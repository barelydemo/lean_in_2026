use std::env;
use std::path::PathBuf;

use anyhow::{Context, bail};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LlmProvider {
    Claude,
    Groq,
    DeepSeek,
    /// Scripted director turns (UI dev and CI, no API calls).
    Mock,
}

impl LlmProvider {
    fn parse(s: &str) -> anyhow::Result<Self> {
        Ok(match s {
            "claude" | "anthropic" => LlmProvider::Claude,
            "groq" => LlmProvider::Groq,
            "deepseek" => LlmProvider::DeepSeek,
            "mock" => LlmProvider::Mock,
            other => bail!("unknown LLM provider {other:?} (expected claude, groq, deepseek or mock)"),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SttProvider {
    Bolna,
    ElevenLabs,
    Groq,
    None,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: String,
    pub database_url: String,
    pub data_dir: PathBuf,
    /// One folder per course, each with a story.toml.
    pub courses_dir: PathBuf,
    pub cors_origins: Vec<String>,
    /// Behind a reverse proxy that sets X-Forwarded-For. Off by default:
    /// otherwise any client could spoof its IP to dodge rate limits.
    pub trust_proxy: bool,
    pub max_turns_per_day: i64,
    pub json_logs: bool,

    pub llm_provider: LlmProvider,
    pub llm_fallback: Option<LlmProvider>,

    pub anthropic_api_key: String,
    pub anthropic_base_url: String,
    pub claude_model: String,
    pub claude_effort: String,
    /// `adaptive` or `off`. Defaults to `off` on Haiku (turns ~5s instead
    /// of ~13s) and `adaptive` elsewhere; `off` needs effort low/medium/high.
    pub claude_thinking: String,

    pub groq_api_key: Option<String>,
    pub groq_model: String,
    pub groq_reasoning_effort: String,
    pub groq_stt_model: String,

    pub deepseek_api_key: Option<String>,
    pub deepseek_model: String,
    pub deepseek_base_url: String,

    pub bolna_api_key: Option<String>,
    pub bolna_agent_id: Option<String>,
    pub bolna_base_url: String,
    pub bolna_stt_model: String,

    /// Voice output, generated music/ambience/sfx, and (optionally) STT.
    pub elevenlabs_api_key: Option<String>,
    pub elevenlabs_tts_model: String,
    pub elevenlabs_stt_model: String,
    /// `auto` (from the key's `_residency_<id>` suffix), `global`, `us`, `in`, `eu`…
    pub elevenlabs_region: String,
    /// Max parallel ElevenLabs requests (your plan's concurrency limit).
    pub elevenlabs_concurrency: usize,
    pub stt_provider: SttProvider,
    /// Render missing audio assets in the background at startup.
    pub audio_autogenerate: bool,

    /// Optional Azure Speech credentials for phoneme-level pronunciation assessment.
    pub azure_speech_key: Option<String>,
    pub azure_speech_region: String,
}

fn var_or(key: &str, default: &str) -> String {
    env::var(key).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| default.to_string())
}

fn var_opt(key: &str) -> Option<String> {
    env::var(key).ok().filter(|v| !v.is_empty())
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let data_dir = PathBuf::from(var_or("DATA_DIR", "data"));
        let default_db = format!("sqlite://{}/lexical.db", data_dir.display());

        let groq_api_key = var_opt("GROQ_API_KEY");
        let deepseek_api_key = var_opt("DEEPSEEK_API_KEY");
        let bolna_api_key = var_opt("BOLNA_API_KEY");
        let elevenlabs_api_key = var_opt("ELEVENLABS_API_KEY");

        // CLAUDE_MOCK=1 predates LLM_PROVIDER and is still honoured.
        let llm_provider = match var_opt("LLM_PROVIDER") {
            Some(p) => LlmProvider::parse(&p)?,
            None if var_or("CLAUDE_MOCK", "0") == "1" => LlmProvider::Mock,
            None => LlmProvider::Claude,
        };
        let llm_fallback = var_opt("LLM_FALLBACK").map(|p| LlmProvider::parse(&p)).transpose()?;

        let stt_provider = match var_opt("STT_PROVIDER").as_deref() {
            Some("bolna") => SttProvider::Bolna,
            Some("elevenlabs") => SttProvider::ElevenLabs,
            Some("groq") => SttProvider::Groq,
            Some("none") => SttProvider::None,
            Some(other) => bail!("unknown STT_PROVIDER {other:?} (expected bolna, elevenlabs, groq or none)"),
            None if bolna_api_key.is_some() => SttProvider::Bolna,
            None if groq_api_key.is_some() => SttProvider::Groq,
            None if elevenlabs_api_key.is_some() => SttProvider::ElevenLabs,
            None => SttProvider::None,
        };
        if stt_provider == SttProvider::Bolna && bolna_api_key.is_none() && groq_api_key.is_none() && elevenlabs_api_key.is_none() {
            bail!("STT_PROVIDER=bolna needs BOLNA_API_KEY (or GROQ_API_KEY/ELEVENLABS_API_KEY as fallback)");
        }
        if stt_provider == SttProvider::ElevenLabs && elevenlabs_api_key.is_none() {
            bail!("STT_PROVIDER=elevenlabs needs ELEVENLABS_API_KEY");
        }
        if stt_provider == SttProvider::Groq && groq_api_key.is_none() {
            bail!("STT_PROVIDER=groq needs GROQ_API_KEY");
        }

        Ok(Config {
            bind: var_or("BIND", "0.0.0.0:8080"),
            database_url: var_or("DATABASE_URL", &default_db),
            courses_dir: PathBuf::from(var_or("COURSES_DIR", "content/courses")),
            trust_proxy: var_or("TRUST_PROXY", "false") == "true",
            cors_origins: var_or("CORS_ORIGINS", "http://localhost:3000")
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            max_turns_per_day: var_or("MAX_TURNS_PER_DAY", "400")
                .parse()
                .context("MAX_TURNS_PER_DAY must be an integer")?,
            json_logs: var_or("LOG_FORMAT", "pretty") == "json",
            data_dir,

            llm_provider,
            llm_fallback,

            anthropic_api_key: var_or("ANTHROPIC_API_KEY", ""),
            anthropic_base_url: var_or("ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
            // Haiku for fast turns; any Claude model with structured outputs works.
            claude_model: var_or("CLAUDE_MODEL", "claude-haiku-5-5"),
            claude_effort: var_or("CLAUDE_EFFORT", "low"),
            claude_thinking: var_or(
                "CLAUDE_THINKING",
                if var_or("CLAUDE_MODEL", "claude-haiku-5-5").contains("haiku") { "off" } else { "adaptive" },
            ),

            groq_api_key,
            groq_model: var_or("GROQ_MODEL", "openai/gpt-oss-120b"),
            groq_reasoning_effort: var_or("GROQ_REASONING_EFFORT", "low"),
            groq_stt_model: var_or("GROQ_STT_MODEL", "whisper-large-v3-turbo"),

            deepseek_api_key,
            deepseek_model: var_or("DEEPSEEK_MODEL", "deepseek-flash"),
            deepseek_base_url: var_or("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),

            bolna_api_key,
            bolna_agent_id: var_opt("BOLNA_AGENT_ID"),
            bolna_base_url: var_or("BOLNA_BASE_URL", "https://api.bolna.ai"),
            bolna_stt_model: var_or("BOLNA_STT_MODEL", "deepgram-nova-3"),

            elevenlabs_api_key,
            elevenlabs_tts_model: var_or("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2"),
            elevenlabs_stt_model: var_or("ELEVENLABS_STT_MODEL", "scribe_v2"),
            elevenlabs_region: var_or("ELEVENLABS_REGION", "auto"),
            elevenlabs_concurrency: var_or("ELEVENLABS_CONCURRENCY", "2")
                .parse()
                .context("ELEVENLABS_CONCURRENCY must be a number")?,
            stt_provider,
            audio_autogenerate: var_or("AUDIO_AUTOGENERATE", "0") == "1",

            azure_speech_key: var_opt("AZURE_SPEECH_KEY"),
            azure_speech_region: var_or("AZURE_SPEECH_REGION", "japaneast"),
        })
    }

    /// `ELEVENLABS_VOICE_KENJI=...` overrides the story file's default voice.
    pub fn voice_override(&self, cast_id: &str) -> Option<String> {
        var_opt(&format!("ELEVENLABS_VOICE_{}", cast_id.to_uppercase()))
    }
}
