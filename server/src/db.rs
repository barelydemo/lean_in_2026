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

