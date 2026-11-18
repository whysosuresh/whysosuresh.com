-- The people a collection is shared with (src/collections.ts, src/store.ts): an invitation to a collection opens every
-- thread in it to that person, the threads added later included, and no other. Applied by the deploy before the code
-- that writes it; until then the old code reads none of it.
--
-- One row per collection and person, the shape of `members` (migrations/0010_members.sql): when they were invited and,
-- once he takes the invitation back, when. Nothing is written per thread: who may read a thread is asked of this table
-- joined to the collection's threads, in the one condition every reader holds (`standing` in src/store.ts), so a thread
-- added to a shared collection opens at once, and one taken out, a person removed or the collection deleted closes at
-- once, with nothing to undo elsewhere. Deleting a collection deletes its rows here in the same batch.
CREATE TABLE collection_members (
  collection_number INTEGER NOT NULL REFERENCES collections (number),
  person_id TEXT NOT NULL REFERENCES people (id),
  added_at TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY (collection_number, person_id)
);

CREATE INDEX collection_members_person_standing ON collection_members (person_id) WHERE removed_at IS NULL;
