-- The home page's feed (src/home.ts): what Suresh posts there, and the one line under his greeting that says what
-- he is doing now. Applied by the deploy before the code that writes it; until then the old code reads none of it.
--
-- `feed_at` is when he put a thread on the home page, null while it isn't there. Only a public thread may be posted,
-- a rule the `post` move and the feed's own query hold (src/store.ts): public means readable by anyone who has the
-- link, and posted means listed on the home page as well, a second act of his, so nothing made public before is
-- listed without him. Taking a thread back from public clears it too, so it never comes back to the home page
-- unasked. The partial index lets the home page read the newest posted threads without a scan.
--
-- `now_lines` is the Now line, kept as a history: the newest row is the line, an empty text means no line, and no
-- row is ever updated or deleted, as the journal's versions aren't (0017), so every earlier line is kept.
ALTER TABLE threads ADD COLUMN feed_at TEXT;
CREATE INDEX threads_feed ON threads (feed_at) WHERE feed_at IS NOT NULL;

CREATE TABLE now_lines (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  set_at TEXT NOT NULL
);
