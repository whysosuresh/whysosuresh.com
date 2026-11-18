-- Distribution (src/distribution.ts, src/distribution-store.ts): where telling people about Stigmer and CapsJump
-- stands, written by the recorder sync's runs and read by him and the sync. Applied by the deploy before the code that
-- writes it; until then the old code reads none of it.
--
-- `distribution_acts` is one row per thing that happened: a post, a reply, a comment, a follow, a briefing or a
-- handoff of ours; someone writing to us (`in`); an `in` we chose not to answer (`left`); a place offered and dropped,
-- never offered again (`skipped`); or an `event` (a ban, a listing accepted, a platform's state changing). Each is
-- named by its origin (`ref`, unique), so a run written again adds nothing. `product` is one of the two spaces with a
-- distribution; `platform` is a slug, so a new network needs no migration; `kind` is a fixed set because what the page
-- works out reads it. `audience` is who it was with, `team` being the people every count leaves out. `conversation`
-- is the address of the post a thread of replies hangs from, which ties someone's `in` to our answer. `person_id`
-- names the person it was with, when one is known. An act is never rewritten: a wrong one is voided (`voided_at`, the
-- one column ever written after the insert), and every read and count holds `voided_at IS NULL`.
CREATE TABLE distribution_acts (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  at TEXT NOT NULL,
  product TEXT NOT NULL CHECK (product IN ('stigmer', 'capsjump')),
  platform TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('post', 'reply', 'comment', 'follow', 'briefing', 'handoff', 'in', 'left', 'skipped', 'event')),
  audience TEXT CHECK (audience IN ('buyer', 'peer', 'community', 'team')),
  url TEXT,
  conversation TEXT,
  person_id TEXT REFERENCES people (id),
  line TEXT NOT NULL,
  created_at TEXT NOT NULL,
  voided_at TEXT
);

CREATE INDEX distribution_acts_when ON distribution_acts (product, at);

CREATE INDEX distribution_acts_person ON distribution_acts (person_id);

-- A product's platform as it stands now: active, warming up, on hold or for later, a one-line note why, a day to look
-- again (`until`), and the pace of acts of ours a week it is kept to. A write replaces the row and writes an `event`
-- act in the same batch, so the state's history is in the log.
CREATE TABLE distribution_platforms (
  product TEXT NOT NULL CHECK (product IN ('stigmer', 'capsjump')),
  platform TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'warming', 'hold', 'later')),
  note TEXT,
  until TEXT,
  pace_per_week INTEGER CHECK (pace_per_week BETWEEN 1 AND 14),
  changed_at TEXT NOT NULL,
  PRIMARY KEY (product, platform)
);

-- The weekly numbers: one value per product, metric and ISO week (`2026-W47`), which a second reading that week
-- replaces, because a week's number is a reading, not a log.
CREATE TABLE distribution_readings (
  product TEXT NOT NULL CHECK (product IN ('stigmer', 'capsjump')),
  metric TEXT NOT NULL,
  week TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value >= 0),
  read_at TEXT NOT NULL,
  PRIMARY KEY (product, metric, week)
);
