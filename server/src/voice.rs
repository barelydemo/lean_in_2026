//! ElevenLabs: character voices (TTS), the player's speech (STT), and
//! generated music / ambience / sound effects. Synthesised speech is cached
//! on disk by content hash, so each line is only ever paid for once.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, bail};
use bytes::Bytes;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::groq::Groq;

/// ElevenLabs runs separate data-residency stacks; a key minted on one is
/// rejected by the others. Keys carry the stack as a `_residency_<id>` suffix.
pub fn base_url(region: &str, api_key: &str) -> String {
    let region = match region {
        "" | "auto" => api_key.rsplit_once("_residency_").map(|(_, r)| r).unwrap_or("global"),
        r => r,
    };
    match region {
        "global" => "https://api.elevenlabs.io".to_string(),
        "us" => "https://api.us.elevenlabs.io".to_string(),
        r => format!("https://api.{r}.residency.elevenlabs.io"),
    }
}

#[derive(Clone)]
pub struct ElevenLabs {
    http: reqwest::Client,
    /// Plans cap parallel requests (2 on the starter tiers); queue the rest.
    slots: Arc<tokio::sync::Semaphore>,
    base: String,
    api_key: String,
    tts_model: String,
    stt_model: String,
    cache_dir: PathBuf,
}

#[derive(Deserialize)]
struct SttResponse {
    text: String,
}

/// A transcription of the player's recording.
pub struct Heard {
    pub text: String,
}

impl ElevenLabs {
    pub fn new(
        base: String,
        api_key: String,
        tts_model: String,
        stt_model: String,
        cache_dir: PathBuf,
        concurrency: usize,
    ) -> anyhow::Result<Self> {
        std::fs::create_dir_all(&cache_dir)
            .with_context(|| format!("creating TTS cache dir {}", cache_dir.display()))?;
        let http = reqwest::Client::builder()
            // Music generation can take a few minutes for long tracks.
            .timeout(Duration::from_secs(600))
            .connect_timeout(Duration::from_secs(10))
            .build()?;
        tracing::info!(%base, "ElevenLabs endpoint");
        let slots = Arc::new(tokio::sync::Semaphore::new(concurrency.max(1)));
        Ok(ElevenLabs { http, slots, base, api_key, tts_model, stt_model, cache_dir })
    }

    /// MP3 audio for `text` spoken by `voice_id`.
    pub async fn speak(&self, voice_id: &str, text: &str) -> anyhow::Result<Bytes> {
        let key = hex::encode(Sha256::digest(format!("{}\n{}\n{}", self.tts_model, voice_id, text).as_bytes()));
        let path = self.cache_dir.join(format!("{key}.mp3"));
        if let Ok(bytes) = tokio::fs::read(&path).await {
            return Ok(bytes.into());
        }

        let audio = self
            .post_audio(
                &format!("/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"),
                json!({
                    "text": text,
                    "model_id": self.tts_model,
                    "voice_settings": { "stability": 0.45, "similarity_boost": 0.8, "style": 0.35 },
                }),
            )
            .await?;
        write_atomic(&path, &audio).await;
        Ok(audio)
    }

    /// A sound effect or (with `looped`) a seamless ambience loop.
    pub async fn sound_effect(&self, prompt: &str, seconds: f32, looped: bool) -> anyhow::Result<Bytes> {
        self.post_audio(
            "/v1/sound-generation?output_format=mp3_44100_128",
            json!({
                "text": prompt,
                "duration_seconds": seconds,
                "loop": looped,
                "prompt_influence": 0.5,
            }),
        )
        .await
    }

    /// An instrumental music track.
    pub async fn compose_music(&self, prompt: &str, length_ms: u32) -> anyhow::Result<Bytes> {
        self.post_audio(
            "/v1/music?output_format=mp3_44100_128",
            json!({
                "prompt": prompt,
                "music_length_ms": length_ms,
                "force_instrumental": true,
            }),
        )
        .await
    }

    async fn post_audio(&self, path: &str, body: serde_json::Value) -> anyhow::Result<Bytes> {
        let _slot = self.slots.acquire().await?;
        let mut attempt = 0;
        loop {
            attempt += 1;
            let resp = self
                .http
                .post(format!("{}{path}", self.base))
                .header("xi-api-key", &self.api_key)
                .header("accept", "audio/mpeg")
                .json(&body)
                .send()
                .await?;
            let status = resp.status();
            if status.is_success() {
                return Ok(resp.bytes().await?);
            }
            let text = resp.text().await.unwrap_or_default();
            // 429 covers both rate and concurrency limits; back off and retry.
            if (status.as_u16() == 429 || status.is_server_error()) && attempt < 4 {
                tracing::warn!(%status, attempt, "ElevenLabs busy, retrying");
                tokio::time::sleep(Duration::from_millis(600 * attempt)).await;
                continue;
            }
            bail!("ElevenLabs {path} {status}: {text}");
        }
    }

    /// Transcribes the player's recording. No language hint: players mix
    /// Japanese and English, and Scribe detects both.
    pub async fn transcribe(&self, audio: Bytes, filename: String, mime: String, language: Option<&str>) -> anyhow::Result<Heard> {
        let _slot = self.slots.acquire().await?;
        let part = reqwest::multipart::Part::bytes(audio.to_vec()).file_name(filename).mime_str(&mime)?;
        let mut form = reqwest::multipart::Form::new()
            .text("model_id", self.stt_model.clone())
            .text("tag_audio_events", "false")
            .part("file", part);
        if let Some(lang) = language {
            form = form.text("language_code", lang.to_string());
        }
        let resp = self
            .http
            .post(format!("{}/v1/speech-to-text", self.base))
            .header("xi-api-key", &self.api_key)
            .multipart(form)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            bail!("ElevenLabs STT {status}: {}", resp.text().await.unwrap_or_default());
        }
        let r = resp.json::<SttResponse>().await?;
        Ok(Heard { text: r.text.trim().to_string() })
    }
}

/// Write-then-rename so a concurrent reader never sees a partial file.
pub async fn write_atomic(path: &std::path::Path, bytes: &[u8]) {
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    if tokio::fs::write(&tmp, bytes).await.is_ok() {
        let _ = tokio::fs::rename(&tmp, path).await;
    }
}

pub enum SttBackend {
    ElevenLabs(ElevenLabs),
    Groq(Groq),
}

impl SttBackend {
    fn name(&self) -> &'static str {
        match self {
            SttBackend::ElevenLabs(_) => "elevenlabs",
            SttBackend::Groq(_) => "groq",
        }
    }

    async fn transcribe(&self, audio: Bytes, filename: String, mime: String, language: Option<&str>, prompt_hint: Option<&str>) -> anyhow::Result<Heard> {
        match self {
            SttBackend::ElevenLabs(e) => e.transcribe(audio, filename, mime, language).await,
            SttBackend::Groq(g) => g.transcribe(audio, filename, mime, language, prompt_hint).await,
        }
    }

    /// The player speaks English or Japanese. Recognition is forced to the
    /// language being learned (`target`) first, biased by the candidate
    /// replies on screen (`reference`), so short phrases like "daijoubu desu"
    /// or "I'm okay" aren't misheard; if that doesn't come out in the target's
    /// script, it's re-run in the other language (the player asking in their
    /// own language, e.g. to the dictionary).
    async fn transcribe_en_ja(&self, audio: Bytes, filename: String, mime: String, reference: Option<&str>, target: &str) -> anyhow::Result<String> {
        let has_ref = reference.is_some_and(|r| !r.trim().is_empty());
        let (first, second) = if target == "en" { ("en", "ja") } else { ("ja", "en") };

        if let Ok(heard) = self.transcribe(audio.clone(), filename.clone(), mime.clone(), Some(first), reference).await {
            let t = heard.text.trim();
            let japanese = t.chars().any(is_japanese) || japanese_share(t) >= 0.2;
            let in_target = if first == "ja" { japanese || (has_ref && !t.is_empty()) } else { !t.is_empty() && !japanese };
            if in_target {
                return Ok(keep_en_ja(t));
            }
        }

        let other = self.transcribe(audio, filename, mime, Some(second), None).await?;
        Ok(keep_en_ja(&other.text))
    }
}

fn is_japanese(c: char) -> bool {
    matches!(c,
        '\u{3040}'..='\u{30FF}'   // hiragana, katakana
        | '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' // kanji
        | '\u{FF66}'..='\u{FF9F}' // half-width katakana
    )
}

/// Share of letters in `s` that are Japanese script.
fn japanese_share(s: &str) -> f32 {
    let letters: Vec<char> = s.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.is_empty() {
        return 0.0;
    }
    letters.iter().filter(|c| is_japanese(**c)).count() as f32 / letters.len() as f32
}

/// Drops letters from any script other than Latin and Japanese (Hangul,
/// Cyrillic, Thai…) as a last guard; punctuation, digits and spaces stay.
fn keep_en_ja(s: &str) -> String {
    let kept: String = s
        .chars()
        .filter(|c| !c.is_alphabetic() || c.is_ascii_alphabetic() || is_japanese(*c) || matches!(c, 'À'..='ž'))
        .collect();
    kept.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Where the player's speech is transcribed, with an optional second
/// provider if the first one fails (bad key, outage, rate limit).
pub struct Transcriber {
    pub primary: SttBackend,
    pub fallback: Option<SttBackend>,
}

impl Transcriber {
    pub async fn transcribe(&self, audio: Bytes, filename: String, mime: String, reference: Option<&str>, target: &str) -> anyhow::Result<String> {
        match self.primary.transcribe_en_ja(audio.clone(), filename.clone(), mime.clone(), reference, target).await {
            Ok(text) => Ok(text),
            Err(e) => match &self.fallback {
                Some(fb) => {
                    tracing::warn!(error = %e, primary = self.primary.name(), fallback = fb.name(), "stt falling back");
                    fb.transcribe_en_ja(audio, filename, mime, reference, target).await
                }
                None => Err(e),
            },
        }
    }
}

// ── Pronunciation Assessment Architecture ──────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PhonemeScore {
    pub phoneme: String,
    pub accuracy: f32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PronunciationAssessment {
    pub accuracy: f32,
    pub fluency: f32,
    pub completeness: f32,
    pub overall: f32,
    pub phonemes: Vec<PhonemeScore>,
    pub provider: String,
}

/// Modular trait for assessing spoken Japanese pronunciation against reference text.
pub trait PronunciationScorer: Send + Sync {
    fn score<'a>(
        &'a self,
        audio: &'a [u8],
        mime: &'a str,
        reference_text: &'a str,
        recognized_text: &'a str,
        lang: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<PronunciationAssessment>> + Send + 'a>>;
}

/// Azure Cognitive Services Speech Pronunciation Assessment implementation.
#[derive(Clone)]
pub struct AzurePronunciationScorer {
    http: reqwest::Client,
    subscription_key: String,
    region: String,
}

impl AzurePronunciationScorer {
    pub fn new(subscription_key: String, region: String) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(5))
            .build()?;
        Ok(Self { http, subscription_key, region })
    }
}

/// Base64 encoder (RFC 4648 standard alphabet) for Azure `Pronunciation-Assessment` header.
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

impl PronunciationScorer for AzurePronunciationScorer {
    fn score<'a>(
        &'a self,
        audio: &'a [u8],
        mime: &'a str,
        reference_text: &'a str,
        _recognized_text: &'a str,
        lang: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<PronunciationAssessment>> + Send + 'a>> {
        Box::pin(async move {
            let params = json!({
                "ReferenceText": reference_text,
                "GradingSystem": "HundredMark",
                "Granularity": "Phoneme",
                "Dimension": "Comprehensive",
                "EnableMiscue": "True"
            });
            let header_val = base64_encode(params.to_string().as_bytes());
            let url = format!(
                "https://{}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language={}&format=detailed",
                self.region,
                if lang == "en" { "en-US" } else { "ja-JP" }
            );

            let resp = self
                .http
                .post(&url)
                .header("Ocp-Apim-Subscription-Key", &self.subscription_key)
                .header("Pronunciation-Assessment", header_val)
                .header("Content-Type", mime)
                .header("Accept", "application/json")
                .body(audio.to_vec())
                .send()
                .await?;

            if !resp.status().is_success() {
                let status = resp.status();
                bail!("Azure Pronunciation Assessment {status}: {}", resp.text().await.unwrap_or_default());
            }

            let data: serde_json::Value = resp.json().await?;
            let nbest = data
                .get("NBest")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .context("Azure response missing NBest")?;

            let accuracy = nbest.get("AccuracyScore").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
            let fluency = nbest.get("FluencyScore").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
            let completeness = nbest.get("CompletenessScore").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
            let overall = nbest.get("PronScore").and_then(|v| v.as_f64()).unwrap_or(accuracy as f64) as f32;

            let mut phonemes = Vec::new();
            if let Some(words) = nbest.get("Words").and_then(|w| w.as_array()) {
                for w in words {
                    if let Some(ps) = w.get("Phonemes").and_then(|p| p.as_array()) {
                        for p in ps {
                            let ph = p.get("Phoneme").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let acc = p.get("AccuracyScore").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                            if !ph.is_empty() {
                                phonemes.push(PhonemeScore { phoneme: ph, accuracy: acc });
                            }
                        }
                    }
                }
            }

            Ok(PronunciationAssessment {
                accuracy,
                fluency,
                completeness,
                overall,
                phonemes,
                provider: "azure".into(),
            })
        })
    }
}

/// Fallback pronunciation scorer using Levenshtein edit distance and
/// in-order subsequence completeness against the target option (for Beginner
/// and Intermediate), or phonetic clarity for open-mic Advanced mode.
#[derive(Clone, Default)]
pub struct ProxyPronunciationScorer;

/// Fold katakana into hiragana so phonetic equivalents (`ワタシ` vs `わたし`)
/// are not penalised as mispronunciations when Whisper normalises script differently.
fn fold_kana(c: char) -> char {
    let code = c as u32;
    if (0x30A1..=0x30F6).contains(&code) {
        char::from_u32(code - 0x60).unwrap_or(c)
    } else {
        c.to_ascii_lowercase()
    }
}

fn clean_chars(s: &str) -> Vec<char> {
    s.chars()
        .filter(|c| {
            !c.is_whitespace()
                && !matches!(
                    c,
                    '、' | '。' | '！' | '？' | '…' | '・' | '「' | '」' | '『' | '』'
                        | '.' | ',' | '!' | '?' | '\'' | '"' | '-' | '〜' | '~'
                )
        })
        .map(fold_kana)
        .collect()
}

/// Classic dynamic-programming Levenshtein edit distance (substitutions, insertions, deletions).
fn levenshtein(a: &[char], b: &[char]) -> usize {
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut curr = vec![0; b.len() + 1];
    for (i, &ca) in a.iter().enumerate() {
        curr[0] = i + 1;
        for (j, &cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            curr[j + 1] = (prev[j + 1] + 1)
                .min(curr[j] + 1)
                .min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[b.len()]
}

/// Longest Common Subsequence length — measures how many characters of the
/// target sentence the learner spoke in the right order (catches dropped words/particles).
fn lcs_length(a: &[char], b: &[char]) -> usize {
    if a.is_empty() || b.is_empty() {
        return 0;
    }
    let mut dp = vec![0usize; b.len() + 1];
    for &ca in a {
        let mut prev_diag = 0;
        for (j, &cb) in b.iter().enumerate() {
            let temp = dp[j + 1];
            if ca == cb {
                dp[j + 1] = prev_diag + 1;
            } else {
                dp[j + 1] = dp[j + 1].max(dp[j]);
            }
            prev_diag = temp;
        }
    }
    dp[b.len()]
}

impl ProxyPronunciationScorer {
    fn score_single_ref(ref_chars: &[char], rec: &[char], jp_ratio: f32) -> PronunciationAssessment {
        let max_len = ref_chars.len().max(rec.len()).max(1) as f32;
        let dist = levenshtein(ref_chars, rec) as f32;
        let edit_similarity = ((1.0 - dist / max_len) * 100.0).clamp(0.0, 100.0);

        let lcs = lcs_length(ref_chars, rec) as f32;
        let completeness = ((lcs / ref_chars.len().max(1) as f32) * 100.0).clamp(0.0, 100.0);

        let len_ratio = (rec.len().min(ref_chars.len()) as f32
            / rec.len().max(ref_chars.len()).max(1) as f32)
            * 100.0;
        let fluency = (edit_similarity * 0.7 + len_ratio * 0.3).clamp(0.0, 100.0);

        // If the target phrase is Japanese but the player spoke mostly English, scale down accuracy.
        let ref_has_jp = ref_chars.iter().any(|c| is_japanese(*c));
        let lang_factor = if ref_has_jp && jp_ratio < 0.25 {
            0.35 + jp_ratio
        } else {
            1.0
        };

        let accuracy = (edit_similarity * lang_factor).clamp(0.0, 100.0);
        let completeness = (completeness * lang_factor).clamp(0.0, 100.0);
        let fluency = (fluency * lang_factor).clamp(0.0, 100.0);
        let overall = (accuracy * 0.55 + completeness * 0.30 + fluency * 0.15).round();

        PronunciationAssessment {
            accuracy: accuracy.round(),
            fluency: fluency.round(),
            completeness: completeness.round(),
            overall,
            phonemes: Vec::new(),
            provider: "levenshtein".into(),
        }
    }

    pub fn compute(reference_text: &str, recognized_text: &str) -> PronunciationAssessment {
        let rec = clean_chars(recognized_text);
        if rec.is_empty() {
            return PronunciationAssessment {
                accuracy: 0.0,
                fluency: 0.0,
                completeness: 0.0,
                overall: 0.0,
                phonemes: Vec::new(),
                provider: "levenshtein".into(),
            };
        }

        let jp_ratio = japanese_share(recognized_text);

        // Support multiple candidate options separated by "||" (picks the closest match).
        let candidates: Vec<Vec<char>> = reference_text
            .split("||")
            .map(clean_chars)
            .filter(|c| !c.is_empty())
            .collect();

        if candidates.is_empty() {
            // Advanced open-mic mode (no fixed target script): score based on Japanese phonetic clarity.
            let base = if jp_ratio >= 0.5 {
                85.0 + (jp_ratio * 15.0).min(15.0)
            } else {
                (jp_ratio * 100.0).max(25.0)
            };
            return PronunciationAssessment {
                accuracy: base.round(),
                fluency: base.round(),
                completeness: 100.0,
                overall: base.round(),
                phonemes: Vec::new(),
                provider: "levenshtein".into(),
            };
        }

        candidates
            .iter()
            .map(|cand| Self::score_single_ref(cand, &rec, jp_ratio))
            .max_by(|a, b| a.overall.partial_cmp(&b.overall).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap()
    }
}

impl PronunciationScorer for ProxyPronunciationScorer {
    fn score<'a>(
        &'a self,
        _audio: &'a [u8],
        _mime: &'a str,
        reference_text: &'a str,
        recognized_text: &'a str,
        _lang: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<PronunciationAssessment>> + Send + 'a>> {
        let res = Self::compute(reference_text, recognized_text);
        Box::pin(async move { Ok(res) })
    }
}

/// Service wrapper that tries Azure Pronunciation Assessment when configured
/// and automatically falls back to the STT / Coach proxy.
#[derive(Clone)]
pub struct PronunciationService {
    azure: Option<AzurePronunciationScorer>,
    fallback: ProxyPronunciationScorer,
}

impl PronunciationService {
    pub fn from_config(cfg: &crate::config::Config) -> Self {
        let azure = cfg.azure_speech_key.as_ref().and_then(|key| {
            match AzurePronunciationScorer::new(key.clone(), cfg.azure_speech_region.clone()) {
                Ok(s) => {
                    tracing::info!(region = %cfg.azure_speech_region, "Azure pronunciation assessment enabled");
                    Some(s)
                }
                Err(e) => {
                    tracing::warn!(error = %e, "failed to init Azure pronunciation scorer; using proxy fallback");
                    None
                }
            }
        });
        Self { azure, fallback: ProxyPronunciationScorer }
    }

    /// `lang` is the language being learned ("ja", "en").
    pub async fn assess(&self, audio: &[u8], mime: &str, reference_text: &str, recognized_text: &str, lang: &str) -> PronunciationAssessment {
        if let Some(azure) = &self.azure {
            match azure.score(audio, mime, reference_text, recognized_text, lang).await {
                Ok(score) => return score,
                Err(e) => tracing::warn!(error = %e, "Azure pronunciation assessment failed, falling back to proxy"),
            }
        }
        self.fallback.score(audio, mime, reference_text, recognized_text, lang).await.unwrap_or_else(|_| {
            ProxyPronunciationScorer::compute(reference_text, recognized_text)
        })
    }
}


#[cfg(test)]
mod tests {
    use super::base_url;

    #[test]
    fn only_english_and_japanese_survive() {
        use super::{japanese_share, keep_en_ja};
        assert!(japanese_share("すみません、カバンがありません") > 0.9);
        assert!(japanese_share("sorry, my bag") < 0.1);
        assert_eq!(keep_en_ja("かばん 가방 bag сумка"), "かばん bag");
        assert_eq!(keep_en_ja("Hello, 大丈夫です!"), "Hello, 大丈夫です!");
    }

    #[test]
    fn residency_is_read_from_the_key() {
        assert_eq!(base_url("auto", "sk_abc_residency_in"), "https://api.in.residency.elevenlabs.io");
        assert_eq!(base_url("auto", "sk_plainkey"), "https://api.elevenlabs.io");
        assert_eq!(base_url("eu", "sk_plainkey"), "https://api.eu.residency.elevenlabs.io");
    }

    #[test]
    fn proxy_pronunciation_scorer_evaluates_levenshtein_and_free_speech() {
        use super::ProxyPronunciationScorer;
        let exact = ProxyPronunciationScorer::compute("私の名前はサルタクです。", "私の名前はさるたくです");
        assert_eq!(exact.overall, 100.0);
        assert_eq!(exact.provider, "levenshtein");

        // Dropped particle `は` ("my name sarthak")
        let dropped = ProxyPronunciationScorer::compute("私の名前はサルタクです", "私の名前サルタクです");
        assert!(dropped.overall >= 88.0 && dropped.overall < 100.0);

        // Mispronounced `私` -> `ばし` ("bye name is sarthak")
        let mispron = ProxyPronunciationScorer::compute("私の名前はサルタクです", "ばしの名前はサルタクです");
        assert!(mispron.overall >= 80.0 && mispron.overall < 100.0);

        // Both dropped particle + mispronounced word
        let both = ProxyPronunciationScorer::compute("私の名前はサルタクです", "ばしの名前サルタクです");
        assert!(both.overall < dropped.overall && both.overall < mispron.overall);
        assert!(both.overall >= 70.0);

        // Multiple options separated by "||" picks the closest option
        let multi = ProxyPronunciationScorer::compute(
            "おはようございます||私の名前はサルタクです||ありがとうございます",
            "私の名前サルタクです",
        );
        assert_eq!(multi.overall, dropped.overall);

        let free = ProxyPronunciationScorer::compute("", "ありがとうございます");
        assert!(free.overall >= 85.0);

        let empty = ProxyPronunciationScorer::compute("こんにちは", "");
        assert_eq!(empty.overall, 0.0);
    }
}
