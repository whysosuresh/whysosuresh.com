// Keeping a note: one row in the inbox table, which holds every thing told to Suresh, whatever the door.
// The note flow writes its rows with `source` set to `talk`; the words are in `body`.

export interface Note {
  topic: string;
  body: string;
  name: string;
  email: string;
}

/** Where a note came from: the site's note flow. */
const SOURCE = "talk";
/** A new note's place in the inbox. */
const STATUS = "received";

export async function keep(db: D1Database, note: Note): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO inbox (id, received_at, source, topic, body, name, email, status)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      id,
      new Date().toISOString(),
      SOURCE,
      note.topic,
      note.body,
      note.name === "" ? null : note.name,
      note.email === "" ? null : note.email,
      STATUS,
    )
    .run();
  return id;
}
