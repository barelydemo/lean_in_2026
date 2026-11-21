//! Generated audio assets (music, ambience loops, sound effects).
//!
//! Assets are rendered once from the prompts in each course's story.toml
//! with `lexical-server generate-audio` and served from DATA_DIR/audio/<course>. Players
//! never trigger generation, so cost is fixed and bounded. Anything not yet
//! rendered is simply absent from the manifest and the client plays its
//! synthesised fallback.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::story::{AudioAsset, AudioCatalog};
use crate::voice::{ElevenLabs, write_atomic};

const MUSIC_LENGTH_MS: u32 = 120_000;
const AMBIENCE_SECONDS: f32 = 22.0;
const SFX_SECONDS: f32 = 2.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Music,
    Ambience,
    Sfx,
}

impl Kind {
    pub const ALL: [Kind; 3] = [Kind::Music, Kind::Ambience, Kind::Sfx];

    pub fn parse(s: &str) -> Option<Kind> {
        match s {
            "music" => Some(Kind::Music),
            "ambience" => Some(Kind::Ambience),
            "sfx" => Some(Kind::Sfx),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Kind::Music => "music",
            Kind::Ambience => "ambience",
            Kind::Sfx => "sfx",
        }
    }
}

pub struct AudioStore {
    dir: PathBuf,
    catalog: AudioCatalog,
}

impl AudioStore {
    pub fn new(dir: &Path, catalog: AudioCatalog) -> anyhow::Result<Self> {
        let dir = dir.to_path_buf();
        for k in Kind::ALL {
            std::fs::create_dir_all(dir.join(k.as_str()))?;
        }
        Ok(AudioStore { dir, catalog })
    }

    fn assets(&self, kind: Kind) -> &[AudioAsset] {
        match kind {
            Kind::Music => &self.catalog.music,
            Kind::Ambience => &self.catalog.ambience,
            Kind::Sfx => &self.catalog.sfx,
        }
    }

    /// Path for a catalogued asset; `None` for unknown ids, so request paths
    /// can never escape the audio directory.
    pub fn path(&self, kind: Kind, id: &str) -> Option<PathBuf> {
        self.assets(kind)
            .iter()
            .any(|a| a.id == id)
            .then(|| self.dir.join(kind.as_str()).join(format!("{id}.mp3")))
    }

    /// `{ music: { id: url }, ambience: {...}, sfx: {...} }` for rendered assets.
    pub fn manifest(&self, url_prefix: &str) -> Value {
        let mut out = json!({});
        for k in Kind::ALL {
            let mut m = serde_json::Map::new();
            for a in self.assets(k) {
                if self.path(k, &a.id).is_some_and(|p| p.exists()) {
                    m.insert(a.id.clone(), json!(format!("{url_prefix}/{}/{}.mp3", k.as_str(), a.id)));
                }
            }
            out[k.as_str()] = Value::Object(m);
        }
        out
    }

    /// Renders every missing asset (or all of them with `force`).
    /// Failures are logged and skipped so one bad prompt doesn't block the rest.
    pub async fn generate_missing(&self, el: &ElevenLabs, force: bool) -> (usize, usize) {
        let (mut made, mut failed) = (0, 0);
        for kind in Kind::ALL {
            for asset in self.assets(kind) {
                let Some(path) = self.path(kind, &asset.id) else { continue };
                if path.exists() && !force {
                    continue;
                }
                tracing::info!(kind = kind.as_str(), id = %asset.id, "generating audio");
                let result = match kind {
                    Kind::Music => el.compose_music(&asset.prompt, MUSIC_LENGTH_MS).await,
                    Kind::Ambience => el.sound_effect(&asset.prompt, AMBIENCE_SECONDS, true).await,
                    Kind::Sfx => el.sound_effect(&asset.prompt, SFX_SECONDS, false).await,
                };
                match result {
                    Ok(bytes) => {
                        write_atomic(&path, &bytes).await;
                        made += 1;
                    }
                    Err(e) => {
                        tracing::error!(kind = kind.as_str(), id = %asset.id, error = %e, "audio generation failed");
                        failed += 1;
                    }
                }
            }
        }
        (made, failed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::story::Story;

    #[test]
    fn only_catalogued_ids_resolve_and_manifest_lists_rendered_files() {
        let story = Story::load(Path::new("content/courses/ja/story.toml")).unwrap();
        let dir = std::env::temp_dir().join(format!("lexical-audio-{}", uuid::Uuid::new_v4()));
        let store = AudioStore::new(&dir, story.audio.clone()).unwrap();

        assert!(store.path(Kind::Music, "../../etc/passwd").is_none());
        assert!(store.path(Kind::Sfx, "not_a_sound").is_none());
        let p = store.path(Kind::Music, "title").unwrap();
        assert!(p.starts_with(&dir));

        assert!(store.manifest("/a")["music"].as_object().unwrap().is_empty());
        std::fs::write(&p, b"mp3").unwrap();
        assert_eq!(store.manifest("/a")["music"]["title"], "/a/music/title.mp3");
        let _ = std::fs::remove_dir_all(dir);
    }
}
