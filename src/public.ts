// The threads' public calls, outside Cloudflare Access, for a thread Suresh made public: anyone reads it with no
// sign-in, and anyone may send him a note on it, which waits for his OK. The request's cookies are never read.
//
//   GET  /api/threads/<n>                    the thread, its page's versions and its public comments
//   GET  /api/threads/<n>/pages/<version>    one version of its page, while the page is its main section
//   POST /api/threads/<n>/notes              {"body", "name", "email", "token"}: a note that waits for his OK
//
// A thread is public when he made it so and it is his own (src/store.ts holds the condition in every query). Any
// other number (private, shared with people, a site note, a told thread, missing, not a number) answers the same
// 404 `no-thread` on each call, so the public calls tell a stranger nothing about threads they can't read. What a
// public thread says is a few of the fields the private call gives, under the same names, so the threads page draws
// one shape: never its status, source, sender, origin, people, history, ids or last activity, which a waiting
// note moves; and its comments are those written as Public that are shown, each by author and name only.
//
// A note runs every visitor note's checks (src/note.ts), the bot check before the thread is read, and counts against
// the same daily limits as the note flow's. It is kept as a comment for anyone that waits for his OK, with the name
// and email the visitor typed, and answers `{}`: no id or number. Every answer carries `X-Robots-Tag: noindex`,
// because a public thread is kept out of search results; it is found by its link. Nothing personal is logged.

import type { Bindings } from "./bindings.ts";
import { json, type JsonValue } from "./json.ts";
import { checkBot, readFields, readNote, takeLimit } from "./note.ts";
import { servePage } from "./page.ts";
import { addNote, findPublic, findPublicPage, historyPublic, pagesOf, type CommentRow, type ThreadRow } from "./store.ts";

/** The most comments one answer holds; `truncated` says there are more. */
const HISTORY = 500;
/** A thread's number or a page's version as a path names it: no sign, no leading zero, at most nine digits. */
const NUMBER_SHAPE = /^[1-9]\d{0,8}$/;
/** The fields a note on a thread carries. */
const NOTE_KEYS = ["body", "name", "email", "token"];
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

/** A public comment: who wrote it, by name ("Suresh", the invited person's, or the visitor's typed name), and its words. */
function publicComment(row: CommentRow): { readonly [key: string]: JsonValue } {
  const name = row.author === "owner" ? OWNER_NAME : (row.person_name ?? row.sender_name);
  return { author: row.author, name, body: row.body, createdAt: row.created_at };
}

async function read(number: number, env: Bindings): Promise<Response> {
  const row = await findPublic(env.DB, number);
  if (row === null) return noThread();
  const [comments, pages] = await Promise.all([historyPublic(env.DB, row.id, HISTORY + 1), row.main === "page" ? pagesOf(env.DB, row.id) : Promise.resolve([])]);
  const newest = pages[pages.length - 1];
  return answer(200, {
    thread: publicThread(row),
    // A version's claude.ai source names his own artifact, so it isn't said.
    page:
      newest === undefined
        ? null
        : { version: newest.version, savedAt: newest.created_at, versions: pages.map((page) => ({ version: page.version, savedAt: page.created_at })) },
    comments: comments.slice(0, HISTORY).map(publicComment),
    truncated: comments.length > HISTORY,
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
  const limited = await takeLimit(env, sender.network);
  if (limited !== null) return withNoindex(limited);
  if (!(await addNote(env.DB, number, { body: note.body, name: note.name, email: note.email }))) return noThread();
  return answer(201, {});
}

/** A refusal the shared checks made, with the public calls' header added. */
function withNoindex(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(NOINDEX)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

/** Answers every request under /api/threads/. */
export async function handlePublic(request: Request, env: Bindings): Promise<Response> {
  const { pathname } = new URL(request.url);
  const route = /^\/api\/threads\/([^/]+)(?:\/(notes)|\/pages\/([^/]+))?$/.exec(pathname);
  if (route === null) return noThread();
  const [, given = "", notes, version] = route;
  if (notes !== undefined) {
    if (request.method !== "POST") return answer(405, { reason: "method" }, { Allow: "POST" });
  } else if (request.method !== "GET" && request.method !== "HEAD") {
    return answer(405, { reason: "method" }, { Allow: "GET" });
  }
  if (!NUMBER_SHAPE.test(given)) return noThread();
  const number = Number(given);
  if (notes !== undefined) return sendNote(request, number, env);
  return version === undefined ? read(number, env) : readPage(request, number, version, env);
}
