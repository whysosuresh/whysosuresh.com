-- People: everyone Suresh deals with, not only the people he invites (src/store.ts, src/people.ts). Until now a
-- person was a row only once he invited them, keyed by the address they sign in with; a visitor who wrote from the
-- site or on a public thread, and someone who told him something in person, were a name (and maybe an address) on
-- one thread or comment, with nothing joining two of them. From here every one of them is a `people` row with a
-- `number` (a person's page is /threads/people/<number>, as a thread's is /threads/<number>), and `note` holds his
-- own notes on them, which only he reads.
--
-- Someone told about in person has no address, so `email` becomes optional. SQLite can't drop a NOT NULL without
-- rebuilding the table, so `people` is rebuilt here, in place and under its own name: copied aside, dropped,
-- created anew with every column it had plus `number` and `note`, and its rows put back with their ids. A migration
-- is one transaction (wrangler sends a file and its bookkeeping as one query; D1 runs every query in one), so no
-- deployed code ever sees the table missing. `members` and `comments` name people by id; dropping `people` counts
-- each of their rows as a foreign-key violation, and putting a row back with the same id under the same table name
-- clears it, so the foreign keys are deferred to the end of the migration, whose commit fails if any child were left
-- without a parent, and nothing of it is kept. The deferral ends with the commit and is never turned off by hand:
-- `PRAGMA defer_foreign_keys = off` forgets the violations counted so far, so a child left without a parent would
-- be committed (tested in test/migrations.test.ts). Nothing is renamed. `email` stays UNIQUE: SQLite counts every NULL as distinct, so many people
-- may have no address, and an invitation's `ON CONFLICT (email)` still lands on a person who wrote from the site.
--
-- Who a site note or a told thread is from is `threads.person_id`. `comments.person_id`, which named the invited
-- person who wrote a comment, now names a visitor who wrote a note on a public thread too; the name shown for a
-- comment is read through it only for an invited person's, so a visitor's note always shows the name they typed.
--
-- The backfill: every address on a site note or a visitor's note that no person holds becomes a person (matched
-- lowercased, named by the newest name typed with it), every distinct told name (trimmed, ignoring case) becomes one
-- person, and each such thread and note is linked to its person. A note with no address links to nobody: there is
-- nothing to match on. People are numbered from 1 by when they first appeared, as 0006 numbered threads.
--
-- The code before this one writes `people` in one place, an invitation, which names no `number`, so an invitation
-- made in the seconds between this migration and the deploy is refused; nothing else it runs writes the table.

PRAGMA defer_foreign_keys = on;

CREATE TABLE people_before AS SELECT id, email, name, created_at FROM people;

DROP TABLE people;

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  email TEXT UNIQUE,
  name TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

-- A new person's id is a version 4 UUID, the shape the code gives one, because the owner's page names a person by
-- it when taking an invitation back.
INSERT INTO people (id, number, email, name, note, created_at)
WITH said AS (
  SELECT lower(trim(sender_email)) AS email, NULLIF(trim(sender_name), '') AS name, created_at AS at
  FROM threads WHERE source = 'talk' AND trim(COALESCE(sender_email, '')) <> ''
  UNION ALL
  SELECT lower(trim(sender_email)), NULLIF(trim(sender_name), ''), created_at
  FROM comments WHERE author = 'visitor' AND trim(COALESCE(sender_email, '')) <> ''
),
addressed AS (
  SELECT email, MIN(at) AS created_at,
    (SELECT named.name FROM said AS named WHERE named.email = said.email AND named.name IS NOT NULL ORDER BY named.at DESC LIMIT 1) AS name
  FROM said WHERE email NOT IN (SELECT email FROM people_before) GROUP BY email
),
told AS (
  SELECT MIN(created_at) AS created_at,
    (SELECT trim(newest.sender_name) FROM threads AS newest
     WHERE newest.source = 'told' AND lower(trim(newest.sender_name)) = lower(trim(threads.sender_name))
     ORDER BY newest.created_at DESC LIMIT 1) AS name
  FROM threads WHERE source = 'told' AND trim(COALESCE(sender_name, '')) <> '' GROUP BY lower(trim(sender_name))
),
fresh AS (
  SELECT email, name, created_at FROM addressed
  UNION ALL
  SELECT NULL, name, created_at FROM told
),
everyone AS (
  SELECT id, email, name, created_at FROM people_before
  UNION ALL
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
      || substr('89ab', 1 + abs(random() % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
    email, name, created_at
  FROM fresh
)
SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id), email, name, NULL, created_at FROM everyone;

DROP TABLE people_before;

ALTER TABLE threads ADD COLUMN person_id TEXT REFERENCES people (id);

UPDATE threads SET person_id = (SELECT people.id FROM people WHERE people.email = lower(trim(threads.sender_email)))
WHERE source = 'talk' AND trim(COALESCE(sender_email, '')) <> '';

UPDATE threads SET person_id = (
  SELECT people.id FROM people WHERE people.email IS NULL AND lower(trim(people.name)) = lower(trim(threads.sender_name))
)
WHERE source = 'told' AND trim(COALESCE(sender_name, '')) <> '';

UPDATE comments SET person_id = (SELECT people.id FROM people WHERE people.email = lower(trim(comments.sender_email)))
WHERE author = 'visitor' AND trim(COALESCE(sender_email, '')) <> '';

CREATE INDEX threads_person ON threads (person_id);
CREATE INDEX comments_person ON comments (person_id);
