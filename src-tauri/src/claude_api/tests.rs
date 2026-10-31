use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

const KEY: &str = "synthetic-claude-test-key";
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

fn credential() -> ClaudeCredential {
    ClaudeCredential::new(KEY.into(), Some("wrkspc_test".into())).unwrap()
}
fn model_list() -> Value {
    json!({"data":[{"id":"opaque-text-model","display_name":"Test text","lifecycle":"active","max_tokens":2048}],"has_more":false})
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
fn events(text: &str, reason: &str) -> Vec<Value> {
    vec![
        json!({"type":"message_start","message":{"role":"assistant","content":[],"stop_reason":null}}),
        json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":text}}),
        json!({"type":"content_block_stop","index":0}),
        json!({"type":"message_delta","delta":{"stop_reason":reason},"usage":{"output_tokens":4}}),
        json!({"type":"message_stop"}),
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
    let mut stream = TextStream::default();
    let mut output = String::new();
    let mut result = Ok(false);
    for value in values {
        result = stream.event(value.clone(), &mut |text| {
            output.push_str(text);
            Ok(())
        });
        if result != Ok(false) {
            break;
        }
    }
    (output, result)
}

#[tokio::test]
async fn discovery_is_versioned_scoped_paginated_and_does_not_guess_model_families() {
    let first = json!({"data":[
        {"id":"opaque/model","display_name":"Opaque","lifecycle":"active","max_tokens":1024},
        {"id":"old","lifecycle":"deprecated"}, {"id":"retired","lifecycle":"retired"},
        {"id":"zero","max_tokens":0}, {"id":"bad id"}
    ],"has_more":true,"last_id":"cursor/?&two"});
    let second = json!({"data":[{"id":"opaque/model"},{"id":"new","max_tokens":null,"capabilities":null}],"has_more":false});
    let (origin, worker) = serve(vec![Reply::json(first), Reply::json(second)]);
    let entries = Http::for_test(origin)
        .discover(&credential())
        .await
        .unwrap();
    assert_eq!(
        entries
            .iter()
            .map(|e| e.model.id.as_str())
            .collect::<Vec<_>>(),
        vec!["claude:opaque/model", "claude:new"]
    );
    assert_eq!(entries[0].max_tokens, 1024);
    assert_eq!(entries[1].max_tokens, 4096);
    for request in worker.join().unwrap() {
        assert!(!request.path.contains(KEY));
        let headers = request.headers.to_lowercase();
        assert!(headers.contains(&format!("authorization: bearer {KEY}")));
        assert!(headers.contains("anthropic-workspace-id: wrkspc_test"));
        assert!(headers.contains(&format!("anthropic-version: {VERSION}")));
        assert!(!headers.contains("x-api-key:"));
        assert!(request.path.contains("lifecycle%5B%5D=active"));
        if request.path.contains("after_id") {
            assert!(request.path.contains("cursor%2F%3F%26two"));
        }
    }
}

#[tokio::test]
async fn discovery_rejects_repeated_or_malformed_pagination() {
    let page = json!({"data":[],"has_more":true,"last_id":"repeat"});
    let (origin, worker) = serve(vec![Reply::json(page.clone()), Reply::json(page)]);
    assert!(
        Http::for_test(origin)
            .discover(&credential())
            .await
            .is_err()
    );
    assert_eq!(worker.join().unwrap().len(), 2);
    for page in [
        json!({"data":[]}),
        json!({"data":[],"has_more":true}),
        json!({"data":{}}),
    ] {
        let (origin, worker) = serve(vec![Reply::json(page)]);
        assert!(
            Http::for_test(origin)
                .discover(&credential())
                .await
                .is_err()
        );
        worker.join().unwrap();
    }
}

#[tokio::test]
async fn requests_preserve_text_context_system_and_output_bound_without_legacy_controls() {
    let (origin, worker) = serve(vec![Reply::sse(sse(&events("Grüezi 🦀", "end_turn")))]);
    let mut output = String::new();
    Http::for_test(origin)
        .stream(
            &credential(),
            "opaque/model",
            1024,
            &[
                message("user", "one"),
                message("assistant", "first"),
                message("assistant", "second"),
                message("user", "current"),
            ],
            Some("workspace instructions"),
            |text| {
                output.push_str(text);
                Ok(())
            },
        )
        .await
        .unwrap();
    assert_eq!(output, "Grüezi 🦀");
    let request = worker.join().unwrap().remove(0);
    assert_eq!(request.path, "/v1/messages");
    let body: Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(body["model"], "opaque/model");
    assert_eq!(body["max_tokens"], 1024);
    assert_eq!(body["system"], "workspace instructions");
    assert_eq!(body["stream"], true);
    assert_eq!(body["messages"].as_array().unwrap().len(), 3);
    assert_eq!(body["messages"][1]["content"].as_array().unwrap().len(), 2);
    for omitted in [
        "temperature",
        "top_p",
        "top_k",
        "tools",
        "thinking",
        "stop_sequences",
    ] {
        assert!(body.get(omitted).is_none());
    }
}

#[tokio::test]
async fn workspace_scoped_key_can_omit_header_and_incomplete_stream_keeps_partial_text() {
    let mut partial = events("retained", "end_turn");
    partial.pop();
    let (origin, worker) = serve(vec![Reply::sse(sse(&partial))]);
    let connection = ClaudeCredential::new(KEY.into(), None).unwrap();
    let mut output = String::new();
    assert!(
        Http::for_test(origin)
            .stream(
                &connection,
                "test",
                4096,
                &[message("user", "current")],
                None,
                |text| {
                    output.push_str(text);
                    Ok(())
                }
            )
            .await
            .is_err()
    );
    assert_eq!(output, "retained");
    assert!(
        !worker.join().unwrap()[0]
            .headers
            .to_lowercase()
            .contains("anthropic-workspace-id")
    );
}

#[tokio::test]
async fn status_errors_do_not_echo_remote_body_or_follow_redirects_or_retry() {
    for code in [302, 400, 401, 403, 429, 500] {
        let reply = Reply {
            code,
            mime: "text/plain",
            body: format!("secret echoed {KEY}").into_bytes(),
            extra: "Location: http://127.0.0.1:9/leak\r\n".into(),
        };
        let (origin, worker) = serve(vec![reply]);
        let error = Http::for_test(origin)
            .discover(&credential())
            .await
            .err()
            .unwrap();
        assert!(!error.contains(KEY));
        assert!(!error.contains("127.0.0.1"));
        assert_eq!(worker.join().unwrap().len(), 1);
    }
    let http = Http {
        client: Http::client(true).unwrap(),
        origin: "http://127.0.0.1:9/v1".into(),
    };
    assert!(http.discover(&credential()).await.is_err());
}

#[test]
fn sse_preserves_fragmented_utf8_crlf_and_validates_named_event_type() {
    let source = sse(&events("Grüezi 🦀", "end_turn"));
    let mut decoder = Decoder::default();
    let mut state = TextStream::default();
    let mut output = String::new();
    let mut done = false;
    for byte in source.as_bytes() {
        done |= decoder
            .push(&[*byte], |value| {
                state.event(value, &mut |text| {
                    output.push_str(text);
                    Ok(())
                })
            })
            .unwrap();
    }
    assert!(done);
    assert_eq!(output, "Grüezi 🦀");
    assert!(
        Decoder::default()
            .push(b"event: ping\ndata: {\"type\":\"error\"}\n\n", |_| Ok(
                false
            ))
            .is_err()
    );
    assert!(
        Decoder::default()
            .push(b"data: \xff\n\n", |_| Ok(false))
            .is_err()
    );
    assert!(
        Decoder::default()
            .push(&vec![b'x'; MAX_FRAME + 1], |_| Ok(false))
            .is_err()
    );
}

#[test]
fn only_end_turn_completes_and_limits_refusal_tools_unknown_stops_keep_partial_text() {
    assert_eq!(
        consume(&events("kept", "end_turn")),
        ("kept".into(), Ok(true))
    );
    for reason in [
        "max_tokens",
        "model_context_window_exceeded",
        "refusal",
        "tool_use",
        "pause_turn",
        "stop_sequence",
        "unknown",
    ] {
        let (text, result) = consume(&events("kept", reason));
        assert_eq!(text, "kept");
        assert!(result.is_err());
    }
    let mut values = events("kept", "end_turn");
    values.insert(3, json!({"type":"error","error":{"message":KEY}}));
    let (text, error) = consume(&values);
    assert_eq!(text, "kept");
    assert!(!error.unwrap_err().contains(KEY));
}

#[test]
fn thinking_and_cumulative_usage_are_not_rendered_and_tool_blocks_fail_closed() {
    let mut values = events("answer", "end_turn");
    values.splice(1..1,[
        json!({"type":"ping"}),json!({"type":"future_ping"}),
        json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"hidden"}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hidden"}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"hidden"}}),
        json!({"type":"content_block_stop","index":0}),
    ]);
    for value in &mut values[7..10] {
        value["index"] = 1.into();
    }
    values.insert(
        values.len() - 1,
        json!({"type":"message_delta","delta":{},"usage":{"output_tokens":4}}),
    );
    assert_eq!(consume(&values), ("answer".into(), Ok(true)));
    let mut tool = events("kept", "end_turn");
    tool.insert(4,json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","name":"unsafe"}}));
    let (text, result) = consume(&tool);
    assert_eq!(text, "kept");
    assert!(result.is_err());
}

#[test]
fn malformed_block_order_and_substantive_extensions_do_not_complete() {
    for invalid in [
        json!({"type":"content_block_delta","index":9,"delta":{"type":"text_delta","text":"bad"}}),
        json!({"type":"message_start","message":{"role":"assistant","content":[]}}),
        json!({"type":"future_output","content":"unsupported"}),
        json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":"bad"}}),
    ] {
        let mut values = events("kept", "end_turn");
        values.insert(3, invalid);
        let (text, result) = consume(&values);
        assert_eq!(text, "kept");
        assert!(result.is_err());
    }
    let mut state = TextStream::default();
    let mut result = Ok(false);
    for value in events("kept", "end_turn") {
        result = state.event(value, &mut |_| Err("Checkpoint failed.".into()));
        if result.is_err() {
            break;
        }
    }
    assert_eq!(result, Err("Checkpoint failed.".into()));
    let mut late_malformed = events("kept", "end_turn");
    late_malformed.insert(
        late_malformed.len() - 1,
        json!({"type":"message_delta","delta":null}),
    );
    let (text, result) = consume(&late_malformed);
    assert_eq!(text, "kept");
    assert!(result.is_err());
}

#[test]
fn actual_persisted_duplicate_runs_receive_distinct_claude_connection_snapshots() {
    let directory = tempfile::tempdir().unwrap();
    let mut store = pavane_core::Store::open(&directory.path().join("test.sqlite3")).unwrap();
    let chat = store.create_chat(false, None, 1).unwrap();
    let models = vec![
        "claude:opaque".into(),
        "gemini:other".into(),
        "claude:opaque".into(),
    ];
    let (_, runs) = store
        .begin_turn(&chat.id, "synthetic prompt", &models, 1)
        .unwrap();
    let mut keys = crate::ClaudeKeys::new();
    keys.insert(
        "claude:opaque".into(),
        std::collections::VecDeque::from([
            Authorization {
                connection: ClaudeCredential::new(
                    "synthetic-first".into(),
                    Some("wrkspc_first".into()),
                )
                .unwrap(),
                max_tokens: 100,
            },
            Authorization {
                connection: ClaudeCredential::new(
                    "synthetic-second".into(),
                    Some("wrkspc_second".into()),
                )
                .unwrap(),
                max_tokens: 200,
            },
        ]),
    );
    let mut gemini = crate::GeminiKeys::new();
    let requests: Vec<_> = runs
        .iter()
        .map(|run| {
            crate::request_for_run(
                run,
                &std::collections::HashMap::new(),
                &mut gemini,
                &mut keys,
            )
        })
        .collect();
    let first = requests[0].claude_authorization.as_ref().unwrap();
    let second = requests[2].claude_authorization.as_ref().unwrap();
    assert_eq!(first.connection.workspace(), Some("wrkspc_first"));
    assert_eq!(second.connection.workspace(), Some("wrkspc_second"));
    assert!(!first.connection.same_identity(&second.connection));
    assert!(requests[1].claude_authorization.is_none());
    assert!(keys.values().all(std::collections::VecDeque::is_empty));
}

#[tokio::test]
async fn dropping_a_pending_http_stream_disconnects_the_owned_request() {
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
            other => panic!("owned stream did not disconnect: {other:?}"),
        }
    });
    let http = Http::for_test(origin);
    let connection = credential();
    let context = [message("user", "current")];
    {
        let pending = http.stream(&connection, "test", 4096, &context, None, |_| Ok(()));
        tokio::pin!(pending);
        tokio::select! { result=&mut pending => panic!("unexpected completion: {result:?}"), result=observed=>result.unwrap(), }
    }
    tokio::task::spawn_blocking(move || worker.join().unwrap())
        .await
        .unwrap();
}

#[cfg(windows)]
mod managed {
    use super::*;
    use std::sync::Arc;
    struct Profile {
        vault: ClaudeVault,
        directory: tempfile::TempDir,
    }
    impl Profile {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            Self {
                vault: ClaudeVault::new(directory.path()).unwrap(),
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
            vault: ClaudeVault::new(profile.directory.path()),
            http: Ok(Http::for_test(origin)),
            state: Mutex::new(CatalogState::default()),
        })
    }

    #[tokio::test]
    async fn missing_key_has_no_network_and_workspace_replacement_invalidates_queued_identity() {
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
        api.save_connection(KEY.into(), Some("wrkspc_first".into()))
            .await
            .unwrap();
        let (models, _) = api.catalog().await.unwrap();
        let snapshot = api
            .authorize(&models[0].id, &ModelOptions::default())
            .await
            .unwrap();
        assert!(
            api.authorize("claude:forged", &ModelOptions::default())
                .await
                .is_err()
        );
        assert!(
            api.authorize(
                &models[0].id,
                &ModelOptions {
                    reasoning_effort: Some("high".into()),
                    service_tier: None
                }
            )
            .await
            .is_err()
        );
        profile
            .vault
            .write(ClaudeCredential::new(KEY.into(), Some("wrkspc_second".into())).unwrap())
            .unwrap();
        assert!(
            api.stream(
                &models[0].id,
                snapshot,
                &[message("user", "current")],
                None,
                |_| Ok(())
            )
            .await
            .is_err()
        );
        api.remove_connection().await.unwrap();
        assert!(profile.vault.read().unwrap().is_none());
        worker.join().unwrap();
    }

    #[tokio::test]
    async fn changed_connection_during_discovery_cannot_publish_old_catalog() {
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
        api.save_connection(KEY.into(), Some("wrkspc_first".into()))
            .await
            .unwrap();
        let pending = {
            let api = api.clone();
            tokio::spawn(async move { api.catalog().await })
        };
        observed.await.unwrap();
        api.save_connection(KEY.into(), Some("wrkspc_second".into()))
            .await
            .unwrap();
        release.send(()).unwrap();
        assert!(pending.await.unwrap().is_err());
        assert!(api.state.lock().await.models.is_empty());
        worker.join().unwrap();
    }
}
