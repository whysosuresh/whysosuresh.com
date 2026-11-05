-- The people a thread is shared with (src/store.ts). `people` is one row per email address, so a person invited
-- to two threads is one person; the address is kept lowercased, and the name is the one Suresh typed when he last
-- invited them. `members` says who is in which thread: a row per thread and person, `removed_at` null while the
-- invitation stands and set when it is taken back; inviting them again clears it, and the thread's history keeps
-- both (`invited` and `removed` events, which name the person by id and name, never by address, because invited
-- people read a thread's history). The partial index serves the one question every invited caller's request asks:
-- does this address have an invitation that stands, to any thread. Applied by the deploy before the code that
-- writes it; until then the old code reads none of it.

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE members (
  thread_id TEXT NOT NULL REFERENCES threads (id),
  person_id TEXT NOT NULL REFERENCES people (id),
  added_at TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY (thread_id, person_id)
);
CREATE INDEX members_person_standing ON members (person_id) WHERE removed_at IS NULL;

-- Who may read a comment: `thread` (everyone in the thread) or `owner` (Suresh and the sync only, his "Only me").
-- Every comment written before this one was the owner's or the sync's, written while no one else could read it,
-- and is shown to people he invites from now on, as he chose (Share says how many). `person_id` names the invited
-- person who wrote a comment (`author` then reads `member`); it is null for the owner's and the sync's.
ALTER TABLE comments ADD COLUMN audience TEXT NOT NULL DEFAULT 'thread';
ALTER TABLE comments ADD COLUMN person_id TEXT REFERENCES people (id);
