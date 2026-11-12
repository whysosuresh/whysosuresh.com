// The avatars' photos in the database (migrations/0020_photos.sql), for src/photos.ts: his photo as a history whose
// newest row is the one shown, a person's Gravatar set once by the hourly run, and the photos themselves, of which
// only those shown now are kept. Every write that adds a photo writes its row in the same batch as the row that shows
// it, so a photo's row is never seen unshown; one that loses its place (he replaced or removed his, or a lookup lost a
// race) is dropped by `dropUnshown`, which answers the objects to delete.

/** A photo's row: its object in the pages bucket, its type as its first bytes prove, and its size. */
export interface PhotoRow {
  id: string;
  object_key: string;
  type: string;
  bytes: number;
}

/** A person due a Gravatar lookup: their id and their address, lowercased as `people` keeps it. */
export interface DuePerson {
  id: string;
  email: string;
}

/** The photo his newest row names, which is his photo now; null while he has none. */
const OWNER_PHOTO = "(SELECT photo_id FROM owner_photos ORDER BY id DESC LIMIT 1)";

/** His photo's id, or null while he has none. */
export async function ownerPhotoId(db: D1Database): Promise<string | null> {
  return (await db.prepare(`SELECT ${OWNER_PHOTO} AS id`).first<{ id: string | null }>())?.id ?? null;
}

/** The photo of the person with this address, or null: an invited person's own, for who is calling. */
export async function personPhotoId(db: D1Database, email: string): Promise<string | null> {
  return (await db.prepare("SELECT photo_id FROM people WHERE email = ?1").bind(email).first<{ photo_id: string | null }>())?.photo_id ?? null;
}

/** A photo shown now, by its id; null when there is none. */
export async function findPhoto(db: D1Database, id: string): Promise<PhotoRow | null> {
  return db.prepare("SELECT id, object_key, type, bytes FROM photos WHERE id = ?1").bind(id).first<PhotoRow>();
}

function insertPhoto(db: D1Database, photo: PhotoRow, at: string): D1PreparedStatement {
  return db
    .prepare("INSERT INTO photos (id, object_key, type, bytes, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(photo.id, photo.object_key, photo.type, photo.bytes, at);
}

/** Makes `photo` his photo, or none when it is null: a new row of his history, beside the photo's own row. */
export async function setOwnerPhoto(db: D1Database, photo: PhotoRow | null): Promise<void> {
  const at = new Date().toISOString();
  const named = db.prepare("INSERT INTO owner_photos (photo_id, set_at) VALUES (?1, ?2)").bind(photo?.id ?? null, at);
  await db.batch(photo === null ? [named] : [insertPhoto(db, photo, at), named]);
}

/**
 * Up to `limit` people due a Gravatar lookup, oldest first: those with an address who were ever invited (a sign-in
 * proves an invited person's address; a visitor's is only ever typed) and who haven't been looked up.
 */
export async function peopleDue(db: D1Database, limit: number): Promise<DuePerson[]> {
  return (
    await db
      .prepare(
        `SELECT people.id, people.email FROM people
         WHERE people.email IS NOT NULL AND people.photo_checked_at IS NULL AND EXISTS (SELECT 1 FROM members WHERE members.person_id = people.id)
         ORDER BY people.created_at, people.id LIMIT ?1`,
      )
      .bind(limit)
      .all<DuePerson>()
  ).results;
}

/** Marks a person looked up, with the photo found (its row kept in the same batch) or none. */
export async function lookedUp(db: D1Database, personId: string, photo: PhotoRow | null): Promise<void> {
  const at = new Date().toISOString();
  const marked = db.prepare("UPDATE people SET photo_id = ?1, photo_checked_at = ?2 WHERE id = ?3 AND photo_checked_at IS NULL").bind(photo?.id ?? null, at, personId);
  await db.batch(photo === null ? [marked] : [insertPhoto(db, photo, at), marked]);
}

/** Drops every photo no longer shown (neither his newest nor any person's), answering the objects to delete. */
export async function dropUnshown(db: D1Database): Promise<string[]> {
  const dropped = await db
    .prepare(
      `DELETE FROM photos WHERE photos.id IS NOT ${OWNER_PHOTO} AND NOT EXISTS (SELECT 1 FROM people WHERE people.photo_id = photos.id)
       RETURNING object_key`,
    )
    .all<{ object_key: string }>();
  return dropped.results.map((row) => row.object_key);
}
