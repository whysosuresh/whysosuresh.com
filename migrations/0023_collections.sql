-- Collections (src/collections.ts, src/collections-store.ts): the threads worth keeping, grouped by him into named
-- sets he orders, finds again and pins. Applied by the deploy before the code that writes it; until then the old code
-- reads none of it.
--
-- A collection is named by a number people can say out loud, as a thread and a person are, and by its name, which is
-- unique ignoring case (ASCII, as SQLite's lower() folds it), so "Every screen" names one collection on his page, on
-- the command line and in his words to the sync. Its number is the table's AUTOINCREMENT key, so a deleted
-- collection's number is never given to another: a link or a history line naming it never opens a different set.
-- `rule_prefix`, when set, keeps every new thread whose title begins with it (ignoring case) in the collection at the
-- moment the thread is made, in the batch that makes it; nothing else reads it. `pinned_at` puts a collection on his
-- menu, in pinning order. `changed_at` is when it or its threads last changed, which orders the rest: reads write
-- nothing on this site, so "recently used" is "recently changed".
--
-- A thread may sit in several collections, and keeping it changes nothing about the thread itself: its status, its
-- last activity and who may read it stay as they were. `position` is its place in his order, dense from 0 within a
-- collection: every write that changes the order shifts the rows between two places in the same batch, and the place
-- asked for is computed from the rows themselves, so two writers racing can't leave a gap or a tie. There is no
-- unique index on the place, because a shifting UPDATE passes through ties row by row. A collection is deleted with
-- its rows here, never its threads; a thread is never deleted, so its key here never blocks anything.
CREATE TABLE collections (
  number INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  rule_prefix TEXT,
  pinned_at TEXT,
  changed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX collections_name ON collections (lower(name));

CREATE TABLE collection_threads (
  collection_number INTEGER NOT NULL REFERENCES collections (number),
  thread_id TEXT NOT NULL REFERENCES threads (id),
  position INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_number, thread_id)
);

CREATE INDEX collection_threads_order ON collection_threads (collection_number, position);

CREATE INDEX collection_threads_thread ON collection_threads (thread_id);
