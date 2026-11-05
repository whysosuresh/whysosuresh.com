-- Retires the inbox's table. 0006 copied every row into `threads`, but the deploy applies migrations before it
-- deploys the code, so the code running in between still wrote `inbox`: a note that arrived or a move made in
-- those seconds is in `inbox` alone. The code deployed with 0006 never reads `inbox`, so this runs a deploy later:
-- it copies what that gap missed, replays a move made in it, then drops the table, and a failed deploy still
-- leaves a working site. Written with correlated subqueries rather than UPDATE ... FROM, which D1's docs don't
-- list.

-- A row the gap added, copied as 0006 copied the rest: numbered after the last thread, the oldest first. A row
-- whose ref a thread already holds is left out, so a ref is never kept twice.
INSERT INTO threads (id, number, created_at, source, space, title, body, summary, status, kind, sender_name, sender_email, drop_reason, reply_opened_at, origin_ref, filed_link, moved_at)
SELECT id, (SELECT COALESCE(MAX(number), 0) FROM threads) + ROW_NUMBER() OVER (ORDER BY received_at, id), received_at, source, topic, title, body, NULL, status, kind, name, email, drop_reason, reply_opened_at, ref, filed_link, moved_at
FROM inbox
WHERE id NOT IN (SELECT id FROM threads)
  AND (ref IS NULL OR ref NOT IN (SELECT origin_ref FROM threads WHERE origin_ref IS NOT NULL));

-- Each of those threads' history, as 0006 began the others': when it arrived and who brought it, then where it
-- stood when copied. A thread copied from the inbox that has no history yet is one this migration just copied.
INSERT INTO events (thread_id, at, actor, type, data)
SELECT id, created_at, CASE WHEN source = 'talk' THEN 'visitor' ELSE 'sync' END, 'created', json_object('source', source)
FROM threads
WHERE id IN (SELECT id FROM inbox) AND NOT EXISTS (SELECT 1 FROM events WHERE events.thread_id = threads.id)
ORDER BY number;

INSERT INTO events (thread_id, at, actor, type, data)
SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'import', 'imported', json_object('status', status)
FROM threads
WHERE id IN (SELECT id FROM inbox) AND NOT EXISTS (SELECT 1 FROM events WHERE events.thread_id = threads.id AND events.type = 'imported')
ORDER BY number;

-- A move the gap made: the inbox's row moved later than its thread did, so the inbox's state wins, and an
-- `imported` event says where it now stands. A thread moved later than its inbox row keeps its own state, so a
-- move made on the new code is never undone. The event goes first, while the condition still holds.
INSERT INTO events (thread_id, at, actor, type, data)
SELECT threads.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'import', 'imported',
       json_object('status', (SELECT inbox.status FROM inbox WHERE inbox.id = threads.id))
FROM threads
WHERE id IN (
  SELECT inbox.id FROM inbox JOIN threads AS later ON later.id = inbox.id
  WHERE inbox.moved_at IS NOT NULL AND (later.moved_at IS NULL OR inbox.moved_at > later.moved_at)
)
ORDER BY number;

UPDATE threads SET
  status = (SELECT inbox.status FROM inbox WHERE inbox.id = threads.id),
  kind = (SELECT inbox.kind FROM inbox WHERE inbox.id = threads.id),
  space = (SELECT inbox.topic FROM inbox WHERE inbox.id = threads.id),
  drop_reason = (SELECT inbox.drop_reason FROM inbox WHERE inbox.id = threads.id),
  reply_opened_at = (SELECT inbox.reply_opened_at FROM inbox WHERE inbox.id = threads.id),
  filed_link = (SELECT inbox.filed_link FROM inbox WHERE inbox.id = threads.id),
  moved_at = (SELECT inbox.moved_at FROM inbox WHERE inbox.id = threads.id)
WHERE id IN (
  SELECT inbox.id FROM inbox JOIN threads AS later ON later.id = inbox.id
  WHERE inbox.moved_at IS NOT NULL AND (later.moved_at IS NULL OR inbox.moved_at > later.moved_at)
);

DROP TABLE inbox;
