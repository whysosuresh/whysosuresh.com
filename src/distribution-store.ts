// Distribution in the database (migrations/0026_distribution.sql), for src/distribution.ts: what happened while
// Stigmer and CapsJump were told about, each platform's state, and the weekly numbers, as the recorder sync's runs
// write them, and the one read his room and the sync's next run take.
//
// An act is written once, by its origin (`ref`): the INSERT holds the origin being new in its own SQL, so a run
// written again adds nothing and answers the act already there. An act may name the person it was with, by number or
// by name, through the store's one rule for finding a person (`personOf` in src/store.ts): a name joins the one
// person who has it, or else makes a new person with no address, in the act's own batch and only when the act is
// kept. An act is never rewritten or deleted; a wrong one is voided (`voided_at`, set once), and every read here
// holds `voided_at IS NULL` except the void's own answer, which shows the act it voided.
//
// A platform's state is one row per product and platform, replaced by each write, and every write puts an `event`
// act in the same batch, ahead of the change, so the log holds the state's history. A week's reading is one row per
// product, metric and week, replaced by a second reading that week; several metrics go in one batch.
//
// The room's read answers, in one batch, the product's platforms, its acts since a day (each with its person's number
// and name), its readings since a week, and the open threads of his collection named Distribution in the product's
// space (the work waiting there), with the newest Engage log thread, found by its origin.

import { COLUMNS, Params, TABS, personOf, statement, type Sender, type ThreadRow } from "./store.ts";

/** The products with a distribution: the two spaces in site/spaces.js whose work this is. */
export const PRODUCTS = ["stigmer", "capsjump"] as const;
export type Product = (typeof PRODUCTS)[number];

/**
 * What an act can be: ours (`post`, `reply`, `comment`, `follow`, `briefing`, `handoff`), theirs (`in`), a decision
 * (`left`, an `in` we chose not to answer; `skipped`, a place offered and dropped), or an `event`. The room's next
 * moves read these, so the set is fixed.
 */
export const KINDS = ["post", "reply", "comment", "follow", "briefing", "handoff", "in", "left", "skipped", "event"] as const;
export type Kind = (typeof KINDS)[number];

/** Who an act was with; `team` is left out of every count. */
export const AUDIENCES = ["buyer", "peer", "community", "team"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Where a platform stands. */
export const STATES = ["active", "warming", "hold", "later"] as const;
export type State = (typeof STATES)[number];

/** An act as the reads answer it, with its person's number and name when it names one. */
export interface ActRow {
  id: string;
  ref: string;
  at: string;
  product: Product;
  platform: string;
  kind: Kind;
  audience: Audience | null;
  url: string | null;
  conversation: string | null;
  person_number: number | null;
  person_name: string | null;
  line: string;
  created_at: string;
  voided_at: string | null;
}

/** An act as a write gives it, checked. */
export interface NewAct {
  readonly ref: string;
  readonly at: string;
  readonly product: Product;
  readonly platform: string;
  readonly kind: Kind;
  readonly audience: Audience | null;
  readonly url: string | null;
  readonly conversation: string | null;
  readonly person: { readonly number: number } | { readonly name: string } | null;
  readonly line: string;
}

export interface PlatformRow {
  product: Product;
  platform: string;
  state: State;
  note: string | null;
  until: string | null;
  pace_per_week: number | null;
  changed_at: string;
}

/** A platform's state as a write gives it, checked. */
export interface PlatformChange {
  readonly state: State;
  readonly note: string | null;
  readonly until: string | null;
  readonly pace: number | null;
}

export interface ReadingRow {
  metric: string;
  week: string;
  value: number;
  read_at: string;
}

const ACT_COLUMNS = `distribution_acts.id, distribution_acts.ref, distribution_acts.at, distribution_acts.product, distribution_acts.platform,
  distribution_acts.kind, distribution_acts.audience, distribution_acts.url, distribution_acts.conversation, people.number AS person_number,
  people.name AS person_name, distribution_acts.line, distribution_acts.created_at, distribution_acts.voided_at`;
const ACT_FROM = "distribution_acts LEFT JOIN people ON people.id = distribution_acts.person_id";
/** The newest first, and a tie in the same order every time. */
const NEWEST = "ORDER BY distribution_acts.at DESC, distribution_acts.id DESC";

async function actByRef(db: D1Database, ref: string): Promise<ActRow | null> {
  return db.prepare(`SELECT ${ACT_COLUMNS} FROM ${ACT_FROM} WHERE distribution_acts.ref = ?1`).bind(ref).first<ActRow>();
}

/** The person an act names, as the store's one rule finds them. */
function senderOf(act: NewAct): Sender {
  if (act.person === null) return null;
  return "number" in act.person ? { by: "number", number: act.person.number } : { by: "name", name: act.person.name };
}

/**
 * Writes an act once, by its origin: `added` true when it was kept now, false when its origin was already there (the
 * act answered is that one, unchanged, and nobody is made). `no-person` when it names a number nobody has; then
 * nothing is written.
 */
export async function addAct(db: D1Database, act: NewAct): Promise<{ readonly act: ActRow; readonly added: boolean } | "no-person"> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const isNew = (p: Params): string => `NOT EXISTS (SELECT 1 FROM distribution_acts WHERE ref = ${p.add(act.ref)})`;
  const p = new Params();
  const person = personOf(db, senderOf(act), now, isNew, p);
  // A number nobody has would name no one; the INSERT holds that it names someone, so such an act is never kept.
  const named = act.person !== null && "number" in act.person ? ` AND ${person.id} IS NOT NULL` : "";
  const insert = statement(
    db,
    `INSERT INTO distribution_acts (id, ref, at, product, platform, kind, audience, url, conversation, person_id, line, created_at)
     SELECT ${p.list([id, act.ref, act.at, act.product, act.platform, act.kind, act.audience, act.url, act.conversation])}, ${person.id}, ${p.list([act.line, now])}
     WHERE ${isNew(p)}${named}`,
    p,
  );
  const results = await db.batch(person.make === null ? [insert] : [person.make, insert]);
  const added = (results[results.length - 1]?.meta.changes ?? 0) > 0;
  const row = await actByRef(db, act.ref);
  if (row === null) return "no-person";
  return { act: row, added };
}

/** Voids an act, once: a second void changes nothing. Answers the act as it now stands; null when no act has the id. */
export async function voidAct(db: D1Database, id: string): Promise<ActRow | null> {
  await db.prepare("UPDATE distribution_acts SET voided_at = ?1 WHERE id = ?2 AND voided_at IS NULL").bind(new Date().toISOString(), id).run();
  return db.prepare(`SELECT ${ACT_COLUMNS} FROM ${ACT_FROM} WHERE distribution_acts.id = ?1`).bind(id).first<ActRow>();
}

/** The `event` act's one line for a platform's new state, beside which the platform is named: "Now on hold: Posts held back". */
function stateLine(change: PlatformChange): string {
  const words: Record<State, string> = { active: "Now active", warming: "Now warming up", hold: "Now on hold", later: "Now for later" };
  return `${words[change.state]}${change.note === null ? "" : `: ${change.note}`}`;
}

/**
 * Sets a product's platform as it now stands, replacing the row, with its `event` act (origin
 * `platform:<product>:<platform>:<when>`) written in the same batch. Answers the row.
 */
export async function setPlatform(db: D1Database, product: Product, platform: string, change: PlatformChange): Promise<PlatformRow> {
  const now = new Date().toISOString();
  const event = new Params();
  const p = new Params();
  await db.batch([
    statement(
      db,
      `INSERT INTO distribution_acts (id, ref, at, product, platform, kind, audience, url, conversation, person_id, line, created_at)
       VALUES (${event.list([crypto.randomUUID(), `platform:${product}:${platform}:${now}`, now, product, platform])}, 'event', NULL, NULL, NULL, NULL, ${event.list([stateLine(change), now])})
       ON CONFLICT (ref) DO NOTHING`,
      event,
    ),
    statement(
      db,
      `INSERT INTO distribution_platforms (product, platform, state, note, until, pace_per_week, changed_at)
       VALUES (${p.list([product, platform, change.state, change.note, change.until, change.pace, now])})
       ON CONFLICT (product, platform) DO UPDATE SET state = excluded.state, note = excluded.note, until = excluded.until,
         pace_per_week = excluded.pace_per_week, changed_at = excluded.changed_at`,
      p,
    ),
  ]);
  const row = await db.prepare("SELECT * FROM distribution_platforms WHERE product = ?1 AND platform = ?2").bind(product, platform).first<PlatformRow>();
  if (row === null) throw new Error("a platform written in this batch is gone");
  return row;
}

/** Writes a week's readings, each replacing the one that week already had, in one batch. Answers the week's readings. */
export async function setReadings(db: D1Database, product: Product, week: string, values: ReadonlyMap<string, number>): Promise<ReadingRow[]> {
  const now = new Date().toISOString();
  await db.batch(
    [...values].map(([metric, value]) =>
      db
        .prepare(
          `INSERT INTO distribution_readings (product, metric, week, value, read_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (product, metric, week) DO UPDATE SET value = excluded.value, read_at = excluded.read_at`,
        )
        .bind(product, metric, week, value, now),
    ),
  );
  return (
    await db.prepare("SELECT metric, week, value, read_at FROM distribution_readings WHERE product = ?1 AND week = ?2 ORDER BY metric").bind(product, week).all<ReadingRow>()
  ).results;
}

/** A thread of his collection named Distribution, with its place there. */
export type WorkRow = ThreadRow & { position: number };

export interface Room {
  readonly platforms: PlatformRow[];
  readonly acts: ActRow[];
  readonly readings: ReadingRow[];
  /** The collection named Distribution's number, null while he has none, and its open threads in this product's space. */
  readonly collection: number | null;
  readonly work: WorkRow[];
  /** The newest Engage log thread, by its origin's quarter. */
  readonly log: { number: number; title: string | null } | null;
}

/** The name of his collection that holds distribution's work, compared as collection names are, ignoring case. */
const WORK_COLLECTION = "distribution";

/**
 * A product's room in one batch: its platforms by name, up to `limit` of its acts at or after `since` (an instant),
 * newest first, its readings from `fromWeek` on, newest week first, and the open threads of the Distribution
 * collection in its space, in his order.
 */
export async function readRoom(db: D1Database, product: Product, since: string, fromWeek: string, limit: number): Promise<Room> {
  const w = new Params();
  const [platforms, acts, readings, collection, work, log] = await db.batch<unknown>([
    db.prepare("SELECT * FROM distribution_platforms WHERE product = ?1 ORDER BY platform").bind(product),
    db.prepare(`SELECT ${ACT_COLUMNS} FROM ${ACT_FROM} WHERE distribution_acts.product = ?1 AND distribution_acts.at >= ?2 AND distribution_acts.voided_at IS NULL ${NEWEST} LIMIT ${limit}`).bind(product, since),
    db.prepare("SELECT metric, week, value, read_at FROM distribution_readings WHERE product = ?1 AND week >= ?2 ORDER BY week DESC, metric").bind(product, fromWeek),
    db.prepare("SELECT number FROM collections WHERE lower(name) = ?1").bind(WORK_COLLECTION),
    statement(
      db,
      `SELECT ${COLUMNS}, collection_threads.position AS position FROM collection_threads JOIN threads ON threads.id = collection_threads.thread_id
       WHERE collection_threads.collection_number = (SELECT number FROM collections WHERE lower(name) = ${w.add(WORK_COLLECTION)})
         AND threads.space = ${w.add(product)} AND threads.status IN (${w.list(TABS.pending)})
       ORDER BY collection_threads.position`,
      w,
    ),
    db.prepare("SELECT number, title FROM threads WHERE origin_ref LIKE 'log:engage-%' ORDER BY origin_ref DESC LIMIT 1"),
  ]);
  const rows = <T>(result: D1Result<unknown> | undefined): T[] => (result?.results ?? []) as T[];
  return {
    platforms: rows<PlatformRow>(platforms),
    acts: rows<ActRow>(acts),
    readings: rows<ReadingRow>(readings),
    collection: rows<{ number: number }>(collection)[0]?.number ?? null,
    work: rows<WorkRow>(work),
    log: rows<{ number: number; title: string | null }>(log)[0] ?? null,
  };
}

/** A person's acts, voided ones left out, newest first: their page's read, for him and the sync. */
export async function actsOfPerson(db: D1Database, personId: string, limit: number): Promise<ActRow[]> {
  return (await db.prepare(`SELECT ${ACT_COLUMNS} FROM ${ACT_FROM} WHERE distribution_acts.person_id = ?1 AND distribution_acts.voided_at IS NULL ${NEWEST} LIMIT ${limit}`).bind(personId).all<ActRow>())
    .results;
}
