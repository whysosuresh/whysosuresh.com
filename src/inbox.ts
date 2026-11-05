// The inbox's own calls under /inbox/api/, behind Cloudflare Access and the Worker's own check of who is
// calling (src/access.ts, with the inbox application's tag): the owner, signed in by an email code, and the
// recorder sync, by its service token. The inbox's page (site/inbox/) and the sync's command line use these
// calls, and they answer exactly as they did before every item became a thread: the same routes, checks, limits
// and messages, over the threads' tables (src/store.ts), with each thread under the item's old names.
//
//   GET  /inbox/api/items?tab=look|act|discuss|done[&before=<cursor>]   owner and sync
//   POST /inbox/api/items        {"ref": ..., "source": ..., ...}       sync only
//   POST /inbox/api/items/<id>   {"action": ...}                        owner and sync
//
// A list answers one tab, newest first, 50 at a time, with a cursor for the rest and every tab's count, so a
// page stays the same size however many notes arrive. An add puts one item the sync was told about in the
// inbox: something told to Suresh in person (`told`, with the teller's name) or his own work or idea
// (`self`), already sorted when he sorted it in the sync's list. Every add names where the item came from
// (`ref`), and adding the same `ref` again answers the item already there, so a sync that stopped halfway
// can run again. A change names one move the inbox allows (`act`, `discuss`, `unsort`, `done`, `drop`,
// `reopen`, `topic`, `reply-opened`, `file`), and the store holds the rules: each matches only the statuses the
// move starts from, so two open tabs can't both win, and a refused move says 409 rather than guess. Every move
// the page can undo has a move that reverses it, every move stamps `moved_at`, and every move is kept in the
// thread's history. `reply-opened` is the owner's alone (it marks his own mail opening); `file` is the sync's
// alone, because filing an issue needs GitHub, which only the sync holds. The page's `topic` takes only the note
// flow's topics. Nothing personal is logged: a refusal's line holds its status and reason only.

import { isTopic } from "../site/talk-topics.js";
import { identify, type Caller } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { json, type JsonValue } from "./json.ts";
import { sameOrigin } from "./request.ts";
import { create, isTab, listByTime, makeMove, onlyFor, type ThreadRow } from "./store.ts";
import { MAX_CHANGE_BYTES, MAX_TEXT_BYTES, lengthRefusal, readAdd, readJson, readMove, refuse, type SpaceKey } from "./wire.ts";

/** The most items one list answers. */
export const PAGE = 50;
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A cursor: the last item's received time and id, joined by `~`. */
const CURSOR_SHAPE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)~([0-9a-f-]{36})$/;
/** The inbox calls a thread's space its topic, and takes only the note flow's topics. */
const TOPIC: SpaceKey = { key: "topic", allowed: isTopic };

/** A thread as the inbox's page has always read an item. */
function item(row: ThreadRow): { readonly [key: string]: JsonValue } {
  return {
    id: row.id,
    receivedAt: row.created_at,
    source: row.source,
    topic: row.space,
    title: row.title,
    body: row.body,
    name: row.sender_name,
    email: row.sender_email,
    status: row.status,
    kind: row.kind,
    dropReason: row.drop_reason,
    replyOpenedAt: row.reply_opened_at,
    ref: row.origin_ref,
    filedLink: row.filed_link,
    movedAt: row.moved_at,
  };
}

async function list(url: URL, env: Bindings, caller: Caller): Promise<Response> {
  const keys = [...url.searchParams.keys()];
  const tab = url.searchParams.get("tab") ?? "";
  const before = url.searchParams.get("before");
  if (!isTab(tab) || keys.some((key) => key !== "tab" && key !== "before") || url.searchParams.getAll("tab").length !== 1) {
    return refuse(400, "query");
  }
  let cursor: RegExpExecArray | null = null;
  if (before !== null) {
    cursor = CURSOR_SHAPE.exec(before);
    if (cursor === null || url.searchParams.getAll("before").length !== 1) return refuse(400, "query");
  }

  const { rows, counts } = await listByTime(env.DB, tab, cursor === null ? null : { at: cursor[1] ?? "", id: cursor[2] ?? "" }, PAGE + 1);
  const shown = rows.slice(0, PAGE);
  const last = shown[shown.length - 1];
  const next = rows.length > PAGE && last !== undefined ? `${last.created_at}~${last.id}` : null;

  return json(200, {
    items: shown.map(item),
    counts,
    next,
    me: caller.caller === "owner" ? caller.email : null,
  });
}

async function add(request: Request, env: Bindings, caller: Caller): Promise<Response> {
  if (caller.caller !== "sync") return refuse(403, "sync-only");
  const length = lengthRefusal(request, MAX_TEXT_BYTES);
  if (length !== null) return length;

  const found = readAdd(await readJson(request), TOPIC);
  if (typeof found === "string") return refuse(400, found);

  const kept = await create(env.DB, found, caller.caller);
  if (kept === null) return refuse(500, "store");
  return json(kept.created ? 201 : 200, { item: item(kept.row) });
}

async function change(request: Request, id: string, env: Bindings, caller: Caller): Promise<Response> {
  // Same-origin keeps another site from borrowing the owner's signed-in cookie. The sync's token travels in
  // headers no other site can set, so it has no origin to show.
  if (caller.caller === "owner" && !sameOrigin(request)) return refuse(403, "origin");
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;

  const move = readMove(await readJson(request), TOPIC);
  if (move === null) return refuse(400, "change");
  const only = onlyFor(move);
  if (only !== null && only !== caller.caller) return refuse(403, `${only}-only`);
  if (!ID_SHAPE.test(id)) return refuse(404, "no-item");

  const moved = await makeMove(env.DB, { id }, move, caller.caller);
  if (moved === "no-thread") return refuse(404, "no-item");
  if (moved === "not-from-here") return refuse(409, "not-from-here");
  return json(200, { item: item(moved) });
}

/** Answers every request under /inbox/api/: who is calling first, then the route. */
export async function handleInbox(request: Request, env: Bindings): Promise<Response> {
  const who = await identify(request, env, env.ACCESS_AUD);
  if (!("caller" in who)) return refuse(who.status, who.reason);

  const url = new URL(request.url);
  if (url.pathname === "/inbox/api/items") {
    if (request.method === "GET") return list(url, env, who);
    if (request.method === "POST") return add(request, env, who);
    return json(405, { reason: "method" }, { Allow: "GET, POST" });
  }
  const one = /^\/inbox\/api\/items\/([^/]+)$/.exec(url.pathname);
  if (one) {
    if (request.method !== "POST") return json(405, { reason: "method" }, { Allow: "POST" });
    return change(request, one[1] ?? "", env, who);
  }
  return json(404, { reason: "not-found" });
}
