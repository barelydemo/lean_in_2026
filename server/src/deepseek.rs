//! DeepSeek API client for director turns, glossing and translation.

use std::time::Duration;

use anyhow::{anyhow, bail};
use serde_json::{Value, json};

use crate::config::Config;

pub struct DeepSeek {
    http: reqwest::Client,
    api_key: String,
    base_url: String,
    model: String,
    /// "off", or a reasoning effort ("low", "high", "max").
    thinking: String,
}

impl DeepSeek {
    pub fn new(cfg: &Config) -> anyhow::Result<Self> {
        let api_key = cfg
            .deepseek_api_key
            .clone()
            .ok_or_else(|| anyhow!("DEEPSEEK_API_KEY must be set to use DeepSeek"))?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(10))
            .build()?;
        Ok(DeepSeek {
            http,
            api_key,
            base_url: cfg.deepseek_base_url.trim_end_matches('/').to_string(),
            model: cfg.deepseek_model.clone(),
            thinking: cfg.deepseek_thinking.clone(),
        })
    }

    pub async fn complete_json(&self, system: &[&str], user: &str, schema: &Value) -> anyhow::Result<String> {
        let mut system = system.join("\n\n");
        let schema_str = serde_json::to_string(schema).unwrap_or_else(|_| schema.to_string());
        system.push_str(&format!(
            "\n\nCRITICAL INSTRUCTION: Respond with a single valid JSON object strictly matching this JSON schema:\n{schema_str}"
        ));

        // The system prompt (world, lesson, schema) is identical across turns,
        // so DeepSeek's automatic prefix cache serves it; only `user` is new.
        let mut body = json!({
            "model": self.model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ],
            "response_format": { "type": "json_object" },
            "max_tokens": 4096,
        });
        if self.thinking == "off" {
            body["thinking"] = json!({ "type": "disabled" });
        } else {
            body["thinking"] = json!({ "type": "enabled" });
            body["reasoning_effort"] = json!(self.thinking);
        }

        // JSON mode occasionally returns empty content; one retry clears it.
        for attempt in 1..=2 {
            let started = std::time::Instant::now();
            let resp = self.send(&body).await?;
            if let Some(usage) = resp.get("usage") {
                tracing::info!(
                    input = usage["prompt_tokens"].as_i64(),
                    cached = usage["prompt_cache_hit_tokens"].as_i64(),
                    output = usage["completion_tokens"].as_i64(),
                    ms = started.elapsed().as_millis() as u64,
                    model = resp["model"].as_str(),
                    "deepseek turn"
                );
            }
            let choice = &resp["choices"][0];
            if choice["finish_reason"] == "length" {
                bail!("director output hit max_tokens");
            }
            match choice["message"]["content"].as_str().map(str::trim) {
                Some(text) if !text.is_empty() => return Ok(text.to_string()),
                _ => tracing::warn!(attempt, "DeepSeek returned empty content"),
            }
        }
        Err(anyhow!("no content in DeepSeek response"))
    }

    async fn send(&self, body: &Value) -> anyhow::Result<Value> {
        let url = format!("{}/chat/completions", self.base_url);

        let mut attempt = 0;
        loop {
            attempt += 1;
            let res = self
                .http
                .post(&url)
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
                        bail!("DeepSeek API {status}: {text}");
                    }
                    tracing::warn!(%status, attempt, "DeepSeek API retryable error");
                }
                Err(e) if attempt < 3 && (e.is_timeout() || e.is_connect()) => {
                    tracing::warn!(error = %e, attempt, "DeepSeek API connection error");
                }
                Err(e) => return Err(e.into()),
            }
            tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
        }
    }
}
