// The journal's store (migrations/0017_journal.sql): every version of every entry, kept for good, with the index of
// each entry's newest version, its storyline lines, the photos its pages show, and his typed answers. The journal's
// calls (src/journal.ts) are its only door, and this file its only writer, so its rules live here once.
//
// A save is one batch, which D1 runs as one transaction. Its INSERT writes version `base + 1` only while `base` is
// still the newest version of that key, so a save built on an older text writes nothing; the index row and the
// storyline lines that follow find the new version by the save's own fresh id, so they too change only when the
// insert happened; and the batch ends by reading that id back. No row there means the save was stale, nothing was
// written, and the caller is told the newest version, so it can read, rebuild and save again. That is what keeps a
// hand edit from being overwritten by a sync that read the day before it. Versions are never updated or deleted.

import type { Storyline } from "../site/app/journal.js";
import type { Author } from "./store.ts";

/** An entry's newest version, as the list and Today read it. */
export interface EntryRow {
  readonly key: string;
  readonly kind: string;
  readonly version: number;
  readonly saved_at: string;
  readonly title: string;
  readonly one_line: string | null;
  readonly stories: number;
  readonly photos: number;
  readonly question: string | null;
}

/** One saved version's text. */
export interface VersionRow {
  readonly version: number;
  readonly text: string;
  readonly saved_at: string;
  readonly actor: string;
  readonly bytes: number;
}

/** One of his typed answers. */
export interface AnswerRow {
  readonly id: number;
  readonly body: string;
  readonly created_at: string;
}

/** A storyline line of a day's newest version. */
export interface StorylineRow {
  readonly key: string;
  readonly name: string;
  readonly state: string;
  readonly mark: string | null;
}

/** A photo the sync uploaded. */
export interface PhotoRow {
  readonly id: string;
  readonly object_key: string;
  readonly type: string;
  readonly bytes: number;
}

/** A save as the calls hand it over: the text, the version it was built on, and what the reader made of it. */
export interface Save {
  readonly key: string;
  readonly kind: "day" | "week";
  readonly base: number;
  readonly text: string;
  readonly bytes: number;
  readonly title: string;
  readonly oneLine: string | null;
  readonly stories: number;
  readonly photos: number;
  readonly question: string | null;
  /** A day's storyline lines, one per name (a week's are none). */
  readonly storylines: readonly Storyline[];
}

const ENTRY_COLUMNS = "key, kind, version, saved_at, title, one_line, stories, photos, question";

/** Every entry's newest version, in no particular order (the calls order them, site/app/journal.js `newestFirst`). */
export async function listEntries(db: D1Database): Promise<EntryRow[]> {
  return (await db.prepare(`SELECT ${ENTRY_COLUMNS} FROM journal_entries`).all<EntryRow>()).results;
}

/** One entry's newest version as indexed, or null when it was never saved. */
export async function findEntry(db: D1Database, key: string): Promise<EntryRow | null> {
  return db.prepare(`SELECT ${ENTRY_COLUMNS} FROM journal_entries WHERE key = ?`).bind(key).first<EntryRow>();
}

/**
 * One entry read whole: the version asked for (the newest when `version` is null), every version's line without its
 * text, oldest first, and a day's answers, oldest first. Null when the entry, or that version of it, isn't there.
 */
export async function readEntry(
  db: D1Database,
  key: string,
  version: number | null,
): Promise<{ readonly entry: EntryRow; readonly text: VersionRow; readonly versions: readonly Omit<VersionRow, "text">[]; readonly answers: readonly AnswerRow[] } | null> {
  const [entries, texts, versions, answers] = await db.batch<EntryRow | VersionRow | Omit<VersionRow, "text"> | AnswerRow>([
    db.prepare(`SELECT ${ENTRY_COLUMNS} FROM journal_entries WHERE key = ?`).bind(key),
    db
      .prepare(
        `SELECT version, text, saved_at, actor, bytes FROM journal_versions
         WHERE key = ?1 AND version = COALESCE(?2, (SELECT MAX(version) FROM journal_versions WHERE key = ?1))`,
      )
      .bind(key, version),
    db.prepare("SELECT version, saved_at, actor, bytes FROM journal_versions WHERE key = ? ORDER BY version").bind(key),
    db.prepare("SELECT id, body, created_at FROM journal_answers WHERE key = ? ORDER BY id").bind(key),
  ]);
  const entry = entries?.results[0] as EntryRow | undefined;
  const text = texts?.results[0] as VersionRow | undefined;
  if (entry === undefined || text === undefined) return null;
  return {
    entry,
    text,
    versions: (versions?.results ?? []) as Omit<VersionRow, "text">[],
    answers: (answers?.results ?? []) as AnswerRow[],
  };
}

/**
 * Saves a new version, only while `base` is the newest: the version it got, or `stale` with the newest there is, and
 * then nothing at all was written (see the header). Two saves racing for one version can't both pass the guard; if the
 * key's constraint refuses one instead, it is answered the same way.
 */
export async function saveEntry(db: D1Database, save: Save, actor: Author): Promise<{ readonly version: number } | { readonly stale: number }> {
  const now = new Date().toISOString();
  const saveId = crypto.randomUUID();
  /** The condition every statement after the insert holds: the insert happened. */
  const saved = "EXISTS (SELECT 1 FROM journal_versions WHERE save_id = ?)";
  const statements = [
    db
      .prepare(
        `INSERT INTO journal_versions (key, version, save_id, text, saved_at, actor, bytes)
         SELECT ?1, ?2 + 1, ?3, ?4, ?5, ?6, ?7
         WHERE (SELECT COALESCE(MAX(version), 0) FROM journal_versions WHERE key = ?1) = ?2`,
      )
      .bind(save.key, save.base, saveId, save.text, now, actor, save.bytes),
    db
      .prepare(
        `INSERT INTO journal_entries (${ENTRY_COLUMNS})
         SELECT key, ?, version, saved_at, ?, ?, ?, ?, ? FROM journal_versions WHERE save_id = ?
         ON CONFLICT (key) DO UPDATE SET kind = excluded.kind, version = excluded.version, saved_at = excluded.saved_at,
           title = excluded.title, one_line = excluded.one_line, stories = excluded.stories, photos = excluded.photos,
           question = excluded.question`,
      )
      .bind(save.kind, save.title, save.oneLine, save.stories, save.photos, save.question, saveId),
    db.prepare(`DELETE FROM journal_storylines WHERE key = ? AND ${saved}`).bind(save.key, saveId),
    ...save.storylines.map((line) =>
      db
        .prepare(`INSERT INTO journal_storylines (key, name, state, mark) SELECT ?, ?, ?, ? WHERE ${saved}`)
        .bind(save.key, line.name, line.state, line.mark, saveId),
    ),
    db.prepare("SELECT version FROM journal_versions WHERE save_id = ?").bind(saveId),
  ];
  const newest = async (): Promise<number> =>
    (await db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM journal_versions WHERE key = ?").bind(save.key).first<{ version: number }>())?.version ?? 0;
  try {
    const results = await db.batch<{ version: number }>(statements);
    const kept = results[results.length - 1]?.results[0];
    if (kept !== undefined) return { version: kept.version };
  } catch (error) {
    // A batch writes all or nothing. One that failed while `base` is still the newest wasn't stale, and saying it was
    // would send the sync round again for ever, so it fails as itself; a newer version means another save won.
    if ((await newest()) === save.base) throw error;
  }
  return { stale: await newest() };
}

/** The photo ids a text names that the store doesn't hold. */
export async function missingPhotos(db: D1Database, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const found = await db
    .prepare(`SELECT id FROM journal_photos WHERE id IN (${unique.map(() => "?").join(", ")})`)
    .bind(...unique)
    .all<{ id: string }>();
  const held = new Set(found.results.map((row) => row.id));
  return unique.filter((id) => !held.has(id));
}

/** Keeps an uploaded photo's row, its object already written under `object_key`. */
export async function keepPhoto(db: D1Database, photo: PhotoRow): Promise<void> {
  await db
    .prepare("INSERT INTO journal_photos (id, object_key, type, bytes, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(photo.id, photo.object_key, photo.type, photo.bytes, new Date().toISOString())
    .run();
}

/** One photo, or null when no photo has that id. */
export async function findPhoto(db: D1Database, id: string): Promise<PhotoRow | null> {
  return db.prepare("SELECT id, object_key, type, bytes FROM journal_photos WHERE id = ?").bind(id).first<PhotoRow>();
}

/** Keeps one typed answer to a day that has an entry: the answer kept, or null when the day has none. */
export async function addAnswer(db: D1Database, key: string, body: string): Promise<AnswerRow | null> {
  return db
    .prepare(
      `INSERT INTO journal_answers (key, body, created_at)
       SELECT key, ?, ? FROM journal_entries WHERE key = ? AND kind = 'day'
       RETURNING id, body, created_at`,
    )
    .bind(body, new Date().toISOString(), key)
    .first<AnswerRow>();
}

/** Every day's storyline lines, by day, oldest first; a week's margin is never among them. */
export async function storylineLines(db: D1Database): Promise<StorylineRow[]> {
  return (
    await db
      .prepare(
        `SELECT journal_storylines.key, name, state, mark FROM journal_storylines
         JOIN journal_entries ON journal_entries.key = journal_storylines.key
         WHERE journal_entries.kind = 'day' ORDER BY journal_storylines.key, name`,
      )
      .all<StorylineRow>()
  ).results;
}
