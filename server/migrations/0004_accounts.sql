-- Accounts on top of guest players: an email and password make a player a
-- member; a guest who signs up keeps their runs.
ALTER TABLE players ADD COLUMN email TEXT;
ALTER TABLE players ADD COLUMN password_hash TEXT;
ALTER TABLE players ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE players ADD COLUMN role TEXT NOT NULL DEFAULT 'player';
ALTER TABLE players ADD COLUMN invite_code TEXT;
ALTER TABLE players ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX players_email ON players(email) WHERE email IS NOT NULL;

-- One per signed-in device. Only a hash of the token is stored.
CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,
    player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_player ON sessions(player_id);

-- Beta invites, made by admins and shared as links.
CREATE TABLE invites (
    code        TEXT PRIMARY KEY,
    email       TEXT,
    note        TEXT NOT NULL DEFAULT '',
    max_uses    INTEGER NOT NULL DEFAULT 1,
    uses        INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT NOT NULL REFERENCES players(id),
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    revoked     INTEGER NOT NULL DEFAULT 0
);
