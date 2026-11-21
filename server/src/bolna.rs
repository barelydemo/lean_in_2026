//! Bolna Voice AI integration: primary speech-to-text transcriber & voice agent pipeline.

use std::time::Duration;

use anyhow::{anyhow, bail};
use bytes::Bytes;
use serde::Deserialize;

use crate::config::Config;
use crate::voice::Heard;

pub struct Bolna {
    http: reqwest::Client,
    api_key: String,
    base_url: String,
    #[allow(dead_code)]
    agent_id: Option<String>,
    stt_model: String,
}

#[derive(Deserialize)]
struct BolnaTranscription {
    text: Option<String>,
    transcript: Option<String>,
    #[serde(default)]
    language: Option<String>,
}

impl Bolna {
    pub fn new(cfg: &Config) -> anyhow::Result<Self> {
        let api_key = cfg
            .bolna_api_key
            .clone()
            .ok_or_else(|| anyhow!("BOLNA_API_KEY must be set to use Bolna"))?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()?;
        Ok(Bolna {
            http,
            api_key,
            base_url: cfg.bolna_base_url.trim_end_matches('/').to_string(),
            agent_id: cfg.bolna_agent_id.clone(),
            stt_model: cfg.bolna_stt_model.clone(),
        })
    }

    /// Transcribe speech audio using Bolna Voice AI pipeline.
    pub async fn transcribe(
        &self,
        audio: Bytes,
        filename: String,
        mime: String,
        language: Option<&str>,
        prompt_hint: Option<&str>,
    ) -> anyhow::Result<Heard> {
        let part = reqwest::multipart::Part::bytes(audio.to_vec())
            .file_name(filename)
            .mime_str(&mime)?;

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
            .text("prompt", prompt_text)
            .part("audio", part);

        if let Some(lang) = language {
            form = form.text("language", lang.to_string());
        }

        let endpoint = if self.base_url.ends_with("/v2") || self.base_url.ends_with("/v1") {
            format!("{}/audio/transcriptions", self.base_url)
        } else {
            format!("{}/v2/audio/transcriptions", self.base_url)
        };

        let resp = self
            .http
            .post(&endpoint)
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_body = resp.text().await.unwrap_or_default();
            bail!("Bolna STT {status}: {err_body}");
        }

        let result = resp.json::<BolnaTranscription>().await?;
        let text = result
            .text
            .or(result.transcript)
            .unwrap_or_default()
            .trim()
            .to_string();

        Ok(Heard {
            text,
            language: result.language,
        })
    }
}
