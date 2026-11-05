-- Threads: every thing in the inbox becomes a numbered thread with a history (src/store.ts). `threads` holds what
-- `inbox` held, under clearer names, plus a `number` people can say out loud (#42) and a `summary` the sync keeps
-- current. `comments` are words added to a thread; `events` are its history, one row per thing that happened to
-- it, in the order it happened. Value lists that grow (`source`, `space`, `status`, `kind`, `author`, `actor`,
-- `type`) carry no CHECK, because SQLite can't alter one without rebuilding the table; the code that writes them
-- validates them. Applied by the deploy job before the code that writes it.
--
-- `inbox` is copied here and stays, because the code running between this migration and the deploy still writes
-- it; a later migration copies what that gap missed and drops it, once no deployed code reads it.

-- A thread. `id` keeps an inbox row's id, so a page left open across the deploy still moves the same rows and
-- pages by the same cursor. `number` is given by the insert itself, one more than the largest, and never reused,
-- because nothing deletes a thread. `body` is the thread's main text: Markdown for a thread the sync wrote, a
-- visitor's own words for a site note. `title` is null for a site note. `space` is what it is about (the note
-- flow's topics, and more). `origin_ref` is where an added thread came from, unique where present.
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  space TEXT,
  title TEXT,
  body TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL,
  kind TEXT,
  sender_name TEXT,
  sender_email TEXT,
  drop_reason TEXT,
  reply_opened_at TEXT,
  origin_ref TEXT,
  filed_link TEXT,
  moved_at TEXT
);
CREATE UNIQUE INDEX threads_origin_ref ON threads (origin_ref) WHERE origin_ref IS NOT NULL;

-- Words added to a thread, by the owner or the sync. A comment is its own entry in the history, so it writes no
-- event.
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads (id),
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX comments_thread ON comments (thread_id, created_at);

-- What happened to a thread: created, moved, its space changed, the owner's reply opened, imported, a text
-- edited (with the text it replaced). The integer key is the order things happened in, with no ties. `data` is
-- a JSON object.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads (id),
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX events_thread ON events (thread_id, id);

-- The copy: every inbox row, the oldest numbered 1. Threads first, then their events, because D1 checks foreign
-- keys inside a migration too.
INSERT INTO threads (id, number, created_at, source, space, title, body, summary, status, kind, sender_name, sender_email, drop_reason, reply_opened_at, origin_ref, filed_link, moved_at)
SELECT id, ROW_NUMBER() OVER (ORDER BY received_at, id), received_at, source, topic, title, body, NULL, status, kind, name, email, drop_reason, reply_opened_at, ref, filed_link, moved_at
FROM inbox;

-- Each copied thread's history begins with when it arrived and who brought it. The status it started in was
-- never kept, so the event doesn't claim one.
INSERT INTO events (thread_id, at, actor, type, data)
SELECT id, created_at, CASE WHEN source = 'talk' THEN 'visitor' ELSE 'sync' END, 'created', json_object('source', source)
FROM threads ORDER BY number;

-- Then where it stood when it was copied, at the migration's own time, in the shape the code writes times in.
-- Every move before this one left no trace, and this says so.
INSERT INTO events (thread_id, at, actor, type, data)
SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'import', 'imported', json_object('status', status)
FROM threads ORDER BY number;
