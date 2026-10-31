//! Gemini ACP wire boundary; this module does not launch or authenticate a CLI.
//!
//! A caller must first prove the real CLI launch profile and own its process
//! scope. Closing a stream or receiving a terminal reply is not process cleanup.
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio_util::sync::CancellationToken;

const MAX_FRAME: usize = 256 * 1024;
const MAX_REQUEST: usize = 512 * 1024;
const MAX_OUTPUT: usize = pavane_core::MAX_OUTPUT_BYTES;
const MAX_WIRE_BYTES: usize = 32 * 1024 * 1024;
const MAX_UPDATES: usize = 65_536;
const SETUP_TIMEOUT: Duration = Duration::from_secs(10);
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
const TURN_TIMEOUT: Duration = Duration::from_secs(900);
const CANCEL_TIMEOUT: Duration = Duration::from_secs(2);
const PROTOCOL_ERROR: &str = "Gemini returned unsupported or invalid chat data.";

#[derive(Debug, PartialEq, Eq)]
pub enum Completion {
    Complete,
    /// The caller still owns process termination, including after acknowledgement.
    Cancelled {
        acknowledged: bool,
    },
}

/// One initialized connection, one session and at most one prompt. There is no
/// background task, request map, implicit authentication or automatic retry.
pub struct Connection<R, W> {
    reader: BufReader<R>,
    writer: W,
    next_id: u64,
    initialized: bool,
    session: Option<String>,
    poisoned: bool,
    busy: bool,
    used: bool,
    prompt_sent: bool,
    writing: bool,
    wire_bytes: usize,
    updates: usize,
    output_bytes: usize,
    frame_bytes: Vec<u8>,
}

impl<R: AsyncRead + Unpin, W: AsyncWrite + Unpin> Connection<R, W> {
    pub fn new(reader: R, writer: W) -> Self {
        Self {
            reader: BufReader::new(reader),
            writer,
            next_id: 0,
            initialized: false,
            session: None,
            poisoned: false,
            busy: false,
            used: false,
            prompt_sent: false,
            writing: false,
            wire_bytes: 0,
            updates: 0,
            output_bytes: 0,
            frame_bytes: Vec::new(),
        }
    }

    pub async fn initialize(&mut self) -> Result<(), String> {
        if self.poisoned || self.initialized || self.busy {
            return Err("Create a fresh Gemini connection.".into());
        }
        self.busy = true;
        let result: Result<(), String> = tokio::time::timeout(SETUP_TIMEOUT, async {
            let id = self.request("initialize", json!({
                "protocolVersion":1,
                "clientInfo":{"name":"pavane","version":env!("CARGO_PKG_VERSION")},
                "clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}
            })).await?;
            let (reply, updates) = self.setup_reply(id, false).await?;
            if reply["protocolVersion"].as_u64() != Some(1) || !updates.is_empty() {
                return Err(PROTOCOL_ERROR.into());
            }
            Ok(())
        })
        .await
        .unwrap_or_else(|_| Err("Gemini initialization timed out.".into()));
        match result {
            Ok(()) => {
                self.initialized = true;
                self.busy = false;
                Ok(())
            }
            Err(error) => self.fail(error),
        }
    }

    /// This request's empty MCP list is NOT an isolation control: the supported
    /// CLI can merge inherited integrations. Qualify its launch before calling.
    pub async fn start_session(&mut self, cwd: &Path) -> Result<(), String> {
        if self.poisoned
            || self.busy
            || !self.initialized
            || self.session.is_some()
            || !cwd.is_absolute()
        {
            return Err("Create a fresh, isolated Gemini session.".into());
        }
        let cwd = cwd
            .to_str()
            .filter(|path| path.len() <= 32_768 && !path.chars().any(char::is_control))
            .ok_or("Gemini workspace path is unsupported.")?;
        self.busy = true;
        let result: Result<String, String> = tokio::time::timeout(SETUP_TIMEOUT, async {
            let id = self
                .request("session/new", json!({"cwd":cwd,"mcpServers":[]}))
                .await?;
            let (reply, updates) = self.setup_reply(id, true).await?;
            let session = reply["sessionId"]
                .as_str()
                .filter(|id| !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control))
                .ok_or(PROTOCOL_ERROR)?
                .to_string();
            for update in updates {
                self.update(&update, &session, false, &mut |_| Ok(()))?;
            }
            Ok(session)
        })
        .await
        .unwrap_or_else(|_| Err("Gemini session creation timed out.".into()));
        match result {
            Ok(session) => {
                self.session = Some(session);
                self.busy = false;
                Ok(())
            }
            Err(error) => self.fail(error),
        }
    }

    pub async fn prompt(
        &mut self,
        text: &str,
        token: &CancellationToken,
        mut on_delta: impl FnMut(&str) -> Result<(), String>,
    ) -> Result<Completion, String> {
        if self.poisoned || self.used || self.busy {
            return Err("Create a fresh Gemini connection for this message.".into());
        }
        let session = self.session.clone().ok_or("Gemini has no chat session.")?;
        if text.is_empty() || text.len() > 256 * 1024 {
            return Err("Gemini chat context must fit within 256 KiB.".into());
        }
        self.used = true;
        self.busy = true;
        if token.is_cancelled() {
            return Ok(Completion::Cancelled {
                acknowledged: false,
            });
        }
        let id = self.next_id;
        let result = tokio::select! {
            biased;
            _ = token.cancelled() => None,
            result = tokio::time::timeout(TURN_TIMEOUT, async {
                self.request("session/prompt", json!({
                    "sessionId":session,"prompt":[{"type":"text","text":text}]
                })).await?;
                self.prompt_sent = true;
                self.prompt_reply(id, &session, &mut on_delta).await
            }) => Some(result),
        };
        match result {
            Some(Ok(Ok(reason))) if reason == "end_turn" => Ok(Completion::Complete),
            Some(Ok(Ok(_))) => self.fail("Gemini stopped before completing this response."),
            Some(Ok(Err(error))) => self.fail(error),
            Some(Err(_)) => self.fail("Gemini response timed out."),
            None => {
                // A cancelled partial JSON write must never be followed by another
                // frame on this stream. The owner must terminate the process.
                if !self.prompt_sent || self.writing {
                    self.poisoned = true;
                    return Ok(Completion::Cancelled {
                        acknowledged: false,
                    });
                }
                let acknowledgement = tokio::time::timeout(CANCEL_TIMEOUT, async {
                    self.write(&json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":session}})).await?;
                    self.prompt_reply(id, &session, &mut on_delta).await
                }).await;
                self.poisoned = true;
                match acknowledgement {
                    Ok(Ok(reason)) => Ok(Completion::Cancelled {
                        acknowledged: reason == "cancelled",
                    }),
                    Ok(Err(error)) => Err(error),
                    Err(_) => Ok(Completion::Cancelled {
                        acknowledged: false,
                    }),
                }
            }
        }
    }

    fn fail<T>(&mut self, error: impl Into<String>) -> Result<T, String> {
        self.poisoned = true;
        Err(error.into())
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<u64, String> {
        if self.poisoned {
            return Err("Create a fresh Gemini connection.".into());
        }
        let id = self.next_id;
        self.next_id = self.next_id.checked_add(1).ok_or(PROTOCOL_ERROR)?;
        self.write(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .await?;
        Ok(id)
    }

    async fn write(&mut self, value: &Value) -> Result<(), String> {
        if self.writing || self.poisoned {
            return Err("Create a fresh Gemini connection.".into());
        }
        let mut bytes = serde_json::to_vec(value).map_err(|_| PROTOCOL_ERROR)?;
        if bytes.len() > MAX_REQUEST {
            return Err("Gemini request is too large.".into());
        }
        bytes.push(b'\n');
        // Remains true if ANY write is interrupted, including a denial reply.
        self.writing = true;
        let result: Result<(), String> = tokio::time::timeout(WRITE_TIMEOUT, async {
            self.writer.write_all(&bytes).await?;
            self.writer.flush().await
        })
        .await
        .map_err(|_| "Gemini stopped accepting requests.")?
        .map_err(|_| "Gemini disconnected.".into());
        if result.is_ok() {
            self.writing = false;
        } else {
            self.poisoned = true;
        }
        result
    }

    async fn frame(&mut self) -> Result<Value, String> {
        if self.frame_bytes.len() > MAX_FRAME {
            return Err(PROTOCOL_ERROR.into());
        }
        // Take bounds allocation even when the peer never emits a newline.
        // Keep partial bytes in the connection: cancellation may interrupt this
        // read before the cancel acknowledgement drains the same JSONL stream.
        (&mut self.reader)
            .take((MAX_FRAME + 1 - self.frame_bytes.len()) as u64)
            .read_until(b'\n', &mut self.frame_bytes)
            .await
            .map_err(|_| "Gemini disconnected.")?;
        let bytes = std::mem::take(&mut self.frame_bytes);
        self.wire_bytes = self
            .wire_bytes
            .checked_add(bytes.len())
            .ok_or(PROTOCOL_ERROR)?;
        if bytes.is_empty()
            || bytes.len() > MAX_FRAME
            || bytes.last() != Some(&b'\n')
            || self.wire_bytes > MAX_WIRE_BYTES
        {
            return Err(PROTOCOL_ERROR.into());
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| PROTOCOL_ERROR)?;
        if !value.is_object() || value["jsonrpc"] != "2.0" {
            return Err(PROTOCOL_ERROR.into());
        }
        // Check server requests before matching reply IDs: ID spaces overlap.
        if value.get("method").is_some() && value.get("id").is_some() {
            if value["id"].is_string() || value["id"].is_number() {
                let _ = self.write(&json!({"jsonrpc":"2.0","id":value["id"],"error":{
                    "code":-32601,"message":"Pavane text chat does not provide tools or permissions."
                }})).await;
            }
            return Err("Gemini requested a tool or client action. Text chat was stopped.".into());
        }
        Ok(value)
    }

    fn response(value: &Value, id: u64) -> Result<Option<Value>, String> {
        if value.get("method").is_some() {
            return Ok(None);
        }
        if value["id"].as_u64() != Some(id)
            || value.get("result").is_some() == value.get("error").is_some()
        {
            return Err(PROTOCOL_ERROR.into());
        }
        if value.get("error").is_some() {
            // Provider messages may contain prompt text, endpoints or credentials.
            return Err(
                "Gemini rejected the request. Check its CLI sign-in, model access and connection."
                    .into(),
            );
        }
        if !value["result"].is_object() {
            return Err(PROTOCOL_ERROR.into());
        }
        Ok(Some(value["result"].clone()))
    }

    async fn setup_reply(
        &mut self,
        id: u64,
        allow_updates: bool,
    ) -> Result<(Value, Vec<Value>), String> {
        let mut updates = Vec::new();
        loop {
            let value = self.frame().await?;
            if let Some(reply) = Self::response(&value, id)? {
                return Ok((reply, updates));
            }
            if !allow_updates || value["method"] != "session/update" || updates.len() >= 32 {
                return Err(PROTOCOL_ERROR.into());
            }
            updates.push(value);
        }
    }

    async fn prompt_reply(
        &mut self,
        id: u64,
        session: &str,
        on_delta: &mut impl FnMut(&str) -> Result<(), String>,
    ) -> Result<String, String> {
        loop {
            let value = self.frame().await?;
            if let Some(reply) = Self::response(&value, id)? {
                return reply["stopReason"]
                    .as_str()
                    .map(str::to_string)
                    .ok_or_else(|| PROTOCOL_ERROR.into());
            }
            self.update(&value, session, true, on_delta)?;
        }
    }

    fn update(
        &mut self,
        value: &Value,
        session: &str,
        allow_text: bool,
        on_delta: &mut impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        self.updates += 1;
        if self.updates > MAX_UPDATES
            || value["method"] != "session/update"
            || value["params"]["sessionId"] != session
        {
            return Err(PROTOCOL_ERROR.into());
        }
        let update = &value["params"]["update"];
        match update["sessionUpdate"].as_str() {
            Some("agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk")
                if allow_text =>
            {
                if update["content"]["type"] != "text" {
                    return Err(PROTOCOL_ERROR.into());
                }
                let text = update["content"]["text"].as_str().ok_or(PROTOCOL_ERROR)?;
                if update["sessionUpdate"] == "agent_message_chunk" {
                    self.output_bytes = self
                        .output_bytes
                        .checked_add(text.len())
                        .ok_or(PROTOCOL_ERROR)?;
                    if self.output_bytes > MAX_OUTPUT {
                        return Err("Gemini response reached the 2 MiB safety limit.".into());
                    }
                    on_delta(text)?;
                }
                Ok(())
            }
            Some(
                "available_commands_update"
                | "current_mode_update"
                | "config_option_update"
                | "usage_update"
                | "session_info_update",
            ) => Ok(()),
            // Tools, plans, unsupported content and unknown extensions fail closed.
            _ => Err(
                "Gemini reported unsupported content or tool activity. Text chat was stopped."
                    .into(),
            ),
        }
    }
}

#[cfg(test)]
mod tests;
