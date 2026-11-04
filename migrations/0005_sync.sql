-- What the recorder sync writes (src/inbox.ts), and when anything last moved. `title` is a one-line title
-- for an item the sync adds; site notes have none, and the page shows their opening words. `ref` is where
-- an item the sync adds came from, `<kind>:<id>` (a moved issue, a piece of a recording, an idea from a
-- chat); it is unique, so a sync that runs again after stopping halfway adds nothing twice, and null on
-- site notes, which the partial index leaves out. `filed_link` is the GitHub issue an item became, set by
-- the sync's `file` move. `moved_at` is when any move, from the page or the sync, last touched the item,
-- so the sync can name what has sat a week. `source` gains `told` (someone told him in person) and `self`
-- (his own), and `status` gains `filed`, validated by the code with no CHECK (0002 says why). Applied by
-- the deploy job before the code that writes it.
ALTER TABLE inbox ADD COLUMN title TEXT;
ALTER TABLE inbox ADD COLUMN ref TEXT;
ALTER TABLE inbox ADD COLUMN filed_link TEXT;
ALTER TABLE inbox ADD COLUMN moved_at TEXT;
CREATE UNIQUE INDEX inbox_ref ON inbox (ref) WHERE ref IS NOT NULL;
