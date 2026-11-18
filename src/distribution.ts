// Distribution's calls under /threads/api/distribution, behind the threads' Access application and the door's own
// check of who is calling (src/threads.ts routes here once the caller is named): where telling people about Stigmer
// and CapsJump stands (src/distribution-store.ts, migrations/0026_distribution.sql), read by Suresh and the recorder
// sync and written by the sync alone, as each of its distribution runs ends.
//
//   GET  /threads/api/distribution?product=<p>[&since=<day>]   owner and sync: the product's room
//   POST /threads/api/distribution/acts                {"ref", "at", "product", "platform", "kind", "line", ...}   sync: one act
//   POST /threads/api/distribution/acts/<id>/void                                  sync: a wrong act voided
//   POST /threads/api/distribution/platforms/<p>/<platform>   {"state", "note", "until", "pace"}   sync: where it stands
//   POST /threads/api/distribution/readings/<p>/<week>        {"<metric>": <value>, ...}          sync: a week's numbers
//
// The room answers the product's platforms, its acts of the last 35 days (or since the day asked, at most 90 days
// back), newest first, each with the person it names by number and name, its readings of the last 12 weeks, the open
// threads of his collection named Distribution in the product's space (`work`, each shaped as every list's thread is,
// and the collection's number, null while he has none), and the newest Engage log thread (`log`). Voided acts are in
// none of it.
//
// An act is one thing that happened, written once by its origin (`ref`, a kind, a colon and an id, at most 200; the
// origins `platform:` and `ask:` are the store's own): 201 with the act when it is kept, 200 with the act already
// there when its origin was. Its moment (`at`) carries its zone; `product` is `stigmer` or `capsjump`; `platform` a
// slug of lowercase letters, digits and hyphens, at most 30; `kind` one of the store's; `line` one plain sentence of
// at most 200 characters. It may name an `audience`, its address (`url`) and the address of the post its replies hang
// from (`conversation`), each at most 2,048, and the person it was with (`person`): a number (404 `no-person` when
// nobody has it), or `{"name"}`, which joins the one person with that name or makes a new person with no address,
// only when the act is kept. A void sets the act's `voided_at` once and answers it; a second void answers it unchanged.
//
// A platform write replaces where it stands (`state` one of the store's, a `note` of one line at most 140, a day to
// look again `until`, a `pace` of 1 to 14 acts of ours a week; each but the state may be null) and writes its `event`
// act in the same batch. A reading is a whole number from 0, by a metric's slug (lowercase letters, digits and `_`,
// at most 40), for an ISO week (`2026-W47`); a second reading that week replaces the first.
//
// Every refusal of a caller comes before anything is read: an invited person gets 403 `owner-only` on every call,
// because this is his and the sync's alone, and every write refuses the owner with 403 `sync-only`, because the
// room is his to read and the sync's to keep. A value outside its shape is 400 naming the field. Nothing an act says
// is ever logged; a refusal's line holds its status and reason only.

import type { Caller } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { json, type JsonValue } from "./json.ts";
import { isWeekKey, weekOf } from "../site/app/journal.js";
import {
  AUDIENCES,
  KINDS,
  PRODUCTS,
  STATES,
  actsOfPerson,
  addAct,
  readRoom,
  setPlatform,
  setReadings,
  voidAct,
  type ActRow,
  type Audience,
  type Kind,
  type NewAct,
  type PlatformChange,
  type PlatformRow,
  type Product,
  type State,
} from "./distribution-store.ts";
import type { ThreadRow } from "./store.ts";
import { MAX_ACT_BYTES, MAX_CHANGE_BYTES, MAX_PERSON_NAME, calendarDay, exactly, lengthRefusal, line, momentOf, readJson, refuse } from "./wire.ts";

/** The days the room reads back by default: five weeks, so a week's pace and a quiet spell always see last week whole. */
const ROOM_DAYS = 35;
/** The furthest back a run may ask the room to read. */
const MAX_DAYS = 90;
/** The weeks of readings the room answers. */
const READING_WEEKS = 12;
/** The most acts one read answers; `truncated` says there were more. */
const MAX_ACTS = 1000;
/** The most acts a person's page answers. */
export const PERSON_ACTS = 200;
const DAY_MS = 24 * 3600 * 1000;
/** An origin: a kind, a colon, and an id of printable ASCII, at most 200 in all. */
const REF_SHAPE = /^[a-z]+:[\x21-\x7e]{1,190}$/;
/** A platform's slug: lowercase letters, digits and hyphens, at most 30, starting and ending with a letter or digit. */
export const PLATFORM_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;
/** A metric's slug: lowercase letters, digits and `_`, starting with a letter, at most 40. */
const METRIC_SHAPE = /^[a-z][a-z0-9_]{0,39}$/;
/** An act's id, as the store gives it. */
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The longest act line, and the longest platform note, in UTF-16 code units of the trimmed text. */
const MAX_LINE = 200;
const MAX_NOTE = 140;
/** The longest address an act carries. */
const MAX_URL = 2048;
/** The most metrics one reading names. */
const MAX_METRICS = 20;
/** The largest reading. */
const MAX_VALUE = 999_999_999_999;
/** Every key an act may carry; the first six it must. */
const ACT_KEYS = ["ref", "at", "product", "platform", "kind", "line", "audience", "url", "conversation", "person"];
const REQUIRED = ACT_KEYS.slice(0, 6);

function isProduct(value: unknown): value is Product {
  return typeof value === "string" && (PRODUCTS as readonly string[]).includes(value);
}

/** An act as he and the sync read it. */
export function actView(row: ActRow): { readonly [key: string]: JsonValue } {
  return {
    id: row.id,
    ref: row.ref,
    at: row.at,
    product: row.product,
    platform: row.platform,
    kind: row.kind,
    audience: row.audience,
    url: row.url,
    conversation: row.conversation,
    person: row.person_number === null ? null : { number: row.person_number, name: row.person_name },
    line: row.line,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
  };
}

function platformView(row: PlatformRow): { readonly [key: string]: JsonValue } {
  return { platform: row.platform, state: row.state, note: row.note, until: row.until, pace: row.pace_per_week, changedAt: row.changed_at };
}

/** A person's acts for their page (src/people.ts): what was done with them, where, and when. */
export async function personActs(db: D1Database, personId: string): Promise<{ readonly acts: JsonValue; readonly more: boolean }> {
  const rows = await actsOfPerson(db, personId, PERSON_ACTS + 1);
  return { acts: rows.slice(0, PERSON_ACTS).map(actView), more: rows.length > PERSON_ACTS };
}

/** An address an act carries: http or https, at most 2,048, with no space or control character; null when absent. */
function address(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > MAX_URL || !/^https?:\/\/[\x21-\x7e]+$/.test(value)) return undefined;
  try {
    new URL(value);
  } catch {
    return undefined;
  }
  return value;
}

/** An act as a write gives it, or the field that is wrong, in a fixed order. */
export function readAct(value: unknown): NewAct | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "act";
  const given = value as Record<string, unknown>;
  const keys = Object.keys(given);
  if (keys.some((key) => !ACT_KEYS.includes(key)) || REQUIRED.some((key) => !keys.includes(key))) return "keys";
  const ref = given.ref;
  if (typeof ref !== "string" || !REF_SHAPE.test(ref) || ref.startsWith("platform:") || ref.startsWith("ask:")) return "ref";
  const at = momentOf(given.at);
  if (at === null) return "at";
  if (!isProduct(given.product)) return "product";
  const platform = given.platform;
  if (typeof platform !== "string" || !PLATFORM_SHAPE.test(platform)) return "platform";
  const kind = given.kind;
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) return "kind";
  const said = line(given.line, MAX_LINE);
  if (said === null) return "line";
  const audience = given.audience ?? null;
  if (audience !== null && (typeof audience !== "string" || !(AUDIENCES as readonly string[]).includes(audience))) return "audience";
  const url = address(given.url);
  if (url === undefined) return "url";
  const conversation = address(given.conversation);
  if (conversation === undefined) return "conversation";
  const who = given.person ?? null;
  let person: NewAct["person"] = null;
  if (typeof who === "number") {
    if (!Number.isInteger(who) || who < 1 || who > 999_999_999) return "person";
    person = { number: who };
  } else if (who !== null) {
    const named = exactly(who, ["name"]);
    const name = named === null ? null : line(named.name, MAX_PERSON_NAME);
    if (name === null) return "person";
    person = { name };
  }
  return { ref, at, product: given.product, platform, kind: kind as Kind, audience: audience as Audience | null, url, conversation, person, line: said };
}

/** A platform's state as a write gives it, every key present; null for anything else. */
function readPlatform(value: unknown): PlatformChange | null {
  const given = exactly(value, ["state", "note", "until", "pace"]);
  if (given === null) return null;
  const state = given.state;
  if (typeof state !== "string" || !(STATES as readonly string[]).includes(state)) return null;
  const note = given.note === null ? null : line(given.note, MAX_NOTE);
  if (given.note !== null && note === null) return null;
  const until = given.until === null ? null : typeof given.until === "string" ? calendarDay(given.until) : null;
  if (given.until !== null && until === null) return null;
  const pace = given.pace;
  if (pace !== null && (typeof pace !== "number" || !Number.isInteger(pace) || pace < 1 || pace > 14)) return null;
  return { state: state as State, note, until, pace };
}

/** A week's readings as a write gives them, by metric; null for anything else. */
function readReadings(value: unknown): Map<string, number> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_METRICS) return null;
  const values = new Map<string, number>();
  for (const [metric, given] of entries) {
    if (!METRIC_SHAPE.test(metric) || typeof given !== "number" || !Number.isInteger(given) || given < 0 || given > MAX_VALUE) return null;
    values.set(metric, given);
  }
  return values;
}

/** How the door shapes a thread for its reader (src/threads.ts), so the work reads as every list's threads do. */
export type ThreadView = (row: ThreadRow) => { readonly [key: string]: JsonValue };

async function room(url: URL, env: Bindings, shape: ThreadView): Promise<Response> {
  const asked = [...url.searchParams.keys()];
  if (asked.some((key) => key !== "product" && key !== "since") || url.searchParams.getAll("product").length !== 1 || url.searchParams.getAll("since").length > 1) {
    return refuse(400, "query");
  }
  const product = url.searchParams.get("product");
  if (!isProduct(product)) return refuse(400, "product");
  const today = new Date().toISOString().slice(0, 10);
  const earliest = new Date(Date.parse(`${today}T00:00:00.000Z`) - MAX_DAYS * DAY_MS).toISOString().slice(0, 10);
  const given = url.searchParams.get("since");
  const since = given === null ? new Date(Date.parse(`${today}T00:00:00.000Z`) - ROOM_DAYS * DAY_MS).toISOString().slice(0, 10) : calendarDay(given);
  if (since === null || since < earliest) return refuse(400, "since");
  const fromWeek = weekOf(new Date(Date.parse(`${today}T00:00:00.000Z`) - (READING_WEEKS - 1) * 7 * DAY_MS).toISOString().slice(0, 10));
  const read = await readRoom(env.DB, product, `${since}T00:00:00.000Z`, fromWeek, MAX_ACTS + 1);
  return json(200, {
    product,
    since,
    platforms: read.platforms.map(platformView),
    acts: read.acts.slice(0, MAX_ACTS).map(actView),
    truncated: read.acts.length > MAX_ACTS,
    readings: read.readings.map((row) => ({ metric: row.metric, week: row.week, value: row.value, readAt: row.read_at })),
    work: { collection: read.collection, threads: read.work.map((row) => ({ ...shape(row), place: row.position + 1 })) },
    log: read.log,
  });
}

async function act(request: Request, env: Bindings): Promise<Response> {
  const length = lengthRefusal(request, MAX_ACT_BYTES);
  if (length !== null) return length;
  const given = readAct(await readJson(request));
  if (typeof given === "string") return refuse(400, given);
  const kept = await addAct(env.DB, given);
  if (kept === "no-person") return refuse(404, "no-person");
  return json(kept.added ? 201 : 200, { act: actView(kept.act) });
}

async function cancel(request: Request, id: string, env: Bindings): Promise<Response> {
  // A void carries nothing; a body, if any, must still be small.
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d{1,12}$/.test(declared) || Number(declared) > MAX_CHANGE_BYTES)) return refuse(413, "too-large");
  if (!ID_SHAPE.test(id)) return refuse(404, "no-act");
  const row = await voidAct(env.DB, id);
  if (row === null) return refuse(404, "no-act");
  return json(200, { act: actView(row) });
}

async function platform(request: Request, product: string, slug: string, env: Bindings): Promise<Response> {
  if (!isProduct(product)) return refuse(400, "product");
  if (!PLATFORM_SHAPE.test(slug)) return refuse(400, "platform");
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const change = readPlatform(await readJson(request));
  if (change === null) return refuse(400, "state");
  return json(200, { platform: platformView(await setPlatform(env.DB, product, slug, change)) });
}

async function readings(request: Request, product: string, week: string, env: Bindings): Promise<Response> {
  if (!isProduct(product)) return refuse(400, "product");
  if (!isWeekKey(week)) return refuse(400, "week");
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const values = readReadings(await readJson(request));
  if (values === null) return refuse(400, "readings");
  const rows = await setReadings(env.DB, product, week, values);
  return json(200, { product, week, readings: rows.map((row) => ({ metric: row.metric, value: row.value, readAt: row.read_at })) });
}

/**
 * Answers every request under /threads/api/distribution for a caller the door has named; `shape` is how the door
 * shapes a thread for them. Every refusal of a caller comes before anything is read: the address, the method, then an
 * invited person, then the owner on a write, then the query.
 */
export async function handleDistribution(request: Request, url: URL, env: Bindings, caller: Caller, shape: ThreadView): Promise<Response> {
  const route = /^\/threads\/api\/distribution(?:\/(acts|platforms|readings)(?:\/([^/]+)(?:\/([^/]+))?)?)?$/.exec(url.pathname);
  if (route === null) return json(404, { reason: "not-found" });
  const [, part, first, second] = route;
  const known =
    part === undefined ||
    (part === "acts" && (first === undefined || second === "void")) ||
    ((part === "platforms" || part === "readings") && first !== undefined && second !== undefined);
  if (!known) return json(404, { reason: "not-found" });
  const allow = part === undefined ? "GET" : "POST";
  if (request.method !== allow) return json(405, { reason: "method" }, { Allow: allow });
  if (caller.caller === "member") return refuse(403, "owner-only");
  if (request.method === "POST") {
    if (caller.caller !== "sync") return refuse(403, "sync-only");
    if (url.search !== "") return refuse(400, "query");
  }
  if (part === undefined) return room(url, env, shape);
  if (part === "acts") return first === undefined ? act(request, env) : cancel(request, first, env);
  if (part === "platforms") return platform(request, first ?? "", second ?? "", env);
  return readings(request, first ?? "", second ?? "", env);
}
