//! Claude Messages API client (raw HTTP — there is no official Rust SDK).

use std::time::Duration;

use anyhow::{anyhow, bail};
use serde_json::{Value, json};

use crate::config::Config;

const API_VERSION: &str = "2026-10-21";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

/// Models that accept `fallbacks: "default"` (Haiku doesn't: a refusal there
/// surfaces as an error, which `LLM_FALLBACK` can catch).
const FALLBACK_MODELS: &[&str] = &["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];

pub struct Claude {
    http: reqwest::Client,
    api_key: String,
    base_url: String,
    model: String,
    effort: String,
    thinking_off: bool,
}

impl Claude {
    pub fn new(cfg: &Config) -> anyhow::Result<Self> {
        if cfg.anthropic_api_key.is_empty() {
            bail!("ANTHROPIC_API_KEY must be set to use Claude");
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(10))
            .build()?;
        Ok(Claude {
            http,
            api_key: cfg.anthropic_api_key.clone(),
            base_url: cfg.anthropic_base_url.trim_end_matches('/').to_string(),
            model: cfg.claude_model.clone(),
            effort: cfg.claude_effort.clone(),
            thinking_off: cfg.claude_thinking == "off",
        })
    }

    /// One structured-output request. Each system block is cached as its own
    /// prefix segment (the world prompt, then the chapter brief).
    pub async fn complete_json(&self, system: &[&str], user: &str, schema: &Value) -> anyhow::Result<String> {
        let system: Vec<Value> = system
            .iter()
            .map(|text| json!({ "type": "text", "text": text, "cache_control": { "type": "ephemeral" } }))
            .collect();
        let mut body = json!({
            "model": self.model,
            "max_tokens": 16000,
            "system": system,
            "messages": [{ "role": "user", "content": user }],
            "output_config": {
                "effort": self.effort,
                "format": { "type": "json_schema", "schema": schema },
            },
        });
        if self.thinking_off {
            body["thinking"] = json!({ "type": "disabled" });
        }
        let use_fallbacks = FALLBACK_MODELS.contains(&self.model.as_str());
        if use_fallbacks {
            body["fallbacks"] = json!("default");
        }

        let resp = self.send(&body, use_fallbacks).await?;

        match resp["stop_reason"].as_str() {
            Some("refusal") => bail!("request declined (refusal): {}", resp["stop_details"]),
            Some("max_tokens") => bail!("director output hit max_tokens"),
            _ => {}
        }
        if let Some(usage) = resp.get("usage") {
            tracing::info!(
                input = usage["input_tokens"].as_i64(),
                cache_read = usage["cache_read_input_tokens"].as_i64(),
                cache_write = usage["cache_creation_input_tokens"].as_i64(),
                output = usage["output_tokens"].as_i64(),
                model = resp["model"].as_str(),
                "claude turn"
            );
        }
        // The final text block holds the structured output; thinking and
        // fallback blocks are skipped.
        resp["content"]
            .as_array()
            .and_then(|blocks| blocks.iter().rev().find(|b| b["type"] == "text"))
            .and_then(|b| b["text"].as_str())
            .map(str::to_string)
            .ok_or_else(|| anyhow!("no text block in response"))
    }

    async fn send(&self, body: &Value, with_fallback_beta: bool) -> anyhow::Result<Value> {
        let url = format!("{}/v1/messages", self.base_url);
        let mut attempt = 0;
        loop {
            attempt += 1;
            let mut req = self
                .http
                .post(&url)
                .header("x-api-key", &self.api_key)
                .header("anthropic-version", API_VERSION)
                .json(body);
            if with_fallback_beta {
                req = req.header("anthropic-beta", FALLBACK_BETA);
            }

            let retry_after = match req.send().await {
                Ok(resp) if resp.status().is_success() => return Ok(resp.json().await?),
                Ok(resp) => {
                    let status = resp.status();
                    let retryable = status.as_u16() == 429 || status.as_u16() == 529 || status.is_server_error();
                    let wait = resp
                        .headers()
                        .get("retry-after")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse::<u64>().ok());
                    let text = resp.text().await.unwrap_or_default();
                    if !retryable || attempt >= 3 {
                        bail!("Claude API {status}: {text}");
                    }
                    tracing::warn!(%status, attempt, "Claude API retryable error");
                    wait
                }
                Err(e) if attempt < 3 && (e.is_timeout() || e.is_connect()) => {
                    tracing::warn!(error = %e, attempt, "Claude API connection error");
                    None
                }
                Err(e) => return Err(e.into()),
            };
            let backoff = retry_after.unwrap_or(1 << attempt).min(20);
            tokio::time::sleep(Duration::from_secs(backoff)).await;
        }
    }
}
