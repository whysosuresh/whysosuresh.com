-- Suresh's journal (src/journal.ts, src/journal-store.ts), his alone: the owner and the sync read it, and nobody else
-- ever does. An entry is the whole page text of a day (`2026-11-06`) or a week's chapter (`2026-W44`), in the sync's
-- page grammar (site/app/journal.js), under that key. Applied by the deploy before the code that writes it; until then
-- the old code reads none of it.
--
-- Every saved text is a version, kept for good: `journal_versions` is never updated and never deleted, as a page's
-- versions aren't (0009). `version` counts from 1 per key, given inside the INSERT, which writes only when the save
-- names the newest version as the one it was built on, so a save built on an older text writes nothing (409 `stale`)
-- and never overwrites a hand edit. `save_id` is a fresh id per save, which the same batch's later statements find
-- the new row by, so they do nothing when the insert wrote nothing. `actor` is who saved it, `bytes` its UTF-8 size.
CREATE TABLE journal_versions (
  key TEXT NOT NULL,
  version INTEGER NOT NULL,
  save_id TEXT NOT NULL UNIQUE,
  text TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  PRIMARY KEY (key, version)
);

-- The newest version of each entry, as the list and Today read it without parsing: rewritten in the same batch as
-- each save, from what the reader made of the text. `kind` is `day` or `week`; `stories` and `photos` are counts;
-- `question` is the day's question for the next morning, null when it has none. Derived, never the source.
CREATE TABLE journal_entries (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  saved_at TEXT NOT NULL,
  title TEXT NOT NULL,
  one_line TEXT,
  stories INTEGER NOT NULL,
  photos INTEGER NOT NULL,
  question TEXT
);

-- One row per storyline line of a day's newest version, replaced with each save of that day, so the storylines page
-- reads every trail at once. A week's margin repeats its days' storylines, so a week has none here. `mark` is `new`,
-- `closed` or null. Derived, never the source.
CREATE TABLE journal_storylines (
  key TEXT NOT NULL REFERENCES journal_entries (key),
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  mark TEXT,
  PRIMARY KEY (key, name)
);
CREATE INDEX journal_storylines_name ON journal_storylines (name);

-- A photo the sync uploaded for a page, which names it `photo:<id>`. The image is an object in the private pages
-- bucket under `journal/<id>.<jpg|png>`, written before its row and deleted again when the row isn't kept; never
-- overwritten, never deleted once kept. `type` is `image/jpeg` or `image/png`, as its first bytes prove.
CREATE TABLE journal_photos (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- His typed answers to a day's question, when the recorder isn't to hand. Every one is kept; the newest (the largest
-- id: one more than the largest, and none is ever deleted) is the answer, and an empty one takes the answer back (the page's Undo).
CREATE TABLE journal_answers (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL REFERENCES journal_entries (key),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX journal_answers_key ON journal_answers (key, id);
