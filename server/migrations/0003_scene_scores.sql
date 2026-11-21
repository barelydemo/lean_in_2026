-- Completed scene scorecards and rewards per playthrough.
CREATE TABLE scene_scores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    place_id    TEXT NOT NULL,
    rank        TEXT NOT NULL,
    score       INTEGER NOT NULL,
    turns_used  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX scene_scores_run ON scene_scores(run_id, created_at);
