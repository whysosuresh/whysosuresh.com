-- Asks (src/store.ts, src/asks.ts). An ask is one of Suresh's own threads whose main section is a questions page,
-- handed to many people by one link, /ask/<slug>: `ask_slug` names it there, lowercase letters, digits and hyphens,
-- at most 40, never changed once given; `ask_state` is `draft` (made, not yet before anyone), `open` (taking answers)
-- or `closed` (read, taking none), checked in the code as 0006 keeps every value check, because SQLite can't alter a
-- CHECK. When it was opened and closed are its events (`ask-opened`, `ask-closed`), as a meeting's changes are, not
-- columns. They sit on the thread, as a meeting does (0014), because an ask is a thread.
--
-- Each browser that answers an ask gets a thread of its own, a site note (`source` `talk`, so it is never public and
-- its words are never rewritten), with `ask_thread_id` naming the ask's thread; it is null on every other thread. The
-- reference is to `threads` itself, which SQLite checks when each statement ends, so one DELETE can remove an ask's
-- thread with the threads that answer it. The partial indexes serve a slug's one read and an ask's answers.
--
-- Asks have their own daily budgets beside the notes' and the answers' (src/quota.ts), counted the same way under the
-- same day's salt (`talk_days`): `ask_thread_senders` counts the answers that make a browser's thread, and
-- `ask_answer_senders` every answer to an ask. Applied by the deploy before the code that writes it; until then the old
-- code reads none of it.

ALTER TABLE threads ADD COLUMN ask_slug TEXT;
ALTER TABLE threads ADD COLUMN ask_state TEXT;
ALTER TABLE threads ADD COLUMN ask_thread_id TEXT REFERENCES threads (id);
CREATE UNIQUE INDEX threads_ask_slug ON threads (ask_slug) WHERE ask_slug IS NOT NULL;
CREATE INDEX threads_ask_thread ON threads (ask_thread_id) WHERE ask_thread_id IS NOT NULL;
CREATE TABLE ask_thread_senders (
  day TEXT NOT NULL,
  sender TEXT NOT NULL,
  sends INTEGER NOT NULL,
  PRIMARY KEY (day, sender)
);
CREATE TABLE ask_answer_senders (
  day TEXT NOT NULL,
  sender TEXT NOT NULL,
  sends INTEGER NOT NULL,
  PRIMARY KEY (day, sender)
);
