use crate::{
    codex::Status,
    credentials::{Secret, Vault},
    provider::{Model, ModelOptions},
};
use futures_util::StreamExt;
use pavane_core::Message;
use reqwest::header::HeaderValue;
use serde_json::{Value, json};
use std::{collections::HashSet, path::Path, time::Duration};
use tokio::sync::Mutex;

const ORIGIN: &str = "https://generativelanguage.googleapis.com/v1beta";
const MAX_FRAME: usize = 256 * 1024;
const MAX_WIRE: usize = 32 * 1024 * 1024;
const INVALID_STREAM: &str = "Gemini returned an invalid or unsupported text response.";

#[derive(Default)]
struct CatalogState {
    revision: u64,
    discovery: u64,
    models: Vec<Model>,
    key: Option<Secret>,
}

pub(crate) struct Manager {
    vault: Result<Vault, String>,
    http: Result<Http, String>,
    state: Mutex<CatalogState>,
}

impl Manager {
    pub(crate) fn new(directory: &Path) -> Self {
        Self {
            vault: Vault::new(directory),
            http: Http::new(),
            state: Mutex::new(CatalogState::default()),
        }
    }

    pub(crate) async fn save_key(&self, key: String) -> Result<(), String> {
        let key = Secret::new(key)?;
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
                        "Add a Gemini API key. API usage has separate limits and billing.",
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
        .unwrap_or_else(|_| Err("Gemini model discovery timed out.".into()));
        let mut state = self.state.lock().await;
        if revision != state.revision || discovery != state.discovery {
            return Err("Gemini connection changed. Refresh model access.".into());
        }
        // Bind availability to the exact credential, including external vault edits.
        let current = vault.read()?;
        if current
            .as_ref()
            .is_none_or(|current| current.as_bytes() != key.as_bytes())
        {
            // Temporary CI probe: classification only, never credential bytes or hashes.
            #[cfg(test)]
            eprintln!(
                "[DEBUG-gemini-vault-001] catalog recheck: {}",
                if current.is_none() {
                    "missing"
                } else {
                    "different"
                }
            );
            state.models.clear();
            state.key = None;
            return Err("Gemini API key changed. Refresh model access.".into());
        }
        match result {
            Ok(models) => {
                let detail = format!("{} API models · quota managed by Google", models.len());
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
        if options.reasoning_effort.is_some()
            || options
                .service_tier
                .as_deref()
                .is_some_and(|tier| tier != "default")
        {
            return Err(
                "This Gemini API connection does not expose reasoning or service-tier controls."
                    .into(),
            );
        }
        let key = self
            .vault
            .as_ref()
            .map_err(Clone::clone)?
            .read()?
            .ok_or("Add a Gemini API key in Connections.")?;
        if !state.models.iter().any(|item| item.id == model)
            || state
                .key
                .as_ref()
                .is_none_or(|cached| cached.as_bytes() != key.as_bytes())
        {
            return Err("Refresh Gemini model access before sending this message.".into());
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
        on_delta: impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        {
            let state = self.state.lock().await;
            let current = self.checked_key(&state, model, &ModelOptions::default())?;
            if current.as_bytes() != key.as_bytes() {
                return Err(
                    "Gemini API key changed after this message was queued. Send again.".into(),
                );
            }
        }
        let id = model
            .strip_prefix("gemini:")
            .filter(|id| valid_model(id))
            .ok_or("Choose an available Gemini model.")?;
        self.http
            .as_ref()
            .map_err(Clone::clone)?
            .stream(&key, id, context, instructions, on_delta)
            .await
    }
}

fn status(state: &str, detail: &str) -> Status {
    Status {
        id: "gemini".into(),
        name: "Gemini API".into(),
        state: state.into(),
        detail: detail.into(),
        limits: vec![],
    }
}

fn valid_model(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 160
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
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
            .map_err(|_| "Gemini API networking is unavailable.".into())
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
    fn header(key: &Secret) -> Result<HeaderValue, String> {
        let mut header = HeaderValue::from_bytes(key.as_bytes())
            .map_err(|_| "The saved Gemini API key is invalid.")?;
        header.set_sensitive(true);
        Ok(header)
    }
    async fn discover(&self, key: &Secret) -> Result<Vec<Model>, String> {
        let mut models = Vec::new();
        let mut token: Option<String> = None;
        let mut seen = HashSet::new();
        for _ in 0..5 {
            let mut request = self
                .client
                .get(format!("{}/models", self.origin))
                .header("x-goog-api-key", Self::header(key)?)
                .query(&[("pageSize", "200")])
                .timeout(Duration::from_secs(8));
            if let Some(token) = &token {
                request = request.query(&[("pageToken", token)]);
            }
            let response = request
                .send()
                .await
                .map_err(|_| "Could not reach the Gemini API.")?;
            check_status(response.status())?;
            let mut bytes = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| "Gemini model discovery disconnected.")?;
                if bytes.len() + chunk.len() > 1024 * 1024 {
                    return Err("Gemini model list is too large.".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| "Gemini returned an invalid model list.")?;
            let entries = value["models"]
                .as_array()
                .ok_or("Gemini returned an invalid model list.")?;
            for entry in entries {
                let Some(id) = entry["name"]
                    .as_str()
                    .and_then(|name| name.strip_prefix("models/"))
                else {
                    continue;
                };
                if !valid_model(id)
                    || !id.starts_with("gemini-")
                    || ["image", "tts", "audio", "robotics"]
                        .iter()
                        .any(|part| id.contains(part))
                {
                    continue;
                }
                if !entry["supportedGenerationMethods"]
                    .as_array()
                    .is_some_and(|methods| methods.iter().any(|method| method == "generateContent"))
                {
                    continue;
                }
                if models
                    .iter()
                    .any(|model: &Model| model.id == format!("gemini:{id}"))
                {
                    continue;
                }
                let name: String = entry["displayName"]
                    .as_str()
                    .unwrap_or(id)
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(120)
                    .collect();
                models.push(Model {
                    id: format!("gemini:{id}"),
                    name: if name.trim().is_empty() {
                        id.into()
                    } else {
                        name
                    },
                    provider: "Gemini".into(),
                    description: "Gemini API · separate API usage and billing".into(),
                    ..Model::default()
                });
                if models.len() == 200 {
                    return Ok(models);
                }
            }
            token = match value.get("nextPageToken") {
                None => return Ok(models),
                Some(value) => {
                    let next = value
                        .as_str()
                        .filter(|next| !next.is_empty() && next.len() <= 4096)
                        .ok_or("Gemini returned invalid pagination.")?;
                    if !seen.insert(next.to_string()) {
                        return Err("Gemini repeated a model-list page.".into());
                    }
                    Some(next.to_string())
                }
            };
        }
        Err("Gemini model discovery exceeded its page limit.".into())
    }
    async fn stream(
        &self,
        key: &Secret,
        model: &str,
        context: &[Message],
        instructions: Option<&str>,
        mut on_delta: impl FnMut(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        if !valid_model(model) {
            return Err("Choose an available Gemini model.".into());
        }
        let mut contents: Vec<Value> = Vec::new();
        for message in context {
            let role = match message.role.as_str() {
                "user" => "user",
                "assistant" => "model",
                _ => return Err("Unsupported Gemini chat context.".into()),
            };
            if let Some(last) = contents.last_mut().filter(|last| last["role"] == role) {
                last["parts"]
                    .as_array_mut()
                    .ok_or("Invalid Gemini chat context.")?
                    .push(json!({"text":message.content}));
            } else {
                contents.push(json!({"role":role,"parts":[{"text":message.content}]}));
            }
        }
        let mut body = json!({"contents":contents,"generationConfig":{"candidateCount":1,"responseModalities":["TEXT"]}});
        if let Some(text) = instructions.filter(|text| !text.is_empty()) {
            body["systemInstruction"] = json!({"parts":[{"text":text}]});
        }
        let response = self
            .client
            .post(format!(
                "{}/models/{model}:streamGenerateContent",
                self.origin
            ))
            .query(&[("alt", "sse")])
            .header("x-goog-api-key", Self::header(key)?)
            .json(&body)
            .timeout(Duration::from_secs(600))
            .send()
            .await
            .map_err(|_| "Could not reach the Gemini API.")?;
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
        let mut decoder = Decoder::default();
        let mut wire = 0usize;
        let mut output = 0usize;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "Gemini disconnected before completing the response.")?;
            wire = wire.checked_add(chunk.len()).ok_or(INVALID_STREAM)?;
            if wire > MAX_WIRE {
                return Err("Gemini response exceeded the stream limit.".into());
            }
            if decoder.push(&chunk, |event| process(&event, &mut output, &mut on_delta))? {
                return if output > 0 {
                    Ok(())
                } else {
                    Err("Gemini returned no text.".into())
                };
            }
        }
        Err("Gemini disconnected before completing the response.".into())
    }
}

fn check_status(status: reqwest::StatusCode) -> Result<(), String> {
    if status.is_success() {
        return Ok(());
    }
    Err(match status.as_u16() {
        401 | 403 => "Gemini rejected the API key or model access. Check Connections.".into(),
        429 => "Gemini API limit reached. Check Google API quotas and billing, then retry.".into(),
        300..=399 => "Gemini redirected the request. No redirect was followed.".into(),
        code => format!("Gemini API request failed (HTTP {code})."),
    })
}

fn process(
    value: &Value,
    output: &mut usize,
    on_delta: &mut impl FnMut(&str) -> Result<(), String>,
) -> Result<bool, String> {
    if !value.is_object()
        || value.get("error").is_some()
        || value["promptFeedback"].get("blockReason").is_some()
    {
        return Err(INVALID_STREAM.into());
    }
    let Some(candidates) = value.get("candidates") else {
        return if value["usageMetadata"].is_object() {
            Ok(false)
        } else {
            Err(INVALID_STREAM.into())
        };
    };
    let candidates = candidates.as_array().ok_or(INVALID_STREAM)?;
    if candidates.len() != 1 {
        return Err(INVALID_STREAM.into());
    }
    let candidate = &candidates[0];
    if candidate
        .get("index")
        .is_some_and(|index| index.as_u64() != Some(0))
    {
        return Err(INVALID_STREAM.into());
    }
    if let Some(content) = candidate.get("content") {
        let content = content.as_object().ok_or(INVALID_STREAM)?;
        if content
            .keys()
            .any(|key| !["parts", "role"].contains(&key.as_str()))
            || content.get("role").is_some_and(|role| role != "model")
        {
            return Err(INVALID_STREAM.into());
        }
    }
    if let Some(parts) = candidate["content"].get("parts") {
        for part in parts.as_array().ok_or(INVALID_STREAM)? {
            let fields = part.as_object().ok_or(INVALID_STREAM)?;
            if fields
                .keys()
                .any(|key| !["text", "thought", "thoughtSignature"].contains(&key.as_str()))
                || fields
                    .get("thoughtSignature")
                    .is_some_and(|value| !value.is_string())
            {
                return Err(INVALID_STREAM.into());
            }
            let text = part["text"].as_str().ok_or(INVALID_STREAM)?;
            match part.get("thought") {
                Some(Value::Bool(true)) => continue,
                Some(Value::Bool(false)) | None => (),
                _ => return Err(INVALID_STREAM.into()),
            }
            *output = output.checked_add(text.len()).ok_or(INVALID_STREAM)?;
            if *output > pavane_core::MAX_OUTPUT_BYTES {
                return Err("Response reached the 2 MiB safety limit.".into());
            }
            on_delta(text)?;
        }
    }
    match candidate.get("finishReason") {
        None => Ok(false),
        Some(Value::String(reason)) if reason == "STOP" => Ok(true),
        Some(Value::String(reason)) if reason == "FINISH_REASON_UNSPECIFIED" => Ok(false),
        Some(_) => {
            Err("Gemini stopped before completing the response. Partial text is retained.".into())
        }
    }
}

#[derive(Default)]
struct Decoder {
    line: Vec<u8>,
    data: Vec<u8>,
    after_cr: bool,
}
impl Decoder {
    fn push(
        &mut self,
        bytes: &[u8],
        mut emit: impl FnMut(Value) -> Result<bool, String>,
    ) -> Result<bool, String> {
        for byte in bytes {
            if self.after_cr {
                self.after_cr = false;
                if *byte == b'\n' {
                    continue;
                }
            }
            if *byte == b'\r' || *byte == b'\n' {
                self.after_cr = *byte == b'\r';
                if self.line.is_empty() {
                    if !self.data.is_empty() {
                        let event =
                            serde_json::from_slice(&self.data).map_err(|_| INVALID_STREAM)?;
                        self.data.clear();
                        if emit(event)? {
                            return Ok(true);
                        }
                    }
                } else if self.line.starts_with(b"data:") {
                    let mut data = &self.line[5..];
                    if data.first() == Some(&b' ') {
                        data = &data[1..];
                    }
                    if self.data.len() + data.len() + 1 > MAX_FRAME {
                        return Err("Gemini response event is too large.".into());
                    }
                    if !self.data.is_empty() {
                        self.data.push(b'\n');
                    }
                    self.data.extend_from_slice(data);
                }
                self.line.clear();
            } else {
                if self.line.len() >= MAX_FRAME {
                    return Err("Gemini response line is too large.".into());
                }
                self.line.push(*byte);
            }
        }
        Ok(false)
    }
}

#[cfg(test)]
mod tests;
