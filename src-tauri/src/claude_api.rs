use crate::sse::Decoder;
use crate::{
    codex::Status,
    credentials::{ClaudeCredential, ClaudeVault, wipe},
    provider::{Model, ModelOptions},
};
use futures_util::StreamExt;
use pavane_core::Message;
use reqwest::header::HeaderValue;
use serde_json::{Value, json};
use std::{collections::HashSet, path::Path, time::Duration};
use tokio::sync::Mutex;

const ORIGIN: &str = "https://api.anthropic.com/v1";
const VERSION: &str = "2026-10-21";
#[cfg(test)]
use crate::sse::MAX_FRAME;
const MAX_WIRE: usize = 32 * 1024 * 1024;
const INVALID_STREAM: &str = "Claude returned an invalid or unsupported text response.";

struct Entry {
    model: Model,
    max_tokens: u32,
}

#[derive(Default)]
struct CatalogState {
    revision: u64,
    discovery: u64,
    models: Vec<Entry>,
    connection: Option<ClaudeCredential>,
}

/// Native-only per-occurrence snapshot, never serialized into a run or renderer DTO.
pub(crate) struct Authorization {
    connection: ClaudeCredential,
    max_tokens: u32,
}

pub(crate) struct Manager {
    vault: Result<ClaudeVault, String>,
    http: Result<Http, String>,
    state: Mutex<CatalogState>,
}

impl Manager {
    pub(crate) fn new(directory: &Path) -> Self {
        Self {
            vault: ClaudeVault::new(directory),
            http: Http::new(),
            state: Mutex::new(CatalogState::default()),
        }
    }

    pub(crate) async fn save_connection(
        &self,
        key: String,
        workspace: Option<String>,
    ) -> Result<(), String> {
        let connection = ClaudeCredential::new(key, workspace)?;
        let mut state = self.state.lock().await;
        self.vault
            .as_ref()
            .map_err(Clone::clone)?
            .write(connection)?;
        state.revision = state.revision.wrapping_add(1);
        state.models.clear();
        state.connection = None;
        Ok(())
    }

    pub(crate) async fn remove_connection(&self) -> Result<(), String> {
        let mut state = self.state.lock().await;
        self.vault.as_ref().map_err(Clone::clone)?.delete()?;
        state.revision = state.revision.wrapping_add(1);
        state.models.clear();
        state.connection = None;
        Ok(())
    }

    pub(crate) async fn catalog(&self) -> Result<(Vec<Model>, Status), String> {
        let vault = self.vault.as_ref().map_err(Clone::clone)?;
        let (revision, discovery, connection) = {
            let mut state = self.state.lock().await;
            state.discovery = state.discovery.wrapping_add(1);
            let Some(connection) = vault.read()? else {
                state.models.clear();
                state.connection = None;
                return Ok((
                    vec![],
                    status(
                        "needsKey",
                        "Add a Claude Console API key. API usage and billing apply.",
                    ),
                ));
            };
            (state.revision, state.discovery, connection)
        };
        let result = tokio::time::timeout(
            Duration::from_secs(10),
            self.http
                .as_ref()
                .map_err(Clone::clone)?
                .discover(&connection),
        )
        .await
        .unwrap_or_else(|_| Err("Claude model discovery timed out.".into()));
        let mut state = self.state.lock().await;
        if revision != state.revision || discovery != state.discovery {
            return Err("Claude connection changed. Refresh model access.".into());
        }
        if vault
            .read()?
            .as_ref()
            .is_none_or(|current| !current.same_identity(&connection))
        {
            state.models.clear();
            state.connection = None;
            return Err("Claude connection changed. Refresh model access.".into());
        }
        match result {
            Ok(entries) => {
                let detail = format!("{} API models · quota managed by Anthropic", entries.len());
                let models = entries.iter().map(|entry| entry.model.clone()).collect();
                state.models = entries;
                state.connection = Some(connection);
                Ok((models, status("connected", &detail)))
            }
            Err(error) => {
                state.models.clear();
                state.connection = None;
                Err(error)
            }
        }
    }

    fn checked_connection(
        &self,
        state: &CatalogState,
        model: &str,
        options: &ModelOptions,
    ) -> Result<Authorization, String> {
        if options.reasoning_effort.is_some()
            || options
                .service_tier
                .as_deref()
                .is_some_and(|tier| tier != "default")
        {
            return Err(
                "This Claude API connection does not expose reasoning or service-tier controls."
                    .into(),
            );
        }
        let connection = self
            .vault
            .as_ref()
            .map_err(Clone::clone)?
            .read()?
            .ok_or("Add a Claude API key in Connections.")?;
        let entry = state.models.iter().find(|entry| entry.model.id == model);
        if state
            .connection
            .as_ref()
            .is_none_or(|cached| !cached.same_identity(&connection))
        {
            return Err("Refresh Claude model access before sending this message.".into());
        }
        let entry = entry.ok_or("Refresh Claude model access before sending this message.")?;
        Ok(Authorization {
            connection,
            max_tokens: entry.max_tokens,
        })
    }

    pub(crate) async fn authorize(
        &self,
        model: &str,
        options: &ModelOptions,
    ) -> Result<Authorization, String> {
        let state = self.state.lock().await;
        self.checked_connection(&state, model, options)
    }

    pub(crate) async fn stream(
        &self,
        model: &str,
        authorization: Authorization,
        context: &[Message],
        instructions: Option<&str>,
        on_delta: impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        let max_tokens = {
            let state = self.state.lock().await;
            let current = self.checked_connection(&state, model, &ModelOptions::default())?;
            if !current.connection.same_identity(&authorization.connection) {
                return Err(
                    "Claude connection changed after this message was queued. Send again.".into(),
                );
            }
            current.max_tokens.min(authorization.max_tokens)
        };
        let id = model
            .strip_prefix("claude:")
            .filter(|id| valid_id(id))
            .ok_or("Choose an available Claude model.")?;
        self.http
            .as_ref()
            .map_err(Clone::clone)?
            .stream(
                &authorization.connection,
                id,
                max_tokens,
                context,
                instructions,
                on_delta,
            )
            .await
    }
}

fn status(state: &str, detail: &str) -> Status {
    Status {
        id: "claude".into(),
        name: "Claude API".into(),
        state: state.into(),
        detail: detail.into(),
        limits: vec![],
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && id.bytes().all(|byte| byte.is_ascii_graphic())
}

struct Http {
    client: reqwest::Client,
    origin: String,
}

impl Http {
    fn client(https_only: bool) -> Result<reqwest::Client, String> {
        reqwest::Client::builder()
            .no_proxy()
            .https_only(https_only)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(3))
            .read_timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| "Claude API networking is unavailable.".into())
    }

    fn new() -> Result<Self, String> {
        Ok(Self {
            client: Self::client(true)?,
            origin: ORIGIN.into(),
        })
    }

    #[cfg(test)]
    fn for_test(origin: String) -> Self {
        Self {
            client: Self::client(false).unwrap(),
            origin,
        }
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        connection: &ClaudeCredential,
    ) -> Result<reqwest::RequestBuilder, String> {
        let mut bytes = b"Bearer ".to_vec();
        bytes.extend_from_slice(connection.key().as_bytes());
        let result = HeaderValue::from_bytes(&bytes);
        wipe(&mut bytes);
        let mut header = result.map_err(|_| "The saved Claude API key is invalid.")?;
        header.set_sensitive(true);
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.origin))
            .header("authorization", header)
            .header("anthropic-version", VERSION);
        if let Some(workspace) = connection.workspace() {
            let mut value = HeaderValue::from_str(workspace)
                .map_err(|_| "The saved Claude workspace is invalid.")?;
            value.set_sensitive(true);
            request = request.header("anthropic-workspace-id", value);
        }
        Ok(request)
    }

    async fn discover(&self, connection: &ClaudeCredential) -> Result<Vec<Entry>, String> {
        let mut models = Vec::new();
        let mut after: Option<String> = None;
        let mut seen = HashSet::new();
        for _ in 0..5 {
            let mut request = self
                .request(reqwest::Method::GET, "/models", connection)?
                .query(&[("limit", "100"), ("lifecycle[]", "active")])
                .timeout(Duration::from_secs(8));
            if let Some(after) = &after {
                request = request.query(&[("after_id", after)]);
            }
            let response = request
                .send()
                .await
                .map_err(|_| "Could not reach the Claude API.")?;
            check_status(response.status())?;
            let mut bytes = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| "Claude model discovery disconnected.")?;
                if bytes.len() + chunk.len() > 1024 * 1024 {
                    return Err("Claude model list is too large.".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| "Claude returned an invalid model list.")?;
            let entries = value["data"]
                .as_array()
                .ok_or("Claude returned an invalid model list.")?;
            for entry in entries {
                let Some(id) = entry["id"].as_str().filter(|id| valid_id(id)) else {
                    continue;
                };
                if entry
                    .get("lifecycle")
                    .is_some_and(|state| state != "active")
                {
                    continue;
                }
                let max_tokens = match entry.get("max_tokens") {
                    None | Some(Value::Null) => 4096,
                    Some(value) => match value.as_u64().filter(|value| *value > 0) {
                        Some(limit) => limit.min(4096) as u32,
                        None => continue,
                    },
                };
                if models
                    .iter()
                    .any(|entry: &Entry| entry.model.id == format!("claude:{id}"))
                {
                    continue;
                }
                let name: String = entry["display_name"]
                    .as_str()
                    .unwrap_or(id)
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(120)
                    .collect();
                models.push(Entry {
                    model: Model {
                        id: format!("claude:{id}"),
                        name: if name.trim().is_empty() {
                            id.into()
                        } else {
                            name
                        },
                        provider: "Claude".into(),
                        description: "Claude API · API usage and billing apply".into(),
                        ..Model::default()
                    },
                    max_tokens,
                });
                if models.len() > 200 {
                    return Err("Claude model list exceeds the supported limit.".into());
                }
            }
            match value["has_more"].as_bool() {
                Some(false) => return Ok(models),
                Some(true) => {
                    let cursor = value["last_id"]
                        .as_str()
                        .filter(|id| valid_id(id))
                        .ok_or("Claude returned invalid pagination.")?;
                    if !seen.insert(cursor.to_string()) {
                        return Err("Claude repeated a model-list page.".into());
                    }
                    after = Some(cursor.to_string());
                }
                None => return Err("Claude returned invalid pagination.".into()),
            }
        }
        Err("Claude model discovery exceeded its page limit.".into())
    }

    async fn stream(
        &self,
        connection: &ClaudeCredential,
        model: &str,
        max_tokens: u32,
        context: &[Message],
        instructions: Option<&str>,
        mut on_delta: impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        if !valid_id(model) || max_tokens == 0 || max_tokens > 4096 {
            return Err("Choose an available Claude model.".into());
        }
        if context.is_empty() || context.last().is_none_or(|message| message.role != "user") {
            return Err("Unsupported Claude chat context.".into());
        }
        let mut messages: Vec<Value> = Vec::new();
        for message in context {
            if !matches!(message.role.as_str(), "user" | "assistant") {
                return Err("Unsupported Claude chat context.".into());
            }
            if let Some(last) = messages
                .last_mut()
                .filter(|last| last["role"] == message.role)
            {
                last["content"]
                    .as_array_mut()
                    .ok_or("Unsupported Claude chat context.")?
                    .push(json!({"type":"text","text":message.content}));
            } else {
                messages.push(
                    json!({"role":message.role,"content":[{"type":"text","text":message.content}]}),
                );
            }
        }
        let mut body =
            json!({"model":model,"messages":messages,"max_tokens":max_tokens,"stream":true});
        if let Some(instructions) = instructions.filter(|text| !text.is_empty()) {
            body["system"] = instructions.into();
        }
        let response = self
            .request(reqwest::Method::POST, "/messages", connection)?
            .json(&body)
            .timeout(Duration::from_secs(600))
            .send()
            .await
            .map_err(|_| "Could not reach the Claude API.")?;
        check_status(response.status())?;
        if !response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| {
                value
                    .split(';')
                    .next()
                    .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/event-stream"))
            })
        {
            return Err(INVALID_STREAM.into());
        }
        let mut stream = response.bytes_stream();
        let mut decoder = Decoder::new(INVALID_STREAM);
        let mut state = TextStream::default();
        let mut wire = 0usize;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "Claude disconnected before completing the response.")?;
            wire = wire.checked_add(chunk.len()).ok_or(INVALID_STREAM)?;
            if wire > MAX_WIRE {
                return Err("Claude response exceeded the stream limit.".into());
            }
            if decoder.push(&chunk, |value| state.event(value, &mut on_delta))? {
                return Ok(());
            }
        }
        Err("Claude disconnected before completing the response. Partial text is retained.".into())
    }
}

fn check_status(status: reqwest::StatusCode) -> Result<(), String> {
    if status.is_success() {
        return Ok(());
    }
    Err(match status.as_u16() {
        401 | 403 => {
            "Claude rejected the API key, workspace or model access. Check Connections.".into()
        }
        429 => {
            "Claude API limit reached. Check Console usage and billing before trying again.".into()
        }
        300..=399 => "Claude redirected the request. No redirect was followed.".into(),
        code => format!("Claude API request failed (HTTP {code})."),
    })
}

#[derive(Clone, Copy)]
enum Block {
    Text,
    Thinking,
    RedactedThinking,
}

#[derive(Default)]
struct TextStream {
    started: bool,
    closing: bool,
    block: Option<Block>,
    next_index: u64,
    stop: Option<String>,
    output: usize,
}

impl TextStream {
    fn text(
        &mut self,
        text: &str,
        emit: &mut impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        self.output = self.output.checked_add(text.len()).ok_or(INVALID_STREAM)?;
        if self.output > pavane_core::MAX_OUTPUT_BYTES {
            return Err("Claude response exceeded the text limit.".into());
        }
        if !text.is_empty() {
            emit(text)?;
        }
        Ok(())
    }

    fn event(
        &mut self,
        value: Value,
        emit: &mut impl FnMut(&str) -> Result<(), String>,
    ) -> Result<bool, String> {
        let kind = value["type"].as_str().ok_or(INVALID_STREAM)?;
        match kind {
            "ping" => {},
            "error" => return Err("Claude reported a streaming error. Partial text is retained; check Console access and usage.".into()),
            "message_start" => {
                if self.started || value["message"]["role"] != "assistant"
                    || !value["message"]["content"].as_array().is_some_and(Vec::is_empty)
                    || !value["message"]["stop_reason"].is_null() { return Err(INVALID_STREAM.into()); }
                self.started = true;
            }
            "content_block_start" => {
                if !self.started || self.closing || self.block.is_some() || value["index"].as_u64() != Some(self.next_index) || self.next_index >= 128 { return Err(INVALID_STREAM.into()); }
                self.block = Some(match value["content_block"]["type"].as_str() {
                    Some("text") => { self.text(value["content_block"]["text"].as_str().ok_or(INVALID_STREAM)?, emit)?; Block::Text },
                    Some("thinking") => Block::Thinking,
                    Some("redacted_thinking") => Block::RedactedThinking,
                    _ => return Err("Claude returned a tool or unsupported content block. Partial text is retained.".into()),
                });
            }
            "content_block_delta" => {
                if value["index"].as_u64() != Some(self.next_index) { return Err(INVALID_STREAM.into()); }
                match (self.block, value["delta"]["type"].as_str()) {
                    (Some(Block::Text), Some("text_delta")) => self.text(value["delta"]["text"].as_str().ok_or(INVALID_STREAM)?, emit)?,
                    (Some(Block::Thinking), Some("thinking_delta")) if value["delta"]["thinking"].is_string() => {},
                    (Some(Block::Thinking), Some("signature_delta")) if value["delta"]["signature"].is_string() => {},
                    _ => return Err(INVALID_STREAM.into()),
                }
            }
            "content_block_stop" => {
                if self.block.is_none() || value["index"].as_u64() != Some(self.next_index) { return Err(INVALID_STREAM.into()); }
                self.block = None;
                self.next_index += 1;
            }
            "message_delta" => {
                if !self.started || self.block.is_some() || !value["delta"].is_object() { return Err(INVALID_STREAM.into()); }
                self.closing = true;
                if let Some(reason) = value["delta"].get("stop_reason").filter(|reason| !reason.is_null()) {
                    let reason = reason.as_str().filter(|reason| reason.len() <= 100).ok_or(INVALID_STREAM)?;
                    if self.stop.as_ref().is_some_and(|previous| previous != reason) { return Err(INVALID_STREAM.into()); }
                    self.stop = Some(reason.into());
                }
                // Usage in message_delta is cumulative, not additive; it is not quota.
            }
            "message_stop" => {
                if !self.started || !self.closing || self.block.is_some() { return Err(INVALID_STREAM.into()); }
                return match self.stop.as_deref() {
                    Some("end_turn") if self.output > 0 => Ok(true),
                    Some("end_turn") => Err("Claude returned no text.".into()),
                    Some("max_tokens" | "model_context_window_exceeded") => Err("Claude reached its output or context limit. Partial text is retained.".into()),
                    Some("refusal") => Err("Claude declined this request. Any returned text is retained.".into()),
                    Some("tool_use" | "pause_turn") => Err("Claude requested an unsupported tool continuation. Partial text is retained.".into()),
                    _ => Err(INVALID_STREAM.into()),
                };
            }
            // Only content-free protocol extensions may be ignored. New blocks,
            // controls or payloads require an explicit implementation decision.
            _ if value.as_object().is_some_and(|object| object.keys().all(|key| key == "type")) => {},
            _ => return Err(INVALID_STREAM.into()),
        }
        Ok(false)
    }
}

#[cfg(test)]
mod tests;
