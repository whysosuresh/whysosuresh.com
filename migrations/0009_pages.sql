-- A thread's main section is one of three (src/store.ts): its text (`body`, Markdown, which every thread keeps and
-- the command line, GitHub and email read), a page (a Claude artifact's own HTML, saved into the thread, every
-- version kept), or a link (to an artifact that only works on claude.ai). `main` says which the thread shows, and
-- is whatever was attached last: saving a page sets `page`, setting a link sets `link`, and clearing a link goes
-- back to `page` when the thread has one, else to `text`. It is stored rather than inferred, so a thread first
-- saved as a page can later show a link, and its history says so. Applied by the deploy before the code that writes
-- it; until then the old code reads none of it.

ALTER TABLE threads ADD COLUMN main TEXT NOT NULL DEFAULT 'text';
ALTER TABLE threads ADD COLUMN link_url TEXT;
ALTER TABLE threads ADD COLUMN link_title TEXT;

-- One row per saved version of a thread's page. The page itself is an object in the private R2 bucket
-- `whysosuresh-com-pages`, named by `object_key` (a fresh id, never reused or overwritten), written before its row,
-- and deleted again when its row isn't kept. `version` counts from 1 per thread, given inside the INSERT; the key
-- turns two saves racing for one version into an error rather than two version 2s. `actor` is who saved it,
-- `bytes` its size as stored, `source_url` the claude.ai address it was read from, when given.
CREATE TABLE pages (
  thread_id TEXT NOT NULL REFERENCES threads (id),
  version INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  source_url TEXT,
  PRIMARY KEY (thread_id, version)
);
