use pavane_core::{DELETE_SOON_MS, Store};
const NOW: i64 = 1_800_000_000_000;

#[test]
fn chats_drafts_and_messages_survive_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pavane.sqlite3");
    let store = Store::open(&path).unwrap();
    let chat = store.create_chat(false, None, NOW).unwrap();
    store.save_draft(&chat.id, "unsent thought", NOW).unwrap();
    drop(store);
    let mut reopened = Store::open(&path).unwrap();
    assert_eq!(reopened.draft(&chat.id, NOW).unwrap(), "unsent thought");
    let (_, runs) = reopened
        .begin_turn(&chat.id, "hello", &["ollama:test".into()], NOW)
        .unwrap();
    reopened
        .update_run(&runs[0], "partial answer", "running", NOW)
        .unwrap();
    drop(reopened);
    let recovered = Store::open(&path).unwrap();
    let messages = recovered.messages(&chat.id, None, NOW).unwrap();
    assert_eq!(messages[1].content, "partial answer");
    assert_eq!(messages[1].status, "interrupted");
    assert_eq!(recovered.draft(&chat.id, NOW).unwrap(), "");
    assert_eq!(recovered.list_chats(NOW, 0, "").unwrap()[0].title, "hello");
}

#[test]
fn delete_soon_expires_at_exact_creation_boundary_and_cascades() {
    let mut store = Store::memory().unwrap();
    let chat = store.create_chat(true, None, NOW).unwrap();
    let (_, runs) = store
        .begin_turn(&chat.id, "temporary", &["ollama:test".into()], NOW)
        .unwrap();
    let deadline = NOW + DELETE_SOON_MS;
    assert_eq!(chat.expires_at, Some(deadline));
    assert_eq!(store.list_chats(deadline - 1, 0, "").unwrap().len(), 1);
    assert!(store.list_chats(deadline, 0, "").unwrap().is_empty());
    assert!(store.messages(&chat.id, None, deadline).is_err());
    assert!(store.keep_chat(&chat.id, deadline).is_err());
    assert!(
        store
            .save_draft(&chat.id, "no resurrection", deadline)
            .is_err()
    );
    assert_eq!(
        store.purge_expired(deadline).unwrap(),
        vec![runs[0].id.clone()]
    );
    assert!(
        store
            .update_run(&runs[0], "late result", "complete", deadline)
            .is_err()
    );
    assert!(store.purge_expired(deadline).unwrap().is_empty());
}

#[test]
fn keep_chat_removes_deadline_without_changing_creation_time() {
    let store = Store::memory().unwrap();
    let chat = store.create_chat(true, None, NOW).unwrap();
    store.keep_chat(&chat.id, NOW + 1).unwrap();
    store.purge_expired(NOW + DELETE_SOON_MS + 1).unwrap();
    let saved = &store.list_chats(NOW + DELETE_SOON_MS + 1, 0, "").unwrap()[0];
    assert_eq!(saved.created_at, NOW);
    assert_eq!(saved.expires_at, None);
}

#[test]
fn parallel_runs_are_atomic_bounded_and_terminal() {
    let mut store = Store::memory().unwrap();
    let chat = store.create_chat(false, None, NOW).unwrap();
    assert!(
        store
            .begin_turn(&chat.id, "hello", &vec!["m".into(); 5], NOW)
            .is_err()
    );
    assert!(store.messages(&chat.id, None, NOW).unwrap().is_empty());
    let (_, runs) = store
        .begin_turn(&chat.id, "hello", &["a".into(), "b".into()], NOW)
        .unwrap();
    assert!(
        store
            .begin_turn(&chat.id, "double click", &["a".into()], NOW)
            .is_err()
    );
    store.update_run(&runs[0], "one", "complete", NOW).unwrap();
    assert!(
        store
            .update_run(&runs[0], "overwrite", "running", NOW)
            .is_err()
    );
    store.update_run(&runs[1], "", "cancelled", NOW).unwrap();
    assert_eq!(store.messages(&chat.id, None, NOW).unwrap().len(), 3);
}

#[test]
fn history_paging_does_not_repeat_or_drop_messages() {
    let mut store = Store::memory().unwrap();
    let chat = store.create_chat(false, None, NOW).unwrap();
    for i in 0..60 {
        let (_, runs) = store
            .begin_turn(&chat.id, &format!("Question {i}"), &["m".into()], NOW + i)
            .unwrap();
        store
            .update_run(&runs[0], "answer", "complete", NOW + i)
            .unwrap();
    }
    let latest = store.messages(&chat.id, None, NOW + 100).unwrap();
    let older = store
        .messages(&chat.id, Some(latest[0].sequence), NOW + 100)
        .unwrap();
    assert_eq!(latest.len(), 100);
    assert_eq!(older.len(), 20);
    assert!(older.last().unwrap().sequence < latest[0].sequence);
}

#[test]
fn workspace_instructions_are_isolated_and_sql_is_parameterized() {
    let store = Store::memory().unwrap();
    let a = store
        .create_workspace("bots", "Writer", "Keep it short.")
        .unwrap();
    let b = store
        .create_workspace("projects", "Research", "Cite sources.")
        .unwrap();
    let chat_a = store.create_chat(false, Some(&a.id), NOW).unwrap();
    let chat_b = store.create_chat(false, Some(&b.id), NOW).unwrap();
    assert_eq!(
        store.instructions(&chat_a.id).unwrap().unwrap(),
        "Keep it short."
    );
    assert_eq!(
        store.instructions(&chat_b.id).unwrap().unwrap(),
        "Cite sources."
    );
    assert!(store.create_chat(false, Some("missing"), NOW).is_err());
    store
        .rename(&chat_a.id, "'; DROP TABLE chats;--", NOW)
        .unwrap();
    assert_eq!(store.list_chats(NOW, 0, "").unwrap().len(), 2);
    store.delete_chat(&chat_a.id).unwrap();
    assert!(store.messages(&chat_a.id, None, NOW).is_err());
    assert!(store.messages(&chat_b.id, None, NOW).unwrap().is_empty());
}
