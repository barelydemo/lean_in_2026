//! Groq (OpenAI-compatible API): an alternative story director and a fast
//! Whisper speech-to-text backend.

use std::time::Duration;

use anyhow::{anyhow, bail};
use bytes::Bytes;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::config::Config;

const BASE_URL: &str = "https://api.groq.com/openai/v1";

/// Models that accept `response_format: json_schema` with `strict: true`.
/// Others fall back to JSON-object mode with the schema in the prompt.
const STRICT_SCHEMA_MODELS: &[&str] = &["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

pub struct Groq {
    http: reqwest::Client,
    api_key: String,
    model: String,
    reasoning_effort: String,
    stt_model: String,
}

#[derive(Deserialize)]
struct Transcription {
    text: String,
}

impl Groq {
    pub fn new(cfg: &Config) -> anyhow::Result<Self> {
        let api_key = cfg.groq_api_key.clone().ok_or_else(|| anyhow!("GROQ_API_KEY must be set to use Groq"))?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(90))
            .connect_timeout(Duration::from_secs(10))
            .build()?;
        Ok(Groq {
            http,
            api_key,
            model: cfg.groq_model.clone(),
            reasoning_effort: cfg.groq_reasoning_effort.clone(),
            stt_model: cfg.groq_stt_model.clone(),
        })
    }

    pub async fn complete_json(&self, system: &[&str], user: &str, schema: &Value) -> anyhow::Result<String> {
        let strict = STRICT_SCHEMA_MODELS.contains(&self.model.as_str());
        let mut system = system.join("\n\n");
        let response_format = if strict {
            json!({ "type": "json_schema", "json_schema": { "name": "director_turn", "strict": true, "schema": schema } })
        } else {
            let schema_str = serde_json::to_string(schema).unwrap_or_else(|_| schema.to_string());
            system.push_str(&format!("\n\nRespond with a single JSON object matching this JSON schema:\n{schema_str}"));
            json!({ "type": "json_object" })
        };
        let mut body = json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ],
            "response_format": response_format,
            "max_completion_tokens": 8000,
        });
        if self.model.starts_with("openai/gpt-oss") {
            body["reasoning_effort"] = json!(self.reasoning_effort);
        }

        let resp = self.send(&body).await?;
        if let Some(usage) = resp.get("usage") {
            tracing::info!(
                input = usage["prompt_tokens"].as_i64(),
                output = usage["completion_tokens"].as_i64(),
                model = resp["model"].as_str(),
                "groq turn"
            );
        }
        let choice = &resp["choices"][0];
        if choice["finish_reason"] == "length" {
            bail!("director output hit max_completion_tokens");
        }
        choice["message"]["content"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| anyhow!("no content in Groq response"))
    }

    async fn send(&self, body: &Value) -> anyhow::Result<Value> {
        let mut attempt = 0;
        loop {
            attempt += 1;
            let res = self
                .http
                .post(format!("{BASE_URL}/chat/completions"))
                .bearer_auth(&self.api_key)
                .json(body)
                .send()
                .await;
            match res {
                Ok(resp) if resp.status().is_success() => return Ok(resp.json().await?),
                Ok(resp) => {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    if !(status.as_u16() == 429 || status.is_server_error()) || attempt >= 3 {
                        bail!("Groq API {status}: {text}");
                    }
                    tracing::warn!(%status, attempt, "Groq API retryable error");
                }
                Err(e) if attempt < 3 && (e.is_timeout() || e.is_connect()) => {
                    tracing::warn!(error = %e, attempt, "Groq API connection error");
                }
                Err(e) => return Err(e.into()),
            }
            tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
        }
    }

    /// Whisper transcription. Whisper treats the prompt as preceding speech,
    /// so a Japanese-only prompt makes it translate English into Japanese;
    /// a mixed prompt keeps whatever language the player actually spoke.
    pub async fn transcribe(
        &self,
        audio: Bytes,
        filename: String,
        mime: String,
        language: Option<&str>,
        prompt_hint: Option<&str>,
    ) -> anyhow::Result<crate::voice::Heard> {
        let part = reqwest::multipart::Part::bytes(audio.to_vec()).file_name(filename).mime_str(&mime)?;
        let default_prompt = "こんにちは、すみません、だいじょうぶです。かばんがありません。駅はどこですか。";
        let prompt_text = match prompt_hint {
            Some(hint) if !hint.trim().is_empty() => {
                let clean = hint.replace("||", "、");
                format!("{default_prompt} {clean}")
            }
            _ => default_prompt.to_string(),
        };

        let mut form = reqwest::multipart::Form::new()
            .text("model", self.stt_model.clone())
            .text("response_format", "verbose_json")
            .text("prompt", prompt_text)
            .part("file", part);
        if let Some(lang) = language {
            form = form.text("language", lang.to_string());
        }
        let resp = self
            .http
            .post(format!("{BASE_URL}/audio/transcriptions"))
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            bail!("Groq STT {status}: {}", resp.text().await.unwrap_or_default());
        }
        let t = resp.json::<Transcription>().await?;
        Ok(crate::voice::Heard { text: t.text.trim().to_string() })
    }
}
