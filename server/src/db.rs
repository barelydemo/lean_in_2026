use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Row, SqliteConnection, SqlitePool};

use crate::game::RunState;
use crate::story::{Beat, Phrase};

pub fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// UTC day number, used to reset per-player daily turn quotas.
pub fn today() -> String {
    (now() / 86_400).to_string()
}

pub async fn connect(url: &str) -> anyhow::Result<SqlitePool> {
    let opts = SqliteConnectOptions::from_str(url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(5));
    let pool = SqlitePoolOptions::new().max_connections(8).connect_with(opts).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

/// A consistent copy of the live database (safe while the server runs).
pub async fn backup(pool: &SqlitePool, path: &str) -> anyhow::Result<()> {
    anyhow::ensure!(!std::path::Path::new(path).exists(), "{path} already exists");
    sqlx::query("VACUUM INTO ?1").bind(path).execute(pool).await?;
    Ok(())
}

// ── players ────────────────────────────────────────────────────────────────

pub async fn create_player(pool: &SqlitePool, id: &str, token_hash: &str) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO players (id, token_hash, created_at) VALUES (?1, ?2, ?3)")
        .bind(id)
        .bind(token_hash)
        .bind(now())
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn player_by_token_hash(pool: &SqlitePool, token_hash: &str) -> sqlx::Result<Option<String>> {
    let row = sqlx::query("SELECT id FROM players WHERE token_hash = ?1")
        .bind(token_hash)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.get("id")))
}

// ── accounts ───────────────────────────────────────────────────────────────

/// A signed-up player (guests have no email).
#[derive(Debug, Clone, serde::Serialize)]
pub struct Account {
    pub id: String,
    pub email: Option<String>,
    pub display_name: String,
    pub role: String,
    /// The whole game, not just the beta demo (admins always have it).
    pub full_access: bool,
}

impl Account {
    pub fn plays_full_game(&self) -> bool {
        self.full_access || self.role == "admin"
    }
}

fn account(r: &sqlx::sqlite::SqliteRow) -> Account {
    Account {
        id: r.get("id"),
        email: r.get("email"),
        display_name: r.get("display_name"),
        role: r.get("role"),
        full_access: r.get::<i64, _>("full_access") != 0,
    }
}

pub async fn account_by_id(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<Account>> {
    let row = sqlx::query("SELECT id, email, display_name, role, full_access FROM players WHERE id = ?1").bind(id).fetch_optional(pool).await?;
    Ok(row.as_ref().map(account))
}

/// The account and its password hash, for signing in.
pub async fn account_by_email(pool: &SqlitePool, email: &str) -> sqlx::Result<Option<(Account, Option<String>)>> {
    let row = sqlx::query("SELECT id, email, display_name, role, full_access, password_hash FROM players WHERE email = ?1")
        .bind(email)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| (account(&r), r.get("password_hash"))))
}

/// Gives a player (a fresh one, or a guest signing up) an email and password.
pub async fn set_credentials(
    pool: &SqlitePool,
    id: &str,
    email: &str,
    password_hash: &str,
    name: &str,
    role: &str,
    invite: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE players SET email = ?2, password_hash = ?3, display_name = ?4, role = ?5, invite_code = ?6 WHERE id = ?1")
        .bind(id)
        .bind(email)
        .bind(password_hash)
        .bind(name)
        .bind(role)
        .bind(invite)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn create_session(pool: &SqlitePool, token_hash: &str, player_id: &str, ttl_secs: i64) -> sqlx::Result<()> {
    let t = now();
    sqlx::query("INSERT INTO sessions (token_hash, player_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(token_hash)
        .bind(player_id)
        .bind(t)
        .bind(t + ttl_secs)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_session(pool: &SqlitePool, token_hash: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM sessions WHERE token_hash = ?1").bind(token_hash).execute(pool).await?;
    Ok(())
}

/// The player behind a session or guest token, marking them as seen.
pub async fn player_by_session(pool: &SqlitePool, token_hash: &str) -> sqlx::Result<Option<String>> {
    let row = sqlx::query("SELECT player_id FROM sessions WHERE token_hash = ?1 AND expires_at > ?2")
        .bind(token_hash)
        .bind(now())
        .fetch_optional(pool)
        .await?;
    let id: Option<String> = match row {
        Some(r) => Some(r.get("player_id")),
        // Guests (and players from before accounts) still hold a player token.
        None => player_by_token_hash(pool, token_hash).await?,
    };
    if let Some(id) = &id {
        sqlx::query("UPDATE players SET last_seen = ?2 WHERE id = ?1 AND last_seen < ?2 - 60").bind(id).bind(now()).execute(pool).await?;
    }
    Ok(id)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Invite {
    pub code: String,
    /// Whoever signs up with it gets the whole game, not just the demo.
    pub full_access: bool,
    pub email: Option<String>,
    pub note: String,
    pub max_uses: i64,
    pub uses: i64,
    pub created_at: i64,
    pub expires_at: i64,
    pub revoked: bool,
}

pub async fn create_invite(pool: &SqlitePool, inv: &Invite, created_by: &str) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO invites (code, email, note, max_uses, created_by, created_at, expires_at, full_access) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
        .bind(&inv.code)
        .bind(&inv.email)
        .bind(&inv.note)
        .bind(inv.max_uses)
        .bind(created_by)
        .bind(inv.created_at)
        .bind(inv.expires_at)
        .bind(inv.full_access)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_invites(pool: &SqlitePool) -> sqlx::Result<Vec<Invite>> {
    let rows = sqlx::query("SELECT code, email, note, max_uses, uses, created_at, expires_at, revoked, full_access FROM invites ORDER BY created_at DESC")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .iter()
        .map(|r| Invite {
            code: r.get("code"),
            full_access: r.get::<i64, _>("full_access") != 0,
            email: r.get("email"),
            note: r.get("note"),
            max_uses: r.get("max_uses"),
            uses: r.get("uses"),
            created_at: r.get("created_at"),
            expires_at: r.get("expires_at"),
            revoked: r.get::<i64, _>("revoked") != 0,
        })
        .collect())
}

pub async fn revoke_invite(pool: &SqlitePool, code: &str) -> sqlx::Result<bool> {
    Ok(sqlx::query("UPDATE invites SET revoked = 1 WHERE code = ?1").bind(code).execute(pool).await?.rows_affected() > 0)
}

/// Uses one seat of an invite if it's live and (when tied to an email) for
/// this email. Returns whether it grants full access, or None if refused.
pub async fn claim_invite(pool: &SqlitePool, code: &str, email: &str) -> sqlx::Result<Option<bool>> {
    let res = sqlx::query(
        "UPDATE invites SET uses = uses + 1
         WHERE code = ?1 AND revoked = 0 AND uses < max_uses AND expires_at > ?2
           AND (email IS NULL OR lower(email) = lower(?3))",
    )
    .bind(code)
    .bind(now())
    .bind(email)
    .execute(pool)
    .await?;
    if res.rows_affected() != 1 {
        return Ok(None);
    }
    let full: i64 = sqlx::query_scalar("SELECT full_access FROM invites WHERE code = ?1").bind(code).fetch_one(pool).await?;
    Ok(Some(full != 0))
}

pub async fn set_full_access(pool: &SqlitePool, id: &str, full: bool) -> sqlx::Result<bool> {
    let res = sqlx::query("UPDATE players SET full_access = ?2 WHERE id = ?1 AND email IS NOT NULL").bind(id).bind(full).execute(pool).await?;
    Ok(res.rows_affected() == 1)
}

/// The state of a player's most recently played run, in any course.
pub async fn latest_run_state(pool: &SqlitePool, player_id: &str) -> sqlx::Result<Option<String>> {
    let row = sqlx::query("SELECT state FROM runs WHERE player_id = ?1 ORDER BY updated_at DESC LIMIT 1")
        .bind(player_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.get("state")))
}

/// Members for the admin panel, each with their latest run's state.
pub async fn members(pool: &SqlitePool) -> sqlx::Result<Vec<(Account, i64, i64, Option<String>, i64, i64)>> {
    let rows = sqlx::query(
        "SELECT p.id, p.email, p.display_name, p.role, p.full_access, p.created_at, p.last_seen, p.turns_day, p.turns_today,
                (SELECT state FROM runs r WHERE r.player_id = p.id ORDER BY updated_at DESC LIMIT 1) AS state,
                (SELECT COUNT(*) FROM runs r WHERE r.player_id = p.id) AS runs
         FROM players p WHERE p.email IS NOT NULL ORDER BY p.last_seen DESC",
    )
    .fetch_all(pool)
    .await?;
    let today = today();
    Ok(rows
        .iter()
        .map(|r| {
            let turns_today = if r.get::<String, _>("turns_day") == today { r.get::<i64, _>("turns_today") } else { 0 };
            (account(r), r.get("created_at"), r.get("last_seen"), r.get("state"), r.get("runs"), turns_today)
        })
        .collect())
}

/// Atomically counts one turn against the player's daily quota.
/// Returns false when the quota is already used up.
pub async fn take_turn_quota(pool: &SqlitePool, player_id: &str, limit: i64) -> sqlx::Result<bool> {
    let day = today();
    let res = sqlx::query(
        "UPDATE players
            SET turns_today = CASE WHEN turns_day = ?1 THEN turns_today + 1 ELSE 1 END,
                turns_day = ?1
          WHERE id = ?2 AND (turns_day <> ?1 OR turns_today < ?3)",
    )
    .bind(&day)
    .bind(player_id)
    .bind(limit)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

// ── runs ───────────────────────────────────────────────────────────────────

pub async fn insert_run(
    conn: &mut SqliteConnection,
    id: &str,
    player_id: &str,
    state: &RunState,
) -> anyhow::Result<()> {
    let ts = now();
    sqlx::query(
        "INSERT INTO runs (id, player_id, status, state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
    )
    .bind(id)
    .bind(player_id)
    .bind(state.status.as_str())
    .bind(serde_json::to_string(state)?)
    .bind(ts)
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn update_run(conn: &mut SqliteConnection, id: &str, state: &RunState) -> anyhow::Result<()> {
    sqlx::query("UPDATE runs SET status = ?2, state = ?3, updated_at = ?4 WHERE id = ?1")
        .bind(id)
        .bind(state.status.as_str())
        .bind(serde_json::to_string(state)?)
        .bind(now())
        .execute(conn)
        .await?;
    Ok(())
}


pub async fn get_run(pool: &SqlitePool, id: &str, player_id: &str) -> anyhow::Result<Option<RunState>> {
    let row = sqlx::query("SELECT state FROM runs WHERE id = ?1 AND player_id = ?2")
        .bind(id)
        .bind(player_id)
        .fetch_optional(pool)
        .await?;
    row.map(|r| Ok(serde_json::from_str(r.get::<&str, _>("state"))?)).transpose()
}

// ── lines ──────────────────────────────────────────────────────────────────

pub async fn insert_line(
    conn: &mut SqliteConnection,
    run_id: &str,
    chapter_idx: usize,
    beat: &Beat,
) -> anyhow::Result<i64> {
    let res = sqlx::query(
        "INSERT INTO lines (run_id, chapter_idx, beat, created_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(run_id)
    .bind(chapter_idx as i64)
    .bind(serde_json::to_string(beat)?)
    .bind(now())
    .execute(conn)
    .await?;
    Ok(res.last_insert_rowid())
}

pub async fn chapter_lines(
    pool: &SqlitePool,
    run_id: &str,
    chapter_idx: usize,
) -> anyhow::Result<Vec<(i64, Beat)>> {
    let rows = sqlx::query(
        "SELECT id, beat FROM lines WHERE run_id = ?1 AND chapter_idx = ?2 ORDER BY id",
    )
    .bind(run_id)
    .bind(chapter_idx as i64)
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|r| Ok((r.get("id"), serde_json::from_str(r.get::<&str, _>("beat"))?)))
        .collect()
}

/// A line and its run's course, only if it belongs to one of this player's runs.
pub async fn line_for_player(pool: &SqlitePool, line_id: i64, player_id: &str) -> anyhow::Result<Option<(Beat, String)>> {
    let row = sqlx::query(
        "SELECT l.beat, r.state FROM lines l JOIN runs r ON r.id = l.run_id
          WHERE l.id = ?1 AND r.player_id = ?2",
    )
    .bind(line_id)
    .bind(player_id)
    .fetch_optional(pool)
    .await?;
    row.map(|r| {
        let beat: Beat = serde_json::from_str(r.get::<&str, _>("beat"))?;
        let state: RunState = serde_json::from_str(r.get::<&str, _>("state"))?;
        Ok((beat, state.course))
    })
    .transpose()
}

/// The player's most recently played run in one course.
pub async fn latest_run_in_course(
    pool: &SqlitePool,
    player_id: &str,
    course: &str,
) -> anyhow::Result<Option<(String, RunState)>> {
    let rows = sqlx::query("SELECT id, state FROM runs WHERE player_id = ?1 ORDER BY updated_at DESC LIMIT 50")
        .bind(player_id)
        .fetch_all(pool)
        .await?;
    for r in rows {
        let state: RunState = serde_json::from_str(r.get::<&str, _>("state"))?;
        if state.course == course {
            return Ok(Some((r.get("id"), state)));
        }
    }
    Ok(None)
}

// ── phrasebook & journal ───────────────────────────────────────────────────

pub async fn insert_phrase(
    conn: &mut SqliteConnection,
    run_id: &str,
    chapter_idx: usize,
    p: &Phrase,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT OR IGNORE INTO phrases (run_id, jp, romaji, en, chapter_idx, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(run_id)
    .bind(&p.jp)
    .bind(&p.romaji)
    .bind(&p.en)
    .bind(chapter_idx as i64)
    .bind(now())
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn phrases(pool: &SqlitePool, run_id: &str) -> sqlx::Result<Vec<(usize, Phrase)>> {
    let rows = sqlx::query(
        "SELECT jp, romaji, en, chapter_idx FROM phrases WHERE run_id = ?1 ORDER BY created_at, jp",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let idx: i64 = r.get("chapter_idx");
            (idx as usize, Phrase { jp: r.get("jp"), romaji: r.get("romaji"), en: r.get("en") })
        })
        .collect())
}

pub async fn upsert_journal(
    conn: &mut SqliteConnection,
    run_id: &str,
    chapter_idx: usize,
    text: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO journal (run_id, chapter_idx, text, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (run_id, chapter_idx) DO UPDATE SET text = excluded.text",
    )
    .bind(run_id)
    .bind(chapter_idx as i64)
    .bind(text)
    .bind(now())
    .execute(conn)
    .await?;
    Ok(())
}

pub async fn journal(pool: &SqlitePool, run_id: &str) -> sqlx::Result<Vec<(usize, String)>> {
    let rows = sqlx::query("SELECT chapter_idx, text FROM journal WHERE run_id = ?1 ORDER BY chapter_idx")
        .bind(run_id)
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|r| (r.get::<i64, _>("chapter_idx") as usize, r.get("text")))
        .collect())
}

// ── translator glosses (shared cache) ──────────────────────────────────────

pub async fn gloss(pool: &SqlitePool, text_hash: &str) -> sqlx::Result<Option<String>> {
    let row = sqlx::query("SELECT gloss FROM glosses WHERE text_hash = ?1")
        .bind(text_hash)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.get("gloss")))
}

pub async fn put_gloss(pool: &SqlitePool, text_hash: &str, gloss: &str) -> sqlx::Result<()> {
    sqlx::query("INSERT OR IGNORE INTO glosses (text_hash, gloss, created_at) VALUES (?1, ?2, ?3)")
        .bind(text_hash)
        .bind(gloss)
        .bind(now())
        .execute(pool)
        .await?;
    Ok(())
}

/// A line, only if it belongs to this run.
pub async fn line_in_run(pool: &SqlitePool, line_id: i64, run_id: &str) -> anyhow::Result<Option<Beat>> {
    let row = sqlx::query("SELECT beat FROM lines WHERE id = ?1 AND run_id = ?2")
        .bind(line_id)
        .bind(run_id)
        .fetch_optional(pool)
        .await?;
    row.map(|r| Ok(serde_json::from_str(r.get::<&str, _>("beat"))?)).transpose()
}

/// The last `limit` beats of a run across all visits, oldest first, so the
/// director remembers what happened in the previous place.
pub async fn recent_lines(pool: &SqlitePool, run_id: &str, limit: usize) -> anyhow::Result<Vec<Beat>> {
    let rows = sqlx::query("SELECT beat FROM lines WHERE run_id = ?1 ORDER BY id DESC LIMIT ?2")
        .bind(run_id)
        .bind(limit as i64)
        .fetch_all(pool)
        .await?;
    let mut beats: Vec<Beat> = rows
        .into_iter()
        .map(|r| serde_json::from_str(r.get::<&str, _>("beat")))
        .collect::<Result<_, _>>()?;
    beats.reverse();
    Ok(beats)
}

// ── scene scores ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SceneScoreRow {
    pub id: i64,
    pub run_id: String,
    pub place_id: String,
    pub rank: String,
    pub score: i64,
    pub turns_used: i64,
    pub created_at: i64,
}

pub async fn insert_scene_score(
    conn: &mut SqliteConnection,
    run_id: &str,
    place_id: &str,
    rank: &str,
    score: i64,
    turns_used: i64,
) -> sqlx::Result<i64> {
    let ts = now();
    let res = sqlx::query(
        "INSERT INTO scene_scores (run_id, place_id, rank, score, turns_used, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(run_id)
    .bind(place_id)
    .bind(rank)
    .bind(score)
    .bind(turns_used)
    .bind(ts)
    .execute(conn)
    .await?;
    Ok(res.last_insert_rowid())
}

pub async fn scene_scores(pool: &SqlitePool, run_id: &str) -> sqlx::Result<Vec<SceneScoreRow>> {
    let rows = sqlx::query(
        "SELECT id, run_id, place_id, rank, score, turns_used, created_at
           FROM scene_scores WHERE run_id = ?1 ORDER BY id",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SceneScoreRow {
            id: r.get("id"),
            run_id: r.get("run_id"),
            place_id: r.get("place_id"),
            rank: r.get("rank"),
            score: r.get("score"),
            turns_used: r.get("turns_used"),
            created_at: r.get("created_at"),
        })
        .collect())
}

