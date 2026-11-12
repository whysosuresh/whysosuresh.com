-- A public thread's preview card (src/cards.ts): the picture a chat shows under its link, drawn by his own page and
-- uploaded, as his photo is. Applied by the deploy before the code that writes it; until then the old code reads none
-- of it.
--
-- One row per thread, the card shown now: the image is an object in the pages bucket under `cards/<id>.png`, written
-- before its row and deleted again when the row isn't kept, and served from its row at /api/cards/<id> only while its
-- thread is public. A redrawn card replaces the row in the same transaction that reads the object it replaced, which
-- is then deleted, so the bucket holds exactly the cards the rows name. `stamp` is what the picture shows, as his page
-- computes it (`cardStamp` in site/app/card.js), so his page redraws exactly the cards whose thread changed. A thread
-- is never deleted, so its card's key on it never blocks anything; a thread taken back from public keeps its card, as
-- it keeps its link's key.
CREATE TABLE cards (
  thread_id TEXT PRIMARY KEY REFERENCES threads (id),
  id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL,
  stamp TEXT NOT NULL,
  created_at TEXT NOT NULL
);
