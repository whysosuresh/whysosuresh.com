-- Public threads, and the notes visitors send on them (src/store.ts, src/public.ts). `public_at` is when Suresh made
-- a thread public, null while it isn't; only his own threads (`source` `self`) may be, a rule the move and every
-- public query hold. Invited stays derived from the people on a thread, so the levels a page shows are Public when
-- this is set, else Invited when the thread has people, else Private.
--
-- A comment gains a `state`: `shown`, `pending` (a visitor's note waiting for his OK) or `dropped` (kept and never
-- shown, because nothing deletes words). Every comment written before this one was shown. `audience` (no CHECK, as
-- 0006 explains) gains `public`, and `author` gains `visitor` for a note sent on a public thread, which keeps the
-- name and email the visitor typed, as `threads` keeps a site note's. Its email is never shown to anyone but him.
-- No index: the owner's count of waiting notes reads one thread's comments through `comments_thread`. Applied by
-- the deploy before the code that writes it; until then the old code reads none of it.

ALTER TABLE threads ADD COLUMN public_at TEXT;
ALTER TABLE comments ADD COLUMN state TEXT NOT NULL DEFAULT 'shown';
ALTER TABLE comments ADD COLUMN sender_name TEXT;
ALTER TABLE comments ADD COLUMN sender_email TEXT;
