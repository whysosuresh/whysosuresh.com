// The journal's calls under /threads/api/journal, behind the threads' Access application and the door's own check of
// who is calling (src/threads.ts routes here once the caller is named). The journal is Suresh's alone: the owner and
// the recorder sync read it, and nobody else ever does. There is no public call, an invited person is refused every
// call with 403 `owner-only` before anything is read, and no journal word is ever logged.
//
//   GET  /threads/api/journal                     owner and sync: every entry's newest version, indexed, newest first
//   GET  /threads/api/journal/<key>[?version=n]   owner and sync: its text (the newest, or version n), every version,
//                                                 and a day's typed answers
//   POST /threads/api/journal/<key>   {"text", "base"}   owner (a hand edit, from his own page) and sync: a new version
//   POST /threads/api/journal/<day>/answers   {"body"}   owner, from his own page: an answer to the day's question
//   POST /threads/api/journal/photos              a JPEG or PNG   sync: a photo a page may show
//   GET  /threads/api/journal/photos/<id>         owner and sync: the photo itself
//   GET  /threads/api/journal/storylines          owner and sync: every storyline's trail across the days
//
// A key is a real calendar day (`2026-11-06`) or ISO week (`2026-W44`); anything else answers 404 `no-entry`, the
// same bytes as a day never written. An entry is the whole page text in the sync's grammar (site/app/journal.js,
// which reads it here to index it, as the page reads it to draw it), stored byte for byte as sent, at most 64,000
// characters and 100 storylines, and it must have a `## ` title (400 `journal`). A photo it shows is `photo:<id>` of a
// photo already uploaded, at most 100 of them (400 `photo` otherwise).
// A save that fails for any other reason fails as itself, never as stale, so nothing retries it for ever. Every save names the version it was built on (`base`, 0 for a new entry): while
// that is still the newest, the save is version `base + 1` (201); otherwise nothing is written and the answer is 409
// `stale` with the newest version, so the sync reads, rebuilds and saves again, and a hand edit is never lost. Every
// version is kept for good. An answer is at most 4,000 characters, on a day that has an entry (404 `no-entry`); all
// are kept, the newest is the answer, and an empty one takes it back.
//
// A photo is uploaded as its own bytes, its declared length at most 4 MiB, its declared type `image/jpeg` or
// `image/png`, and its first bytes that type's signature (415 `type` otherwise), because it is served as itself: the
// site's one image check (src/images.ts), which his own photo and the Gravatars the hourly run copies share. The
// object goes into the private pages bucket first, under a fresh key, then its row; when the row isn't kept the object
// is deleted again. It is served with its stored type, `nosniff`, a sandboxing CSP, and `Cache-Control: private,
// max-age=31536000, immutable`, because a photo never changes.

import { kindOf, newestFirst, parse, photosOf, type Storyline } from "../site/app/journal.js";
import type { Caller } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { PHOTO_ID, imageHeaders, readImage } from "./images.ts";
import { json, type JsonValue } from "./json.ts";
import { addAnswer, findPhoto, keepPhoto, listEntries, missingPhotos, readEntry, saveEntry, storylineLines, type EntryRow } from "./journal-store.ts";
import { sameOrigin } from "./request.ts";
import { MAX_ANSWER, MAX_JOURNAL, MAX_JOURNAL_BYTES, MAX_PHOTO_BYTES, MAX_TEXT_BYTES, exactly, lengthRefusal, readJson, refuse } from "./wire.ts";

/** A body may keep its line breaks and tabs; every other control character is refused. */
const BODY_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
/** A version as a query names it: no sign, no leading zero, at most nine digits. */
const VERSION_SHAPE = /^[1-9]\d{0,8}$/;
/** The most storylines, and the most photos, one page may name: far beyond a day, and within D1's bound parameters. */
const MAX_LINES = 100;

/** An entry's index row as the owner and the sync read it. */
function entryView(row: EntryRow): { readonly [key: string]: JsonValue } {
  return {
    key: row.key,
    kind: row.kind,
    version: row.version,
    savedAt: row.saved_at,
    title: row.title,
    oneLine: row.one_line,
    stories: row.stories,
    photos: row.photos,
    question: row.question,
  };
}

async function everything(env: Bindings): Promise<Response> {
  return json(200, { entries: newestFirst(await listEntries(env.DB)).map(entryView) });
}

async function read(url: URL, key: string, env: Bindings): Promise<Response> {
  const asked = [...url.searchParams.keys()];
  if (asked.some((name) => name !== "version") || url.searchParams.getAll("version").length > 1) return refuse(400, "query");
  const given = url.searchParams.get("version");
  if (given !== null && !VERSION_SHAPE.test(given)) return refuse(404, "no-entry");
  const found = await readEntry(env.DB, key, given === null ? null : Number(given));
  if (found === null) return refuse(404, "no-entry");
  return json(200, {
    key,
    kind: found.entry.kind,
    version: found.text.version,
    newest: found.entry.version,
    text: found.text.text,
    savedAt: found.text.saved_at,
    actor: found.text.actor,
    versions: found.versions.map((row) => ({ version: row.version, savedAt: row.saved_at, actor: row.actor, bytes: row.bytes })),
    answers: found.answers.map((row) => ({ id: row.id, body: row.body, createdAt: row.created_at })),
  });
}

/** A page text as sent, unchanged: a string of at most MAX_JOURNAL code units, well-formed, with no stray control character. */
function pageText(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_JOURNAL || !value.isWellFormed() || BODY_CONTROL.test(value)) return null;
  return value;
}

/** Each storyline once, at its last line on the page, as the sync's grammar asks. */
function onceEach(lines: readonly Storyline[]): Storyline[] {
  const byName = new Map<string, Storyline>();
  for (const line of lines) byName.set(line.name, line);
  return [...byName.values()];
}

async function write(request: Request, key: string, kind: "day" | "week", env: Bindings, actor: "owner" | "sync"): Promise<Response> {
  const length = lengthRefusal(request, MAX_JOURNAL_BYTES);
  if (length !== null) return length;
  const given = exactly(await readJson(request), ["base", "text"]);
  if (given === null) return refuse(400, "journal");
  const base = given.base;
  const text = pageText(given.text);
  if (typeof base !== "number" || !Number.isInteger(base) || base < 0 || base > 999_999_999 || text === null) return refuse(400, "journal");
  const entry = parse(text);
  if (entry === null) return refuse(400, "journal");
  const lines = onceEach(entry.storylines);
  if (lines.length > MAX_LINES) return refuse(400, "journal");
  const photos = photosOf(entry);
  if (new Set(photos).size > MAX_LINES || (await missingPhotos(env.DB, photos)).length > 0) return refuse(400, "photo");
  const saved = await saveEntry(
    env.DB,
    {
      key,
      kind,
      base,
      text,
      bytes: new TextEncoder().encode(text).byteLength,
      title: entry.title,
      oneLine: entry.oneLine,
      stories: entry.stories.length,
      photos: photos.length,
      question: kind === "day" ? entry.question : null,
      storylines: kind === "day" ? lines : [],
    },
    actor,
  );
  if ("stale" in saved) {
    console.log(JSON.stringify({ refused: 409, reason: "stale" }));
    return json(409, { reason: "stale", version: saved.stale });
  }
  return json(201, { key, version: saved.version });
}

async function answer(request: Request, key: string, env: Bindings): Promise<Response> {
  const length = lengthRefusal(request, MAX_TEXT_BYTES);
  if (length !== null) return length;
  const given = exactly(await readJson(request), ["body"]);
  const body = given === null || typeof given.body !== "string" ? null : given.body.trim();
  if (body === null || body.length > MAX_ANSWER || !body.isWellFormed() || BODY_CONTROL.test(body)) return refuse(400, "answer");
  const kept = await addAnswer(env.DB, key, body);
  if (kept === null) return refuse(404, "no-entry");
  return json(201, { answer: { id: kept.id, body: kept.body, createdAt: kept.created_at } });
}

async function upload(request: Request, env: Bindings): Promise<Response> {
  const read = await readImage(request, MAX_PHOTO_BYTES);
  if (read instanceof Response) return read;
  const { bytes, image } = read;

  const id = crypto.randomUUID();
  const objectKey = `journal/${id}.${image.extension}`;
  await env.PAGES.put(objectKey, bytes, { httpMetadata: { contentType: image.type } });
  try {
    await keepPhoto(env.DB, { id, object_key: objectKey, type: image.type, bytes: bytes.byteLength });
  } catch {
    await env.PAGES.delete(objectKey);
    return refuse(409, "busy");
  }
  return json(201, { id, type: image.type, bytes: bytes.byteLength });
}

async function photo(id: string, env: Bindings): Promise<Response> {
  if (!PHOTO_ID.test(id)) return refuse(404, "no-photo");
  const row = await findPhoto(env.DB, id);
  const object = row === null ? null : await env.PAGES.get(row.object_key);
  if (row === null || object === null) return refuse(404, "no-photo");
  return new Response(object.body, { status: 200, headers: imageHeaders(row.type, row.bytes, "private, max-age=31536000, immutable") });
}

/** Every storyline's trail: its name, first and last day, its latest state and mark, and every day it touched. */
async function storylines(env: Bindings): Promise<Response> {
  const trails = new Map<string, { key: string; state: string; mark: string | null }[]>();
  for (const row of await storylineLines(env.DB)) {
    const days = trails.get(row.name) ?? [];
    days.push({ key: row.key, state: row.state, mark: row.mark });
    trails.set(row.name, days);
  }
  const list = [...trails.entries()].map(([name, days]) => {
    const first = days[0];
    const last = days[days.length - 1];
    return { name, first: first?.key ?? null, last: last?.key ?? null, state: last?.state ?? "", mark: last?.mark ?? null, days };
  });
  list.sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || a.name.localeCompare(b.name));
  return json(200, { storylines: list });
}

/**
 * Answers every request under /threads/api/journal for a caller the door has named. Every refusal of a caller comes
 * before anything is read: the method, then an invited person, then who may write, then the owner's own page, then
 * the query.
 */
export async function handleJournal(request: Request, url: URL, env: Bindings, caller: Caller): Promise<Response> {
  const route = /^\/threads\/api\/journal(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(url.pathname);
  if (route === null) return json(404, { reason: "not-found" });
  const [, first, second] = route;
  const isPhotos = first === "photos";
  const answers = first !== undefined && !isPhotos && second === "answers";
  // What each address allows: the list, the storylines and a photo are read; a photo is uploaded and an answer
  // given; an entry is read and saved. Any other address under the journal is none of these.
  let allow: string;
  if (first === undefined || (first === "storylines" && second === undefined) || (isPhotos && second !== undefined)) allow = "GET";
  else if ((isPhotos && second === undefined) || answers) allow = "POST";
  else if (second === undefined) allow = "GET, POST";
  else return json(404, { reason: "not-found" });
  if (!allow.split(", ").includes(request.method)) return json(405, { reason: "method" }, { Allow: allow });

  if (caller.caller === "member") return refuse(403, "owner-only");
  if (request.method === "POST") {
    if (isPhotos && caller.caller !== "sync") return refuse(403, "sync-only");
    if (answers && caller.caller !== "owner") return refuse(403, "owner-only");
    if (caller.caller === "owner" && !sameOrigin(request)) return refuse(403, "origin");
  }
  const versioned = first !== undefined && !isPhotos && first !== "storylines" && second === undefined && request.method === "GET";
  if (url.search !== "" && !versioned) return refuse(400, "query");

  if (first === undefined) return everything(env);
  if (first === "storylines") return storylines(env);
  if (isPhotos) return second === undefined ? upload(request, env) : photo(second, env);
  const kind = kindOf(first);
  if (kind === null || (answers && kind !== "day")) return refuse(404, "no-entry");
  if (answers) return answer(request, first, env);
  if (request.method === "GET") return read(url, first, env);
  return write(request, first, kind, env, caller.caller);
}
