-- Beta testers play the demo; full access (admins always) unlocks the rest.
ALTER TABLE players ADD COLUMN full_access INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invites ADD COLUMN full_access INTEGER NOT NULL DEFAULT 0;
