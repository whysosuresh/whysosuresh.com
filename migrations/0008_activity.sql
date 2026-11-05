-- A thread's last activity: when anything last happened to it (it arrived, it moved, a text was edited, a comment
-- was added), which the threads page shows as "updated 2 h" and reads for Today's "sat a week". The store sets it
-- in the same batch as every write (src/store.ts), rather than deriving it on read, because a write answers
-- from RETURNING, where SQLite leaves a subquery on the table being changed unspecified. Applied by the deploy
-- before the code that writes it; a thread the old code creates in between has none, and the store answers its
-- arrival time instead (`COALESCE(activity_at, created_at)`).

ALTER TABLE threads ADD COLUMN activity_at TEXT;

-- Filled from each thread's own history: its arrival, its newest event and its newest comment. Every time here is
-- ISO 8601 in UTC with milliseconds, so the latest is the largest string. The `imported` events are left out:
-- they record the day the inbox became threads, which happened to every thread at once and says nothing about any.
UPDATE threads SET activity_at = MAX(
  created_at,
  COALESCE((SELECT MAX(at) FROM events WHERE events.thread_id = threads.id AND events.type <> 'imported'), ''),
  COALESCE((SELECT MAX(created_at) FROM comments WHERE comments.thread_id = threads.id), '')
);
