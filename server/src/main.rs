mod api;
mod audio;
mod bolna;
mod claude;
mod config;
mod db;
mod deepseek;
mod director;
mod error;
mod game;
mod groq;
mod story;
mod voice;

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Context;
use tracing_subscriber::EnvFilter;

use crate::config::SttProvider;

const USAGE: &str = "usage: lexical-server [serve | generate-audio [--force]]";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    let cfg = config::Config::from_env()?;

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=info,sqlx=warn"));
    if cfg.json_logs {
        tracing_subscriber::fmt().json().with_env_filter(filter).init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }

    // Every folder in COURSES_DIR with a story.toml is a course; "ja" is the
    // default when present.
    let mut stories = std::collections::BTreeMap::new();
    for entry in std::fs::read_dir(&cfg.courses_dir).with_context(|| format!("reading {}", cfg.courses_dir.display()))? {
        let path = entry?.path().join("story.toml");
        if path.exists() {
            let story = story::Story::load(&path).with_context(|| format!("loading {}", path.display()))?;
            tracing::info!(course = %story.course.id, places = story.places.len(), lessons = story.lessons.len(), "course loaded");
            stories.insert(story.course.id.clone(), story);
        }
    }
    anyhow::ensure!(!stories.is_empty(), "no courses found in {}", cfg.courses_dir.display());
    let default_course = if stories.contains_key("ja") { "ja".to_string() } else { stories.keys().next().unwrap().clone() };
    std::fs::create_dir_all(&cfg.data_dir).context("creating data dir")?;
    let audio = audio::AudioStore::new(&cfg.data_dir, stories[&default_course].audio.clone())?;

    let elevenlabs = cfg
        .elevenlabs_api_key
        .clone()
        .map(|key| {
            voice::ElevenLabs::new(
                voice::base_url(&cfg.elevenlabs_region, &key),
                key,
                cfg.elevenlabs_tts_model.clone(),
                cfg.elevenlabs_stt_model.clone(),
                cfg.data_dir.join("tts"),
                cfg.elevenlabs_concurrency,
            )
        })
        .transpose()?;

    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        None | Some("serve") => {}
        Some("generate-audio") => {
            let el = elevenlabs.context("generate-audio needs ELEVENLABS_API_KEY")?;
            let force = args.iter().any(|a| a == "--force");
            let (made, failed) = audio.generate_missing(&el, force).await;
            tracing::info!(made, failed, "audio generation finished");
            return if failed == 0 { Ok(()) } else { anyhow::bail!("{failed} assets failed") };
        }
        Some(_) => anyhow::bail!(USAGE),
    }

    let db = db::connect(&cfg.database_url).await?;
    let mut courses = std::collections::BTreeMap::new();
    for (id, story) in stories {
        let director = director::Director::new(&cfg, &story)?;
        courses.insert(id, api::CourseRt { story, director });
    }
    // The other configured provider backs up the chosen one.
    let bolna_stt = cfg.bolna_api_key.is_some().then(|| bolna::Bolna::new(&cfg)).transpose()?;
    let groq_stt = cfg.groq_api_key.is_some().then(|| groq::Groq::new(&cfg)).transpose()?;
    let el_stt = elevenlabs.clone();
    let stt = match cfg.stt_provider {
        SttProvider::Bolna => {
            if let Some(b) = bolna_stt {
                Some(voice::Transcriber {
                    primary: voice::SttBackend::Bolna(b),
                    fallback: groq_stt.map(voice::SttBackend::Groq).or_else(|| el_stt.map(voice::SttBackend::ElevenLabs)),
                })
            } else if let Some(g) = groq_stt {
                tracing::warn!("BOLNA_API_KEY not set — using Groq STT fallback");
                Some(voice::Transcriber {
                    primary: voice::SttBackend::Groq(g),
                    fallback: el_stt.map(voice::SttBackend::ElevenLabs),
                })
            } else if let Some(e) = el_stt {
                tracing::warn!("BOLNA_API_KEY not set — using ElevenLabs STT fallback");
                Some(voice::Transcriber {
                    primary: voice::SttBackend::ElevenLabs(e),
                    fallback: None,
                })
            } else {
                None
            }
        }
        SttProvider::ElevenLabs => el_stt.map(|e| voice::Transcriber {
            primary: voice::SttBackend::ElevenLabs(e),
            fallback: groq_stt.map(voice::SttBackend::Groq),
        }),
        SttProvider::Groq => groq_stt.map(|g| voice::Transcriber {
            primary: voice::SttBackend::Groq(g),
            fallback: el_stt.map(voice::SttBackend::ElevenLabs),
        }),
        SttProvider::None => None,
    };
    if elevenlabs.is_none() {
        tracing::warn!("ELEVENLABS_API_KEY not set — character voices and generated audio are disabled");
    }
    if stt.is_none() {
        tracing::warn!("no speech-to-text provider — players can type or pick replies, but not talk");
    }

    let bind = cfg.bind.clone();
    let autogen = cfg.audio_autogenerate;
    let state = Arc::new(api::AppState::new(cfg, courses, default_course, db, elevenlabs, stt, audio));

    if autogen && let Some(el) = state.tts.clone() {
        let state = state.clone();
        tokio::spawn(async move {
            let (made, failed) = state.audio.generate_missing(&el, false).await;
            tracing::info!(made, failed, "background audio generation finished");
        });
    }

    let app = api::router(state);
    let listener = tokio::net::TcpListener::bind(&bind).await.with_context(|| format!("binding {bind}"))?;
    tracing::info!(%bind, "lexical server listening");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    tracing::info!("shutting down");
}
