use super::*;
use std::collections::HashMap;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

const KEY: &str = "synthetic-xai-test-key";
struct Request {
    path: String,
    headers: String,
    body: Vec<u8>,
}
struct Reply {
    code: u16,
    mime: &'static str,
    body: Vec<u8>,
    extra: String,
}
impl Reply {
    fn json(value: Value) -> Self {
        Self {
            code: 200,
            mime: "application/json",
            body: value.to_string().into_bytes(),
            extra: String::new(),
        }
    }
    fn sse(body: String) -> Self {
        Self {
            code: 200,
            mime: "text/event-stream; charset=utf-8",
            body: body.into_bytes(),
            extra: String::new(),
        }
    }
}
fn read_request(socket: &mut std::net::TcpStream) -> Request {
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    socket
        .set_write_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    let end = loop {
        let read = socket.read(&mut buffer).unwrap();
        assert!(read > 0);
        bytes.extend_from_slice(&buffer[..read]);
        assert!(bytes.len() <= 1024 * 1024);
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            break end + 4;
        }
    };
    let headers = String::from_utf8(bytes[..end].to_vec()).unwrap();
    let length = headers
        .lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
        .map(|(_, value)| value.trim().parse::<usize>().unwrap())
        .unwrap_or(0);
    while bytes.len() - end < length {
        let read = socket.read(&mut buffer).unwrap();
        assert!(read > 0);
        bytes.extend_from_slice(&buffer[..read]);
    }
    Request {
        path: headers
            .lines()
            .next()
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .into(),
        headers,
        body: bytes[end..end + length].to_vec(),
    }
}
fn write_reply(socket: &mut std::net::TcpStream, reply: Reply) {
    write!(
        socket,
        "HTTP/1.1 {} Test\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n",
        reply.code,
        reply.mime,
        reply.body.len(),
        reply.extra
    )
    .unwrap();
    socket.write_all(&reply.body).unwrap();
}
fn serve(replies: Vec<Reply>) -> (String, thread::JoinHandle<Vec<Request>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}/v1", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        replies
            .into_iter()
            .map(|reply| {
                let (mut socket, _) = listener.accept().unwrap();
                let request = read_request(&mut socket);
                write_reply(&mut socket, reply);
                request
            })
            .collect()
    });
    (origin, worker)
}

fn key() -> Secret {
    Secret::new(KEY.into()).unwrap()
}
fn model_list() -> Value {
    json!({"models":[{"id":"opaque-model","input_modalities":["text"],"output_modalities":["text"],"capabilities":{"reasoning_effort":["low","high"],"default_reasoning_effort":"high"}}]})
}
fn message(role: &str, text: &str) -> Message {
    Message {
        id: "test".into(),
        chat_id: "chat".into(),
        role: role.into(),
        content: text.into(),
        model: None,
        status: "complete".into(),
        created_at: 1,
        sequence: 1,
    }
}
fn final_item(text: &str) -> Value {
    json!({"type":"message","role":"assistant","status":"completed","id":"msg_test","content":[{"type":"output_text","text":text,"annotations":[]}]})
}
fn events(text: &str) -> Vec<Value> {
    vec![
        json!({"type":"response.created","response":{"id":"resp_test","status":"in_progress"}}),
        json!({"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant","id":"msg_test","status":"in_progress","content":[]}}),
        json!({"type":"response.content_part.added","output_index":0,"content_index":0,"item_id":"msg_test","part":{"type":"output_text","text":""}}),
        json!({"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_test","delta":text}),
        json!({"type":"response.output_text.done","output_index":0,"content_index":0,"item_id":"msg_test","text":text}),
        json!({"type":"response.content_part.done","output_index":0,"content_index":0,"item_id":"msg_test","part":{"type":"output_text","text":text}}),
        json!({"type":"response.output_item.done","output_index":0,"item":final_item(text)}),
        json!({"type":"response.completed","response":{"id":"resp_test","status":"completed","output":[final_item(text)],"error":null,"incomplete_details":null}}),
    ]
}
fn sse(values: &[Value]) -> String {
    values
        .iter()
        .map(|value| {
            format!(
                "event: {}\r\ndata: {value}\r\n\r\n",
                value["type"].as_str().unwrap()
            )
        })
        .collect()
}
fn consume(values: &[Value]) -> (String, Result<bool, String>) {
    let mut state = TextStream::default();
    let mut text = String::new();
    let mut result = Ok(false);
    for value in values {
        result = state.event(value.clone(), &mut |delta| {
            text.push_str(delta);
            Ok(())
        });
        if result != Ok(false) {
            break;
        }
    }
    (text, result)
}

#[tokio::test]
async fn discovery_uses_language_modalities_and_returned_reasoning_without_guessing_names() {
    let models = json!({"models":[
        {"id":"opaque/text","input_modalities":["text","image"],"output_modalities":["text"],"capabilities":{"reasoning_effort":["low","high",7,"bad option"],"default_reasoning_effort":"high"}},
        {"id":"opaque/text","input_modalities":["text"],"output_modalities":["text"]},
        {"id":"image-only","input_modalities":["text"],"output_modalities":["image"]},
        {"id":"unknown-modalities"}, {"id":"bad id","input_modalities":["text"],"output_modalities":["text"]}
    ]});
    let (origin, worker) = serve(vec![Reply::json(models)]);
    let http = Http::for_test(origin);
    let discovered = http.discover(&key()).await.unwrap();
    assert_eq!(discovered.len(), 1);
    assert_eq!(discovered[0].id, "xai:opaque/text");
    assert_eq!(discovered[0].reasoning_efforts, vec!["low", "high"]);
    assert_eq!(
        discovered[0].default_reasoning_effort.as_deref(),
        Some("high")
    );
    let request = worker.join().unwrap().remove(0);
    assert_eq!(request.path, "/v1/language-models");
    assert!(!request.path.contains(KEY));
    assert!(
        request
            .headers
            .to_lowercase()
            .contains(&format!("authorization: bearer {KEY}"))
    );
    let built = http
        .request(reqwest::Method::GET, "/language-models", &key())
        .unwrap()
        .build()
        .unwrap();
    assert!(built.headers()["authorization"].is_sensitive());
}

#[tokio::test]
async fn responses_send_local_text_and_instructions_with_storage_disabled_and_no_tools() {
    let (origin, worker) = serve(vec![Reply::sse(sse(&events("Grüezi 🦀")))]);
    let mut output = String::new();
    Http::for_test(origin)
        .stream(
            &key(),
            "opaque-model",
            &[
                message("user", "previous"),
                message("assistant", "answer"),
                message("user", "current"),
            ],
            Some("workspace instructions"),
            &ModelOptions {
                reasoning_effort: Some("high".into()),
                service_tier: None,
            },
            |delta| {
                output.push_str(delta);
                Ok(())
            },
        )
        .await
        .unwrap();
    assert_eq!(output, "Grüezi 🦀");
    let request = worker.join().unwrap().remove(0);
    assert_eq!(request.path, "/v1/responses");
    let body: Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(body["store"], false);
    assert_eq!(body["stream"], true);
    assert_eq!(body["max_output_tokens"], 4096);
    assert_eq!(body["reasoning"]["effort"], "high");
    assert_eq!(body["instructions"], "workspace instructions");
    assert_eq!(body["input"][2]["content"], "current");
    for omitted in [
        "previous_response_id",
        "include",
        "tools",
        "tool_choice",
        "search_parameters",
        "temperature",
        "top_p",
        "service_tier",
    ] {
        assert!(body.get(omitted).is_none());
    }
}

#[test]
fn typed_events_fragmented_utf8_and_terminal_alias_do_not_duplicate_final_text() {
    let source = sse(&events("Grüezi 🦀"));
    let mut decoder = Decoder::new(INVALID_STREAM);
    let mut state = TextStream::default();
    let mut output = String::new();
    let mut done = false;
    for byte in source.as_bytes() {
        done |= decoder
            .push(&[*byte], |value| {
                state.event(value, &mut |delta| {
                    output.push_str(delta);
                    Ok(())
                })
            })
            .unwrap();
    }
    assert!(done);
    assert_eq!(output, "Grüezi 🦀");
    let mut values = events("retained");
    values.last_mut().unwrap()["type"] = "response.done".into();
    assert_eq!(consume(&values), ("retained".into(), Ok(true)));
}

#[test]
fn data_only_frames_optional_closers_and_terminal_snapshots_preserve_exact_text() {
    let mut values = events("kept");
    values.retain(|value| {
        !matches!(
            value["type"].as_str(),
            Some(
                "response.output_text.done"
                    | "response.content_part.done"
                    | "response.output_item.done"
            )
        )
    });
    values[2]["part"].as_object_mut().unwrap().remove("text");
    assert_eq!(consume(&values), ("kept".into(), Ok(true)));
    let wire: String = values
        .iter()
        .map(|value| format!("data: {value}\n\n"))
        .collect();
    let mut decoder = Decoder::new(INVALID_STREAM);
    let mut state = TextStream::default();
    let mut text = String::new();
    assert!(
        decoder
            .push(wire.as_bytes(), |value| state.event(value, &mut |delta| {
                text.push_str(delta);
                Ok(())
            }))
            .unwrap()
    );
    assert_eq!(text, "kept");
    let mut values = events("kept");
    values.last_mut().unwrap()["response"]["output"] = json!([]);
    assert_eq!(consume(&values), ("kept".into(), Ok(true)));
    values.remove(6);
    assert!(consume(&values).1.is_err());
    let mut values = events("kept");
    values.insert(5, json!({"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_test","delta":"late"}));
    assert_eq!(consume(&values).0, "kept");
    assert!(consume(&values).1.is_err());
}

#[test]
fn empty_reasoning_ids_and_private_reasoning_events_do_not_become_answer_text() {
    let mut values = events("answer");
    for value in &mut values {
        if value.get("output_index").is_some() {
            value["output_index"] = 1.into();
        }
    }
    values.splice(1..1, [
        json!({"type":"response.output_item.added","output_index":0,"item":{"id":"","type":"reasoning"}}),
        json!({"type":"response.reasoning_summary_text.delta","output_index":0,"item_id":"","delta":"hidden reasoning"}),
        json!({"type":"response.reasoning_text.delta","output_index":0,"item_id":"","content_index":0,"delta":"private chain"}),
        json!({"type":"response.reasoning_text.done","output_index":0,"item_id":"","content_index":0,"text":"private chain"}),
        json!({"type":"response.output_item.done","output_index":0,"item":{"id":"","type":"reasoning","encrypted_content":"ignored"}}),
    ]);
    values.last_mut().unwrap()["response"]["output"] =
        json!([{"id":"","type":"reasoning"}, final_item("answer")]);
    assert_eq!(consume(&values), ("answer".into(), Ok(true)));
    values[3]["item_id"] = "unrelated".into();
    assert!(consume(&values).1.is_err());
}

#[test]
fn multiple_messages_keep_terminal_order_and_reject_interleaved_text() {
    let mut first = events("AC");
    first.pop();
    let mut second = events("B");
    second.remove(0);
    for value in &mut second {
        if value.get("output_index").is_some() {
            value["output_index"] = 1.into();
        }
        if value.get("item_id").is_some() {
            value["item_id"] = "msg_second".into();
        }
        if value.get("item").is_some() {
            value["item"]["id"] = "msg_second".into();
        }
    }
    let mut second_final = final_item("B");
    second_final["id"] = "msg_second".into();
    second.last_mut().unwrap()["response"]["output"] = json!([final_item("AC"), second_final]);
    let mut ordered = first.clone();
    ordered.extend(second.clone());
    assert_eq!(consume(&ordered), ("ACB".into(), Ok(true)));

    // A, new message B, then C would append ABC while the final items say ACB.
    let mut interleaved = first[..4].to_vec();
    interleaved[3]["delta"] = "A".into();
    interleaved.extend(second[..3].iter().cloned());
    interleaved.push(json!({"type":"response.output_text.delta","output_index":0,"content_index":0,"item_id":"msg_test","delta":"C"}));
    interleaved.extend(first[4..].iter().cloned());
    interleaved.extend(second[3..].iter().cloned());
    let (text, result) = consume(&interleaved);
    assert_eq!(text, "A");
    assert!(result.is_err());
}

#[tokio::test]
async fn dropping_pending_xai_http_consumption_disconnects_the_owned_request() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}/v1", listener.local_addr().unwrap());
    let (started, observed) = tokio::sync::oneshot::channel();
    let worker = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        read_request(&mut socket);
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 100000\r\n\r\n").unwrap();
        started.send(()).unwrap();
        let mut byte = [0];
        match socket.read(&mut byte) {
            Ok(0) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::ConnectionAborted
                        | std::io::ErrorKind::BrokenPipe
                ) => {}
            other => panic!("owned xAI stream did not disconnect: {other:?}"),
        }
    });
    let http = Http::for_test(origin);
    let key = key();
    let context = [message("user", "current")];
    let options = ModelOptions::default();
    {
        let pending = http.stream(&key, "test", &context, None, &options, |_| Ok(()));
        tokio::pin!(pending);
        tokio::select! { result=&mut pending => panic!("unexpected completion: {result:?}"), result=observed => result.unwrap(), }
    }
    tokio::task::spawn_blocking(move || worker.join().unwrap())
        .await
        .unwrap();
}

#[test]
fn failure_incomplete_mismatched_terminal_and_unsupported_tool_keep_partial_text() {
    for kind in ["response.incomplete", "response.failed", "error"] {
        let mut values = events("kept");
        values.truncate(4);
        values.push(json!({"type":kind,"message":KEY}));
        let (text, error) = consume(&values);
        assert_eq!(text, "kept");
        assert!(!error.unwrap_err().contains(KEY));
    }
    for change in [
        json!({"status":"incomplete"}),
        json!({"id":"wrong"}),
        json!({"output":[final_item("not streamed")]}),
        json!({"error":{"message":KEY}}),
    ] {
        let mut values = events("kept");
        for (key, value) in change.as_object().unwrap() {
            values.last_mut().unwrap()["response"][key] = value.clone();
        }
        let (text, result) = consume(&values);
        assert_eq!(text, "kept");
        assert!(result.is_err());
    }
    let mut values = events("kept");
    values.truncate(4);
    values.push(json!({"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"tool","name":"unsafe"}}));
    let (text, result) = consume(&values);
    assert_eq!(text, "kept");
    assert!(result.is_err());
}

#[test]
fn malformed_item_part_delta_and_content_done_cannot_complete() {
    for index in [1usize, 2, 3, 4, 5, 6] {
        let mut values = events("kept");
        if index == 6 {
            values[index]["item"]["content"][0]["text"] = "wrong".into();
        } else {
            values[index]["output_index"] = 77.into();
        }
        assert!(consume(&values).1.is_err());
    }
    let mut values = events("kept");
    values[3]["item_id"] = "different".into();
    assert!(consume(&values).1.is_err());
    let mut values = events("kept");
    values[2]["part"]["type"] = "refusal".into();
    assert!(consume(&values).1.is_err());
    let mut state = TextStream::default();
    let mut result = Ok(false);
    for value in events("kept") {
        result = state.event(value, &mut |_| Err("Checkpoint failed.".into()));
        if result.is_err() {
            break;
        }
    }
    assert_eq!(result, Err("Checkpoint failed.".into()));
}

#[tokio::test]
async fn eof_or_done_only_is_not_a_successful_response_and_mime_is_checked() {
    for body in [
        sse(&events("kept")[..7]),
        format!("{}data: [DONE]\n\n", sse(&events("kept")[..7])),
    ] {
        let (origin, worker) = serve(vec![Reply::sse(body)]);
        let mut text = String::new();
        assert!(
            Http::for_test(origin)
                .stream(
                    &key(),
                    "test",
                    &[message("user", "current")],
                    None,
                    &ModelOptions::default(),
                    |delta| {
                        text.push_str(delta);
                        Ok(())
                    }
                )
                .await
                .is_err()
        );
        assert_eq!(text, "kept");
        worker.join().unwrap();
    }
    let (origin, worker) = serve(vec![Reply::json(json!({"type":"response.completed"}))]);
    assert!(
        Http::for_test(origin)
            .stream(
                &key(),
                "test",
                &[message("user", "current")],
                None,
                &ModelOptions::default(),
                |_| Ok(())
            )
            .await
            .is_err()
    );
    worker.join().unwrap();
}

#[tokio::test]
async fn status_errors_are_redacted_redirects_refused_and_http_is_test_only() {
    for code in [302, 400, 401, 403, 429, 500] {
        let (origin, worker) = serve(vec![Reply {
            code,
            mime: "text/plain",
            body: KEY.as_bytes().to_vec(),
            extra: "Location: http://127.0.0.1:9/leak\r\n".into(),
        }]);
        let error = Http::for_test(origin).discover(&key()).await.err().unwrap();
        assert!(!error.contains(KEY));
        assert!(!error.contains("127.0.0.1"));
        worker.join().unwrap();
    }
    assert!(
        Http {
            client: Http::client(true).unwrap(),
            origin: "http://127.0.0.1:9/v1".into()
        }
        .discover(&key())
        .await
        .is_err()
    );
    let (origin, worker) = serve(vec![Reply::json(
        json!({"models":vec![json!({"id":"x"});201]}),
    )]);
    assert!(Http::for_test(origin).discover(&key()).await.is_err());
    worker.join().unwrap();
}

#[test]
fn actual_persisted_duplicate_runs_keep_separate_xai_snapshots_and_other_providers() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = pavane_core::Store::open(&directory.path().join("test.sqlite3")).unwrap();
    let chat = store.create_chat(false, None, 1).unwrap();
    let models = vec![
        "xai:opaque".into(),
        "gemini:other".into(),
        "claude:other".into(),
        "xai:opaque".into(),
    ];
    let (_, runs) = store
        .begin_turn(&chat.id, "synthetic prompt", &models, 1)
        .unwrap();
    let mut keys = crate::KeySnapshots::new();
    keys.insert(
        "xai:opaque".into(),
        std::collections::VecDeque::from([
            Secret::new("synthetic-first".into()).unwrap(),
            Secret::new("synthetic-second".into()).unwrap(),
        ]),
    );
    let requests: Vec<_> = runs
        .iter()
        .map(|run| {
            crate::request_for_run(
                run,
                &HashMap::new(),
                &mut crate::KeySnapshots::new(),
                &mut crate::ClaudeKeys::new(),
                &mut keys,
            )
        })
        .collect();
    assert_eq!(
        requests[0].xai_key.as_ref().unwrap().as_bytes(),
        b"synthetic-first"
    );
    assert_eq!(
        requests[3].xai_key.as_ref().unwrap().as_bytes(),
        b"synthetic-second"
    );
    assert!(requests[1].xai_key.is_none() && requests[2].xai_key.is_none());
    assert!(keys.values().all(std::collections::VecDeque::is_empty));
}

#[cfg(windows)]
mod managed {
    use super::*;
    use std::sync::Arc;
    struct Profile {
        vault: XaiVault,
        directory: tempfile::TempDir,
    }
    impl Profile {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            Self {
                vault: XaiVault::new(directory.path()).unwrap(),
                directory,
            }
        }
    }
    impl Drop for Profile {
        fn drop(&mut self) {
            let _ = self.vault.delete();
        }
    }
    fn manager(profile: &Profile, origin: String) -> Arc<Manager> {
        Arc::new(Manager {
            vault: XaiVault::new(profile.directory.path()),
            http: Ok(Http::for_test(origin)),
            state: Mutex::new(CatalogState::default()),
        })
    }
    #[tokio::test]
    async fn missing_key_does_not_connect_and_options_are_authorized_from_returned_metadata() {
        let profile = Profile::new();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let empty = manager(
            &profile,
            format!("http://{}/v1", listener.local_addr().unwrap()),
        );
        assert_eq!(empty.catalog().await.unwrap().1.state, "needsKey");
        assert!(listener.accept().is_err());
        let (origin, worker) = serve(vec![Reply::json(model_list())]);
        let api = manager(&profile, origin);
        api.save_key(KEY.into()).await.unwrap();
        let (models, _) = api.catalog().await.unwrap();
        api.authorize(
            &models[0].id,
            &ModelOptions {
                reasoning_effort: Some("high".into()),
                service_tier: None,
            },
        )
        .await
        .unwrap();
        assert!(
            api.authorize(
                &models[0].id,
                &ModelOptions {
                    reasoning_effort: Some("unsupported".into()),
                    service_tier: None
                }
            )
            .await
            .is_err()
        );
        assert!(
            api.authorize("xai:forged", &ModelOptions::default())
                .await
                .is_err()
        );
        let captured = api
            .authorize(&models[0].id, &ModelOptions::default())
            .await
            .unwrap();
        profile
            .vault
            .write(Secret::new("synthetic-replacement".into()).unwrap())
            .unwrap();
        assert!(
            api.stream(
                &models[0].id,
                captured,
                &[message("user", "current")],
                None,
                &ModelOptions::default(),
                |_| Ok(())
            )
            .await
            .is_err()
        );
        api.remove_key().await.unwrap();
        assert!(profile.vault.read().unwrap().is_none());
        worker.join().unwrap();
    }
    #[tokio::test]
    async fn rekey_during_discovery_cannot_publish_old_catalog() {
        let profile = Profile::new();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}/v1", listener.local_addr().unwrap());
        let (started, observed) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let worker = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            read_request(&mut socket);
            started.send(()).unwrap();
            wait.recv_timeout(Duration::from_secs(5)).unwrap();
            write_reply(&mut socket, Reply::json(model_list()));
        });
        let api = manager(&profile, origin);
        api.save_key(KEY.into()).await.unwrap();
        let pending = {
            let api = api.clone();
            tokio::spawn(async move { api.catalog().await })
        };
        observed.await.unwrap();
        api.save_key("synthetic-replacement".into()).await.unwrap();
        release.send(()).unwrap();
        assert!(pending.await.unwrap().is_err());
        assert!(api.state.lock().await.models.is_empty());
        worker.join().unwrap();
    }
}
