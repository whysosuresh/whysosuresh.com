-- The avatars' photos (src/photos.ts, src/photos-store.ts): Suresh's own, which he sets from his page, and the
-- Gravatar of each person he invited, which the hourly run looks up once. Applied by the deploy before the code that
-- writes it; until then the old code reads none of it.
--
-- `photos` holds only what is shown now, in the shape of the journal's photos (0017): the image is an object in the
-- pages bucket under `photos/<id>.<jpg|png>`, written before its row and deleted again when the row isn't kept, and
-- served from its row at /api/photos/<id>. A photo he replaced or removed loses its row and its object, so a photo he
-- took down is never served again; the history below keeps the record, not the picture.
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- His photo, kept as a history in the shape of the Now line's (0018): the newest row is his photo, a null `photo_id`
-- means none, and no row is ever updated or deleted. `photo_id` holds no key on `photos`, because the photo an earlier
-- row named is gone.
CREATE TABLE owner_photos (
  id INTEGER PRIMARY KEY,
  photo_id TEXT,
  set_at TEXT NOT NULL
);

-- A person's Gravatar, and when it was looked up: each is set once by the hourly run, for a person he invited, whose
-- address their sign-in proves, and never by a write. A null `photo_id` with a `photo_checked_at` is someone who has
-- no Gravatar; a null `photo_checked_at` is someone not looked up yet. A person's address is given at most once
-- (src/people.ts), so the address a lookup used never changes under it.
ALTER TABLE people ADD COLUMN photo_id TEXT REFERENCES photos (id);
ALTER TABLE people ADD COLUMN photo_checked_at TEXT;
