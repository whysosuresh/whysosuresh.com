// Collections in the database (migrations/0023_collections.sql), for src/collections.ts: his named sets of threads,
// each in his own order, found again by search and paged, a few pinned to his menu. A collection is named by its
// number and by its name, unique ignoring case. A thread may sit in several, and keeping it changes nothing about the
// thread itself.
//
// The order is `position`, dense from 0. Every write that changes it is one batch, which D1 runs as one transaction:
// adding puts a thread at the end (the place is the count of rows, read in the INSERT itself), taking one out shifts
// every row after it up by one, and moving one shifts the rows between its two places by one, then sets its own. The
// place asked for is clamped to the rows there are, in the SQL, so the page and the sync racing can't leave a gap or
// a tie. Keeping and taking out write the thread's `kept` and `unkept` events in the same batch, ahead of the change,
// naming the collection by number and by name as it was then, so renaming or deleting it later leaves the history as
// written; neither moves the thread's last activity, because keeping is not activity on the thread. The collection's
// `changed_at` moves instead, on every change of it or its threads, and orders the list.
//
// A new thread whose title meets a collection's rule is kept by the batch that makes it (`ruleStatements` in
// src/store.ts), not here, because only that batch knows the thread is new.
//
// A collection may be shared with people he invites (`collection_members`, migrations/0024_collection_members.sql):
// each reads every thread in it, the ones added later included, through the one membership test every read holds
// (`standing` in src/store.ts), and nothing is written per thread. An invited person lists only the collections shared
// with them and reads one only while that invitation stands (`collectionsFor`, `findCollectionFor`); they never read
// its people, its rule or its pin. Deleting a collection deletes its invitations in the same batch, so nobody keeps a
// reach through it.

import { COLUMNS, NEXT_PERSON, Params, TABS, statement, type Author, type Invitee, type PersonRow, type ThreadRow } from "./store.ts";

/** A collection as the calls answer it, with how many threads it holds. */
export interface CollectionRow {
  number: number;
  name: string;
  description: string | null;
  rule_prefix: string | null;
  pinned_at: string | null;
  changed_at: string;
  created_at: string;
  threads: number;
}

/** A thread in a collection: the thread's own columns and its place, from 0. */
export type KeptThreadRow = ThreadRow & { position: number };

/** Which of a collection's threads a read answers: every one, the open ones or the closed ones. */
export type KeptFilter = "open" | "done" | null;

const COLLECTION_COLUMNS =
  "collections.number, collections.name, collections.description, collections.rule_prefix, collections.pinned_at, collections.changed_at, collections.created_at, (SELECT COUNT(*) FROM collection_threads WHERE collection_threads.collection_number = collections.number) AS threads";

/** The newest change first, then the newest collection: one order every page of the list keeps. */
const RECENT = "ORDER BY collections.changed_at DESC, collections.number DESC";

/** Words as a LIKE pattern that matches them as typed, ignoring case for ASCII letters; `%` and `_` match only themselves. */
function pattern(words: string, p: Params): string {
  return p.add(`%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
}

/** A page of the list after the collection `after` names, in `RECENT` order; nothing when no collection has that number. */
function cursor(after: number | null, p: Params): string {
  return after === null ? "" : ` AND (collections.changed_at, collections.number) < (SELECT changed_at, number FROM collections WHERE number = ${p.add(after)})`;
}

/** One page of the list: the pinned collections (all of them, in pinning order), a page of the rest, and how many the rest are. */
export interface CollectionList {
  readonly pinned: CollectionRow[];
  readonly rows: CollectionRow[];
  readonly count: number;
}

/**
 * Collections for the list. With no words: every pinned one in pinning order, and up to `limit` of the others, the most
 * recently changed first, after `after`; `count` is how many the others are. With words: no pinned list, and up to
 * `limit` of every collection whose name or description holds them, in the same order; `count` is how many match.
 */
export async function listCollections(db: D1Database, words: string | null, after: number | null, limit: number): Promise<CollectionList> {
  if (words === null) {
    const p = new Params();
    const [pinned, rows, count] = await db.batch<CollectionRow | { n: number }>([
      db.prepare(`SELECT ${COLLECTION_COLUMNS} FROM collections WHERE collections.pinned_at IS NOT NULL ORDER BY collections.pinned_at, collections.number`),
      statement(db, `SELECT ${COLLECTION_COLUMNS} FROM collections WHERE collections.pinned_at IS NULL${cursor(after, p)} ${RECENT} LIMIT ${limit}`, p),
      db.prepare("SELECT COUNT(*) AS n FROM collections WHERE pinned_at IS NULL"),
    ]);
    return {
      pinned: (pinned?.results ?? []) as CollectionRow[],
      rows: (rows?.results ?? []) as CollectionRow[],
      count: ((count?.results ?? []) as { n: number }[])[0]?.n ?? 0,
    };
  }
  const p = new Params();
  const like = pattern(words, p);
  const where = `(collections.name LIKE ${like} ESCAPE '\\' OR collections.description LIKE ${like} ESCAPE '\\')`;
  const c = new Params();
  const counted = pattern(words, c);
  const [rows, count] = await db.batch<CollectionRow | { n: number }>([
    statement(db, `SELECT ${COLLECTION_COLUMNS} FROM collections WHERE ${where}${cursor(after, p)} ${RECENT} LIMIT ${limit}`, p),
    statement(db, `SELECT COUNT(*) AS n FROM collections WHERE (name LIKE ${counted} ESCAPE '\\' OR description LIKE ${counted} ESCAPE '\\')`, c),
  ]);
  return { pinned: [], rows: (rows?.results ?? []) as CollectionRow[], count: ((count?.results ?? []) as { n: number }[])[0]?.n ?? 0 };
}

/** The most collections one search answers, as a thread search's. */
export const COLLECTION_SEARCH_LIMIT = 20;

/** Collections whose name or description holds the words, the most recently changed first: ⌘K's group. */
export async function searchCollections(db: D1Database, words: string): Promise<CollectionRow[]> {
  return (await listCollections(db, words, null, COLLECTION_SEARCH_LIMIT)).rows;
}

/** A collection by its number; null when there is none. */
export async function findCollection(db: D1Database, number: number): Promise<CollectionRow | null> {
  return db.prepare(`SELECT ${COLLECTION_COLUMNS} FROM collections WHERE collections.number = ?1`).bind(number).first<CollectionRow>();
}

/** One page of a collection's threads, in his order, and how many threads meet the filter and the words. */
export interface KeptList {
  readonly rows: KeptThreadRow[];
  readonly count: number;
}

/**
 * Up to `limit` of a collection's threads in his order, after the place `after` (from 0) when given: every one, or the
 * open or closed ones, and only those whose title, summary or main text hold the words when given, or whose number
 * they are (`42`, `#42`).
 */
export async function collectionThreads(db: D1Database, number: number, words: string | null, filter: KeptFilter, after: number | null, limit: number): Promise<KeptList> {
  const where = (p: Params): string => {
    const conditions = [`collection_threads.collection_number = ${p.add(number)}`];
    if (filter !== null) conditions.push(`threads.status IN (${p.list(TABS[filter === "open" ? "pending" : "done"])})`);
    if (words !== null) {
      const asNumber = /^#?([1-9]\d{0,8})$/.exec(words);
      const like = pattern(words, p);
      const matches = ["title", "summary", "body"].map((column) => `threads.${column} LIKE ${like} ESCAPE '\\'`);
      if (asNumber !== null) matches.push(`threads.number = ${p.add(Number(asNumber[1]))}`);
      conditions.push(`(${matches.join(" OR ")})`);
    }
    return conditions.join(" AND ");
  };
  const p = new Params();
  const rows = statement(
    db,
    `SELECT ${COLUMNS}, collection_threads.position AS position FROM collection_threads JOIN threads ON threads.id = collection_threads.thread_id
     WHERE ${where(p)}${after === null ? "" : ` AND collection_threads.position > ${p.add(after)}`} ORDER BY collection_threads.position LIMIT ${limit}`,
    p,
  );
  const c = new Params();
  const count = statement(db, `SELECT COUNT(*) AS n FROM collection_threads JOIN threads ON threads.id = collection_threads.thread_id WHERE ${where(c)}`, c);
  const [listed, counted] = await db.batch<KeptThreadRow | { n: number }>([rows, count]);
  return { rows: (listed?.results ?? []) as KeptThreadRow[], count: ((counted?.results ?? []) as { n: number }[])[0]?.n ?? 0 };
}

/** The collections a thread is in, by number and name, in name order: the thread's own read, for him and the sync. */
export async function collectionsOf(db: D1Database, threadId: string): Promise<{ number: number; name: string }[]> {
  return (
    await db
      .prepare(
        "SELECT collections.number, collections.name FROM collection_threads JOIN collections ON collections.number = collection_threads.collection_number WHERE collection_threads.thread_id = ?1 ORDER BY lower(collections.name), collections.number",
      )
      .bind(threadId)
      .all<{ number: number; name: string }>()
  ).results;
}

/** A new collection, numbered after every one there ever was; `name-taken` when another has its name, ignoring case. */
export async function createCollection(db: D1Database, name: string, description: string | null): Promise<CollectionRow | "name-taken"> {
  const now = new Date().toISOString();
  const made = await db
    .prepare("INSERT INTO collections (name, description, changed_at, created_at) VALUES (?1, ?2, ?3, ?3) ON CONFLICT DO NOTHING RETURNING number")
    .bind(name, description, now)
    .first<{ number: number }>();
  if (made === null) return "name-taken";
  return (await findCollection(db, made.number)) ?? "name-taken";
}

/** One change to a collection: its name, its description, its rule (a title prefix, or none), pinned or not, or gone. */
export type CollectionChange =
  | { readonly name: string }
  | { readonly description: string | null }
  | { readonly rule: string | null }
  | { readonly pinned: boolean }
  | { readonly delete: true };

/**
 * Changes a collection and moves its `changed_at`: `no-collection` when nobody has the number, `name-taken` when
 * another collection has the new name, ignoring case. Pinning keeps the time it was first pinned, so the menu's order
 * holds. Deleting takes its rows away with it, never a thread, and answers `deleted`; the threads' `kept` lines stay.
 */
export async function changeCollection(db: D1Database, number: number, change: CollectionChange): Promise<CollectionRow | "deleted" | "no-collection" | "name-taken"> {
  const now = new Date().toISOString();
  if ("delete" in change) {
    const [, , gone] = await db.batch<{ number: number }>([
      db.prepare("DELETE FROM collection_threads WHERE collection_number = ?1").bind(number),
      db.prepare("DELETE FROM collection_members WHERE collection_number = ?1").bind(number),
      db.prepare("DELETE FROM collections WHERE number = ?1 RETURNING number").bind(number),
    ]);
    return (gone?.results.length ?? 0) > 0 ? "deleted" : "no-collection";
  }
  const p = new Params();
  let update: string;
  if ("name" in change) {
    const name = p.add(change.name);
    const own = p.add(number);
    update = `UPDATE collections SET name = ${name}, changed_at = ${p.add(now)} WHERE number = ${own}
      AND NOT EXISTS (SELECT 1 FROM collections AS other WHERE lower(other.name) = lower(${name}) AND other.number <> ${own}) RETURNING number`;
  } else if ("pinned" in change) {
    const at = p.add(now);
    update = `UPDATE collections SET pinned_at = ${change.pinned ? `COALESCE(pinned_at, ${at})` : "NULL"}, changed_at = ${at} WHERE number = ${p.add(number)} RETURNING number`;
  } else {
    const [column, value] = "description" in change ? ["description", change.description] : ["rule_prefix", change.rule];
    update = `UPDATE collections SET ${column} = ${p.add(value)}, changed_at = ${p.add(now)} WHERE number = ${p.add(number)} RETURNING number`;
  }
  const changed = await statement(db, update, p).first<{ number: number }>();
  const row = await findCollection(db, number);
  if (row === null) return "no-collection";
  return changed === null ? "name-taken" : row;
}

/** What a change of a collection's threads answers: the collection as it now stands and the thread's place, or why not. */
export type KeptChange = { readonly collection: CollectionRow; readonly position: number | null } | "no-collection" | "no-thread" | "not-kept";

/** The thread numbered `?` as an id, for a statement that names it by number. */
function threadId(number: number, p: Params): string {
  return `(SELECT id FROM threads WHERE number = ${p.add(number)})`;
}

/** Why a change found nothing to do, after the batch: no collection, no thread, or (for a take-out or move) not kept. */
async function missing(db: D1Database, collection: number, thread: number): Promise<"no-collection" | "no-thread" | null> {
  const [c, t] = await db.batch<{ yes: number }>([
    db.prepare("SELECT 1 AS yes FROM collections WHERE number = ?1").bind(collection),
    db.prepare("SELECT 1 AS yes FROM threads WHERE number = ?1").bind(thread),
  ]);
  if ((c?.results.length ?? 0) === 0) return "no-collection";
  if ((t?.results.length ?? 0) === 0) return "no-thread";
  return null;
}

async function standing(db: D1Database, collection: number, thread: number): Promise<KeptChange> {
  const why = await missing(db, collection, thread);
  if (why !== null) return why;
  const [row, place] = await Promise.all([
    findCollection(db, collection),
    db
      .prepare("SELECT position FROM collection_threads WHERE collection_number = ?1 AND thread_id = (SELECT id FROM threads WHERE number = ?2)")
      .bind(collection, thread)
      .first<{ position: number }>(),
  ]);
  return row === null ? "no-collection" : { collection: row, position: place?.position ?? null };
}

/**
 * Keeps a thread at the end of a collection, with its `kept` event, in one batch; a thread already there stays where it
 * is and nothing is written. Answers the collection and the thread's place.
 */
export async function keep(db: D1Database, collection: number, thread: number, actor: Author): Promise<KeptChange> {
  const now = new Date().toISOString();
  const pair = (p: Params): string =>
    `FROM threads, collections WHERE threads.number = ${p.add(thread)} AND collections.number = ${p.add(collection)}
     AND NOT EXISTS (SELECT 1 FROM collection_threads WHERE collection_threads.collection_number = collections.number AND collection_threads.thread_id = threads.id)`;
  const e = new Params();
  const event = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data)
     SELECT threads.id, ${e.add(now)}, ${e.add(actor)}, 'kept', json_object('collection', collections.number, 'name', collections.name) ${pair(e)}`,
    e,
  );
  const k = new Params();
  const insert = statement(
    db,
    `INSERT INTO collection_threads (collection_number, thread_id, position, added_at)
     SELECT collections.number, threads.id, (SELECT COUNT(*) FROM collection_threads AS kept WHERE kept.collection_number = collections.number), ${k.add(now)} ${pair(k)}`,
    k,
  );
  const c = new Params();
  const at = c.add(now);
  const changed = statement(
    db,
    `UPDATE collections SET changed_at = ${at} WHERE number = ${c.add(collection)}
     AND EXISTS (SELECT 1 FROM collection_threads WHERE collection_number = collections.number AND thread_id = ${threadId(thread, c)} AND added_at = ${at})`,
    c,
  );
  await db.batch([event, insert, changed]);
  return standing(db, collection, thread);
}

/**
 * Takes a thread out of a collection, with its `unkept` event, shifting every thread after it up by one, in one batch.
 * `not-kept` when it isn't there.
 */
export async function unkeep(db: D1Database, collection: number, thread: number, actor: Author): Promise<KeptChange> {
  const now = new Date().toISOString();
  const kept = (p: Params): string => `SELECT position FROM collection_threads WHERE collection_number = ${p.add(collection)} AND thread_id = ${threadId(thread, p)}`;
  const e = new Params();
  const event = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data)
     SELECT threads.id, ${e.add(now)}, ${e.add(actor)}, 'unkept', json_object('collection', collections.number, 'name', collections.name)
     FROM collection_threads JOIN threads ON threads.id = collection_threads.thread_id JOIN collections ON collections.number = collection_threads.collection_number
     WHERE collections.number = ${e.add(collection)} AND threads.number = ${e.add(thread)}`,
    e,
  );
  const c = new Params();
  const changed = statement(db, `UPDATE collections SET changed_at = ${c.add(now)} WHERE number = ${c.add(collection)} AND EXISTS (${kept(c)})`, c);
  const s = new Params();
  const shift = statement(
    db,
    `UPDATE collection_threads SET position = position - 1 WHERE collection_number = ${s.add(collection)} AND position > (${kept(s)})`,
    s,
  );
  const d = new Params();
  const gone = statement(
    db,
    `DELETE FROM collection_threads WHERE collection_number = ${d.add(collection)} AND thread_id = ${threadId(thread, d)} RETURNING thread_id`,
    d,
  );
  const results = await db.batch([event, changed, shift, gone]);
  if ((results[3]?.results.length ?? 0) === 0) return (await missing(db, collection, thread)) ?? "not-kept";
  return standing(db, collection, thread);
}

/**
 * Moves a thread to the place `to` (from 0) in a collection, clamped to the places there are: the threads between its
 * old and new place shift by one toward the place it left, then it takes its new place, in one batch. `not-kept` when
 * it isn't there.
 */
export async function moveKept(db: D1Database, collection: number, thread: number, to: number): Promise<KeptChange> {
  const now = new Date().toISOString();
  const from = (p: Params): string => `(SELECT position FROM collection_threads WHERE collection_number = ${p.add(collection)} AND thread_id = ${threadId(thread, p)})`;
  const target = (p: Params): string =>
    `MAX(0, MIN(${p.add(to)}, (SELECT COUNT(*) FROM collection_threads WHERE collection_number = ${p.add(collection)}) - 1))`;
  const c = new Params();
  const changed = statement(
    db,
    `UPDATE collections SET changed_at = ${c.add(now)} WHERE number = ${c.add(collection)} AND ${from(c)} IS NOT NULL AND ${from(c)} <> ${target(c)}`,
    c,
  );
  const s = new Params();
  const [old, place] = [from(s), target(s)];
  const shift = statement(
    db,
    `UPDATE collection_threads SET position = position + CASE WHEN ${place} < ${old} THEN 1 ELSE -1 END
     WHERE collection_number = ${s.add(collection)} AND thread_id <> ${threadId(thread, s)} AND position BETWEEN MIN(${old}, ${place}) AND MAX(${old}, ${place})`,
    s,
  );
  const m = new Params();
  const moved = statement(
    db,
    `UPDATE collection_threads SET position = ${target(m)} WHERE collection_number = ${m.add(collection)} AND thread_id = ${threadId(thread, m)} RETURNING position`,
    m,
  );
  const results = await db.batch([changed, shift, moved]);
  if ((results[2]?.results.length ?? 0) === 0) return (await missing(db, collection, thread)) ?? "not-kept";
  return standing(db, collection, thread);
}

/** An invitation that stands to the collection `collection` names (an SQL expression for its number), for the address bound in. */
function invitedTo(collection: string, email: string, p: Params): string {
  return `EXISTS (SELECT 1 FROM collection_members JOIN people ON people.id = collection_members.person_id
    WHERE collection_members.collection_number = ${collection} AND collection_members.removed_at IS NULL AND people.email = ${p.add(email)})`;
}

/** The most collections an invited person's list answers. */
const SHARED_COLLECTIONS = 200;

/**
 * The collections shared with an invited person now, the most recently changed first; with words, only those whose
 * name or description holds them.
 */
export async function collectionsFor(db: D1Database, email: string, words: string | null = null): Promise<CollectionRow[]> {
  const p = new Params();
  const like = words === null ? null : pattern(words, p);
  const matching = like === null ? "" : ` AND (collections.name LIKE ${like} ESCAPE '\\' OR collections.description LIKE ${like} ESCAPE '\\')`;
  return (
    await statement(db, `SELECT ${COLLECTION_COLUMNS} FROM collections WHERE ${invitedTo("collections.number", email, p)}${matching} ${RECENT} LIMIT ${SHARED_COLLECTIONS}`, p).all<CollectionRow>()
  ).results;
}

/** A collection by its number while it is shared with the address; null otherwise, as a number never used. */
export async function findCollectionFor(db: D1Database, number: number, email: string): Promise<CollectionRow | null> {
  const p = new Params();
  return statement(db, `SELECT ${COLLECTION_COLUMNS} FROM collections WHERE collections.number = ${p.add(number)} AND ${invitedTo("collections.number", email, p)}`, p).first<CollectionRow>();
}

/** The people a collection is shared with now, in the order they were invited. */
export async function collectionPeople(db: D1Database, number: number): Promise<PersonRow[]> {
  return (
    await db
      .prepare(
        `SELECT people.id, people.number, people.email, people.name, collection_members.added_at, people.photo_id
         FROM collection_members JOIN people ON people.id = collection_members.person_id
         WHERE collection_members.collection_number = ?1 AND collection_members.removed_at IS NULL ORDER BY collection_members.added_at, people.id`,
      )
      .bind(number)
      .all<PersonRow>()
  ).results;
}

/** The collections a person is invited to now, by number and name, for their page. */
export async function collectionsOfPerson(db: D1Database, personId: string): Promise<{ number: number; name: string }[]> {
  return (
    await db
      .prepare(
        `SELECT collections.number, collections.name FROM collection_members JOIN collections ON collections.number = collection_members.collection_number
         WHERE collection_members.person_id = ?1 AND collection_members.removed_at IS NULL ORDER BY lower(collections.name), collections.number`,
      )
      .bind(personId)
      .all<{ number: number; name: string }>()
  ).results;
}

/**
 * Invites a person to a collection, by the owner, in one batch: the person (kept once per address, their name the one
 * typed now), the invitation (a new one, or a removed one standing again) and the collection's `changed_at`. Inviting
 * someone already in it changes nothing but their name. `no-collection` when nobody has the number, and then nothing
 * is written, the person included.
 */
export async function inviteToCollection(db: D1Database, number: number, invitee: Invitee): Promise<"invited" | "no-collection"> {
  const now = new Date().toISOString();
  const p = new Params();
  const person = statement(
    db,
    `INSERT INTO people (id, number, email, name, created_at)
     SELECT ${p.add(crypto.randomUUID())}, ${NEXT_PERSON}, ${p.list([invitee.email, invitee.name, now])} WHERE EXISTS (SELECT 1 FROM collections WHERE number = ${p.add(number)})
     ON CONFLICT (email) DO UPDATE SET name = excluded.name`,
    p,
  );
  const m = new Params();
  const member = statement(
    db,
    `INSERT INTO collection_members (collection_number, person_id, added_at)
     SELECT collections.number, people.id, ${m.add(now)} FROM collections JOIN people ON people.email = ${m.add(invitee.email)} WHERE collections.number = ${m.add(number)}
     ON CONFLICT (collection_number, person_id) DO UPDATE SET added_at = excluded.added_at, removed_at = NULL WHERE collection_members.removed_at IS NOT NULL`,
    m,
  );
  const c = new Params();
  const changed = statement(db, `UPDATE collections SET changed_at = ${c.add(now)} WHERE number = ${c.add(number)} RETURNING number`, c);
  const [, , touched] = await db.batch<{ number: number }>([person, member, changed]);
  return (touched?.results.length ?? 0) > 0 ? "invited" : "no-collection";
}

/**
 * Takes back a person's invitation to a collection, by the owner: every thread it opened to them closes at once.
 * `no-collection`, or `not-invited` when the person has no invitation there that stands; either way nothing is written.
 */
export async function uninviteFromCollection(db: D1Database, number: number, personId: string): Promise<"removed" | "no-collection" | "not-invited"> {
  const now = new Date().toISOString();
  const [ended] = await db.batch<{ person_id: string }>([
    db
      .prepare("UPDATE collection_members SET removed_at = ?1 WHERE collection_number = ?2 AND person_id = ?3 AND removed_at IS NULL RETURNING person_id")
      .bind(now, number, personId),
    db
      .prepare("UPDATE collections SET changed_at = ?1 WHERE number = ?2 AND EXISTS (SELECT 1 FROM collection_members WHERE collection_number = ?2 AND person_id = ?3 AND removed_at = ?1)")
      .bind(now, number, personId),
  ]);
  if ((ended?.results.length ?? 0) > 0) return "removed";
  return (await findCollection(db, number)) === null ? "no-collection" : "not-invited";
}
