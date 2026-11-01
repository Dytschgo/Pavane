use futures_util::StreamExt;
use pavane_core::Message;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;

const OLLAMA: &str = "http://127.0.0.1:11434";
const MAX_FRAME: usize = 256 * 1024;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub reasoning_efforts: Vec<String>,
    pub default_reasoning_effort: Option<String>,
    pub service_tiers: Vec<ServiceTier>,
    pub is_default: bool,
    pub description: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ServiceTier {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOptions {
    pub reasoning_effort: Option<String>,
    pub service_tier: Option<String>,
}

pub async fn discover(client: &reqwest::Client) -> Result<Vec<Model>, String> {
    let response = client
        .get(format!("{OLLAMA}/api/tags"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|_| {
            "Ollama is not available. Start Ollama on this device, then refresh.".to_string()
        })?;
    if !response.status().is_success() {
        return Err("Ollama could not list models. Check its local service.".into());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Ollama disconnected.".to_string())?;
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err("Ollama model list is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Ollama returned an invalid model list.".to_string())?;
    let models = value["models"]
        .as_array()
        .ok_or("Ollama returned an invalid model list.")?;
    Ok(models
        .iter()
        .take(200)
        .filter_map(|model| {
            let name = model["name"].as_str()?;
            // Cloud models require separate account/billing support, not this local adapter.
            if name.is_empty()
                || name.len() > 240
                || name.ends_with(":cloud")
                || name.ends_with("-cloud")
            {
                return None;
            }
            Some(Model {
                id: format!("ollama:{name}"),
                name: name.into(),
                provider: "Ollama".into(),
                ..Model::default()
            })
        })
        .collect())
}

pub async fn stream(
    client: &reqwest::Client,
    model: &str,
    context: &[Message],
    instructions: Option<&str>,
    mut on_delta: impl FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    let mut messages = Vec::new();
    if let Some(instructions) = instructions.filter(|text| !text.is_empty()) {
        messages.push(json!({"role":"system","content":instructions}));
    }
    for message in context {
        messages.push(json!({"role":message.role,"content":message.content}));
    }
    let response = client
        .post(format!("{OLLAMA}/api/chat"))
        .json(&json!({"model":model,"messages":messages,"stream":true,"keep_alive":"1m"}))
        .send()
        .await
        .map_err(|_| {
            "Could not reach Ollama. Check that the local service is running.".to_string()
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "Ollama could not start the model (HTTP {}). Check that it is installed.",
            response.status().as_u16()
        ));
    }
    let mut stream = response.bytes_stream();
    let mut decoder = Decoder::default();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|_| "Ollama disconnected. Your partial response is saved.".to_string())?;
        for frame in decoder.push(&chunk)? {
            if let Some(delta) = frame["message"]["content"].as_str() {
                on_delta(delta)?;
            }
            if frame.get("error").is_some() {
                return Err(
                    "Ollama reported an error. Check the installed model and available memory."
                        .into(),
                );
            }
            if frame["done"].as_bool() == Some(true) {
                return Ok(());
            }
        }
    }
    for frame in decoder.finish()? {
        if let Some(delta) = frame["message"]["content"].as_str() {
            on_delta(delta)?;
        }
        if frame["done"].as_bool() == Some(true) {
            return Ok(());
        }
    }
    Err("The model stopped before completing its response. Your partial response is saved.".into())
}

#[derive(Default)]
struct Decoder {
    buffer: Vec<u8>,
}

impl Decoder {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<Value>, String> {
        let mut frames = Vec::new();
        // Bound each frame, not the transport chunk (which can contain many frames).
        for byte in chunk {
            if *byte == b'\n' {
                if !self.buffer.is_empty() {
                    frames.push(
                        serde_json::from_slice(&self.buffer)
                            .map_err(|_| "Ollama returned an invalid stream.".to_string())?,
                    );
                    self.buffer.clear();
                }
            } else {
                if self.buffer.len() >= MAX_FRAME {
                    return Err("Ollama response frame is too large.".into());
                }
                self.buffer.push(*byte);
            }
        }
        Ok(frames)
    }

    fn finish(&mut self) -> Result<Vec<Value>, String> {
        if self.buffer.is_empty() {
            Ok(Vec::new())
        } else {
            self.push(b"\n")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decoder_preserves_fragmented_utf8_and_final_frame() {
        let bytes = "{\"message\":{\"content\":\"Grüezi 🦀\"}}\n{\"done\":true}".as_bytes();
        let mut decoder = Decoder::default();
        let mut frames = Vec::new();
        for byte in bytes {
            frames.extend(decoder.push(&[*byte]).unwrap());
        }
        frames.extend(decoder.finish().unwrap());
        assert_eq!(frames[0]["message"]["content"], "Grüezi 🦀");
        assert_eq!(frames[1]["done"], true);
    }
    #[test]
    fn decoder_rejects_invalid_or_unbounded_frames() {
        assert!(Decoder::default().push(b"not json\n").is_err());
        assert!(Decoder::default().push(&vec![b'x'; MAX_FRAME + 1]).is_err());
    }
}
