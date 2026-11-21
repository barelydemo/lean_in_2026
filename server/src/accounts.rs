//! Accounts, sessions and the closed-beta invite system.
//!
//! Players start as guests (a random token) or, in the closed beta, sign up
//! with an invite. An account is a guest with an email and password, so a
//! guest who signs up keeps their saved runs. Each signed-in device gets its
//! own session token; only its hash is stored. Admins (ADMIN_EMAILS) make
//! invites and see testers' progress.

use std::net::SocketAddr;
use std::time::Duration;

use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, header};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::api::{AppStateRef, Player, client_ip, hash_token};
use crate::db::{self, Account, Invite};
use crate::error::{AppError, AppResult};
use crate::game::RunState;

pub fn routes() -> Router<AppStateRef> {
    Router::new()
        .route("/auth/signup", post(signup))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/auth/config", get(auth_config))
        .route("/admin/invites", get(list_invites).post(create_invite))
        .route("/admin/invites/{code}/revoke", post(revoke_invite))
        .route("/admin/members", get(members))
        .route("/admin/members/{id}/access", post(set_access))
}

// ── helpers ────────────────────────────────────────────────────────────────

/// 64 hex characters (256 bits) for session tokens.
fn random_token() -> String {
    let mut b = [0u8; 32];
    OsRng.fill_bytes(&mut b);
    hex::encode(b)
}

fn invite_code() -> String {
    // No 0/O/1/I/L: codes get read aloud and typed by hand.
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let mut b = [0u8; 10];
    OsRng.fill_bytes(&mut b);
    b.iter().map(|x| ALPHABET[*x as usize % ALPHABET.len()] as char).collect()
}

fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(anyhow::anyhow!("hashing password: {e}")))
}

fn password_ok(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash).is_ok_and(|h| Argon2::default().verify_password(password.as_bytes(), &h).is_ok())
}

/// A real hash to verify against when the email is unknown, so a failed
/// sign-in takes the same time either way.
fn dummy_hash() -> &'static str {
    static HASH: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    HASH.get_or_init(|| hash_password("not-a-real-password").unwrap_or_default())
}

fn clean_email(raw: &str) -> AppResult<String> {
    let email = raw.trim().to_lowercase();
    let ok = email.len() <= 254
        && email.split_once('@').is_some_and(|(user, domain)| !user.is_empty() && domain.contains('.') && !domain.starts_with('.'))
        && !email.chars().any(|c| c.is_whitespace() || c.is_control());
    if ok { Ok(email) } else { Err(AppError::BadRequest("that doesn't look like an email address".into())) }
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers.get(header::AUTHORIZATION)?.to_str().ok()?.strip_prefix("Bearer ")
}

async fn new_session(app: &AppStateRef, player_id: &str) -> AppResult<String> {
    let token = random_token();
    db::create_session(&app.db, &hash_token(&token), player_id, app.cfg.session_days * 86_400).await?;
    Ok(token)
}

async fn require_admin(app: &AppStateRef, player: &Player) -> AppResult<Account> {
    match db::account_by_id(&app.db, &player.id).await? {
        Some(a) if a.role == "admin" => Ok(a),
        _ => Err(AppError::Forbidden("admins only")),
    }
}

/// Where a player has got to in their latest run, for their profile and the admin panel.
fn progress(app: &AppStateRef, state_json: Option<&str>) -> Value {
    let Some(state) = state_json.and_then(|s| serde_json::from_str::<RunState>(s).ok()) else {
        return Value::Null;
    };
    let story = &app.course(&state.course).story;
    let lesson = story.lessons.get(state.lesson_idx);
    json!({
        "course": state.course,
        "place": story.place(&state.place).map(|p| p.name.as_str()).unwrap_or(&state.place),
        "lesson": state.lesson_idx,
        "lesson_title": lesson.map(|l| l.title.as_str()).unwrap_or(""),
        "lessons_total": story.lessons.len(),
        "candos_done": state.candos_done.len(),
        "candos_total": story.lessons.iter().map(|l| l.candos.len()).sum::<usize>(),
        "words_known": state.known_words.len(),
        "words_owned": state.known_words.values().filter(|w| w.mastered).count(),
        "scenes_cleared": state.goals_done.len(),
        "places_visited": state.visited.len(),
        "quest": state.current_quest(story).map(|q| q.title.as_str()),
        "finished": state.ending.is_some(),
    })
}

// ── public ─────────────────────────────────────────────────────────────────

/// What the sign-in screen needs to know before anyone is signed in.
async fn auth_config(State(app): State<AppStateRef>) -> Json<Value> {
    Json(json!({ "invite_only": app.cfg.needs_invite(), "guests": app.cfg.allow_guests }))
}

#[derive(Deserialize)]
struct SignupRequest {
    email: String,
    password: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    invite: String,
}

async fn signup(
    State(app): State<AppStateRef>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<SignupRequest>,
) -> AppResult<Json<Value>> {
    let ip = client_ip(&headers, addr, app.cfg.trust_proxy);
    app.limiter.check(format!("signup:{ip}"), 10, Duration::from_secs(3600))?;

    let email = clean_email(&body.email)?;
    let n = body.password.chars().count();
    if !(8..=200).contains(&n) {
        return Err(AppError::BadRequest("use a password of at least 8 characters".into()));
    }
    let name: String = body.name.trim().chars().filter(|c| !c.is_control()).take(32).collect();
    if db::account_by_email(&app.db, &email).await?.is_some() {
        return Err(AppError::Conflict("there's already an account with that email — sign in instead"));
    }

    let admin = app.cfg.admin_emails.contains(&email);
    let code = body.invite.trim().to_uppercase();
    let invite = if code.is_empty() { None } else { Some(code) };
    // An invite, when given (or required), is claimed and may grant the full game.
    let mut full_access = false;
    if let Some(code) = &invite
        && !admin
    {
        match db::claim_invite(&app.db, code, &email).await? {
            Some(full) => full_access = full,
            None => return Err(AppError::BadRequest("that invite isn't valid — it may have expired or been used up".into())),
        }
    } else if app.cfg.needs_invite() && !admin {
        return Err(AppError::Forbidden("you need an invite to join the beta"));
    }

    // A guest signing up keeps their runs; otherwise this is a brand-new player.
    let guest = match bearer(&headers) {
        Some(t) => match db::player_by_session(&app.db, &hash_token(t)).await? {
            Some(id) => db::account_by_id(&app.db, &id).await?.filter(|a| a.email.is_none()).map(|a| a.id),
            None => None,
        },
        None => None,
    };
    let id = match guest {
        Some(id) => id,
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            // The player token column is for guests; members sign in with sessions.
            db::create_player(&app.db, &id, &hash_token(&random_token())).await?;
            id
        }
    };
    let role = if admin { "admin" } else { "player" };
    db::set_credentials(&app.db, &id, &email, &hash_password(&body.password)?, &name, role, invite.as_deref()).await?;
    if full_access {
        db::set_full_access(&app.db, &id, true).await?;
    }
    let token = new_session(&app, &id).await?;
    tracing::info!(player = %id, role, "account created");
    Ok(Json(json!({ "token": token, "account": db::account_by_id(&app.db, &id).await? })))
}

#[derive(Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
}

async fn login(
    State(app): State<AppStateRef>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> AppResult<Json<Value>> {
    let ip = client_ip(&headers, addr, app.cfg.trust_proxy);
    let email = body.email.trim().to_lowercase();
    app.limiter.check(format!("login-ip:{ip}"), 30, Duration::from_secs(900))?;
    app.limiter.check(format!("login-email:{email}"), 10, Duration::from_secs(900))?;

    let found = db::account_by_email(&app.db, &email).await?;
    let hash = found.as_ref().and_then(|(_, h)| h.clone()).unwrap_or_else(|| dummy_hash().to_string());
    let ok = password_ok(&body.password, &hash);
    match found {
        Some((account, Some(_))) if ok => {
            let token = new_session(&app, &account.id).await?;
            Ok(Json(json!({ "token": token, "account": account })))
        }
        _ => Err(AppError::BadRequest("that email and password don't match".into())),
    }
}

async fn logout(State(app): State<AppStateRef>, headers: HeaderMap) -> AppResult<Json<Value>> {
    if let Some(t) = bearer(&headers) {
        db::delete_session(&app.db, &hash_token(t)).await?;
    }
    Ok(Json(json!({ "ok": true })))
}

/// The signed-in player: account (null for guests) and their progress.
async fn me(State(app): State<AppStateRef>, player: Player) -> AppResult<Json<Value>> {
    let account = db::account_by_id(&app.db, &player.id).await?.filter(|a| a.email.is_some());
    let latest = db::latest_run_state(&app.db, &player.id).await?;
    Ok(Json(json!({ "account": account, "progress": progress(&app, latest.as_deref()) })))
}

// ── admin ──────────────────────────────────────────────────────────────────

fn invite_view(app: &AppStateRef, inv: &Invite) -> Value {
    let mut v = serde_json::to_value(inv).unwrap_or(Value::Null);
    v["link"] = json!(format!("{}/?invite={}", app.cfg.public_web_url, inv.code));
    v
}

async fn list_invites(State(app): State<AppStateRef>, player: Player) -> AppResult<Json<Value>> {
    require_admin(&app, &player).await?;
    let invites: Vec<Value> = db::list_invites(&app.db).await?.iter().map(|i| invite_view(&app, i)).collect();
    Ok(Json(json!({ "invites": invites })))
}

#[derive(Deserialize)]
struct InviteRequest {
    #[serde(default)]
    email: String,
    #[serde(default)]
    note: String,
    #[serde(default = "one")]
    max_uses: i64,
    #[serde(default = "fortnight")]
    days: i64,
    /// Whoever signs up with it plays past the demo.
    #[serde(default)]
    full_access: bool,
}

fn one() -> i64 {
    1
}
fn fortnight() -> i64 {
    14
}

async fn create_invite(State(app): State<AppStateRef>, player: Player, Json(body): Json<InviteRequest>) -> AppResult<Json<Value>> {
    let admin = require_admin(&app, &player).await?;
    let email = if body.email.trim().is_empty() { None } else { Some(clean_email(&body.email)?) };
    let now = db::now();
    let invite = Invite {
        code: invite_code(),
        full_access: body.full_access,
        email,
        note: body.note.trim().chars().filter(|c| !c.is_control()).take(120).collect(),
        max_uses: body.max_uses.clamp(1, 100),
        uses: 0,
        created_at: now,
        expires_at: now + body.days.clamp(1, 90) * 86_400,
        revoked: false,
    };
    db::create_invite(&app.db, &invite, &admin.id).await?;
    tracing::info!(by = %admin.id, uses = invite.max_uses, "invite created");
    Ok(Json(invite_view(&app, &invite)))
}

async fn revoke_invite(State(app): State<AppStateRef>, player: Player, Path(code): Path<String>) -> AppResult<Json<Value>> {
    require_admin(&app, &player).await?;
    if !db::revoke_invite(&app.db, &code).await? {
        return Err(AppError::NotFound("no such invite"));
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct AccessRequest {
    full: bool,
}

/// Lets one tester past the demo (or back to it).
async fn set_access(State(app): State<AppStateRef>, player: Player, Path(id): Path<String>, Json(body): Json<AccessRequest>) -> AppResult<Json<Value>> {
    let admin = require_admin(&app, &player).await?;
    if !db::set_full_access(&app.db, &id, body.full).await? {
        return Err(AppError::NotFound("no such member"));
    }
    tracing::info!(by = %admin.id, member = %id, full = body.full, "access changed");
    Ok(Json(json!({ "ok": true })))
}

async fn members(State(app): State<AppStateRef>, player: Player) -> AppResult<Json<Value>> {
    require_admin(&app, &player).await?;
    let rows: Vec<Value> = db::members(&app.db)
        .await?
        .into_iter()
        .map(|(account, joined, last_seen, state, runs, turns_today)| {
            json!({
                "account": account,
                "joined": joined,
                "last_seen": last_seen,
                "runs": runs,
                "turns_today": turns_today,
                "progress": progress(&app, state.as_deref()),
            })
        })
        .collect();
    Ok(Json(json!({ "members": rows, "turn_limit": app.cfg.max_turns_per_day })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passwords_hash_and_verify() {
        let h = hash_password("correct horse").unwrap();
        assert!(password_ok("correct horse", &h));
        assert!(!password_ok("Correct horse", &h));
        assert!(!password_ok("anything", "not a hash"));
    }

    #[test]
    fn emails_are_normalised_and_checked() {
        assert_eq!(clean_email("  Ren@Example.COM ").unwrap(), "ren@example.com");
        for bad in ["ren", "ren@", "@example.com", "ren@localhost", "ren @example.com", "ren@.com"] {
            assert!(clean_email(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn invite_codes_avoid_lookalike_characters() {
        for _ in 0..50 {
            let c = invite_code();
            assert_eq!(c.len(), 10);
            assert!(!c.chars().any(|ch| "01OIL".contains(ch)), "{c}");
        }
        assert_eq!(random_token().len(), 64);
    }
}
