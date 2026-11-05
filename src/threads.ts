// The threads' own calls under /threads/api/, behind their own Cloudflare Access application and the Worker's
// own check of who is calling (src/access.ts, with that application's tag): the owner, signed in by an email
// code, and the recorder sync, by its service token. A thread is named by its number, the one people say out
// loud (#42).
//
//   GET  /threads/api/threads?tab=look|act|discuss|done[&before=<number>]   owner and sync
//   POST /threads/api/threads                 {"ref": ..., "source": ..., ...}   sync only
//   GET  /threads/api/threads/<n>                                             owner and sync
//   POST /threads/api/threads/<n>             {"action": ...}                  owner and sync
//   POST /threads/api/threads/<n>/comments    {"body": ...}                    owner and sync
//   POST /threads/api/threads/<n>/text        {"field": ..., "text": ...}      owner and sync
//
// A list answers one tab, newest number first, 50 at a time, with the number to go on from and every tab's
// count. An add is the inbox's add with `space` for `topic` (src/wire.ts), and answers the thread already
// there when its `ref` comes again. A thread's own call answers it with its comments and its history, oldest
// first, up to 500 of each. A move is the inbox's move list with `space` for `topic`, and the store holds its
// rules (src/store.ts). A comment adds Markdown to a thread. A text replaces the thread's living summary (an
// empty one clears it) or its main text, keeping the text it replaced in the history; a visitor's own words are
// never rewritten (409 `visitor-words`). Text has its own call because a move is capped at 1 KiB. The owner's
// writes must come from his own page; `reply-opened` is his alone and `file` the sync's. Nothing personal is
// logged: a refusal's line holds its status and reason only.

import { isSpace } from "../site/spaces.js";
import { identify, type Caller } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { json, type JsonValue } from "./json.ts";
import { sameOrigin } from "./request.ts";
import {
  comment,
  create,
  edit,
  find,
  history,
  isTab,
  listByNumber,
  makeMove,
  onlyFor,
  type CommentRow,
  type EventRow,
  type ThreadRow,
} from "./store.ts";
import { MAX_BODY, MAX_CHANGE_BYTES, MAX_TEXT_BYTES, lengthRefusal, readAdd, readJson, readMove, refuse, text, type SpaceKey } from "./wire.ts";

/** The most threads one list answers. */
const PAGE = 50;
/** The most comments, and the most events, one thread's call answers; `truncated` says there are more. */
const HISTORY = 500;
/** The longest living summary, in UTF-16 code units of the trimmed text. */
const MAX_SUMMARY = 4000;
/** A thread's number as a path or a cursor names it: no sign, no leading zero, at most nine digits. */
const NUMBER_SHAPE = /^[1-9]\d{0,8}$/;
const SPACE: SpaceKey = { key: "space", allowed: isSpace };

/** A thread as both callers see it. */
function thread(row: ThreadRow): { readonly [key: string]: JsonValue } {
  return {
    number: row.number,
    id: row.id,
    createdAt: row.created_at,
    source: row.source,
    space: row.space,
    title: row.title,
    body: row.body,
    summary: row.summary,
    senderName: row.sender_name,
    senderEmail: row.sender_email,
    status: row.status,
    kind: row.kind,
    dropReason: row.drop_reason,
    replyOpenedAt: row.reply_opened_at,
    ref: row.origin_ref,
    filedLink: row.filed_link,
    movedAt: row.moved_at,
  };
}

function commentView(row: CommentRow): { readonly [key: string]: JsonValue } {
  return { id: row.id, author: row.author, body: row.body, createdAt: row.created_at };
}

function eventView(row: EventRow): { readonly [key: string]: JsonValue } {
  return { id: row.id, at: row.at, actor: row.actor, type: row.type, data: JSON.parse(row.data) as JsonValue };
}

async function list(url: URL, env: Bindings): Promise<Response> {
  const keys = [...url.searchParams.keys()];
  const tab = url.searchParams.get("tab") ?? "";
  const before = url.searchParams.get("before");
  if (!isTab(tab) || keys.some((key) => key !== "tab" && key !== "before") || url.searchParams.getAll("tab").length !== 1) {
    return refuse(400, "query");
  }
  if (before !== null && (!NUMBER_SHAPE.test(before) || url.searchParams.getAll("before").length !== 1)) return refuse(400, "query");

  const { rows, counts } = await listByNumber(env.DB, tab, before === null ? null : Number(before), PAGE + 1);
  const shown = rows.slice(0, PAGE);
  const last = shown[shown.length - 1];
  return json(200, { threads: shown.map(thread), counts, next: rows.length > PAGE && last !== undefined ? last.number : null });
}

async function add(request: Request, env: Bindings, caller: Caller): Promise<Response> {
  if (caller.caller !== "sync") return refuse(403, "sync-only");
  const length = lengthRefusal(request, MAX_TEXT_BYTES);
  if (length !== null) return length;

  const found = readAdd(await readJson(request), SPACE);
  if (typeof found === "string") return refuse(400, found);

  const kept = await create(env.DB, found, caller.caller);
  if (kept === null) return refuse(500, "store");
  return json(kept.created ? 201 : 200, { thread: thread(kept.row) });
}

async function show(number: number, env: Bindings): Promise<Response> {
  const row = await find(env.DB, { number });
  if (row === null) return refuse(404, "no-thread");
  const { comments, events } = await history(env.DB, row.id, HISTORY + 1);
  return json(200, {
    thread: thread(row),
    comments: comments.slice(0, HISTORY).map(commentView),
    events: events.slice(0, HISTORY).map(eventView),
    truncated: comments.length > HISTORY || events.length > HISTORY,
  });
}

async function move(request: Request, number: number, env: Bindings, caller: Caller): Promise<Response> {
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const change = readMove(await readJson(request), SPACE);
  if (change === null) return refuse(400, "change");
  const only = onlyFor(change);
  if (only !== null && only !== caller.caller) return refuse(403, `${only}-only`);

  const moved = await makeMove(env.DB, { number }, change, caller.caller);
  if (moved === "no-thread") return refuse(404, "no-thread");
  if (moved === "not-from-here") return refuse(409, "not-from-here");
  return json(200, { thread: thread(moved) });
}

/** Exactly the given keys, as a record; null for anything else. */
function exactly(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === [...keys].sort().join(",") ? record : null;
}

async function addComment(request: Request, number: number, env: Bindings, caller: Caller): Promise<Response> {
  const length = lengthRefusal(request, MAX_TEXT_BYTES);
  if (length !== null) return length;
  const fields = exactly(await readJson(request), ["body"]);
  const body = fields === null ? null : text(fields.body, MAX_BODY);
  if (body === null || body === "") return refuse(400, "comment");

  const added = await comment(env.DB, { number }, caller.caller, body);
  if (added === null) return refuse(404, "no-thread");
  return json(201, { comment: commentView(added) });
}

async function replaceText(request: Request, number: number, env: Bindings, caller: Caller): Promise<Response> {
  const length = lengthRefusal(request, MAX_TEXT_BYTES);
  if (length !== null) return length;
  const fields = exactly(await readJson(request), ["field", "text"]);
  const field = fields?.field;
  if (fields === null || (field !== "summary" && field !== "body")) return refuse(400, "text");
  const given = text(fields.text, field === "summary" ? MAX_SUMMARY : MAX_BODY);
  // An empty summary clears it; a thread always has a main text.
  if (given === null || (field === "body" && given === "")) return refuse(400, "text");

  const edited = await edit(env.DB, { number }, field, given === "" ? null : given, caller.caller);
  if (edited === "no-thread") return refuse(404, "no-thread");
  if (edited === "visitor-words") return refuse(409, "visitor-words");
  return json(200, { thread: thread(edited) });
}

/** Answers every request under /threads/api/: who is calling first, then the route. */
export async function handleThreads(request: Request, env: Bindings): Promise<Response> {
  const who = await identify(request, env, env.THREADS_ACCESS_AUD);
  if (!("caller" in who)) return refuse(who.status, who.reason);

  const url = new URL(request.url);
  if (url.pathname === "/threads/api/threads") {
    if (request.method === "GET") return list(url, env);
    if (request.method === "POST") return add(request, env, who);
    return json(405, { reason: "method" }, { Allow: "GET, POST" });
  }
  const route = /^\/threads\/api\/threads\/([^/]+)(?:\/(comments|text))?$/.exec(url.pathname);
  if (route === null) return json(404, { reason: "not-found" });
  const [, given = "", part] = route;
  const reading = part === undefined && request.method === "GET";
  if (!reading && request.method !== "POST") return json(405, { reason: "method" }, { Allow: part === undefined ? "GET, POST" : "POST" });
  // Same-origin keeps another site from borrowing the owner's signed-in cookie. The sync's token travels in
  // headers no other site can set, so it has no origin to show.
  if (!reading && who.caller === "owner" && !sameOrigin(request)) return refuse(403, "origin");
  // Anything that isn't a thread's number is answered as a thread that isn't there.
  if (!NUMBER_SHAPE.test(given)) return refuse(404, "no-thread");
  const number = Number(given);

  if (reading) return show(number, env);
  if (part === "comments") return addComment(request, number, env, who);
  if (part === "text") return replaceText(request, number, env, who);
  return move(request, number, env, who);
}
