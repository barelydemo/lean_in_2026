-- Word-by-word glosses from the translator device, shared across runs:
-- the same line is only ever glossed once.
CREATE TABLE glosses (
    text_hash   TEXT PRIMARY KEY,
    gloss       TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);
