# Lexical — *Lost in Japan* (迷子の日本)

A voice-driven visual novel that teaches beginner Japanese. You land at Narita, slip, hit your head, and wake up with your passport, wallet and phone stolen. You talk your way out — out loud, in Japanese — and every line you say moves the story.

- **Talk to play.** Hold the mic (or Space) and speak. ElevenLabs transcribes you; characters answer in voice. Three suggested replies are always available as a fallback.
- **An open world.** Places connected by exits, not a fixed script: when Kenji points you to the police box, you can go to the police box. Several routes; a big arc from getting out of Narita to finding work, love, and who you are.
- **A curriculum hiding in a story.** Your own Genki I track (lessons 0–12). A lesson only completes when you've used enough of its grammar yourself, and some places stay locked until you're ready — the server enforces this, not the model.
- **What you say changes the scene.** The director directs the stage with a fixed vocabulary of animation presets (scene cuts, transitions, camera, character actions, manga emotes, weather, sound cues). The client animates and sounds them; the server rejects anything outside the vocabulary.
- **Sound everywhere, nothing to license.** Music, ambience and effects are synthesised in the browser (generative per-scene score, ambience beds, UI and story sounds). With ElevenLabs, a one-time `generate-audio` renders real instrumental tracks, ambience loops and effects from prompts in the story file, and the client prefers those.
- **Pick your providers.** Claude or Groq as the story director (with optional fallback), ElevenLabs or Groq Whisper for speech-to-text, ElevenLabs for character voices.

## Architecture

```
web/  (Next.js 16 · React 19 · Motion · Tailwind 4)      server/  (Rust · Axum · SQLite · Tokio)
┌──────────────────────────────┐   JSON over HTTPS    ┌─────────────────────────────────────────┐
│ Stage: backdrop, sprites,     │ ───────────────────▶ │ api.rs     routes, guest auth, limits    │
│   camera, transitions, ambient│                      │ game.rs    rules: validate + clamp what  │
│ Dialogue (typewriter + voice) │ ◀─────────────────── │            Claude proposes; exits, gates │
│ Reply dock (push-to-talk)     │   beats + state      │ claude.rs  director prompt, JSON schema  │
│ HUD · Notebook · Coach        │                      │ voice.rs   ElevenLabs TTS (disk cache)   │
└──────────────────────────────┘                      │            + STT                          │
                                                      │ content/story.toml  cast, scenes, Genki  │
                                                      │            places, Genki lessons, quests │
                                                      └─────────────────────────────────────────┘
```

**One LLM call per turn.** The director (Claude Haiku 5.5 by default, or Groq) acts as director and every character in a single request with structured output (`output_config.format` JSON schema): the reaction beats with stage cues, three next replies, coaching on the player's Japanese, which grammar points they used, proposed state changes, whether the place goal is met, and `go_to` (an open exit, or "stay"). With Claude, the world prompt and the current lesson brief are prompt-cached; with Groq's `gpt-oss` models the same schema is enforced with strict `json_schema` output. The transcript and player line go in the user turn. `director.rs` owns the prompt, schema and provider selection; `claude.rs` and `groq.rs` are thin transports.

**Claude proposes, the server disposes** (`server/src/game.rs`): speakers limited to the people at the current place, movement only through open exits, story flags only from the place's event list, money clamped to the place's budget, items to an allow-list, trust to ±2 per turn, and grammar credit only for real ids. A lesson completes only after `min_turns`, `min_grammar` distinct target points, and at least one spoken/typed (not picked) line.

## Running locally

Requirements: Rust (stable), Node 24.

```bash
# server — offline mode needs no API keys
cd server
CLAUDE_MOCK=1 cargo run            # http://localhost:8080

# web
cd web
npm install
npm run dev                        # http://localhost:3000
```

For the real thing, copy `.env.example` to `server/.env` (or export the variables) and set `ANTHROPIC_API_KEY` (or `LLM_PROVIDER=groq` + `GROQ_API_KEY`) and, for voice, `ELEVENLABS_API_KEY`.

To render the generated soundtrack once (ElevenLabs credits, ~26 assets):

```bash
cd server && cargo run -- generate-audio      # add --force to re-render
# or: docker compose run --rm generate-audio
```

With Docker: `cp .env.example .env && docker compose up --build`.

### Configuration

| Variable | Default | |
|---|---|---|
| `LLM_PROVIDER` / `LLM_FALLBACK` | `claude` / — | `claude`, `groq` or `mock` (`CLAUDE_MOCK=1` still works) |
| `ANTHROPIC_API_KEY` | — | For `claude` |
| `CLAUDE_MODEL` / `CLAUDE_EFFORT` | `claude-haiku-5-5` / `low` | Haiku for fast turns; `claude-opus-5-5` for richer characters |
| `CLAUDE_THINKING` | `off` on Haiku, else `adaptive` | Measured on Haiku: ~5 s/turn off vs ~13 s adaptive |
| `GROQ_API_KEY` | — | For `groq` director or Groq STT |
| `GROQ_MODEL` / `GROQ_REASONING_EFFORT` | `openai/gpt-oss-120b` / `low` | |
| `STT_PROVIDER` / `GROQ_STT_MODEL` | auto / `whisper-large-v3-turbo` | `elevenlabs`, `groq` or `none` |
| `ELEVENLABS_API_KEY` | — | Character voices and generated audio disabled when unset |
| `AUDIO_AUTOGENERATE` | `0` | Render missing audio in the background at startup |
| `ELEVENLABS_TTS_MODEL` / `ELEVENLABS_STT_MODEL` | `eleven_multilingual_v2` / `scribe_v1` | |
| `ELEVENLABS_VOICE_<CAST_ID>` | story defaults | e.g. `ELEVENLABS_VOICE_KENJI` |
| `DATA_DIR` / `DATABASE_URL` | `data` / `sqlite://data/lexical.db` | TTS cache lives in `DATA_DIR/tts` |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated |
| `MAX_TURNS_PER_DAY` | `400` | Per-player Claude call quota |
| `NEXT_PUBLIC_API_URL` (web, build time) | `http://localhost:8080` | |

## Writing content

Everything narrative lives in [`server/content/story.toml`](server/content/story.toml) and is validated at startup (unknown speakers, scenes, items or duplicate grammar ids fail fast):

- `[[cast]]` — profile, sprite, colour, English level, default ElevenLabs voice.
- `[audio]` — prompts for generated music moods, ambience loops and sound effects. Each scene names a `music` mood and an `ambience` loop.
- `[[scenes]]` — backgrounds. Art lives in `web/public/scenes/<id>.jpg` (16:9); a vector painting in `Backdrop.tsx` is the fallback when a file is missing.
- `[[lessons]]` — the curriculum: Genki I lessons 0–12 in order, each with target grammar. This is the player's own progress track; wherever they are, the director steers talk toward the current lesson.
- `[[places]]` — the open world. Each place has a scene, people, a situation (director-only), the player's goal as their own thought, story events the director may trigger, and exits. Exits can wait on story flags (`requires_flags`) or curriculum progress (`min_lesson`). The player moves by saying where they'll go (the director sets `go_to` to an open exit) or by picking an exit on the map (M).
- `[[quests]]` — the big arc (get to Tokyo, a bed, a job, rent, love, memory, home), each completed by any of its flags. `[[triggers]]` let the world act on its own; `[[endings]]` close the story.

The stage-cue vocabulary is defined once in `server/src/story.rs` (`string_enum!`) and mirrored in `web/lib/types.ts`. Adding a cue means adding it in both places and animating it in `web/components/stage/`.

Per-expression sprite art can be added as `web/public/characters/<id>/<expression>.png` and registered in `EXPRESSION_ART` (`Sprite.tsx`); until then one sprite per character is graded per expression and emotes carry the emotion.

## API

All routes are under `/api/v1`; everything except `story` and `players` needs `Authorization: Bearer <token>`.

| | |
|---|---|
| `GET /story` | Public story data + `voice_enabled` |
| `POST /players` | Create a guest player → `{ token }` |
| `POST /runs` `{ player_name }` | New game |
| `GET /runs/current` | Latest save or `null` |
| `POST /runs/{id}/turn` `{ text, via: voice\|text\|choice }` | Play a turn → beats, coach, goal/lesson completion, `moved_to` + arrival, state |
| `POST /runs/{id}/travel` `{ to }` | Walk through an open exit from the map |
| `POST /runs/{id}/scan` `{ line_id }` · `POST /runs/{id}/hint` | Dictionary look-up · unlock suggested replies (battery) |
| `POST /tts` `{ line_id }` | MP3 for a line the player owns (cached) |
| `POST /stt` multipart `audio` | `{ text }` |
| `GET /audio` | Manifest of rendered music / ambience / sfx |
| `GET /audio/{kind}/{id}.mp3` | A rendered asset (only catalogued ids) |

## Production notes

- Single instance by design for now: SQLite (WAL) on a volume and in-memory rate limiting. To scale out, move to Postgres and a shared limiter (Redis); the queries in `db.rs` are plain SQL.
- Guest tokens are stored hashed (SHA-256). Real accounts (email / OAuth) are the next step before payments.
- Claude requests on Opus/Sonnet use server-side refusal fallbacks (`fallbacks: "default"`; Haiku has none — set `LLM_FALLBACK=groq` to cover refusals there), retries with backoff on 429/5xx, and log token usage including cache reads.
- TTS is cached on disk by `(model, voice, text)` hash, so each line is synthesised once. Music/ambience/sfx are rendered ahead of time — players never trigger generation, so audio cost is fixed.
- Licensing: the synthesised audio is original code output. ElevenLabs-generated music and effects are covered by ElevenLabs' terms for your plan — check that your plan allows commercial use before shipping them.

## Roadmap

- Season 2: Genki lessons 8–12 (short forms, 〜と思います, 〜たい, 〜たり…).
- Streaming turns (beats appear while Claude is still writing).
- Painted backgrounds and expression sheets for the cast.
- Accounts, cloud saves, spaced-repetition review of the phrasebook.

Original story and characters. Grammar ordering follows the Genki I sequence; this project is not affiliated with its publisher.
