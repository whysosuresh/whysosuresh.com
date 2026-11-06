-- Visitors' answers on a public thread, and visitors' words shown at once (src/store.ts, src/public.ts). Anyone with a
-- public thread's link may answer its page's questions with no sign-in: an answer is a comment by `visitor`, for
-- anyone (`public`), with `question` set and the name they typed. `visitor_key` is the hex SHA-256 of a random key the
-- visitor's browser made once and sends with each answer, so answering again from that browser is a new answer that
-- shows in place of its last one, and nobody else can replace it; only the hash is kept, so the column can't be used
-- to answer as anyone. It is null for every other comment. The partial index serves the newest answer per question
-- and key, and whether a key has answered a question.
--
-- A visitor's words no longer wait for his OK: they are shown at once and he drops them after the fact. Every note
-- still waiting is shown, so the code can hold the two states left, `shown` and `dropped` (none were waiting when
-- this was written). Answers have their own daily budget beside the notes' (`talk_senders`, migrations/0001_talk.sql),
-- counted the same way under the same day's salt (`talk_days`): `sender` is the hex SHA-256 of that salt and the
-- network, and the day's total is the sum of `sends`. Applied by the deploy before the code that writes it; until
-- then the old code reads none of it.

ALTER TABLE comments ADD COLUMN visitor_key TEXT;
CREATE INDEX comments_visitor ON comments (thread_id, question, visitor_key) WHERE visitor_key IS NOT NULL;
UPDATE comments SET state = 'shown' WHERE state = 'pending';
CREATE TABLE answer_senders (
  day TEXT NOT NULL,
  sender TEXT NOT NULL,
  sends INTEGER NOT NULL,
  PRIMARY KEY (day, sender)
);
