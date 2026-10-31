use super::*;
use std::{
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    task::{Context, Poll},
};
use tokio::io::{DuplexStream, ReadHalf, WriteHalf};

struct CancelOnRead<R> {
    inner: R,
    token: CancellationToken,
    armed: Arc<AtomicBool>,
}
impl<R: AsyncRead + Unpin> AsyncRead for CancelOnRead<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &mut tokio::io::ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buffer.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(cx, buffer);
        if matches!(result, Poll::Ready(Ok(())))
            && buffer.filled().len() > before
            && self.armed.swap(false, Ordering::AcqRel)
        {
            self.token.cancel();
        }
        result
    }
}

type Client = Connection<ReadHalf<DuplexStream>, WriteHalf<DuplexStream>>;
struct Peer {
    reader: BufReader<ReadHalf<DuplexStream>>,
    writer: WriteHalf<DuplexStream>,
}
impl Peer {
    async fn request(&mut self) -> Value {
        let mut line = String::new();
        self.reader.read_line(&mut line).await.unwrap();
        serde_json::from_str(&line).unwrap()
    }
    async fn send(&mut self, value: Value) {
        let mut bytes = serde_json::to_vec(&value).unwrap();
        bytes.push(b'\n');
        self.writer.write_all(&bytes).await.unwrap();
    }
    async fn reply(&mut self, id: Value, result: Value) {
        self.send(json!({"jsonrpc":"2.0","id":id,"result":result}))
            .await;
    }
    async fn setup(&mut self) {
        let init = self.request().await;
        assert_eq!(init["method"], "initialize");
        assert_eq!(init["params"]["protocolVersion"], 1);
        assert_eq!(init["params"]["clientCapabilities"]["terminal"], false);
        assert_eq!(
            init["params"]["clientCapabilities"]["fs"]["readTextFile"],
            false
        );
        assert_eq!(
            init["params"]["clientCapabilities"]["fs"]["writeTextFile"],
            false
        );
        self.reply(init["id"].clone(), json!({"protocolVersion":1}))
            .await;
        let session = self.request().await;
        assert_eq!(session["method"], "session/new");
        assert_eq!(session["params"]["mcpServers"], json!([]));
        assert!(Path::new(session["params"]["cwd"].as_str().unwrap()).is_absolute());
        self.send(update(
            "available_commands_update",
            json!({"availableCommands":[]}),
        ))
        .await;
        self.reply(session["id"].clone(), json!({"sessionId":"session-1"}))
            .await;
    }
}
fn pair() -> (Client, Peer) {
    let (client, peer) = tokio::io::duplex(4096);
    let (reader, writer) = tokio::io::split(client);
    let (peer_reader, peer_writer) = tokio::io::split(peer);
    (
        Connection::new(reader, writer),
        Peer {
            reader: BufReader::new(peer_reader),
            writer: peer_writer,
        },
    )
}
fn update(kind: &str, fields: Value) -> Value {
    let mut body = fields.as_object().unwrap().clone();
    body.insert("sessionUpdate".into(), kind.into());
    json!({"jsonrpc":"2.0","method":"session/update","params":{
        "sessionId":"session-1","update":body
    }})
}
fn chunk(text: &str) -> Value {
    update(
        "agent_message_chunk",
        json!({"content":{"type":"text","text":text}}),
    )
}
async fn ready<R: AsyncRead + Unpin, W: AsyncWrite + Unpin>(client: &mut Connection<R, W>) {
    client.initialize().await.unwrap();
    client.start_session(&std::env::temp_dir()).await.unwrap();
}

#[tokio::test]
async fn text_handshake_streams_fragmented_unicode_without_thought_or_echo() {
    let (mut client, mut peer) = pair();
    let server = tokio::spawn(async move {
        peer.setup().await;
        let prompt = peer.request().await;
        assert_eq!(prompt["method"], "session/prompt");
        assert_eq!(prompt["params"]["sessionId"], "session-1");
        assert_eq!(
            prompt["params"]["prompt"],
            json!([{"type":"text","text":"@file is plain request text"}])
        );
        peer.send(update(
            "agent_thought_chunk",
            json!({"content":{"type":"text","text":"private reasoning"}}),
        ))
        .await;
        peer.send(update(
            "user_message_chunk",
            json!({"content":{"type":"text","text":"echo"}}),
        ))
        .await;
        peer.send(update("usage_update", json!({"used":400,"size":1000})))
            .await;
        let bytes = format!("{}\n", chunk("Grüezi 🦀"));
        for byte in bytes.as_bytes() {
            peer.writer.write_all(&[*byte]).await.unwrap();
        }
        peer.reply(prompt["id"].clone(), json!({"stopReason":"end_turn"}))
            .await;
    });
    ready(&mut client).await;
    let mut output = String::new();
    assert_eq!(
        client
            .prompt(
                "@file is plain request text",
                &CancellationToken::new(),
                |text| {
                    output.push_str(text);
                    Ok(())
                }
            )
            .await
            .unwrap(),
        Completion::Complete
    );
    assert_eq!(output, "Grüezi 🦀");
    assert!(
        client
            .prompt("duplicate", &CancellationToken::new(), |_| Ok(()))
            .await
            .is_err()
    );
    server.await.unwrap();
}

#[tokio::test]
async fn dropping_initialization_cannot_send_another_request() {
    let (mut client, mut peer) = pair();
    let (sent, observed) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        assert_eq!(peer.request().await["method"], "initialize");
        sent.send(()).unwrap();
        let mut rest = Vec::new();
        peer.reader.read_to_end(&mut rest).await.unwrap();
        assert!(rest.is_empty());
    });
    tokio::select! {
        result = client.initialize() => panic!("Initialization unexpectedly completed: {result:?}"),
        signal = observed => signal.unwrap(),
    }
    assert!(client.initialize().await.is_err());
    drop(client);
    server.await.unwrap();
}

#[tokio::test]
async fn server_request_with_colliding_reply_id_is_denied_not_accepted() {
    let (mut client, mut peer) = pair();
    let server = tokio::spawn(async move {
        let init = peer.request().await;
        peer.send(json!({"jsonrpc":"2.0","id":init["id"],"method":"terminal/create","params":{}}))
            .await;
        let denial = peer.request().await;
        assert_eq!(denial["id"], init["id"]);
        assert_eq!(denial["error"]["code"], -32601);
        assert!(denial.get("result").is_none());
    });
    assert!(
        client
            .initialize()
            .await
            .unwrap_err()
            .contains("client action")
    );
    assert!(client.initialize().await.is_err());
    server.await.unwrap();
}

#[tokio::test]
async fn setup_rejects_wrong_version_id_and_raw_provider_errors() {
    for reply in [
        json!({"jsonrpc":"2.0","id":0,"result":{"protocolVersion":2}}),
        json!({"jsonrpc":"2.0","id":99,"result":{"protocolVersion":1}}),
        json!({"jsonrpc":"2.0","id":0,"result":{},"error":{}}),
        json!({"jsonrpc":"2.0","id":0,"error":{"message":"synthetic-private-diagnostic"}}),
    ] {
        let (mut client, mut peer) = pair();
        let server = tokio::spawn(async move {
            peer.request().await;
            peer.send(reply).await;
        });
        let error = client.initialize().await.unwrap_err();
        assert!(!error.contains("synthetic-private-diagnostic"));
        assert!(!client.initialized);
        server.await.unwrap();
    }
}

#[tokio::test]
async fn malformed_oversized_and_unterminated_frames_fail_boundedly() {
    for bytes in [
        b"not json\n".to_vec(),
        vec![b'x'; MAX_FRAME + 1],
        b"{\"jsonrpc\":\"2.0\"}".to_vec(),
    ] {
        let (mut client, mut peer) = pair();
        let server = tokio::spawn(async move {
            peer.request().await;
            peer.writer.write_all(&bytes).await.unwrap();
        });
        assert!(client.initialize().await.is_err());
        assert!(client.poisoned);
        server.await.unwrap();
    }
}

#[tokio::test]
async fn wrong_session_tools_and_nontext_content_never_reach_the_callback() {
    let mut foreign = chunk("foreign text");
    foreign["params"]["sessionId"] = "other-session".into();
    for bad in [
        foreign,
        update("tool_call", json!({"toolCallId":"bad","title":"read"})),
        update(
            "agent_message_chunk",
            json!({"content":{"type":"image","data":"synthetic"}}),
        ),
        update("unknown_extension", json!({})),
    ] {
        let (mut client, mut peer) = pair();
        let server = tokio::spawn(async move {
            peer.setup().await;
            peer.request().await;
            peer.send(bad).await;
        });
        ready(&mut client).await;
        let mut output = String::new();
        assert!(
            client
                .prompt("hello", &CancellationToken::new(), |text| {
                    output.push_str(text);
                    Ok(())
                })
                .await
                .is_err()
        );
        assert!(output.is_empty());
        assert!(client.poisoned);
        server.await.unwrap();
    }
}

#[tokio::test]
async fn early_text_and_unbounded_setup_updates_are_not_accepted() {
    for flood in [false, true] {
        let (mut client, mut peer) = pair();
        let server = tokio::spawn(async move {
            let init = peer.request().await;
            peer.reply(init["id"].clone(), json!({"protocolVersion":1}))
                .await;
            let session = peer.request().await;
            if flood {
                for _ in 0..33 {
                    peer.send(update("usage_update", json!({}))).await;
                }
            } else {
                peer.send(chunk("unsolicited response")).await;
                peer.reply(session["id"].clone(), json!({"sessionId":"session-1"}))
                    .await;
            }
        });
        client.initialize().await.unwrap();
        assert!(client.start_session(&std::env::temp_dir()).await.is_err());
        server.await.unwrap();
    }
}

#[tokio::test]
async fn partial_output_is_delivered_before_disconnect_or_token_limit_failure() {
    for finish in [None, Some("max_tokens")] {
        let (mut client, mut peer) = pair();
        let server = tokio::spawn(async move {
            peer.setup().await;
            let prompt = peer.request().await;
            peer.send(chunk("saved partial")).await;
            if let Some(reason) = finish {
                peer.reply(prompt["id"].clone(), json!({"stopReason":reason}))
                    .await;
            }
        });
        ready(&mut client).await;
        let mut output = String::new();
        assert!(
            client
                .prompt("hello", &CancellationToken::new(), |text| {
                    output.push_str(text);
                    Ok(())
                })
                .await
                .is_err()
        );
        assert_eq!(output, "saved partial");
        server.await.unwrap();
    }
}

#[tokio::test]
async fn cancelled_prompt_sends_exact_notification_and_drains_fragmented_frame() {
    let (client, mut peer) = pair();
    let token = CancellationToken::new();
    let armed = Arc::new(AtomicBool::new(false));
    let mut client = Connection::new(
        CancelOnRead {
            inner: client.reader,
            token: token.clone(),
            armed: armed.clone(),
        },
        client.writer,
    );
    let server = tokio::spawn(async move {
        peer.setup().await;
        let prompt = peer.request().await;
        let text = format!("{}\n", chunk("late partial 🦀"));
        peer.writer.write_all(&text.as_bytes()[..17]).await.unwrap();
        let notification = peer.request().await;
        assert_eq!(notification["method"], "session/cancel");
        assert_eq!(notification["params"]["sessionId"], "session-1");
        assert!(notification.get("id").is_none());
        peer.writer.write_all(&text.as_bytes()[17..]).await.unwrap();
        peer.reply(prompt["id"].clone(), json!({"stopReason":"cancelled"}))
            .await;
    });
    ready(&mut client).await;
    armed.store(true, Ordering::Release);
    let mut output = String::new();
    assert_eq!(
        client
            .prompt("hello", &token, |text| {
                output.push_str(text);
                Ok(())
            })
            .await
            .unwrap(),
        Completion::Cancelled { acknowledged: true }
    );
    assert_eq!(output, "late partial 🦀");
    assert!(!armed.load(Ordering::Acquire));
    assert!(client.poisoned);
    server.await.unwrap();
}

#[tokio::test]
async fn cancellation_without_acknowledgement_requires_owner_cleanup() {
    let (mut client, mut peer) = pair();
    let token = CancellationToken::new();
    let cancel = token.clone();
    let server = tokio::spawn(async move {
        peer.setup().await;
        peer.request().await;
        cancel.cancel();
        assert_eq!(peer.request().await["method"], "session/cancel");
        // Keep it open to exercise the actual bounded acknowledgement wait.
        let mut rest = Vec::new();
        peer.reader.read_to_end(&mut rest).await.unwrap();
    });
    ready(&mut client).await;
    let started = std::time::Instant::now();
    assert_eq!(
        client.prompt("hello", &token, |_| Ok(())).await.unwrap(),
        Completion::Cancelled {
            acknowledged: false
        }
    );
    assert!(started.elapsed() >= CANCEL_TIMEOUT);
    assert!(client.poisoned);
    drop(client);
    server.await.unwrap();
}

#[tokio::test]
async fn cancel_during_a_blocked_prompt_write_does_not_append_a_corrupt_frame() {
    let (mut client, mut peer) = pair();
    let token = CancellationToken::new();
    let cancel = token.clone();
    let server = tokio::spawn(async move {
        peer.setup().await;
        let mut first = [0];
        peer.reader.read_exact(&mut first).await.unwrap();
        assert_eq!(first[0], b'{');
        cancel.cancel();
        // Keep the pipe open until the client returns and its owner drops it.
        let mut remaining = Vec::new();
        peer.reader.read_to_end(&mut remaining).await.unwrap();
        assert!(
            !String::from_utf8(remaining)
                .unwrap()
                .contains("session/cancel")
        );
    });
    ready(&mut client).await;
    assert_eq!(
        client
            .prompt(&"x".repeat(128 * 1024), &token, |_| Ok(()))
            .await
            .unwrap(),
        Completion::Cancelled {
            acknowledged: false
        }
    );
    assert!(client.poisoned);
    drop(client);
    server.await.unwrap();
}

#[tokio::test]
async fn cancellation_cannot_append_to_an_interrupted_server_denial() {
    let (mut client, mut peer) = pair();
    let token = CancellationToken::new();
    let cancel = token.clone();
    let server = tokio::spawn(async move {
        peer.setup().await;
        peer.request().await;
        peer.send(json!({"jsonrpc":"2.0","id":"s".repeat(32 * 1024),"method":"session/request_permission","params":{}})).await;
        let mut prefix = [0; 8];
        peer.reader.read_exact(&mut prefix).await.unwrap();
        assert_eq!(prefix[0], b'{');
        cancel.cancel();
        let mut rest = Vec::new();
        peer.reader.read_to_end(&mut rest).await.unwrap();
        assert!(!String::from_utf8(rest).unwrap().contains("session/cancel"));
    });
    ready(&mut client).await;
    assert_eq!(
        client.prompt("hello", &token, |_| Ok(())).await.unwrap(),
        Completion::Cancelled {
            acknowledged: false
        }
    );
    assert!(client.poisoned);
    assert!(client.writing);
    drop(client);
    server.await.unwrap();
}

#[tokio::test]
async fn cancellation_drain_propagates_callback_and_protocol_errors() {
    for callback_error in [false, true] {
        let (mut client, mut peer) = pair();
        let token = CancellationToken::new();
        let cancel = token.clone();
        let server = tokio::spawn(async move {
            peer.setup().await;
            peer.request().await;
            cancel.cancel();
            assert_eq!(peer.request().await["method"], "session/cancel");
            if callback_error {
                peer.send(chunk("late text")).await;
            } else {
                peer.send(update("tool_call", json!({"toolCallId":"blocked"})))
                    .await;
            }
        });
        ready(&mut client).await;
        let error = client
            .prompt("hello", &token, |_| Err("Local checkpoint failed.".into()))
            .await
            .unwrap_err();
        assert!(error.contains(if callback_error {
            "checkpoint"
        } else {
            "tool activity"
        }));
        assert!(client.poisoned);
        server.await.unwrap();
    }
}

#[tokio::test]
async fn callback_failure_stops_normal_delivery() {
    let (mut client, mut peer) = pair();
    let server = tokio::spawn(async move {
        peer.setup().await;
        peer.request().await;
        peer.send(chunk("first")).await;
    });
    ready(&mut client).await;
    let mut calls = 0;
    let error = client
        .prompt("hello", &CancellationToken::new(), |_| {
            calls += 1;
            Err("Local checkpoint failed.".into())
        })
        .await
        .unwrap_err();
    assert_eq!(calls, 1);
    assert!(error.contains("checkpoint"));
    assert!(client.poisoned);
    server.await.unwrap();
}

#[tokio::test]
async fn complete_stream_cannot_exceed_the_output_budget() {
    let (mut client, mut peer) = pair();
    const CHUNK: usize = 200 * 1024;
    let server = tokio::spawn(async move {
        peer.setup().await;
        peer.request().await;
        for _ in 0..=MAX_OUTPUT / CHUNK {
            peer.send(chunk(&"x".repeat(CHUNK))).await;
        }
    });
    ready(&mut client).await;
    let mut delivered = 0;
    let error = client
        .prompt("hello", &CancellationToken::new(), |text| {
            delivered += text.len();
            Ok(())
        })
        .await
        .unwrap_err();
    assert!(error.contains("2 MiB"));
    assert_eq!(delivered, MAX_OUTPUT / CHUNK * CHUNK);
    server.await.unwrap();
}
