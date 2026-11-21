CREATE TABLE players (
    id           TEXT PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL,
    turns_day    TEXT NOT NULL DEFAULT '',
    turns_today  INTEGER NOT NULL DEFAULT 0
);

-- One playthrough. Game state is a JSON document owned by the server.
CREATE TABLE runs (
    id          TEXT PRIMARY KEY,
    player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    status      TEXT NOT NULL,
    state       TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX runs_player_updated ON runs(player_id, updated_at DESC);

-- Every beat shown to the player, in order (the backlog).
CREATE TABLE lines (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    chapter_idx  INTEGER NOT NULL,
    beat         TEXT NOT NULL,
    created_at   INTEGER NOT NULL
);
CREATE INDEX lines_run_chapter ON lines(run_id, chapter_idx, id);

CREATE TABLE phrases (
    run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    jp           TEXT NOT NULL,
    romaji       TEXT NOT NULL,
    en           TEXT NOT NULL,
    chapter_idx  INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (run_id, jp)
);

CREATE TABLE journal (
    run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    chapter_idx  INTEGER NOT NULL,
    text         TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (run_id, chapter_idx)
);
