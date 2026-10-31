use pavane_core::{DELETE_SOON_MS, Store};
const NOW: i64 = 1_800_000_000_000;

#[test]
fn closed_database_backup_restores_saved_conversations() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pavane.sqlite3");
    let backup = directory.path().join("backup.sqlite3");
    let mut store = Store::open(&path).unwrap();
    let chat = store.create_chat(false, None, NOW).unwrap();
    let (_, runs) = store
        .begin_turn(&chat.id, "Original conversation", &["model".into()], NOW)
        .unwrap();
    store
        .update_run(&runs[0], "Original answer", "complete", NOW)
        .unwrap();
    drop(store);
    std::fs::copy(&path, &backup).unwrap();
    let changed = Store::open(&path).unwrap();
    changed.delete_chat(&chat.id).unwrap();
    drop(changed);
    std::fs::copy(&backup, &path).unwrap();
    let restored = Store::open(&path).unwrap();
    assert_eq!(
        restored.messages(&chat.id, None, NOW).unwrap()[1].content,
        "Original answer"
    );
}

#[test]
fn newer_or_corrupt_databases_are_not_replaced() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("newer.sqlite3");
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("PRAGMA user_version=2; CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('keep me');").unwrap();
    drop(connection);
    assert!(Store::open(&path).is_err());
    let connection = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT value FROM sentinel", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "keep me"
    );
    let corrupt = directory.path().join("corrupt.sqlite3");
    let bytes = b"not a SQLite database";
    std::fs::write(&corrupt, bytes).unwrap();
    assert!(Store::open(&corrupt).is_err());
    assert_eq!(std::fs::read(&corrupt).unwrap(), bytes);
}

#[test]
fn second_open_cannot_interrupt_a_live_owner() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pavane.sqlite3");
    let mut first = Store::open(&path).unwrap();
    let chat = first.create_chat(false, None, NOW).unwrap();
    let (_, runs) = first
        .begin_turn(&chat.id, "hello", &["model".into()], NOW)
        .unwrap();
    first
        .update_run(&runs[0], "in progress", "running", NOW)
        .unwrap();
    assert!(Store::open(&path).is_err());
    assert_eq!(
        first.messages(&chat.id, None, NOW).unwrap()[1].status,
        "running"
    );
    first
        .update_run(&runs[0], "finished", "complete", NOW)
        .unwrap();
    drop(first);
    let reopened = Store::open(&path).unwrap();
    assert_eq!(
        reopened.messages(&chat.id, None, NOW).unwrap()[1].status,
        "complete"
    );
}

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

#[test]
fn workspace_edits_survive_reopen_without_replacing_linked_data() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.sqlite3");
    let mut store = Store::open(&path).unwrap();
    let original = store
        .create_workspace("bots", "Writer", "Original rules")
        .unwrap();
    let other = store
        .create_workspace("spaces", "Other", "Other rules")
        .unwrap();
    let chat = store.create_chat(false, Some(&original.id), NOW).unwrap();
    let other_chat = store.create_chat(false, Some(&other.id), NOW).unwrap();
    let (_, runs) = store
        .begin_turn(&chat.id, "Keep my message", &["m".into()], NOW)
        .unwrap();
    store
        .update_run(&runs[0], "Keep my answer", "complete", NOW)
        .unwrap();
    // Sending intentionally clears the submitted draft. Preserve a distinct
    // unsent draft that exists when the workspace is edited.
    store.save_draft(&chat.id, "Keep my draft", NOW).unwrap();
    assert_eq!(store.draft(&chat.id, NOW).unwrap(), "Keep my draft");
    let saved = store
        .update_workspace(&original, "  Writer revised  ", "New rules; 'quoted' text")
        .unwrap();
    assert_eq!(saved.id, original.id);
    assert_eq!(saved.kind, "bots");
    assert_eq!(saved.name, "Writer revised");
    assert_eq!(
        store.instructions(&other_chat.id).unwrap().unwrap(),
        "Other rules"
    );
    drop(store);
    let reopened = Store::open(&path).unwrap();
    assert_eq!(
        reopened.workspace(&original.id).unwrap().instructions,
        saved.instructions
    );
    assert_eq!(
        reopened.instructions(&chat.id).unwrap().unwrap(),
        saved.instructions
    );
    assert_eq!(
        reopened
            .list_chats(NOW, 0, "")
            .unwrap()
            .iter()
            .find(|c| c.id == chat.id)
            .unwrap()
            .workspace_id
            .as_deref(),
        Some(original.id.as_str())
    );
    assert_eq!(reopened.draft(&chat.id, NOW).unwrap(), "Keep my draft");
    let messages = reopened.messages(&chat.id, None, NOW).unwrap();
    assert_eq!(messages[0].content, "Keep my message");
    assert_eq!(messages[1].content, "Keep my answer");
}

#[test]
fn workspace_edit_rejects_stale_missing_or_wrong_kind_snapshots() {
    let store = Store::memory().unwrap();
    let original = store
        .create_workspace("bots", "Writer", "Original")
        .unwrap();
    let saved = store
        .update_workspace(&original, "New name", "New rules")
        .unwrap();
    assert!(
        store
            .update_workspace(&original, "Lost update", "Overwrite")
            .is_err()
    );
    let mut wrong_kind = saved.clone();
    wrong_kind.kind = "spaces".into();
    assert!(
        store
            .update_workspace(&wrong_kind, "Moved", "Overwrite")
            .is_err()
    );
    let mut missing = saved.clone();
    missing.id = uuid::Uuid::new_v4().to_string();
    assert!(
        store
            .update_workspace(&missing, "Missing", "Overwrite")
            .is_err()
    );
    assert!(store.workspace(&missing.id).is_err());
    missing.id = "'; DROP TABLE workspaces;--".into();
    assert!(store.workspace(&missing.id).is_err());
    assert!(
        store
            .update_workspace(&missing, "Invalid ID", "Overwrite")
            .is_err()
    );
    assert_eq!(
        store.workspace(&saved.id).unwrap().instructions,
        "New rules"
    );
    assert_eq!(store.workspaces().unwrap().len(), 1);
    assert!(
        store
            .update_workspace(&saved, &saved.name, &saved.instructions)
            .is_ok()
    );
}

#[test]
fn workspace_edit_enforces_unicode_name_and_utf8_instruction_limits_atomically() {
    let store = Store::memory().unwrap();
    let original = store
        .create_workspace("projects", "Original", "Original rules")
        .unwrap();
    for (name, instructions) in [
        (" ".to_owned(), "Fine".to_owned()),
        ("🦀".repeat(81), "Fine".into()),
        ("Fine".into(), "界".repeat(2731)),
    ] {
        assert!(
            store
                .update_workspace(&original, &name, &instructions)
                .is_err()
        );
        assert_eq!(store.workspace(&original.id).unwrap().name, "Original");
        assert_eq!(
            store.workspace(&original.id).unwrap().instructions,
            "Original rules"
        );
    }
    let saved = store
        .update_workspace(&original, &"🦀".repeat(80), &"x".repeat(8192))
        .unwrap();
    assert_eq!(saved.name.chars().count(), 80);
    assert_eq!(saved.instructions.len(), 8192);
    assert!(
        store
            .update_workspace(&saved, "Fine", &"x".repeat(8193))
            .is_err()
    );
    assert_eq!(store.workspace(&saved.id).unwrap().instructions.len(), 8192);
}
