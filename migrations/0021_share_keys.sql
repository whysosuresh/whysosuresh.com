-- A public thread's link (src/public.ts, src/pages.ts): strangers read a public thread at /threads/<share_key>, a
-- random key, so counting numbers no longer opens every thread Suresh made public. Applied by the deploy before the
-- code that writes it; the old code reads neither column.
--
-- `share_key` is 16 random bytes as 32 lowercase hex characters, given by the `publish` move the first time a thread
-- is made public and kept for good, so turning Public off and on again brings the same link back (src/store.ts,
-- `newShareKey`). It is never in an event's data, so the history never carries it. The partial unique index finds a
-- thread by its key in one indexed read and refuses two threads one key, as `threads_ask_slug` does for asks (0016).
--
-- `public_by_number` is 1 only for a thread that was public when this migration ran: links to its number were sent
-- before keys existed, so its number still opens it for strangers, until he turns Public off (`unpublish` clears it,
-- and publishing again opens it by its key alone). A thread made public from now on is 0: its number opens it only
-- for him and the people he invited.
--
-- Every thread public now gets its key here, from SQLite's randomblob, so every public thread has a link the moment
-- the new code serves them; a thread public once and taken back gets nothing until its next publish.
ALTER TABLE threads ADD COLUMN share_key TEXT;
ALTER TABLE threads ADD COLUMN public_by_number INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX threads_share_key ON threads (share_key) WHERE share_key IS NOT NULL;

UPDATE threads SET share_key = lower(hex(randomblob(16))), public_by_number = 1
WHERE public_at IS NOT NULL AND source = 'self';
