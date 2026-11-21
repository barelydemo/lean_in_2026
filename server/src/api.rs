use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, DefaultBodyLimit, FromRequestParts, Multipart, Path, Query, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, Method, header};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::audio::{AudioStore, Kind};
use crate::config::Config;
use crate::db;
use crate::director::{self, Director};
use crate::error::{AppError, AppResult};
use crate::game::{self, InputVia, RunState, RunStatus};
use crate::story::{Beat, Phrase, Story};
use crate::voice::{ElevenLabs, PronunciationService, Transcriber};

/// One course (a target language for a learner language): its story and
/// the director that runs it, and its rendered music and sounds.
pub struct CourseRt {
    pub story: Story,
    pub director: Director,
    pub audio: AudioStore,
}

pub struct AppState {
    pub cfg: Config,
    /// Keyed by course id ("ja", "en"); the first listed is the default.
    pub courses: std::collections::BTreeMap<String, CourseRt>,
    pub default_course: String,
    pub db: SqlitePool,
    pub tts: Option<ElevenLabs>,
    pub stt: Option<Transcriber>,
    pub pronunciation: PronunciationService,
    run_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    pub(crate) limiter: Limiter,
}

impl AppState {
    pub fn new(
        cfg: Config,
        courses: std::collections::BTreeMap<String, CourseRt>,
        default_course: String,
        db: SqlitePool,
        tts: Option<ElevenLabs>,
        stt: Option<Transcriber>,
    ) -> Self {
        let pronunciation = PronunciationService::from_config(&cfg);
        AppState { cfg, courses, default_course, db, tts, stt, pronunciation, run_locks: Mutex::default(), limiter: Limiter::default() }
    }

    /// A course by id, falling back to the default for unknown or legacy ids.
    pub fn course(&self, id: &str) -> &CourseRt {
        self.courses.get(id).unwrap_or_else(|| &self.courses[&self.default_course])
    }

    /// One turn at a time per run, so a double-submit can't fork the save.
    fn run_lock(&self, run_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.run_locks.lock().unwrap();
        locks.retain(|_, l| Arc::strong_count(l) > 1);
        locks.entry(run_id.to_string()).or_default().clone()
    }
}

pub(crate) type AppStateRef = Arc<AppState>;

pub fn router(state: AppStateRef) -> Router {
    let origins: Vec<HeaderValue> = state.cfg.cors_origins.iter().filter_map(|o| o.parse().ok()).collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .max_age(Duration::from_secs(3600));

    let api = Router::new()
        .route("/story", get(get_story))
        .route("/courses", get(list_courses))
        .route("/players", post(create_player))
        .route("/runs", post(create_run))
        .route("/runs/current", get(current_run))
        .route("/runs/{id}/turn", post(take_turn))
        .route("/runs/{id}/scan", post(scan_line))
        .route("/runs/{id}/hint", post(unlock_hint))
        .route("/runs/{id}/translate", post(translate_phrase))
        .route("/runs/{id}/travel", post(travel))
        .route("/runs/{id}/act", post(act))
        .route("/runs/{id}/score", post(record_scene_score))
        .route("/tts", post(tts))
        .route("/tts/preview", post(tts_preview))
        .route("/stt", post(stt).layer(DefaultBodyLimit::max(8 * 1024 * 1024)))
        .route("/audio", get(audio_manifest))
        .route("/audio/{course}/{kind}/{file}", get(audio_file))
        .merge(crate::accounts::routes());

    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .nest("/api/v1", api)
        .layer(SetResponseHeaderLayer::overriding(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::overriding(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY")))
        .layer(SetResponseHeaderLayer::overriding(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer")))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

// ── rate limiting ──────────────────────────────────────────────────────────

/// Fixed-window counter per key. Plenty for a single instance; swap for
/// Redis when running more than one.
#[derive(Default)]
pub(crate) struct Limiter {
    windows: Mutex<HashMap<String, (Instant, u32)>>,
}

impl Limiter {
    pub(crate) fn check(&self, key: String, max: u32, per: Duration) -> AppResult<()> {
        let mut w = self.windows.lock().unwrap();
        if w.len() > 50_000 {
            w.retain(|_, (start, _)| start.elapsed() < per);
        }
        let now = Instant::now();
        let entry = w.entry(key).or_insert((now, 0));
        if now.duration_since(entry.0) >= per {
            *entry = (now, 0);
        }
        entry.1 += 1;
        if entry.1 > max { Err(AppError::RateLimited) } else { Ok(()) }
    }
}

pub(crate) fn client_ip(headers: &HeaderMap, addr: SocketAddr, trust_proxy: bool) -> String {
    if !trust_proxy {
        return addr.ip().to_string();
    }
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        // The last hop is the one our proxy appended; earlier ones are client-supplied.
        .and_then(|v| v.rsplit(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| addr.ip().to_string())
}

// ── auth ───────────────────────────────────────────────────────────────────

pub(crate) fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// The authenticated player, from `Authorization: Bearer <token>`.
pub struct Player {
    pub id: String,
}

impl FromRequestParts<AppStateRef> for Player {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppStateRef) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(AppError::Unauthorized)?;
        let id = db::player_by_session(&state.db, &hash_token(token))
            .await?
            .ok_or(AppError::Unauthorized)?;
        Ok(Player { id })
    }
}

/// Playing needs an account unless guests are allowed. Old guest tokens still
/// identify the player, so signing up keeps their runs. Returns whether they
/// play the full game or just the beta demo.
async fn require_member(app: &AppState, player: &Player) -> AppResult<bool> {
    let account = db::account_by_id(&app.db, &player.id).await?.filter(|a| a.email.is_some());
    match account {
        Some(a) => Ok(a.plays_full_game()),
        None if app.cfg.allow_guests => Ok(false),
        None => Err(AppError::Forbidden("sign in to play")),
    }
}

/// The demo stops at the course's demo_end for anyone without full access.
fn past_demo(story: &Story, full: bool, to: &str) -> bool {
    !full && !story.course.demo_end.is_empty() && to == story.course.demo_end
}

// ── views ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct LineView {
    id: i64,
    #[serde(flatten)]
    beat: Beat,
}

#[derive(Serialize)]
struct PhraseView {
    /// Lesson the phrase was picked up in.
    lesson_idx: usize,
    #[serde(flatten)]
    phrase: Phrase,
}

#[derive(Serialize)]
struct JournalView {
    seq: usize,
    text: String,
}

/// Everything the client needs to render the stage, minus the backlog.
#[derive(Serialize)]
struct StateView<'a> {
    status: RunStatus,
    course: &'a str,
    player_name: &'a str,
    place: &'a str,
    exits: Vec<game::ExitView>,
    quest: Option<&'a str>,
    goal_done: bool,
    goals_done: &'a std::collections::BTreeSet<String>,
    visited: &'a std::collections::BTreeSet<String>,
    flags: &'a std::collections::BTreeSet<String>,
    lesson_idx: usize,
    lesson_turns: u32,
    lesson_spoke: bool,
    lesson_grammar: Vec<&'a str>,
    grammar_counts: &'a std::collections::BTreeMap<String, u32>,
    scene: &'a str,
    ambient: &'static str,
    on_stage: &'a [String],
    yen: i64,
    items: &'a [String],
    trust: &'a std::collections::BTreeMap<String, i64>,
    /// Empty until the player spends battery on a hint.
    choices: &'a [Phrase],
    choices_unlocked: bool,
    battery: i64,
    known_words: &'a std::collections::BTreeMap<String, game::KnownWord>,
    seen_words: &'a std::collections::BTreeSet<String>,
    candos_done: &'a std::collections::BTreeSet<String>,
    unlocked_skills: &'a std::collections::BTreeMap<String, game::UnlockedSkill>,
    diary: &'a [game::DiaryEntry],
    /// Turns of patience left per character here; maxima are on the cast.
    patience: &'a std::collections::BTreeMap<String, i64>,
    timer: Option<TimerView<'a>>,
    scene_over: Option<&'a str>,
    lead: &'a str,
    /// People here the player can walk up to, and who they're talking with.
    present: Vec<String>,
    talking_to: &'a str,
    /// The story graph as lived, for the flowchart.
    flow: Vec<game::FlowQuest>,
    /// The current objective: its step and the ways open.
    objective: Option<game::ObjectiveView>,
    ending: Option<&'a str>,
}

#[derive(Serialize)]
struct TimerView<'a> {
    label: &'a str,
    left: u32,
    total: u32,
}

fn state_view<'a>(story: &'a Story, s: &'a RunState) -> StateView<'a> {
    StateView {
        status: s.status,
        course: &s.course,
        player_name: &s.player_name,
        place: &s.place,
        exits: s.exits(story),
        quest: s.current_quest(story).map(|q| q.id.as_str()),
        goal_done: s.goals_done.contains(&s.place),
        goals_done: &s.goals_done,
        visited: &s.visited,
        flags: &s.flags,
        lesson_idx: s.lesson_idx,
        lesson_turns: s.lesson_turns,
        lesson_spoke: s.lesson_spoke,
        lesson_grammar: s.lesson_grammar.iter().map(String::as_str).collect(),
        grammar_counts: &s.grammar_counts,
        scene: &s.scene,
        ambient: s.ambient.as_str(),
        on_stage: &s.on_stage,
        yen: s.yen,
        items: &s.items,
        trust: &s.trust,
        choices: if s.choices_unlocked { &s.choices } else { &[] },
        choices_unlocked: s.choices_unlocked,
        battery: s.battery,
        known_words: &s.known_words,
        seen_words: &s.seen_words,
        candos_done: &s.candos_done,
        unlocked_skills: &s.unlocked_skills,
        diary: &s.diary,
        patience: &s.patience,
        timer: match (s.timer_left, story.place(&s.place).and_then(|p| p.timer.as_ref())) {
            (Some(left), Some(t)) => Some(TimerView { label: &t.label, left, total: t.turns }),
            _ => None,
        },
        scene_over: s.scene_over.as_deref(),
        lead: &s.lead,
        present: s.present(story),
        talking_to: &s.talking_to,
        flow: s.flow(story),
        objective: s.objective(story),
        ending: s.ending.as_deref(),
    }
}

async fn run_view(app: &AppState, run_id: &str, s: &RunState) -> AppResult<Value> {
    let story = &app.course(&s.course).story;
    let lines: Vec<LineView> = db::chapter_lines(&app.db, run_id, s.segment)
        .await?
        .into_iter()
        .map(|(id, beat)| LineView { id, beat })
        .collect();
    let phrases: Vec<PhraseView> = db::phrases(&app.db, run_id)
        .await?
        .into_iter()
        .map(|(lesson_idx, phrase)| PhraseView { lesson_idx, phrase })
        .collect();
    let journal: Vec<JournalView> = db::journal(&app.db, run_id)
        .await?
        .into_iter()
        .map(|(seq, text)| JournalView { seq, text })
        .collect();
    let scene_scores = db::scene_scores(&app.db, run_id).await.unwrap_or_default();
    Ok(json!({
        "id": run_id,
        "state": state_view(story, s),
        "lines": lines,
        "phrases": phrases,
        "journal": journal,
        "scene_scores": scene_scores,
    }))
}

// ── handlers ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct CourseQuery {
    course: Option<String>,
}

async fn get_story(State(app): State<AppStateRef>, Query(q): Query<CourseQuery>) -> Json<Value> {
    let course = app.course(q.course.as_deref().unwrap_or(&app.default_course));
    Json(json!({
        "story": course.story,
        "tts_enabled": app.tts.is_some(),
        "stt_enabled": app.stt.is_some(),
    }))
}

/// The courses on offer, for the title screen.
async fn list_courses(State(app): State<AppStateRef>) -> Json<Value> {
    let courses: Vec<&crate::story::Course> = app.courses.values().map(|c| &c.story.course).collect();
    Json(json!({ "courses": courses, "default": app.default_course }))
}

async fn audio_manifest(State(app): State<AppStateRef>, Query(q): Query<CourseQuery>) -> Json<Value> {
    let id = q.course.as_deref().unwrap_or(&app.default_course);
    let course = app.course(id);
    Json(course.audio.manifest(&format!("/api/v1/audio/{}", course.story.course.id)))
}

/// Serves a rendered asset. Ids are checked against the catalogue, so the
/// path can't be used to read anything else.
async fn audio_file(
    State(app): State<AppStateRef>,
    Path((course, kind, file)): Path<(String, String, String)>,
) -> AppResult<impl IntoResponse> {
    let course = app.courses.get(&course).ok_or(AppError::NotFound("unknown course"))?;
    let kind = Kind::parse(&kind).ok_or(AppError::NotFound("unknown audio kind"))?;
    let id = file.strip_suffix(".mp3").ok_or(AppError::NotFound("audio not found"))?;
    let path = course.audio.path(kind, id).ok_or(AppError::NotFound("audio not found"))?;
    let bytes = tokio::fs::read(&path).await.map_err(|_| AppError::NotFound("audio not generated yet"))?;
    Ok((
        [(header::CONTENT_TYPE, "audio/mpeg"), (header::CACHE_CONTROL, "public, max-age=86400")],
        bytes,
    ))
}

async fn create_player(
    State(app): State<AppStateRef>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    // Without guests, everyone plays with an account.
    if !app.cfg.allow_guests {
        return Err(AppError::Forbidden("sign in to play"));
    }
    app.limiter.check(format!("player:{}", client_ip(&headers, addr, app.cfg.trust_proxy)), 20, Duration::from_secs(3600))?;
    let id = uuid::Uuid::new_v4().to_string();
    // Two v4 UUIDs: 244 random bits.
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    db::create_player(&app.db, &id, &hash_token(&token)).await?;
    Ok(Json(json!({ "player_id": id, "token": token })))
}

#[derive(Deserialize)]
struct CreateRun {
    player_name: String,
    #[serde(default)]
    course: Option<String>,
}

async fn create_run(
    State(app): State<AppStateRef>,
    player: Player,
    Json(body): Json<CreateRun>,
) -> AppResult<Json<Value>> {
    require_member(&app, &player).await?;
    app.limiter.check(format!("newrun:{}", player.id), 10, Duration::from_secs(3600))?;
    let name: String = body.player_name.trim().chars().filter(|c| !c.is_control()).take(24).collect();
    if name.is_empty() {
        return Err(AppError::BadRequest("player_name is required".into()));
    }
    let course_id = body.course.filter(|c| app.courses.contains_key(c)).unwrap_or_else(|| app.default_course.clone());
    let story = &app.course(&course_id).story;

    let run_id = uuid::Uuid::new_v4().to_string();
    let (mut state, intro) = RunState::new(story, name);
    state.course = course_id.clone();
    game::note_seen_words(story, &mut state, &intro);
    let mut tx = app.db.begin().await?;
    db::insert_run(&mut tx, &run_id, &player.id, &state).await?;
    for b in &intro {
        db::insert_line(&mut tx, &run_id, state.segment, b).await?;
    }
    for v in &story.lessons[0].vocab {
        db::insert_phrase(&mut tx, &run_id, 0, v).await?;
    }
    tx.commit().await?;

    Ok(Json(run_view(&app, &run_id, &state).await?))
}

/// The player's most recent save in a course, or `null` if there isn't one.
async fn current_run(
    State(app): State<AppStateRef>,
    player: Player,
    Query(q): Query<CourseQuery>,
) -> AppResult<Json<Value>> {
    let course = q.course.unwrap_or_else(|| app.default_course.clone());
    match db::latest_run_in_course(&app.db, &player.id, &course).await? {
        Some((run_id, state)) => Ok(Json(run_view(&app, &run_id, &state).await?)),
        None => Ok(Json(Value::Null)),
    }
}

#[derive(Deserialize)]
struct TurnRequest {
    text: String,
    via: InputVia,
    #[serde(default)]
    difficulty: director::Difficulty,
    #[serde(default)]
    pron_score: Option<u32>,
}

#[derive(Serialize)]
struct LessonCompleteView {
    finished: usize,
    next: usize,
}

#[derive(Serialize)]
struct GoalCompleteView {
    place: String,
    journal: String,
    next_steps: Vec<String>,
}

/// Moves the player into `to` and produces the arrival: the authored intro
/// on a first visit, otherwise an improvised scene from the director.
async fn arrive(
    app: &AppState,
    state: &mut RunState,
    from: &str,
    transcript: &[Beat],
    difficulty: director::Difficulty,
) -> AppResult<Vec<Beat>> {
    let to = state.place.clone();
    let course = app.course(&state.course);
    let (story, director) = (&course.story, &course.director);
    let intro = state.enter_place(story, &to);
    if !intro.is_empty() {
        return Ok(intro);
    }
    let brief = game::lesson_brief(story, state.lesson_idx);
    let msg = game::director_message(story, state, transcript, game::Prompt::Arrival { from: Some(from) });
    let turn = director.direct_turn(&brief, difficulty, &msg).await.map_err(AppError::Upstream)?;
    let mut beats = game::apply_arrival(story, state, turn);
    if beats.is_empty() {
        let name = &state.place(story).name;
        beats.push(Beat::narration(&story.course.arrive.replace("{place}", name)));
    }
    Ok(beats)
}

async fn take_turn(
    State(app): State<AppStateRef>,
    player: Player,
    Path(run_id): Path<String>,
    Json(body): Json<TurnRequest>,
) -> AppResult<Json<Value>> {
    let full = require_member(&app, &player).await?;
    let input = game::clean_input(&body.text).ok_or_else(|| AppError::BadRequest("say something first".into()))?;
    app.limiter.check(format!("turn:{}", player.id), 20, Duration::from_secs(60))?;

    let lock = app.run_lock(&run_id);
    let _guard = lock.try_lock().map_err(|_| AppError::Conflict("a turn is already in progress"))?;

    let mut state = db::get_run(&app.db, &run_id, &player.id).await?.ok_or(AppError::NotFound("run not found"))?;
    if state.status != RunStatus::Playing {
        return Err(AppError::Conflict("this story is already complete"));
    }
    if !db::take_turn_quota(&app.db, &player.id, app.cfg.max_turns_per_day).await? {
        return Err(AppError::RateLimited);
    }
    let course = app.course(&state.course);
    let (story, director) = (&course.story, &course.director);

    let transcript = db::recent_lines(&app.db, &run_id, game::TRANSCRIPT_LINES).await?;
    // Saves from before directions were remembered: learn them once from the past.
    if state.heard_of.is_empty() {
        let past = db::recent_lines(&app.db, &run_id, 1000).await?;
        game::hear_from(story, &mut state, &past);
    }
    let segment = state.segment;
    let lesson_before = state.lesson_idx;
    let brief = game::lesson_brief(story, lesson_before);
    let message = game::director_message(story, &state, &transcript, game::Prompt::Turn { input: &input, via: body.via });

    let turn = director.direct_turn(&brief, body.difficulty, &message).await.map_err(AppError::Upstream)?;
    state.difficulty = body.difficulty;
    let mut outcome = game::apply_turn_with_pron(story, &mut state, turn, body.via, &input, body.pron_score);
    // The player's stated intent wins if the director forgot to move them.
    if outcome.go_to.is_none() {
        outcome.go_to = game::intended_exit(story, &state, &input);
    }
    // The beta demo ends here: no further, and the client says thanks.
    let demo_end = outcome.go_to.as_deref().is_some_and(|to| past_demo(story, full, to));
    if demo_end {
        outcome.go_to = None;
    }
    // Using a looked-up word yourself (not via a suggestion) counts toward owning it.
    let (words_used, words_owned) =
        if body.via == InputVia::Choice { (Vec::new(), Vec::new()) } else { game::record_word_uses(&mut state, &input) };
    outcome.beats.extend(game::run_triggers(story, &mut state));
    game::note_seen_words(story, &mut state, &outcome.beats);

    // Walking somewhere: the reaction stays in this visit, the arrival opens the next.
    let player_line = Beat::player(&input);
    let mut arrival = Vec::new();
    if outcome.go_to.is_some() && outcome.goal_complete.is_none() {
        outcome.goal_complete = game::finish_on_leaving(story, &mut state, &mut outcome.beats);
    }
    if let Some(to) = outcome.go_to.clone() {
        let from = state.place.clone();
        state.place = to;
        let mut recent = transcript.clone();
        recent.push(player_line.clone());
        recent.extend(outcome.beats.iter().cloned());
        arrival = arrive(&app, &mut state, &from, &recent, body.difficulty).await?;
        arrival.extend(game::run_triggers(story, &mut state));
    }
    let ending = game::check_ending(story, &mut state);
    game::note_seen_words(story, &mut state, &arrival);

    let mut tx = app.db.begin().await?;
    let player_line_id = db::insert_line(&mut tx, &run_id, segment, &player_line).await?;
    let mut beats = Vec::new();
    for b in outcome.beats {
        let id = db::insert_line(&mut tx, &run_id, segment, &b).await?;
        beats.push(LineView { id, beat: b });
    }
    let arrival_starts_at = (!arrival.is_empty()).then_some(beats.len());
    for b in arrival.into_iter().chain(ending.clone().unwrap_or_default()) {
        let id = db::insert_line(&mut tx, &run_id, state.segment, &b).await?;
        beats.push(LineView { id, beat: b });
    }
    for p in &outcome.new_phrases {
        db::insert_phrase(&mut tx, &run_id, lesson_before, p).await?;
    }
    if let Some(done) = &outcome.goal_complete {
        state.journal_seq += 1;
        db::upsert_journal(&mut tx, &run_id, state.journal_seq, &done.journal).await?;
    }
    if let Some(finished) = outcome.lesson_complete {
        for v in &story.lessons[finished + 1].vocab {
            db::insert_phrase(&mut tx, &run_id, finished + 1, v).await?;
        }
    }
    db::update_run(&mut tx, &run_id, &state).await?;
    tx.commit().await?;

    Ok(Json(json!({
        "player_line": LineView { id: player_line_id, beat: player_line },
        "coach": outcome.coach,
        "beats": beats,
        "arrival_starts_at": arrival_starts_at,
        "moved_to": outcome.go_to,
        "demo_end": demo_end,
        "new_phrases": outcome.new_phrases,
        "mastered": words_owned.iter().map(|(jp, w)| json!({ "jp": jp, "romaji": w.romaji, "en": w.en })).collect::<Vec<_>>(),
        "words_used": words_used.iter().map(|(jp, w)| json!({ "jp": jp, "en": w.en, "uses": w.uses })).collect::<Vec<_>>(),
        "candos_done": outcome.candos_done.iter().filter_map(|id| story.cando(id)).collect::<Vec<_>>(),
        "skill_unlocked": outcome.skill_unlocked,
        "departed": outcome.departed,
        "scene_over": outcome.scene_over,
        "steps_done": outcome.steps_done,
        "goal_complete": outcome.goal_complete.map(|g| GoalCompleteView { place: g.place, journal: g.journal, next_steps: g.next_steps }),
        "lesson_complete": outcome.lesson_complete.map(|f| LessonCompleteView { finished: f, next: f + 1 }),
        "ending": state.ending,
        "state": state_view(story, &state),
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
enum ActRequestKind {
    /// Walk up to someone here.
    Approach { who: String },
    /// Stop and take stock.
    Look,
}

#[derive(Deserialize)]
struct ActRequest {
    #[serde(flatten)]
    kind: ActRequestKind,
    #[serde(default)]
    difficulty: director::Difficulty,
}

/// Approaching someone or looking around: the director plays it out, but
/// there's no line to grade and nobody's patience is spent.
async fn act(
    State(app): State<AppStateRef>,
    player: Player,
    Path(run_id): Path<String>,
    Json(body): Json<ActRequest>,
) -> AppResult<Json<Value>> {
    let full = require_member(&app, &player).await?;
    app.limiter.check(format!("turn:{}", player.id), 20, Duration::from_secs(60))?;
    let lock = app.run_lock(&run_id);
    let _guard = lock.try_lock().map_err(|_| AppError::Conflict("a turn is already in progress"))?;

    let mut state = db::get_run(&app.db, &run_id, &player.id).await?.ok_or(AppError::NotFound("run not found"))?;
    if state.status != RunStatus::Playing {
        return Err(AppError::Conflict("this story is already complete"));
    }
    let course = app.course(&state.course);
    let (story, director) = (&course.story, &course.director);
    let who = match &body.kind {
        ActRequestKind::Approach { who } if state.present(story).contains(who) => Some(who.as_str()),
        ActRequestKind::Approach { .. } => return Err(AppError::BadRequest("they're not here".into())),
        ActRequestKind::Look => None,
    };
    if !db::take_turn_quota(&app.db, &player.id, app.cfg.max_turns_per_day).await? {
        return Err(AppError::RateLimited);
    }

    let transcript = db::recent_lines(&app.db, &run_id, game::TRANSCRIPT_LINES).await?;
    if state.heard_of.is_empty() {
        let past = db::recent_lines(&app.db, &run_id, 1000).await?;
        game::hear_from(story, &mut state, &past);
    }
    let segment = state.segment;
    let brief = game::lesson_brief(story, state.lesson_idx);
    let prompt = match who {
        Some(who) => game::Prompt::Approach { who },
        None => game::Prompt::Look,
    };
    let message = game::director_message(story, &state, &transcript, prompt);
    let turn = director.direct_turn(&brief, body.difficulty, &message).await.map_err(AppError::Upstream)?;
    state.difficulty = body.difficulty;
    let who = who.map(str::to_string);
    let mut outcome = game::apply_act(story, &mut state, turn, who.as_deref());
    let demo_end = outcome.go_to.as_deref().is_some_and(|to| past_demo(story, full, to));
    if demo_end {
        outcome.go_to = None;
    }
    outcome.beats.extend(game::run_triggers(story, &mut state));
    game::note_seen_words(story, &mut state, &outcome.beats);

    // The scene's clock ran out while the player was looking around.
    let mut arrival = Vec::new();
    if let Some(to) = outcome.go_to.clone() {
        let from = state.place.clone();
        state.place = to;
        let mut recent = transcript.clone();
        recent.extend(outcome.beats.iter().cloned());
        arrival = arrive(&app, &mut state, &from, &recent, body.difficulty).await?;
        arrival.extend(game::run_triggers(story, &mut state));
        game::note_seen_words(story, &mut state, &arrival);
    }

    let mut tx = app.db.begin().await?;
    let mut beats = Vec::new();
    for b in outcome.beats {
        let id = db::insert_line(&mut tx, &run_id, segment, &b).await?;
        beats.push(LineView { id, beat: b });
    }
    let arrival_starts_at = (!arrival.is_empty()).then_some(beats.len());
    for b in arrival {
        let id = db::insert_line(&mut tx, &run_id, state.segment, &b).await?;
        beats.push(LineView { id, beat: b });
    }
    db::update_run(&mut tx, &run_id, &state).await?;
    tx.commit().await?;

    Ok(Json(json!({
        "beats": beats,
        "arrival_starts_at": arrival_starts_at,
        "moved_to": outcome.go_to,
        "demo_end": demo_end,
        "departed": outcome.departed,
        "scene_over": outcome.scene_over,
        "state": state_view(story, &state),
    })))
}

#[derive(Deserialize)]
struct TravelRequest {
    to: String,
    #[serde(default)]
    difficulty: director::Difficulty,
}

/// Walking somewhere by choosing it on the map.
async fn travel(
    State(app): State<AppStateRef>,
    player: Player,
    Path(run_id): Path<String>,
    Json(body): Json<TravelRequest>,
) -> AppResult<Json<Value>> {
    let full = require_member(&app, &player).await?;
    app.limiter.check(format!("turn:{}", player.id), 20, Duration::from_secs(60))?;
    let lock = app.run_lock(&run_id);
    let _guard = lock.try_lock().map_err(|_| AppError::Conflict("a turn is already in progress"))?;

    let mut state = db::get_run(&app.db, &run_id, &player.id).await?.ok_or(AppError::NotFound("run not found"))?;
    if state.status != RunStatus::Playing {
        return Err(AppError::Conflict("this story is already complete"));
    }
    let course = app.course(&state.course);
    let story = &course.story;
    if state.heard_of.is_empty() {
        let past = db::recent_lines(&app.db, &run_id, 1000).await?;
        game::hear_from(story, &mut state, &past);
    }
    if !state.can_go(story, &body.to) {
        return Err(AppError::BadRequest("you can't go there from here (yet)".into()));
    }
    if past_demo(story, full, &body.to) {
        return Ok(Json(json!({ "demo_end": true, "beats": [], "arrival_starts_at": 0, "state": state_view(story, &state) })));
    }
    let label = state
        .place(story)
        .exits
        .iter()
        .find(|e| e.to == body.to)
        .map(|e| e.label.clone())
        .unwrap_or_default();
    let segment = state.segment;
    let mut finished = Vec::new();
    let goal = game::finish_on_leaving(story, &mut state, &mut finished);
    let leaving = Beat::narration(&story.course.set_off.replace("{label}", &label));
    let mut transcript = db::recent_lines(&app.db, &run_id, game::TRANSCRIPT_LINES).await?;
    transcript.push(leaving.clone());

    let from = state.place.clone();
    state.place = body.to;
    let mut arrival = arrive(&app, &mut state, &from, &transcript, body.difficulty).await?;
    arrival.extend(game::run_triggers(story, &mut state));
    game::note_seen_words(story, &mut state, &arrival);

    let mut tx = app.db.begin().await?;
    let mut beats = Vec::new();
    for b in finished {
        let id = db::insert_line(&mut tx, &run_id, segment, &b).await?;
        beats.push(LineView { id, beat: b });
    }
    let leaving_id = db::insert_line(&mut tx, &run_id, segment, &leaving).await?;
    beats.push(LineView { id: leaving_id, beat: leaving });
    if let Some(done) = &goal {
        state.journal_seq += 1;
        db::upsert_journal(&mut tx, &run_id, state.journal_seq, &done.journal).await?;
    }
    let arrival_starts_at = beats.len();
    for b in arrival {
        let id = db::insert_line(&mut tx, &run_id, state.segment, &b).await?;
        beats.push(LineView { id, beat: b });
    }
    db::update_run(&mut tx, &run_id, &state).await?;
    tx.commit().await?;

    Ok(Json(json!({
        "beats": beats,
        "arrival_starts_at": arrival_starts_at,
        "goal_complete": goal.map(|g| GoalCompleteView { place: g.place, journal: g.journal, next_steps: g.next_steps }),
        "state": state_view(story, &state),
    })))
}

#[derive(Deserialize)]
struct ScanRequest {
    line_id: i64,
}

/// Translator "scan": a word-by-word gloss of one line. Costs battery the
/// first time; re-scanning a line whose words are all known is free.
async fn scan_line(
    State(app): State<AppStateRef>,
    player: Player,
    Path(run_id): Path<String>,
    Json(body): Json<ScanRequest>,
) -> AppResult<Json<Value>> {
    app.limiter.check(format!("scan:{}", player.id), 30, Duration::from_secs(60))?;
    let lock = app.run_lock(&run_id);
    let _guard = lock.lock().await;

    let mut state = db::get_run(&app.db, &run_id, &player.id).await?.ok_or(AppError::NotFound("run not found"))?;
    let course = app.course(&state.course);
    let (story, director) = (&course.story, &course.director);
    let beat = db::line_in_run(&app.db, body.line_id, &run_id).await?.ok_or(AppError::NotFound("line not found"))?;
    let jp = beat.jp.trim();
    if jp.is_empty() || beat.speaker == crate::story::PLAYER {
        return Err(AppError::BadRequest("nothing to translate on that line".into()));
    }

    let hash = hex::encode(Sha256::digest(jp.as_bytes()));
    let cached = db::gloss(&app.db, &hash).await?.and_then(|g| serde_json::from_str::<director::Gloss>(&g).ok());
    let already_known = cached
        .as_ref()
        .is_some_and(|g| g.words.iter().all(|w| state.known_words.contains_key(&w.jp)));
    let cost = if already_known { 0 } else { story.device.scan_cost };
    if state.battery < cost {
        return Err(AppError::Conflict("the translator's battery is dead"));
    }

    let gloss = match cached {
        Some(g) => g,
        None => {
            let g = director.gloss(jp).await.map_err(AppError::Upstream)?;
            db::put_gloss(&app.db, &hash, &serde_json::to_string(&g)?).await?;
            g
        }
    };
    state.battery -= cost;
    for w in &gloss.words {
        if w.jp.chars().any(|c| c.is_alphanumeric()) {
            // Re-looking a word up refreshes its meaning but keeps its progress.
            let prev = state.known_words.get(&w.jp).cloned();
            state.known_words.insert(
                w.jp.clone(),
                game::KnownWord {
                    romaji: w.romaji.clone(),
                    en: w.en.clone(),
                    kind: w.kind.clone(),
                    note: w.note.clone(),
                    mastered: prev.as_ref().is_some_and(|k| k.mastered),
                    uses: prev.as_ref().map_or(0, |k| k.uses),
                    last_use_segment: prev.as_ref().map_or(0, |k| k.last_use_segment),
                },
            );
            state.seen_words.remove(&w.jp);
        }
    }
    let mut conn = app.db.acquire().await?;
    db::update_run(&mut conn, &run_id, &state).await?;
    Ok(Json(json!({ "line_id": body.line_id, "gloss": gloss, "cost": cost, "state": state_view(story, &state) })))
}

#[derive(Deserialize)]
struct TranslateRequest {
    text: String,
}

/// Dictionary "how do I say…?": English in, a Japanese line to read aloud out.
async fn translate_phrase(
    State(app): State<AppStateRef>,
    player: Player,
    Path(run_id): Path<String>,
    Json(body): Json<TranslateRequest>,
) -> AppResult<Json<Value>> {
    let want = game::clean_input(&body.text).ok_or_else(|| AppError::BadRequest("type what you want to say".into()))?;
    app.limiter.check(format!("translate:{}", player.id), 20, Duration::from_secs(60))?;
    let lock = app.run_lock(&run_id);
    let _guard = lock.lock().await;

    let mut state = db::get_run(&app.db, &run_id, &player.id).await?.ok_or(AppError::NotFound("run not found"))?;
    let course = app.course(&state.course);
    let (story, director) = (&course.story, &course.director);
    let cost = story.device.translate_cost;
    if state.battery < cost {
        return Err(AppError::Conflict("the dictionary's battery is dead"));
    }
    let brief = game::lesson_brief(story, state.lesson_idx);
    let translation = director.translate(&want, &brief).await.map_err(AppError::Upstream)?;
    state.battery -= cost;
    let mut conn = app.db.acquire().await?;
    db::update_run(&mut conn, &run_id, &state).await?;
    Ok(Json(json!({ "translation": translation, "cost": cost, "state": state_view(story, &state) })))
}

/// Translator "hint": reveals the suggested replies for the current moment.
#[derive(Deserialize)]
struct HintQuery {
    #[serde(default)]
    difficulty: director::Difficulty,
}

/// Unlocks suggested replies. They cost battery, except on Beginner, where
/// suggestions are always on.
async fn unlock_hint(
    State(app): State<AppStateRef>,
    player: Player,
    Path(run_id): Path<String>,
    Query(q): Query<HintQuery>,
) -> AppResult<Json<Value>> {
    let lock = app.run_lock(&run_id);
    let _guard = lock.lock().await;
    let mut state = db::get_run(&app.db, &run_id, &player.id).await?.ok_or(AppError::NotFound("run not found"))?;
    let course = app.course(&state.course);
    let story = &course.story;
    if !state.choices_unlocked {
        let cost = if q.difficulty == director::Difficulty::Beginner { 0 } else { story.device.hint_cost };
        if state.battery < cost {
            return Err(AppError::Conflict("the translator's battery is dead"));
        }
        state.battery -= cost;
        state.choices_unlocked = true;
        let mut conn = app.db.acquire().await?;
        db::update_run(&mut conn, &run_id, &state).await?;
    }
    Ok(Json(json!({ "state": state_view(story, &state) })))
}

#[derive(Deserialize)]
struct SceneScoreRequest {
    place_id: String,
    rank: String,
    score: i64,
    turns_used: i64,
    #[serde(default)]
    voice_turns: i64,
    #[serde(default)]
    difficulty: String,
    #[serde(default)]
    metrics: std::collections::BTreeMap<String, i64>,
    #[serde(default)]
    feedbacks: Vec<game::DiaryLineFeedback>,
    #[serde(default)]
    journal: Option<String>,
}

/// Persists a completed scene's scorecard and grants battery / trust rewards.
async fn record_scene_score(
    State(app): State<AppStateRef>,
    player: Player,
    Path(run_id): Path<String>,
    Json(body): Json<SceneScoreRequest>,
) -> AppResult<Json<Value>> {
    app.limiter.check(format!("score:{}", player.id), 30, Duration::from_secs(60))?;
    let lock = app.run_lock(&run_id);
    let _guard = lock.lock().await;

    let mut state = db::get_run(&app.db, &run_id, &player.id).await?.ok_or(AppError::NotFound("run not found"))?;
    let course = app.course(&state.course);
    let story = &course.story;

    let rank = match body.rank.trim().to_uppercase().as_str() {
        "S" => "S",
        "A" => "A",
        "B" => "B",
        _ => "C",
    };

    // The rank is the client's own tally, so it pays out at most once per
    // visit, and only for the scene the player is actually in.
    if body.place_id != state.place {
        return Err(AppError::BadRequest("that isn't the current scene".into()));
    }
    let (reward_battery, reward_trust) = if state.rewarded_segments.insert(state.segment) {
        state.apply_scene_reward(story, &body.place_id, rank)
    } else {
        (0, Vec::new())
    };
    let place = story.place(&body.place_id).ok_or(AppError::BadRequest("unknown place".into()))?;
    let clip = |s: String, n: usize| s.chars().take(n).collect::<String>();
    let journal = body.journal.map(|j| clip(j, 2000));
    let mut metrics = body.metrics;
    while metrics.len() > 12 {
        metrics.pop_last();
    }
    let mut feedbacks = body.feedbacks;
    feedbacks.truncate(60);
    for f in &mut feedbacks {
        for field in [&mut f.note, &mut f.better_jp, &mut f.better_romaji, &mut f.better_en] {
            *field = clip(std::mem::take(field), 500);
        }
    }

    // Capture the current scene segment's dialogue backlog for the Diary.
    let seg_lines = db::chapter_lines(&app.db, &run_id, state.segment).await.unwrap_or_default();

    let mut tx = app.db.begin().await?;
    let score_id = db::insert_scene_score(&mut tx, &run_id, &body.place_id, rank, body.score.clamp(0, 100), body.turns_used.clamp(0, 999)).await?;

    let entry = game::DiaryEntry {
        id: format!("scene-{score_id}"),
        place_id: body.place_id.clone(),
        place_name: place.name.clone(),
        place_name_jp: place.name_jp.clone(),
        rank: rank.to_string(),
        score: body.score.clamp(0, 100),
        turns_used: body.turns_used.clamp(0, 999),
        voice_turns: body.voice_turns.clamp(0, 999),
        difficulty: match body.difficulty.as_str() {
            "intermediate" | "advanced" => body.difficulty,
            _ => "beginner".into(),
        },
        metrics: metrics.into_iter().map(|(k, v)| (clip(k, 60), v.clamp(0, 100))).collect(),
        lines: seg_lines,
        feedbacks,
        journal,
        reward_battery,
        reward_trust: reward_trust.clone(),
        created_at: db::now(),
    };
    state.diary.push(entry.clone());
    db::update_run(&mut tx, &run_id, &state).await?;
    tx.commit().await?;

    let scene_scores = db::scene_scores(&app.db, &run_id).await.unwrap_or_default();
    Ok(Json(json!({
        "reward_battery": reward_battery,
        "reward_trust": reward_trust,
        "diary_entry": entry,
        "scene_scores": scene_scores,
        "state": state_view(story, &state),
    })))
}

#[derive(Deserialize)]
struct TtsRequest {
    line_id: i64,
}

async fn tts(
    State(app): State<AppStateRef>,
    player: Player,
    Json(body): Json<TtsRequest>,
) -> AppResult<impl IntoResponse> {
    let voice = app.tts.as_ref().ok_or(AppError::Unavailable("voice is not configured"))?;
    app.limiter.check(format!("tts:{}", player.id), 60, Duration::from_secs(60))?;

    let (beat, course_id) = db::line_for_player(&app.db, body.line_id, &player.id)
        .await?
        .ok_or(AppError::NotFound("line not found"))?;
    let story = &app.course(&course_id).story;
    let cast = story.cast_member(&beat.speaker).ok_or(AppError::BadRequest("this line has no voice".into()))?;
    if beat.jp.trim().is_empty() {
        return Err(AppError::BadRequest("this line has no Japanese to speak".into()));
    }
    let voice_id = app.cfg.voice_override(&cast.id).unwrap_or_else(|| cast.voice.clone());

    let audio = voice.speak(&voice_id, &beat.jp).await.map_err(AppError::Upstream)?;
    Ok((
        [(header::CONTENT_TYPE, "audio/mpeg"), (header::CACHE_CONTROL, "private, max-age=31536000, immutable")],
        audio,
    ))
}

#[derive(Deserialize)]
struct TtsPreviewRequest {
    text: String,
    #[serde(default)]
    speaker: Option<String>,
    #[serde(default)]
    course: Option<String>,
}

/// Synthesizes a suggested Japanese reply using a character's configured voice
/// from `story.toml` (with disk caching), for Beginner Shadow Mode.
async fn tts_preview(
    State(app): State<AppStateRef>,
    player: Player,
    Json(body): Json<TtsPreviewRequest>,
) -> AppResult<impl IntoResponse> {
    let voice = app.tts.as_ref().ok_or(AppError::Unavailable("voice is not configured"))?;
    app.limiter.check(format!("tts:{}", player.id), 60, Duration::from_secs(60))?;

    let text = body.text.trim();
    if text.is_empty() || text.chars().count() > 300 {
        return Err(AppError::BadRequest("invalid text for voice preview".into()));
    }
    let course_id = body.course.as_deref().unwrap_or(&app.default_course);
    let story = &app.course(course_id).story;

    // Only lines the game itself offers can be voiced, so the endpoint can't
    // be used as a free text-to-speech service on our ElevenLabs credits.
    let offered = || {
        story.lessons.iter().flat_map(|l| l.candos.iter().map(|c| c.example.as_str()))
            .chain(story.places.iter().flat_map(|p| p.pack.iter().chain(&p.choices).map(|w| w.jp.as_str())))
            .chain(story.lessons.iter().flat_map(|l| l.grammar.iter().map(|g| g.example_jp.as_str())))
            .any(|t| t.trim() == text)
    };
    let in_choices = match db::latest_run_in_course(&app.db, &player.id, &story.course.id).await? {
        Some((_, state)) => state.choices.iter().any(|c| c.jp.trim() == text),
        None => false,
    };
    if !in_choices && !offered() {
        return Err(AppError::BadRequest("that line can't be previewed".into()));
    }

    let cast = body
        .speaker
        .as_deref()
        .and_then(|id| story.cast_member(id))
        .or_else(|| story.cast.first())
        .ok_or(AppError::BadRequest("no character voice available".into()))?;

    let voice_id = app.cfg.voice_override(&cast.id).unwrap_or_else(|| cast.voice.clone());
    let audio = voice.speak(&voice_id, text).await.map_err(AppError::Upstream)?;
    Ok((
        [(header::CONTENT_TYPE, "audio/mpeg"), (header::CACHE_CONTROL, "private, max-age=31536000, immutable")],
        audio,
    ))
}

async fn stt(State(app): State<AppStateRef>, player: Player, mut form: Multipart) -> AppResult<Json<Value>> {
    let stt = app.stt.as_ref().ok_or(AppError::Unavailable("speech input is not configured"))?;
    app.limiter.check(format!("stt:{}", player.id), 30, Duration::from_secs(60))?;

    let mut audio_bytes: Option<(bytes::Bytes, String, String)> = None;
    let mut reference_text = String::new();
    let mut course_id: Option<String> = None;

    while let Some(field) = form.next_field().await.map_err(|e| AppError::BadRequest(e.to_string()))? {
        match field.name() {
            Some("audio") => {
                let filename = field.file_name().unwrap_or("speech.webm").to_string();
                let mime = field.content_type().unwrap_or("audio/webm").to_string();
                if !mime.starts_with("audio/") && !mime.starts_with("video/webm") {
                    return Err(AppError::BadRequest("expected an audio file".into()));
                }
                let bytes = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;
                if bytes.len() < 512 {
                    return Err(AppError::BadRequest("that recording was too short".into()));
                }
                audio_bytes = Some((bytes, filename, mime));
            }
            Some("reference") => {
                if let Ok(txt) = field.text().await {
                    // A recognition hint, not free text: keep it short.
                    reference_text = txt.chars().take(400).collect();
                }
            }
            Some("course") => {
                if let Ok(c) = field.text().await {
                    course_id = Some(c);
                }
            }
            _ => {}
        }
    }

    let (bytes, filename, mime) = audio_bytes.ok_or_else(|| AppError::BadRequest("missing `audio` field".into()))?;
    let ref_opt = (!reference_text.trim().is_empty()).then_some(reference_text.as_str());
    let target = app.course(course_id.as_deref().unwrap_or(&app.default_course)).story.course.target_lang.clone();
    let text = stt.transcribe(bytes.clone(), filename, mime.clone(), ref_opt, &target).await.map_err(AppError::Upstream)?;
    let pronunciation = app.pronunciation.assess(&bytes, &mime, &reference_text, &text, &target).await;
    Ok(Json(json!({
        "text": text,
        "pronunciation": pronunciation,
    })))
}
