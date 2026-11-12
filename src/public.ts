// The threads' public calls, outside Cloudflare Access, for a thread Suresh made public: anyone reads it with no
// sign-in, sends him a note on it, and answers its page's questions, each shown at once, which he may drop after the
// fact. The request's cookies are never read.
//
//   GET  /api/threads/<n>                    the thread, its page's versions and its public comments
//                                            [X-Visitor-Key: <the visitor's key>]
//   GET  /api/threads/<n>/pages/<version>    one version of its page, while the page is its main section
//   POST /api/threads/<n>/notes              {"body", "name", "email", "token"}: a note, shown at once
//   POST /api/threads/<n>/answers            {"question", "body", "name", "token", "key"}: an answer, shown at once
//
// A thread is public when he made it so and it is his own (src/store.ts holds the condition in every query). Any
// other number (private, shared with people, a site note, a told thread, missing, not a number) answers the same
// 404 `no-thread` on each call, so the public calls tell a stranger nothing about threads they can't read. What a
// public thread says is a few of the fields the private call gives, under the same names, so the threads page draws
// one shape: never its status, source, sender, origin, people, history, ids or last activity, which a visitor's
// words move; and its comments are those written as Public that are shown, each by author and name only, with the
// question an answer answers and whether it is the reader's own. His photo is said once (`ownerPhoto`), for his own
// comments, and an invited person's comment carries theirs (`photo`); a visitor's never does, because anyone may
// type any address. A photo itself is served at /api/photos/<id> (src/photos.ts).
//
// A note runs every visitor note's checks (src/note.ts), the bot check before the thread is read, and counts against
// the same daily limits as the note flow's. It is kept as a comment for anyone, shown at once, with the name and
// email the visitor typed, and answers `{}`: no id or number. An answer runs the same checks in the same order, with
// a name it must have and no email, and counts against the answers' own daily limits; a thread takes answers only
// while its page is its main section, any other answering the same 404. Its `key` is 32 random bytes as hex that the
// visitor's browser made once and keeps; only its SHA-256 is kept, so answering again from that browser is a new
// answer that shows in place of the last one, and nobody else can replace it. The read takes the same key from
// `X-Visitor-Key`, never a cookie, to say which answers are the reader's own (`mine`), and the store returns other
// people's answers to a question only once that key has answered it (src/store.ts, `historyPublic`). Every answer carries `X-Robots-Tag: noindex`,
// because a public thread is kept out of search results; it is found by its link. Nothing personal is logged.

import type { Bindings } from "./bindings.ts";
import { json, type JsonValue } from "./json.ts";
import { checkBot, readAnswer, readFields, readNote, takeLimit, VISITOR_KEY_SHAPE } from "./note.ts";
import { servePage } from "./page.ts";
import { ownerPhotoId } from "./photos-store.ts";
import { addAnswer, addNote, findPublic, findPublicPage, historyPublic, pagesOf, type CommentRow, type ThreadRow } from "./store.ts";

/** The most comments one answer holds; `truncated` says there are more. */
const HISTORY = 500;
/** A thread's number or a page's version as a path names it: no sign, no leading zero, at most nine digits. */
const NUMBER_SHAPE = /^[1-9]\d{0,8}$/;
/** The fields a note on a thread carries. */
const NOTE_KEYS = ["body", "name", "email", "token"];
/** The fields an answer to a question of a thread's page carries. */
const ANSWER_KEYS = ["question", "body", "name", "token", "key"];
/** How strangers see the owner's own comments: the site is his. */
const OWNER_NAME = "Suresh";
/** Every public answer is kept out of search results. */
const NOINDEX = { "X-Robots-Tag": "noindex" };

/** A JSON answer with the public calls' header, logging a refusal's status and reason only. */
function answer(status: number, body: { readonly [key: string]: JsonValue }, headers: Record<string, string> = {}): Response {
  if (status >= 400) console.log(JSON.stringify({ refused: status, reason: body.reason ?? null }));
  return json(status, body, { ...NOINDEX, ...headers });
}

/** The one answer every number that isn't a public thread gets, on every call. */
function noThread(): Response {
  return answer(404, { reason: "no-thread" });
}

/** A public thread as anyone reads it: what it says, and its main section only as it now stands. */
function publicThread(row: ThreadRow): { readonly [key: string]: JsonValue } {
  return {
    number: row.number,
    title: row.title,
    summary: row.summary,
    space: row.space,
    main: row.main,
    body: row.main === "text" ? row.body : null,
    link: row.main === "link" && row.link_url !== null ? { url: row.link_url, title: row.link_title } : null,
    createdAt: row.created_at,
  };
}

/** The hex SHA-256 of a visitor's key, as the store keeps it. */
export async function keyHash(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The reader's key's hash, from `X-Visitor-Key`, or null when they sent none, or something that isn't a key. */
export async function readerKey(request: Request): Promise<string | null> {
  const given = request.headers.get("X-Visitor-Key") ?? "";
  return VISITOR_KEY_SHAPE.test(given) ? keyHash(given) : null;
}

/**
 * A public comment: who wrote it, by name ("Suresh", the invited person's, or the visitor's typed name), its words,
 * the question it answers (null for a note or a comment), whether it is the reader's own answer, and an invited
 * person's photo.
 */
function publicComment(row: CommentRow, key: string | null): { readonly [key: string]: JsonValue } {
  const name = row.author === "owner" ? OWNER_NAME : (row.person_name ?? row.sender_name);
  const said = { author: row.author, name, body: row.body, createdAt: row.created_at, question: row.question, mine: key !== null && row.visitor_key === key };
  return row.author === "member" ? { ...said, photo: row.person_photo } : said;
}

async function read(request: Request, number: number, env: Bindings): Promise<Response> {
  const row = await findPublic(env.DB, number);
  if (row === null) return noThread();
  const key = await readerKey(request);
  const [comments, pages, ownerPhoto] = await Promise.all([
    historyPublic(env.DB, row.id, HISTORY + 1, key),
    row.main === "page" ? pagesOf(env.DB, row.id) : Promise.resolve([]),
    ownerPhotoId(env.DB),
  ]);
  const newest = pages[pages.length - 1];
  return answer(200, {
    thread: publicThread(row),
    // A version's claude.ai source names his own artifact, so it isn't said.
    page:
      newest === undefined
        ? null
        : { version: newest.version, savedAt: newest.created_at, versions: pages.map((page) => ({ version: page.version, savedAt: page.created_at })) },
    comments: comments.slice(0, HISTORY).map((comment) => publicComment(comment, key)),
    truncated: comments.length > HISTORY,
    ownerPhoto,
  });
}

async function readPage(request: Request, number: number, given: string, env: Bindings): Promise<Response> {
  if (!NUMBER_SHAPE.test(given)) return noThread();
  const page = await findPublicPage(env.DB, number, Number(given));
  if (page === null) return noThread();
  const served = await servePage(env.PAGES, page.object_key, request);
  if (served === null) return noThread();
  const headers = new Headers(served.headers);
  for (const [name, value] of Object.entries(NOINDEX)) headers.set(name, value);
  return new Response(served.body, { status: served.status, headers });
}

async function sendNote(request: Request, number: number, env: Bindings): Promise<Response> {
  const fields = await readFields(request, env, NOTE_KEYS);
  if (fields instanceof Response) return withNoindex(fields);
  const note = readNote(fields.fields);
  if (note instanceof Response) return withNoindex(note);
  const sender = await checkBot(request, fields.secret, note.token);
  if (sender instanceof Response) return withNoindex(sender);
  if ((await findPublic(env.DB, number)) === null) return noThread();
  const limited = await takeLimit(env, sender.network, "notes");
  if (limited !== null) return withNoindex(limited);
  if (!(await addNote(env.DB, number, { body: note.body, name: note.name, email: note.email }))) return noThread();
  return answer(201, {});
}

async function sendAnswer(request: Request, number: number, env: Bindings): Promise<Response> {
  const fields = await readFields(request, env, ANSWER_KEYS);
  if (fields instanceof Response) return withNoindex(fields);
  const given = readAnswer(fields.fields);
  if (given instanceof Response) return withNoindex(given);
  const sender = await checkBot(request, fields.secret, given.token);
  if (sender instanceof Response) return withNoindex(sender);
  if ((await findPublic(env.DB, number))?.main !== "page") return noThread();
  const limited = await takeLimit(env, sender.network, "answers");
  if (limited !== null) return withNoindex(limited);
  const kept = await addAnswer(env.DB, number, { question: given.question, body: given.body, name: given.name, key: await keyHash(given.key) });
  return kept ? answer(201, {}) : noThread();
}

/** A refusal the shared checks made, with the public calls' header added. */
export function withNoindex(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(NOINDEX)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

/** Answers every request under /api/threads/. */
export async function handlePublic(request: Request, env: Bindings): Promise<Response> {
  const { pathname } = new URL(request.url);
  const route = /^\/api\/threads\/([^/]+)(?:\/(notes|answers)|\/pages\/([^/]+))?$/.exec(pathname);
  if (route === null) return noThread();
  const [, given = "", write, version] = route;
  if (write !== undefined) {
    if (request.method !== "POST") return answer(405, { reason: "method" }, { Allow: "POST" });
  } else if (request.method !== "GET" && request.method !== "HEAD") {
    return answer(405, { reason: "method" }, { Allow: "GET" });
  }
  if (!NUMBER_SHAPE.test(given)) return noThread();
  const number = Number(given);
  if (write === "notes") return sendNote(request, number, env);
  if (write === "answers") return sendAnswer(request, number, env);
  return version === undefined ? read(request, number, env) : readPage(request, number, version, env);
}
