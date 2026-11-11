-- What arrives on the home page from outside (src/outside.ts): his full YouTube episodes and the newest release of
-- each product he makes, fetched every hour with no act of his, because they are already public where they come
-- from. Applied by the deploy before the code that writes it; until then the old code reads none of it.
--
-- A mirror of the sources, not a history: a row lives while its source lists it. A video's id is
-- `video:<videoId>`; a release's is `release:<owner>/<repo>`, naming the repository and not the tag, so the
-- newest release replaces the last in place, and `ref` carries the tag (the feed's entry id) or the video id (its
-- picture's key). Every date is stored as Date#toISOString writes it, with Z, so it orders as text beside
-- `threads.feed_at`, which the home page merges these with. `updated_at` is a video's own <updated>, which tells a
-- changed picture; `thumb` is 1 once its picture is in the pages bucket under `outside/`. The index lets the home
-- page read the newest rows without a scan.
CREATE TABLE outside_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'release')),
  source TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT NOT NULL,
  updated_at TEXT,
  thumb INTEGER NOT NULL DEFAULT 0 CHECK (thumb IN (0, 1))
);
CREATE INDEX outside_items_published ON outside_items (published_at);
