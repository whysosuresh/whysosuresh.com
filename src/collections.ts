// The collections' calls under /threads/api/collections, behind the threads' Access application and the door's own
// check of who is calling (src/threads.ts routes here once the caller is named): his named sets of the threads worth
// keeping, each in his own order (src/collections-store.ts, migrations/0023_collections.sql).
//
//   GET  /threads/api/collections[?q=<words>][&after=<n>]          owner and sync: the pinned ones and a page of the rest
//   POST /threads/api/collections          {"name", "description"?}  owner and sync: a new collection
//   GET  /threads/api/collections/<n>[?q=<words>][&status=open|done][&after=<place>]   owner and sync: it and a page of its threads
//   POST /threads/api/collections/<n>      {"name"} | {"description"} | {"rule"} | {"pinned"} | {"delete": true}   owner and sync
//   POST /threads/api/collections/<n>/threads   {"add": <thread>} | {"remove": <thread>} | {"move": <thread>, "to": <place>}   owner and sync
//   GET  /threads/api/collections/<n>/people                   owner: who it is shared with, and how many are invited in all
//   POST /threads/api/collections/<n>/people   {"add": {"email", "name"}} | {"remove": <person id>}   owner
//   GET  /threads/api/collections[?q=<words>], GET /threads/api/collections/<n>[?...]   invited people: the ones shared with them
//
// The list answers every pinned collection in pinning order (`pinned`, for his menu, whatever page he is on), then 25
// of the rest, the most recently changed first, with the number to go on from (`next`) and how many the rest are
// (`count`); with words it answers 25 of the collections whose name or description holds them, pinned or not, and no
// pinned list. A collection answers 50 of its threads in his order, each shaped as every list's thread is with its
// place (`place`, from 1), filtered to the open or closed ones and to those holding the words when asked, with the
// place to go on from and how many meet the filter.
//
// A name is one line of at most 80 characters, unique ignoring case (409 `name-taken`); a description at most 280
// (an empty one clears it); a rule is a title prefix of at most 80 (null or empty clears it), which keeps every new
// thread of his or the sync's whose title begins with it, from then on. Pinning puts a collection on his menu.
// Deleting is for good, and takes only the collection: its threads stay as they are, their history included. Adding
// a thread puts it at the end (one already there stays where it is), taking it out closes the gap, and moving it takes
// it to the place asked for, clamped to the places there are (409 `not-kept` for a thread that isn't in it). A
// collection nobody has answers 404 `no-collection`, a thread 404 `no-thread`.
//
// Collections are his and the sync's, and his to share: inviting a person to one opens every thread in it to them, the
// ones added later included, and taking the invitation back closes them, through the one membership test every read
// holds (src/store.ts), with nothing written per thread. The people calls are his alone, from his own page; the sync is
// refused them with 403 `owner-only`, because an invitation grants access. An invited person reads the collections
// shared with them (their name, description, how many threads, and a page of the threads in his order, each shaped as
// their threads are), never another collection, which answers exactly as a number never used (404 `no-collection`),
// and never its people, rule or pin; every other call refuses them with 403 `owner-only` before anything is read. His
// writes come only from his own page, as every write of his does. Making a collection public is never the sync's.
// Nothing personal is logged: a refusal's line holds its status and reason only.

import type { Caller } from "./access.ts";
import { invitedCount, type PersonRow } from "./store.ts";
import type { Bindings } from "./bindings.ts";
import { json, type JsonValue } from "./json.ts";
import { sameOrigin } from "./request.ts";
import {
  changeCollection,
  collectionPeople,
  collectionThreads,
  collectionsFor,
  createCollection,
  findCollection,
  findCollectionFor,
  inviteToCollection,
  keep,
  listCollections,
  moveKept,
  uninviteFromCollection,
  unkeep,
  type CollectionChange,
  type CollectionRow,
  type KeptChange,
  type KeptFilter,
} from "./collections-store.ts";
import type { ThreadRow } from "./store.ts";
import { MAX_CHANGE_BYTES, MAX_PERSON_NAME, exactly, lengthRefusal, line, readEmail, readJson, refuse } from "./wire.ts";

/** The most collections one page of the list answers. */
const COLLECTIONS_PAGE = 25;
/** The most threads one page of a collection answers. */
const THREADS_PAGE = 50;
/** The longest name, and the longest rule, in UTF-16 code units of the trimmed text. */
export const MAX_COLLECTION_NAME = 80;
/** The longest description, in UTF-16 code units of the trimmed text. */
export const MAX_COLLECTION_DESCRIPTION = 280;
/** The longest search, as the threads' search takes. */
const MAX_SEARCH = 100;
/** A collection's or a thread's number, or a place, as a path or a query names it: no sign, no leading zero, at most nine digits. */
const NUMBER_SHAPE = /^[1-9]\d{0,8}$/;

/** How the door shapes a thread for its reader (src/threads.ts), so a collection's threads read as every list's do. */
export type ThreadView = (row: ThreadRow) => { readonly [key: string]: JsonValue };

/** A collection as he and the sync read it. */
export function collectionView(row: CollectionRow): { readonly [key: string]: JsonValue } {
  return {
    number: row.number,
    name: row.name,
    description: row.description,
    rule: row.rule_prefix,
    pinned: row.pinned_at !== null,
    changedAt: row.changed_at,
    createdAt: row.created_at,
    threads: row.threads,
  };
}

/** A collection as an invited person reads it: what it is and how many threads, never its rule, pin or people. */
export function sharedView(row: CollectionRow): { readonly [key: string]: JsonValue } {
  return { number: row.number, name: row.name, description: row.description, changedAt: row.changed_at, threads: row.threads };
}

/** A person or a comment's id, as the store gives it. */
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The people a collection is shared with, as his Share reads them. */
function peopleView(people: readonly PersonRow[]): JsonValue {
  return people.map((person) => ({ id: person.id, number: person.number, name: person.name, email: person.email, addedAt: person.added_at, photo: person.photo_id }));
}

/** A whole number from 1, as a write names a thread or a place. */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 999_999_999;
}

/** The one value a query names under `key`, or null when absent; undefined when it is there twice. */
function single(url: URL, key: string): string | null | undefined {
  const values = url.searchParams.getAll(key);
  return values.length === 0 ? null : values.length === 1 ? values[0] : undefined;
}

/** Search words from a query: none when absent or empty, undefined when malformed. */
function wordsOf(url: URL): string | null | undefined {
  const given = single(url, "q");
  if (given === undefined) return undefined;
  if (given === null || given.trim() === "") return null;
  return line(given, MAX_SEARCH) ?? undefined;
}

async function list(url: URL, env: Bindings): Promise<Response> {
  if ([...url.searchParams.keys()].some((key) => key !== "q" && key !== "after")) return refuse(400, "query");
  const words = wordsOf(url);
  const after = single(url, "after");
  if (words === undefined || after === undefined || (after !== null && !NUMBER_SHAPE.test(after))) return refuse(400, "query");
  const listed = await listCollections(env.DB, words, after === null ? null : Number(after), COLLECTIONS_PAGE + 1);
  const shown = listed.rows.slice(0, COLLECTIONS_PAGE);
  const last = shown[shown.length - 1];
  return json(200, {
    pinned: listed.pinned.map(collectionView),
    collections: shown.map(collectionView),
    next: listed.rows.length > COLLECTIONS_PAGE && last !== undefined ? last.number : null,
    count: listed.count,
  });
}

/** An invited person's collections: those shared with them, searched by words when given. */
async function listShared(url: URL, env: Bindings, email: string): Promise<Response> {
  if ([...url.searchParams.keys()].some((key) => key !== "q")) return refuse(400, "query");
  const words = wordsOf(url);
  if (words === undefined) return refuse(400, "query");
  const rows = await collectionsFor(env.DB, email, words);
  return json(200, { pinned: [], collections: rows.map(sharedView), next: null, count: rows.length });
}

/** Who a collection is shared with, and how many people are invited to anything: his Share's read. */
async function people(number: number, env: Bindings): Promise<Response> {
  if ((await findCollection(env.DB, number)) === null) return refuse(404, "no-collection");
  const [shared, count] = await Promise.all([collectionPeople(env.DB, number), invitedCount(env.DB)]);
  return json(200, { people: peopleView(shared), invitedCount: count });
}

/** Invites a person to a collection, or takes the invitation back; answers its people as they now stand. */
async function changePeople(request: Request, number: number, env: Bindings): Promise<Response> {
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const given = await readJson(request);
  const adding = exactly(given, ["add"]);
  const removing = exactly(given, ["remove"]);
  if (adding !== null) {
    const fields = exactly(adding.add, ["email", "name"]);
    const email = fields === null ? "person" : readEmail(fields.email, env);
    const name = fields === null ? null : line(fields.name, MAX_PERSON_NAME);
    if (email === "owner") return refuse(400, "owner");
    if (email === "person" || name === null) return refuse(400, "person");
    if ((await inviteToCollection(env.DB, number, { email: email.email, name })) === "no-collection") return refuse(404, "no-collection");
    return people(number, env);
  }
  if (removing !== null && typeof removing.remove === "string" && ID_SHAPE.test(removing.remove)) {
    const ended = await uninviteFromCollection(env.DB, number, removing.remove);
    if (ended === "no-collection") return refuse(404, ended);
    if (ended === "not-invited") return refuse(409, ended);
    return people(number, env);
  }
  return refuse(400, "person");
}

async function one(url: URL, number: number, env: Bindings, shape: ThreadView, caller: Caller): Promise<Response> {
  if ([...url.searchParams.keys()].some((key) => key !== "q" && key !== "status" && key !== "after")) return refuse(400, "query");
  const words = wordsOf(url);
  const status = single(url, "status");
  const after = single(url, "after");
  if (words === undefined || after === undefined || (after !== null && !NUMBER_SHAPE.test(after))) return refuse(400, "query");
  if (status === undefined || (status !== null && status !== "open" && status !== "done")) return refuse(400, "query");
  // An invited person reads a collection only while it is shared with them; any other answers as a number never used.
  const row = caller.caller === "member" ? await findCollectionFor(env.DB, number, caller.email) : await findCollection(env.DB, number);
  if (row === null) return refuse(404, "no-collection");
  const kept = await collectionThreads(env.DB, number, words, status satisfies KeptFilter, after === null ? null : Number(after) - 1, THREADS_PAGE + 1);
  const shown = kept.rows.slice(0, THREADS_PAGE);
  const last = shown[shown.length - 1];
  return json(200, {
    collection: caller.caller === "member" ? sharedView(row) : collectionView(row),
    threads: shown.map((thread) => ({ ...shape(thread), place: thread.position + 1 })),
    next: kept.rows.length > THREADS_PAGE && last !== undefined ? last.position + 1 : null,
    count: kept.count,
  });
}

/** A description as a write gives it: one line of at most 280, an empty one clearing it; undefined when malformed. */
function descriptionOf(value: unknown): string | null | undefined {
  if (typeof value === "string" && value.trim() === "") return null;
  return line(value, MAX_COLLECTION_DESCRIPTION) ?? undefined;
}

async function make(request: Request, env: Bindings): Promise<Response> {
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const given = await readJson(request);
  const fields = exactly(given, ["name"]) ?? exactly(given, ["name", "description"]);
  const name = line(fields?.name, MAX_COLLECTION_NAME);
  const description = fields === null || !("description" in fields) ? null : descriptionOf(fields.description);
  if (name === null || description === undefined) return refuse(400, "collection");
  const made = await createCollection(env.DB, name, description);
  if (made === "name-taken") return refuse(409, "name-taken");
  return json(201, { collection: collectionView(made) });
}

/** The change a request asks for, or null for a malformed one: exactly one field. */
function readChange(value: unknown): CollectionChange | null {
  const name = exactly(value, ["name"]);
  if (name !== null) {
    const given = line(name.name, MAX_COLLECTION_NAME);
    return given === null ? null : { name: given };
  }
  const description = exactly(value, ["description"]);
  if (description !== null) {
    const given = descriptionOf(description.description);
    return given === undefined ? null : { description: given };
  }
  const rule = exactly(value, ["rule"]);
  if (rule !== null) {
    if (rule.rule === null || (typeof rule.rule === "string" && rule.rule.trim() === "")) return { rule: null };
    const given = line(rule.rule, MAX_COLLECTION_NAME);
    return given === null ? null : { rule: given };
  }
  const pinned = exactly(value, ["pinned"]);
  if (pinned !== null) return typeof pinned.pinned === "boolean" ? { pinned: pinned.pinned } : null;
  const gone = exactly(value, ["delete"]);
  return gone !== null && gone.delete === true ? { delete: true } : null;
}

async function change(request: Request, number: number, env: Bindings): Promise<Response> {
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const asked = readChange(await readJson(request));
  if (asked === null) return refuse(400, "collection");
  const changed = await changeCollection(env.DB, number, asked);
  if (changed === "no-collection") return refuse(404, changed);
  if (changed === "name-taken") return refuse(409, changed);
  if (changed === "deleted") return json(200, { deleted: true });
  return json(200, { collection: collectionView(changed) });
}

async function changeThreads(request: Request, number: number, env: Bindings, caller: "owner" | "sync"): Promise<Response> {
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const given = await readJson(request);
  const add = exactly(given, ["add"]);
  const remove = exactly(given, ["remove"]);
  const move = exactly(given, ["move", "to"]);
  let changed: KeptChange;
  if (add !== null && isNumber(add.add)) changed = await keep(env.DB, number, add.add, caller);
  else if (remove !== null && isNumber(remove.remove)) changed = await unkeep(env.DB, number, remove.remove, caller);
  else if (move !== null && isNumber(move.move) && isNumber(move.to)) changed = await moveKept(env.DB, number, move.move, move.to - 1);
  else return refuse(400, "change");
  if (changed === "no-collection" || changed === "no-thread") return refuse(404, changed);
  if (changed === "not-kept") return refuse(409, changed);
  return json(200, { collection: collectionView(changed.collection), place: changed.position === null ? null : changed.position + 1 });
}

/**
 * Answers every request under /threads/api/collections for a caller the door has named; `shape` is how the door
 * shapes a thread for them. Every refusal of a caller comes before anything is read.
 */
export async function handleCollections(request: Request, url: URL, env: Bindings, caller: Caller, shape: ThreadView): Promise<Response> {
  const route = /^\/threads\/api\/collections(?:\/([^/]+)(?:\/(threads|people))?)?$/.exec(url.pathname);
  if (route === null) return json(404, { reason: "not-found" });
  const [, given, part] = route;
  const readable = part === undefined || part === "people";
  const allowed = readable ? "GET, POST" : "POST";
  if (request.method !== "POST" && !(readable && request.method === "GET")) return json(405, { reason: "method" }, { Allow: allowed });
  // An invited person reads the collections shared with them, and nothing else: every other call is refused before
  // anything is read, so the refusal says nothing about a number.
  if (caller.caller === "member") {
    if (request.method !== "GET" || part !== undefined) return refuse(403, "owner-only");
    if (given === undefined) return listShared(url, env, caller.email);
    return NUMBER_SHAPE.test(given) ? one(url, Number(given), env, shape, caller) : refuse(404, "no-collection");
  }
  // Sharing grants access, so the people calls are his alone, never the sync's.
  if (part === "people" && caller.caller !== "owner") return refuse(403, "owner-only");
  // Same-origin keeps another site from borrowing his signed-in cookie; the sync's token travels in headers no other
  // site can set, so it has no origin to show.
  if (request.method === "POST" && caller.caller === "owner" && !sameOrigin(request)) return refuse(403, "origin");
  if (request.method === "POST" && url.search !== "") return refuse(400, "query");
  if (given === undefined) return request.method === "GET" ? list(url, env) : make(request, env);
  if (!NUMBER_SHAPE.test(given)) return refuse(404, "no-collection");
  const number = Number(given);
  if (part === "threads") return changeThreads(request, number, env, caller.caller);
  if (part === "people") {
    if (request.method === "GET" && url.search !== "") return refuse(400, "query");
    return request.method === "GET" ? people(number, env) : changePeople(request, number, env);
  }
  return request.method === "GET" ? one(url, number, env, shape, caller) : change(request, number, env);
}
