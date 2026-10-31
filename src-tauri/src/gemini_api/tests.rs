use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

const KEY: &str = "synthetic-gemini-test-key";
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
    let origin = format!("http://{}/v1beta", listener.local_addr().unwrap());
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
fn secret() -> Secret {
    Secret::new(KEY.into()).unwrap()
}
fn model_list() -> Value {
    json!({"models":[{"name":"models/gemini-test","displayName":"Test text","supportedGenerationMethods":["generateContent"]}]})
}
fn event(parts: Value, finish: Option<&str>) -> Value {
    let mut candidate = json!({"index":0,"content":{"role":"model","parts":parts}});
    if let Some(reason) = finish {
        candidate["finishReason"] = reason.into();
    }
    json!({"candidates":[candidate]})
}
fn sse(value: Value) -> String {
    format!("data: {value}\n\n")
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

#[tokio::test]
async fn model_discovery_paginates_filters_and_keeps_keys_out_of_urls() {
    let first = json!({"models":[
        {"name":"models/gemini-test","displayName":"Test text","supportedGenerationMethods":["generateContent"]},
        {"name":"models/../escape","supportedGenerationMethods":["generateContent"]},
        {"name":"models/gemini-image-test","supportedGenerationMethods":["generateContent"]},
        {"name":"models/gemini-embed","supportedGenerationMethods":["embedContent"]}
    ],"nextPageToken":"page /?&two"});
    let second = json!({"models":[
        {"name":"models/gemini-second","supportedGenerationMethods":["generateContent"]},
        {"name":"models/gemini-test","supportedGenerationMethods":["generateContent"]}
    ]});
    let (origin, worker) = serve(vec![Reply::json(first), Reply::json(second)]);
    let models = Http::for_test(origin).discover(&secret()).await.unwrap();
    assert_eq!(
        models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>(),
        ["gemini:gemini-test", "gemini:gemini-second"]
    );
    let requests = worker.join().unwrap();
    assert_eq!(requests.len(), 2);
    for request in &requests {
        assert!(
            request
                .headers
                .to_ascii_lowercase()
                .contains(&format!("x-goog-api-key: {KEY}"))
        );
        assert!(!request.path.contains(KEY));
        assert!(request.body.is_empty());
    }
    let url = reqwest::Url::parse(&format!("http://example.test{}", requests[1].path)).unwrap();
    assert!(
        url.query_pairs()
            .any(|(key, value)| key == "pageToken" && value == "page /?&two")
    );
    assert!(
        models
            .iter()
            .all(|model| model.reasoning_efforts.is_empty() && model.service_tiers.is_empty())
    );
}

#[tokio::test]
async fn repeating_model_page_and_raw_api_failures_are_not_success() {
    let mut repeated = model_list();
    repeated["nextPageToken"] = "again".into();
    let (origin, worker) = serve(vec![Reply::json(repeated.clone()), Reply::json(repeated)]);
    assert!(
        Http::for_test(origin)
            .discover(&secret())
            .await
            .err()
            .unwrap()
            .contains("repeated")
    );
    worker.join().unwrap();
    for code in [401, 403, 429, 500] {
        let (origin, worker) = serve(vec![Reply {
            code,
            mime: "application/json",
            body: b"synthetic-private-diagnostic".to_vec(),
            extra: String::new(),
        }]);
        let error = Http::for_test(origin)
            .discover(&secret())
            .await
            .err()
            .unwrap();
        assert!(!error.contains("synthetic-private-diagnostic"));
        assert!(!error.contains(KEY));
        if code == 429 {
            assert!(error.contains("limit reached"));
        }
        worker.join().unwrap();
    }
}

#[tokio::test]
async fn production_client_refuses_cleartext_and_redirects_do_not_forward_keys() {
    let cleartext = TcpListener::bind("127.0.0.1:0").unwrap();
    cleartext.set_nonblocking(true).unwrap();
    let mut production = Http::new().unwrap();
    production.origin = format!("http://{}/v1beta", cleartext.local_addr().unwrap());
    assert!(production.discover(&secret()).await.is_err());
    assert!(cleartext.accept().is_err());
    let target = TcpListener::bind("127.0.0.1:0").unwrap();
    target.set_nonblocking(true).unwrap();
    let (origin, worker) = serve(vec![Reply {
        code: 307,
        mime: "application/json",
        body: vec![],
        extra: format!(
            "Location: http://{}/capture\r\n",
            target.local_addr().unwrap()
        ),
    }]);
    assert!(
        Http::for_test(origin)
            .discover(&secret())
            .await
            .err()
            .unwrap()
            .contains("No redirect")
    );
    worker.join().unwrap();
    assert!(target.accept().is_err());
    assert!(Http::header(&secret()).unwrap().is_sensitive());
}

#[tokio::test]
async fn native_http_stream_sends_text_context_and_instructions_without_tools() {
    let body = sse(event(
        json!([{"text":"private thought","thought":true},{"text":"Grüezi 🦀"}]),
        None,
    )) + &sse(event(json!([{"text":" done"}]), Some("STOP")));
    let (origin, worker) = serve(vec![Reply::sse(body)]);
    let context = [
        message("user", "First"),
        message("assistant", "Reply one"),
        message("assistant", "Reply two"),
        message("user", "Latest"),
    ];
    let mut output = String::new();
    Http::for_test(origin)
        .stream(
            &secret(),
            "gemini-test",
            &context,
            Some("Bot rules"),
            |text| {
                output.push_str(text);
                Ok(())
            },
        )
        .await
        .unwrap();
    assert_eq!(output, "Grüezi 🦀 done");
    let requests = worker.join().unwrap();
    let request = &requests[0];
    assert!(
        request
            .path
            .starts_with("/v1beta/models/gemini-test:streamGenerateContent?")
    );
    assert!(request.path.contains("alt=sse"));
    assert!(!request.path.contains(KEY));
    let body: Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(body["contents"].as_array().unwrap().len(), 3);
    assert_eq!(body["contents"][1]["role"], "model");
    assert_eq!(body["contents"][1]["parts"].as_array().unwrap().len(), 2);
    assert_eq!(body["contents"][2]["parts"][0]["text"], "Latest");
    assert_eq!(body["systemInstruction"]["parts"][0]["text"], "Bot rules");
    assert_eq!(
        body["generationConfig"]["responseModalities"],
        json!(["TEXT"])
    );
    assert!(body.get("tools").is_none());
    assert!(
        !String::from_utf8(request.body.clone())
            .unwrap()
            .contains(KEY)
    );
}

#[test]
fn fragmented_sse_accepts_crlf_cr_and_multiline_unicode() {
    for ending in ["\n", "\r\n", "\r"] {
        let pretty =
            serde_json::to_string_pretty(&event(json!([{"text":"Grüezi 🦀"}]), None)).unwrap();
        let mut source = format!(": heartbeat{ending}");
        for line in pretty.lines() {
            source.push_str(&format!("data: {line}{ending}"));
        }
        source.push_str(ending);
        let mut decoder = Decoder::default();
        let mut output = String::new();
        let mut bytes = 0;
        for byte in source.as_bytes() {
            decoder
                .push(&[*byte], |value| {
                    process(&value, &mut bytes, &mut |text| {
                        output.push_str(text);
                        Ok(())
                    })
                })
                .unwrap();
        }
        assert_eq!(output, "Grüezi 🦀");
    }
}

#[test]
fn earlier_text_survives_later_malformed_data_in_the_same_transport_chunk() {
    for chunk_size in [1, usize::MAX] {
        let source = sse(event(json!([{"text":"retained partial"}]), None)) + "data: not-json\n\n";
        let mut decoder = Decoder::default();
        let mut output = String::new();
        let mut bytes = 0;
        let mut error = None;
        for chunk in source.as_bytes().chunks(chunk_size.min(source.len())) {
            if let Err(value) = decoder.push(chunk, |value| {
                process(&value, &mut bytes, &mut |text| {
                    output.push_str(text);
                    Ok(())
                })
            }) {
                error = Some(value);
                break;
            }
        }
        assert!(error.is_some());
        assert_eq!(output, "retained partial");
    }
}

#[test]
fn unsupported_parts_roles_and_finish_reasons_fail_closed() {
    for unsupported in [
        "functionCall",
        "functionResponse",
        "inlineData",
        "fileData",
        "executableCode",
        "codeExecutionResult",
    ] {
        let mut part = json!({"text":"must not display"});
        part[unsupported] = json!({});
        let mut bytes = 0;
        let mut calls = 0;
        assert!(
            process(&event(json!([part]), Some("STOP")), &mut bytes, &mut |_| {
                calls += 1;
                Ok(())
            })
            .is_err()
        );
        assert_eq!(calls, 0);
    }
    let mut wrong_role = event(json!([{"text":"no"}]), Some("STOP"));
    wrong_role["candidates"][0]["content"]["role"] = "user".into();
    assert!(process(&wrong_role, &mut 0, &mut |_| Ok(())).is_err());
    for reason in ["SAFETY", "MAX_TOKENS", "RECITATION", "OTHER"] {
        assert!(process(&event(json!([]), Some(reason)), &mut 0, &mut |_| Ok(())).is_err());
    }
}

#[tokio::test]
async fn incomplete_stream_and_checkpoint_failure_retain_delivered_text() {
    let partial = sse(event(json!([{"text":"saved partial"}]), None));
    let (origin, worker) = serve(vec![Reply::sse(partial.clone())]);
    let mut output = String::new();
    assert!(
        Http::for_test(origin)
            .stream(
                &secret(),
                "gemini-test",
                &[message("user", "hello")],
                None,
                |text| {
                    output.push_str(text);
                    Ok(())
                }
            )
            .await
            .is_err()
    );
    assert_eq!(output, "saved partial");
    worker.join().unwrap();
    let (origin, worker) = serve(vec![Reply::sse(partial)]);
    assert!(
        Http::for_test(origin)
            .stream(&secret(), "gemini-test", &[], None, |_| Err(
                "Checkpoint failed.".into()
            ))
            .await
            .unwrap_err()
            .contains("Checkpoint")
    );
    worker.join().unwrap();
}

#[test]
fn decoder_and_output_are_bounded_before_more_text_is_delivered() {
    assert!(
        Decoder::default()
            .push(&vec![b'x'; MAX_FRAME + 1], |_| Ok(false))
            .is_err()
    );
    let mut output = 0;
    let mut delivered = 0;
    let chunk = event(json!([{"text":"x".repeat(200*1024)}]), None);
    while process(&chunk, &mut output, &mut |text| {
        delivered += text.len();
        Ok(())
    })
    .is_ok()
    {}
    assert_eq!(
        delivered,
        pavane_core::MAX_OUTPUT_BYTES / (200 * 1024) * (200 * 1024)
    );
}

#[cfg(windows)]
mod managed_tests {
    use super::*;
    use std::sync::Arc;
    struct Profile {
        vault: Vault,
        directory: tempfile::TempDir,
    }
    impl Profile {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            Self {
                vault: Vault::new(directory.path()).unwrap(),
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
            vault: Vault::new(profile.directory.path()),
            http: Ok(Http::for_test(origin)),
            state: Mutex::new(CatalogState::default()),
        })
    }
    #[tokio::test]
    async fn missing_key_never_connects_and_saved_key_binding_controls_sends() {
        let profile = Profile::new();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let empty = manager(
            &profile,
            format!("http://{}/v1beta", listener.local_addr().unwrap()),
        );
        assert_eq!(empty.catalog().await.unwrap().1.state, "needsKey");
        assert!(listener.accept().is_err());
        let (origin, worker) = serve(vec![Reply::json(model_list())]);
        let api = manager(&profile, origin);
        api.save_key(KEY.into()).await.unwrap();
        assert!(
            profile
                .vault
                .read()
                .unwrap()
                .is_some_and(|key| key.as_bytes() == KEY.as_bytes()),
            "saved synthetic credential must be visible before discovery"
        );
        let (models, _) = api.catalog().await.unwrap_or_else(|error| {
            let current = profile.vault.read().unwrap();
            let classification = match current.as_ref() {
                None => "missing",
                Some(key) if key.as_bytes() == KEY.as_bytes() => "expected",
                Some(_) => "different",
            };
            panic!("{error}; independent synthetic vault reread: {classification}");
        });
        api.authorize(&models[0].id, &ModelOptions::default())
            .await
            .unwrap();
        assert!(
            api.authorize("gemini:forged", &ModelOptions::default())
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
            .write(Secret::new("synthetic-replacement".into()).unwrap())
            .unwrap();
        assert!(
            api.authorize(&models[0].id, &ModelOptions::default())
                .await
                .is_err()
        );
        api.remove_key().await.unwrap();
        assert!(profile.vault.read().unwrap().is_none());
        worker.join().unwrap();
    }
    #[tokio::test]
    async fn rekey_during_discovery_cannot_publish_the_old_catalog() {
        let profile = Profile::new();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}/v1beta", listener.local_addr().unwrap());
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
        tokio::time::timeout(Duration::from_secs(5), observed)
            .await
            .unwrap()
            .unwrap();
        api.save_key("synthetic-new-key".into()).await.unwrap();
        release.send(()).unwrap();
        assert!(pending.await.unwrap().is_err());
        assert!(api.state.lock().await.models.is_empty());
        worker.join().unwrap();
    }
    #[tokio::test]
    async fn a_queued_message_cannot_switch_to_a_replacement_account_key() {
        let profile = Profile::new();
        let (origin, worker) = serve(vec![Reply::json(model_list()), Reply::json(model_list())]);
        let api = manager(&profile, origin);
        api.save_key(KEY.into()).await.unwrap();
        let (models, _) = api.catalog().await.unwrap();
        let captured = api
            .authorize(&models[0].id, &ModelOptions::default())
            .await
            .unwrap();
        api.save_key("synthetic-other-account".into())
            .await
            .unwrap();
        api.catalog().await.unwrap();
        let error = api
            .stream(
                &models[0].id,
                captured,
                &[message("user", "must stay local")],
                None,
                |_| Ok(()),
            )
            .await
            .unwrap_err();
        assert!(error.contains("after this message was queued"));
        let requests = worker.join().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(
            requests
                .iter()
                .all(|request| request.path.contains("/models?"))
        );
    }

    #[tokio::test]
    async fn older_external_key_discovery_cannot_clear_newer_success() {
        let profile = Profile::new();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}/v1beta", listener.local_addr().unwrap());
        let (started, observed) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let worker = thread::spawn(move || {
            let (mut old, _) = listener.accept().unwrap();
            read_request(&mut old);
            started.send(()).unwrap();
            let (mut new, _) = listener.accept().unwrap();
            read_request(&mut new);
            write_reply(&mut new, Reply::json(model_list()));
            wait.recv_timeout(Duration::from_secs(5)).unwrap();
            write_reply(&mut old, Reply::json(model_list()));
        });
        let api = manager(&profile, origin);
        api.save_key(KEY.into()).await.unwrap();
        let old = {
            let api = api.clone();
            tokio::spawn(async move { api.catalog().await })
        };
        tokio::time::timeout(Duration::from_secs(5), observed)
            .await
            .unwrap()
            .unwrap();
        profile
            .vault
            .write(Secret::new("synthetic-newer-key".into()).unwrap())
            .unwrap();
        let (models, _) = api.catalog().await.unwrap();
        release.send(()).unwrap();
        assert!(old.await.unwrap().is_err());
        api.authorize(&models[0].id, &ModelOptions::default())
            .await
            .unwrap();
        worker.join().unwrap();
    }
}

#[tokio::test]
async fn cancelling_a_stream_keeps_partial_text_and_closes_its_response() {
    use tokio_util::sync::CancellationToken;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}/v1beta", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        read_request(&mut socket);
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").unwrap();
        let data = sse(event(json!([{"text":"partial before stop"}]), None));
        write!(socket, "{:x}\r\n{}\r\n", data.len(), data).unwrap();
        socket.flush().unwrap();
        let mut byte = [0];
        match socket.read(&mut byte) {
            Ok(0) => true,
            Err(error) => matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
            ),
            _ => false,
        }
    });
    let http = Http::for_test(origin);
    let key = secret();
    let token = CancellationToken::new();
    let signal = token.clone();
    let mut output = String::new();
    let result: Result<(), String> = tokio::select! {
        biased;
        _=token.cancelled()=>Err("Stopped".into()),
        result=http.stream(&key,"gemini-test",&[],None,|text|{output.push_str(text);signal.cancel();Ok(())})=>result,
    };
    assert_eq!(result, Err("Stopped".into()));
    assert_eq!(output, "partial before stop");
    assert!(
        tokio::task::spawn_blocking(move || worker.join().unwrap())
            .await
            .unwrap()
    );
}
