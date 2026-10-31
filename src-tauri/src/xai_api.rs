use crate::{
    codex::Status,
    credentials::{Secret, XaiVault, wipe},
    provider::{Model, ModelOptions},
    sse::Decoder,
};
use futures_util::StreamExt;
use pavane_core::Message;
use reqwest::header::HeaderValue;
use serde_json::{Value, json};
use std::{collections::HashSet, path::Path, time::Duration};
use tokio::sync::Mutex;

const ORIGIN: &str = "https://api.x.ai/v1";
const INVALID_STREAM: &str = "xAI returned an invalid or unsupported text response.";
const MAX_WIRE: usize = 32 * 1024 * 1024;

#[derive(Default)]
struct CatalogState {
    revision: u64,
    discovery: u64,
    models: Vec<Model>,
    key: Option<Secret>,
}

pub(crate) struct Manager {
    vault: Result<XaiVault, String>,
    http: Result<Http, String>,
    state: Mutex<CatalogState>,
}
impl Manager {
    pub(crate) fn new(directory: &Path) -> Self {
        Self {
            vault: XaiVault::new(directory),
            http: Http::new(),
            state: Mutex::new(CatalogState::default()),
        }
    }
    pub(crate) async fn save_key(&self, key: String) -> Result<(), String> {
        let key = Secret::new(key).map_err(
            |_| "Enter an xAI API key containing 1–2048 ASCII characters without spaces.",
        )?;
        let mut state = self.state.lock().await;
        self.vault.as_ref().map_err(Clone::clone)?.write(key)?;
        state.revision = state.revision.wrapping_add(1);
        state.models.clear();
        state.key = None;
        Ok(())
    }
    pub(crate) async fn remove_key(&self) -> Result<(), String> {
        let mut state = self.state.lock().await;
        self.vault.as_ref().map_err(Clone::clone)?.delete()?;
        state.revision = state.revision.wrapping_add(1);
        state.models.clear();
        state.key = None;
        Ok(())
    }
    pub(crate) async fn catalog(&self) -> Result<(Vec<Model>, Status), String> {
        let vault = self.vault.as_ref().map_err(Clone::clone)?;
        let (revision, discovery, key) = {
            let mut state = self.state.lock().await;
            state.discovery = state.discovery.wrapping_add(1);
            let Some(key) = vault.read()? else {
                state.models.clear();
                state.key = None;
                return Ok((
                    vec![],
                    status(
                        "needsKey",
                        "Add an xAI API key. API usage has separate limits and billing.",
                    ),
                ));
            };
            (state.revision, state.discovery, key)
        };
        let result = tokio::time::timeout(
            Duration::from_secs(10),
            self.http.as_ref().map_err(Clone::clone)?.discover(&key),
        )
        .await
        .unwrap_or_else(|_| Err("xAI model discovery timed out.".into()));
        let mut state = self.state.lock().await;
        if revision != state.revision || discovery != state.discovery {
            return Err("xAI connection changed. Refresh model access.".into());
        }
        if vault
            .read()?
            .as_ref()
            .is_none_or(|current| current.as_bytes() != key.as_bytes())
        {
            state.models.clear();
            state.key = None;
            return Err("xAI API key changed. Refresh model access.".into());
        }
        match result {
            Ok(models) => {
                let detail = format!("{} API models · quota managed by xAI", models.len());
                state.models = models.clone();
                state.key = Some(key);
                Ok((models, status("connected", &detail)))
            }
            Err(error) => {
                state.models.clear();
                state.key = None;
                Err(error)
            }
        }
    }
    fn checked_key(
        &self,
        state: &CatalogState,
        model: &str,
        options: &ModelOptions,
    ) -> Result<Secret, String> {
        let entry = state
            .models
            .iter()
            .find(|entry| entry.id == model)
            .ok_or("Refresh xAI model access before sending this message.")?;
        if options
            .service_tier
            .as_deref()
            .is_some_and(|tier| tier != "default")
            || options
                .reasoning_effort
                .as_ref()
                .is_some_and(|effort| !entry.reasoning_efforts.contains(effort))
        {
            return Err("Choose reasoning and service options supported by this xAI model.".into());
        }
        let key = self
            .vault
            .as_ref()
            .map_err(Clone::clone)?
            .read()?
            .ok_or("Add an xAI API key in Connections.")?;
        if state
            .key
            .as_ref()
            .is_none_or(|cached| cached.as_bytes() != key.as_bytes())
        {
            return Err("Refresh xAI model access before sending this message.".into());
        }
        Ok(key)
    }
    pub(crate) async fn authorize(
        &self,
        model: &str,
        options: &ModelOptions,
    ) -> Result<Secret, String> {
        let state = self.state.lock().await;
        self.checked_key(&state, model, options)
    }
    pub(crate) async fn stream(
        &self,
        model: &str,
        key: Secret,
        context: &[Message],
        instructions: Option<&str>,
        options: &ModelOptions,
        on_delta: impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        {
            let state = self.state.lock().await;
            let current = self.checked_key(&state, model, options)?;
            if current.as_bytes() != key.as_bytes() {
                return Err(
                    "xAI API key changed after this message was queued. Send again.".into(),
                );
            }
        }
        let model = model
            .strip_prefix("xai:")
            .filter(|id| valid_id(id))
            .ok_or("Choose an available xAI model.")?;
        self.http
            .as_ref()
            .map_err(Clone::clone)?
            .stream(&key, model, context, instructions, options, on_delta)
            .await
    }
}
fn status(state: &str, detail: &str) -> Status {
    Status {
        id: "xai".into(),
        name: "xAI API".into(),
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
            .map_err(|_| "xAI API networking is unavailable.".into())
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
        key: &Secret,
    ) -> Result<reqwest::RequestBuilder, String> {
        let mut bytes = b"Bearer ".to_vec();
        bytes.extend_from_slice(key.as_bytes());
        let header = HeaderValue::from_bytes(&bytes);
        wipe(&mut bytes);
        let mut header = header.map_err(|_| "The saved xAI API key is invalid.")?;
        header.set_sensitive(true);
        Ok(self
            .client
            .request(method, format!("{}{path}", self.origin))
            .header("authorization", header))
    }
    async fn discover(&self, key: &Secret) -> Result<Vec<Model>, String> {
        let response = self
            .request(reqwest::Method::GET, "/language-models", key)?
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|_| "Could not reach the xAI API.")?;
        check_status(response.status())?;
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "xAI model discovery disconnected.")?;
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return Err("xAI model list is too large.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| "xAI returned an invalid model list.")?;
        let entries = value["models"]
            .as_array()
            .ok_or("xAI returned an invalid model list.")?;
        if entries.len() > 200 {
            return Err("xAI model list exceeds the supported limit.".into());
        }
        let mut seen = HashSet::new();
        let mut models = Vec::new();
        for entry in entries {
            let Some(id) = entry["id"].as_str().filter(|id| valid_id(id)) else {
                continue;
            };
            if !["input_modalities", "output_modalities"]
                .iter()
                .all(|field| {
                    entry[*field]
                        .as_array()
                        .is_some_and(|values| values.iter().any(|v| v == "text"))
                })
                || !seen.insert(id.to_string())
            {
                continue;
            }
            let mut efforts: Vec<String> = entry["capabilities"]["reasoning_effort"]
                .as_array()
                .map(|efforts| {
                    efforts
                        .iter()
                        .filter_map(|v| {
                            v.as_str()
                                .filter(|s| {
                                    !s.is_empty()
                                        && s.len() <= 20
                                        && s.bytes().all(|byte| {
                                            byte.is_ascii_alphanumeric() || byte == b'_'
                                        })
                                })
                                .map(str::to_owned)
                        })
                        .take(10)
                        .collect()
                })
                .unwrap_or_default();
            let mut effort_seen = HashSet::new();
            efforts.retain(|effort| effort_seen.insert(effort.clone()));
            let default = entry["capabilities"]["default_reasoning_effort"]
                .as_str()
                .filter(|effort| efforts.iter().any(|e| e == effort))
                .map(str::to_owned);
            models.push(Model {
                id: format!("xai:{id}"),
                name: id.into(),
                provider: "xAI".into(),
                description: "xAI API · separate API usage and billing".into(),
                reasoning_efforts: efforts,
                default_reasoning_effort: default,
                ..Model::default()
            });
        }
        Ok(models)
    }
    async fn stream(
        &self,
        key: &Secret,
        model: &str,
        context: &[Message],
        instructions: Option<&str>,
        options: &ModelOptions,
        mut on_delta: impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        if !valid_id(model)
            || context.is_empty()
            || context.last().is_none_or(|message| message.role != "user")
        {
            return Err("Unsupported xAI model or chat context.".into());
        }
        let mut input = Vec::new();
        for message in context {
            if !matches!(message.role.as_str(), "user" | "assistant") {
                return Err("Unsupported xAI chat context.".into());
            }
            input.push(json!({"role":message.role,"content":message.content}));
        }
        let mut body = json!({"model":model,"input":input,"stream":true,"store":false,"max_output_tokens":4096});
        if let Some(text) = instructions.filter(|text| !text.is_empty()) {
            body["instructions"] = text.into();
        }
        if let Some(effort) = &options.reasoning_effort {
            body["reasoning"] = json!({"effort":effort});
        }
        let response = self
            .request(reqwest::Method::POST, "/responses", key)?
            .json(&body)
            .timeout(Duration::from_secs(600))
            .send()
            .await
            .map_err(|_| "Could not reach the xAI API.")?;
        check_status(response.status())?;
        if !response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|value| {
                value
                    .split(';')
                    .next()
                    .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/event-stream"))
            })
        {
            return Err(INVALID_STREAM.into());
        }
        let mut decoder = Decoder::new(INVALID_STREAM);
        let mut state = TextStream::default();
        let mut stream = response.bytes_stream();
        let mut wire = 0usize;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(
                |_| "xAI disconnected before completing the response. Partial text is retained.",
            )?;
            wire = wire.checked_add(chunk.len()).ok_or(INVALID_STREAM)?;
            if wire > MAX_WIRE {
                return Err("xAI response exceeded the stream limit.".into());
            }
            if decoder.push(&chunk, |value| state.event(value, &mut on_delta))? {
                return Ok(());
            }
        }
        Err(
            "xAI disconnected before a complete terminal response. Partial text is retained."
                .into(),
        )
    }
}
fn check_status(status: reqwest::StatusCode) -> Result<(), String> {
    if status.is_success() {
        return Ok(());
    }
    Err(match status.as_u16() {
        401 | 403 => "xAI rejected the API key or model access. Check Connections.".into(),
        429 => "xAI API limit reached. Check Console usage and billing before trying again.".into(),
        300..=399 => "xAI redirected the request. No redirect was followed.".into(),
        code => format!("xAI API request failed (HTTP {code})."),
    })
}

struct TextPart {
    text: String,
    finished: bool,
}
struct MessageOutput {
    id: String,
    parts: Vec<TextPart>,
    active: Option<usize>,
    done: bool,
}
impl MessageOutput {
    fn matches(&self, value: &Value) -> bool {
        value["type"] == "message"
            && value["role"] == "assistant"
            && value["status"] == "completed"
            && value["id"].as_str() == Some(self.id.as_str())
            && value["content"].as_array().is_some_and(|content| {
                content.len() == self.parts.len()
                    && content.iter().zip(&self.parts).all(|(part, saved)| {
                        part["type"] == "output_text"
                            && part["text"].as_str() == Some(saved.text.as_str())
                    })
            })
    }
}
enum OutputItem {
    Message(MessageOutput),
    Reasoning { id: String, done: bool },
}
impl OutputItem {
    fn id(&self) -> &str {
        match self {
            Self::Message(message) => &message.id,
            Self::Reasoning { id, .. } => id,
        }
    }
    fn done(&self) -> bool {
        match self {
            Self::Message(message) => message.done && message.active.is_none(),
            Self::Reasoning { done, .. } => *done,
        }
    }
}
#[derive(Default)]
struct TextStream {
    id: Option<String>,
    items: Vec<OutputItem>,
    output: usize,
}
fn index(value: &Value, field: &str) -> Result<usize, String> {
    value[field]
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| INVALID_STREAM.into())
}
fn protocol_id(value: &Value) -> Result<&str, String> {
    // Provider schema permits empty IDs; output_index still binds each item.
    value
        .as_str()
        .filter(|id| id.len() <= 200 && id.bytes().all(|byte| byte.is_ascii_graphic()))
        .ok_or_else(|| INVALID_STREAM.into())
}
impl TextStream {
    fn reserve_text(&mut self, text: &str) -> Result<(), String> {
        self.output = self.output.checked_add(text.len()).ok_or(INVALID_STREAM)?;
        if self.output > pavane_core::MAX_OUTPUT_BYTES {
            return Err("xAI response exceeded the text limit.".into());
        }
        Ok(())
    }
    fn message(&mut self, value: &Value) -> Result<&mut MessageOutput, String> {
        let item = self
            .items
            .get_mut(index(value, "output_index")?)
            .ok_or(INVALID_STREAM)?;
        match item {
            OutputItem::Message(message)
                if !message.done && value["item_id"].as_str() == Some(message.id.as_str()) =>
            {
                Ok(message)
            }
            _ => Err(INVALID_STREAM.into()),
        }
    }
    fn complete(&self, value: &Value) -> Result<bool, String> {
        let response = &value["response"];
        if self.id.is_none()
            || self.id.as_deref() != response["id"].as_str()
            || response["status"] != "completed"
            || !response["error"].is_null()
            || !response["incomplete_details"].is_null()
        {
            return Err("xAI did not complete this response. Partial text is retained.".into());
        }
        let output = response["output"].as_array().ok_or(INVALID_STREAM)?;
        if output.is_empty() {
            // Some compatible terminals omit repeated output. Earlier item-done
            // snapshots must then have confirmed every emitted text part.
            if self.items.is_empty() || !self.items.iter().all(OutputItem::done) {
                return Err(INVALID_STREAM.into());
            }
        } else {
            if output.len() != self.items.len() {
                return Err(INVALID_STREAM.into());
            }
            for (value, item) in output.iter().zip(&self.items) {
                let matches = match item {
                    OutputItem::Message(message) => message.matches(value),
                    OutputItem::Reasoning { id, .. } => {
                        value["type"] == "reasoning" && value["id"].as_str() == Some(id.as_str())
                    }
                };
                if !matches {
                    return Err(INVALID_STREAM.into());
                }
            }
        }
        if self.output == 0 {
            return Err("xAI returned no text.".into());
        }
        Ok(true)
    }
    fn event(
        &mut self,
        value: Value,
        emit: &mut impl FnMut(&str) -> Result<(), String>,
    ) -> Result<bool, String> {
        let kind = value["type"].as_str().ok_or(INVALID_STREAM)?;
        match kind {
            "response.created" => {
                if self.id.is_some() || value["response"]["status"] != "in_progress" { return Err(INVALID_STREAM.into()); }
                self.id = Some(protocol_id(&value["response"]["id"])? .into());
            }
            "response.in_progress" => {
                if self.id.is_none() || self.id.as_deref() != value["response"]["id"].as_str() || value["response"]["status"] != "in_progress" { return Err(INVALID_STREAM.into()); }
            }
            "response.output_item.added" => {
                if self.id.is_none() || index(&value, "output_index")? != self.items.len() || self.items.len() >= 128 { return Err(INVALID_STREAM.into()); }
                let id = protocol_id(&value["item"]["id"])? .to_owned();
                if !id.is_empty() && self.items.iter().any(|item| item.id() == id) { return Err(INVALID_STREAM.into()); }
                // Emit visible items in terminal output order. An earlier open
                // message could otherwise append text after a later message.
                if value["item"]["type"] == "message" && self.items.iter().any(|item| matches!(item, OutputItem::Message(message) if !message.done)) { return Err(INVALID_STREAM.into()); }
                let item = match value["item"]["type"].as_str() {
                    Some("message") if value["item"]["role"] == "assistant" && value["item"]["content"].as_array().is_some_and(Vec::is_empty) => OutputItem::Message(MessageOutput { id, parts:Vec::new(), active:None, done:false }),
                    Some("reasoning") => OutputItem::Reasoning { id, done:false },
                    _ => return Err("xAI returned a tool or unsupported output item. Partial text is retained.".into()),
                };
                self.items.push(item);
            }
            "response.content_part.added" => {
                if value["part"]["type"] != "output_text" { return Err(INVALID_STREAM.into()); }
                let text = match value["part"].get("text") { None => "", Some(text) => text.as_str().ok_or(INVALID_STREAM)? };
                self.reserve_text(text)?;
                let part = index(&value, "content_index")?;
                let message = self.message(&value)?;
                if message.active.is_some() || part != message.parts.len() || part >= 128 { return Err(INVALID_STREAM.into()); }
                message.parts.push(TextPart { text:text.into(), finished:false });
                message.active = Some(part);
                if !text.is_empty() { emit(text)?; }
            }
            "response.output_text.delta" => {
                let text = value["delta"].as_str().ok_or(INVALID_STREAM)?;
                self.reserve_text(text)?;
                let part = index(&value, "content_index")?;
                let message = self.message(&value)?;
                if message.active != Some(part) { return Err(INVALID_STREAM.into()); }
                let part = message.parts.get_mut(part).ok_or(INVALID_STREAM)?;
                if part.finished { return Err(INVALID_STREAM.into()); }
                part.text.push_str(text);
                if !text.is_empty() { emit(text)?; }
            }
            "response.output_text.done" => {
                let part = index(&value, "content_index")?;
                let message = self.message(&value)?;
                if message.active != Some(part) { return Err(INVALID_STREAM.into()); }
                let part = message.parts.get_mut(part).ok_or(INVALID_STREAM)?;
                if part.finished || value["text"].as_str() != Some(part.text.as_str()) { return Err(INVALID_STREAM.into()); }
                part.finished = true;
            }
            "response.content_part.done" => {
                let part = index(&value, "content_index")?;
                let message = self.message(&value)?;
                if message.active != Some(part) || value["part"]["type"] != "output_text"
                    || value["part"]["text"].as_str() != message.parts.get(part).map(|part| part.text.as_str()) { return Err(INVALID_STREAM.into()); }
                message.active = None;
            }
            "response.output_item.done" => {
                let item = self.items.get_mut(index(&value, "output_index")?).ok_or(INVALID_STREAM)?;
                match item {
                    OutputItem::Message(message) => {
                        if message.done || !message.matches(&value["item"]) { return Err(INVALID_STREAM.into()); }
                        message.done = true;
                        message.active = None;
                    }
                    OutputItem::Reasoning { id, done } => {
                        if *done || value["item"]["type"] != "reasoning" || value["item"]["id"].as_str() != Some(id.as_str()) { return Err(INVALID_STREAM.into()); }
                        *done = true;
                    }
                }
            }
            "response.completed" | "response.done" => return self.complete(&value),
            "response.incomplete" => return Err("xAI reached an output or context limit. Partial text is retained.".into()),
            "response.failed" | "error" => return Err("xAI reported a streaming error. Partial text is retained; check Console access and usage.".into()),
            "response.reasoning_summary_part.added" | "response.reasoning_summary_part.done" | "response.reasoning_summary_text.delta" | "response.reasoning_summary_text.done" | "response.reasoning_text.delta" | "response.reasoning_text.done" | "response.reasoning.delta" | "response.reasoning.done" => {
                if !matches!(self.items.get(index(&value, "output_index")?), Some(OutputItem::Reasoning { id, done:false }) if value["item_id"].as_str() == Some(id.as_str())) { return Err(INVALID_STREAM.into()); }
            }
            "ping" => {},
            _ if value.as_object().is_some_and(|object| object.keys().all(|key| key == "type")) => {},
            _ => return Err(INVALID_STREAM.into()),
        }
        Ok(false)
    }
}

#[cfg(test)]
mod tests;
