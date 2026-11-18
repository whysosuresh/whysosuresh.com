-- A collection's public link (src/public-collections.ts): he may make one of his collections readable by anyone with
-- its link, /collections/<key>, as he makes a thread public (migrations/0021_share_keys.sql). Applied by the deploy
-- before the code that writes it; until then the old code reads none of it.
--
-- `public_at` is when he made it public, null while it isn't. `share_key` is 128 random bits as 32 lowercase hex
-- characters, given the first time he makes it public and kept for good, so turning it off and on again brings the same
-- link back. Strangers read through it only the threads of his own words in it, never a site note, a told thread or an
-- ask's (`IN_PUBLIC_COLLECTION` in src/collections-store.ts holds that in every query), and never a thread's own key.
ALTER TABLE collections ADD COLUMN public_at TEXT;
ALTER TABLE collections ADD COLUMN share_key TEXT;

CREATE UNIQUE INDEX collections_share_key ON collections (share_key) WHERE share_key IS NOT NULL;
