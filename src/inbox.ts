// The inbox's own calls under /inbox/api/, behind Cloudflare Access and the Worker's own check of who is
// calling (src/access.ts): the owner, signed in by an email code, and the recorder sync, by its service token.
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
// `reopen`, `topic`, `reply-opened`, `file`), and the server holds the rules: each is one UPDATE that
// matches only the statuses the move starts from, so two open tabs can't both win, and a refused move says
// 409 rather than guess. Every move the page can undo has a move that reverses it, and every move stamps
// `moved_at`. `reply-opened` is the owner's alone (it marks his own mail opening); `file` is the sync's
// alone, because filing an issue needs GitHub, which only the sync holds. Nothing personal is logged: a
// refusal's line holds its status and reason only.

import { isTopic } from "../site/talk-topics.js";
import { identify, type Caller } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { json, type JsonValue } from "./json.ts";
import { isJson, sameOrigin } from "./request.ts";

/** A tab, and the statuses it shows. */
const TABS = {
  look: ["received"],
  act: ["act"],
  discuss: ["discuss"],
  done: ["done", "dropped", "filed"],
} as const satisfies Record<string, readonly string[]>;
type Tab = keyof typeof TABS;

/** The most items one list answers. */
export const PAGE = 50;
/** The longest drop reason, in UTF-16 code units of the trimmed text. */
const MAX_REASON = 120;
/** A change is one small JSON object; anything larger is refused before it is read. */
const MAX_CHANGE_BYTES = 1024;
/** The longest body an add carries, in UTF-16 code units of the trimmed text: a moved issue with its comments. */
const MAX_ITEM_BODY = 32_000;
/**
 * The largest add: 32,000 code units are at most 96,000 bytes of UTF-8 (Telugu takes three bytes a
 * character), and JSON escapes at most double the few characters it escapes, so with the title, ref and name
 * the whole body stays under 128 KiB.
 */
const MAX_ADD_BYTES = 128 * 1024;
const MAX_TITLE = 200;
const MAX_NAME = 80;
const MAX_LINK = 200;
/** Where an item came from: a kind, a colon, and an id of printable ASCII. */
const REF_SHAPE = /^[a-z]+:[\x21-\x7e]{1,190}$/;
/** The only place an item is filed: a GitHub issue's address. */
const ISSUE_SHAPE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** A body may keep its line breaks and tabs; every other control character is refused. */
const BODY_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A cursor: the last item's received time and id, joined by `~`. */
const CURSOR_SHAPE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)~([0-9a-f-]{36})$/;

const COLUMNS =
  "id, received_at, source, topic, body, name, email, status, kind, drop_reason, reply_opened_at, title, ref, filed_link, moved_at";

interface Row {
  id: string;
  received_at: string;
  source: string;
  topic: string | null;
  body: string;
  name: string | null;
  email: string | null;
  status: string;
  kind: string | null;
  drop_reason: string | null;
  reply_opened_at: string | null;
  title: string | null;
  ref: string | null;
  filed_link: string | null;
  moved_at: string | null;
}

function item(row: Row): { readonly [key: string]: JsonValue } {
  return {
    id: row.id,
    receivedAt: row.received_at,
    source: row.source,
    topic: row.topic,
    title: row.title,
    body: row.body,
    name: row.name,
    email: row.email,
    status: row.status,
    kind: row.kind,
    dropReason: row.drop_reason,
    replyOpenedAt: row.reply_opened_at,
    ref: row.ref,
    filedLink: row.filed_link,
    movedAt: row.moved_at,
  };
}

function refuse(status: number, reason: string): Response {
  console.log(JSON.stringify({ refused: status, reason }));
  return json(status, { reason });
}

function isTab(value: string): value is Tab {
  return Object.hasOwn(TABS, value);
}

/** `?1, ?2, …` for the given statuses, numbered from `first`. */
function slots(count: number, first: number): string {
  return Array.from({ length: count }, (_, i) => `?${first + i}`).join(", ");
}

/** The declared length's refusal, if any: none, malformed or over `max`. */
function lengthRefusal(request: Request, max: number): Response | null {
  const declared = request.headers.get("Content-Length");
  if (declared === null || !/^\d{1,12}$/.test(declared)) return refuse(411, "length");
  if (Number(declared) > max) return refuse(413, "too-large");
  if (!isJson(request)) return refuse(415, "type");
  return null;
}

async function list(url: URL, env: Bindings, caller: Caller): Promise<Response> {
  const keys = [...url.searchParams.keys()];
  const tab = url.searchParams.get("tab") ?? "";
  const before = url.searchParams.get("before");
  if (!isTab(tab) || keys.some((key) => key !== "tab" && key !== "before") || url.searchParams.getAll("tab").length !== 1) {
    return refuse(400, "query");
  }
  const statuses: readonly string[] = TABS[tab];
  let cursor: RegExpExecArray | null = null;
  if (before !== null) {
    cursor = CURSOR_SHAPE.exec(before);
    if (cursor === null || url.searchParams.getAll("before").length !== 1) return refuse(400, "query");
  }

  const n = statuses.length;
  const page = cursor
    ? env.DB.prepare(
        `SELECT ${COLUMNS} FROM inbox WHERE status IN (${slots(n, 1)})
         AND (received_at < ?${n + 1} OR (received_at = ?${n + 1} AND id < ?${n + 2}))
         ORDER BY received_at DESC, id DESC LIMIT ${PAGE + 1}`,
      ).bind(...statuses, cursor[1], cursor[2])
    : env.DB.prepare(`SELECT ${COLUMNS} FROM inbox WHERE status IN (${slots(n, 1)}) ORDER BY received_at DESC, id DESC LIMIT ${PAGE + 1}`).bind(...statuses);
  const counted = env.DB.prepare("SELECT status, COUNT(*) AS n FROM inbox GROUP BY status");
  const [rows, counts] = await env.DB.batch<Row | { status: string; n: number }>([page, counted]);

  const found = (rows?.results ?? []) as Row[];
  const shown = found.slice(0, PAGE);
  const last = shown[shown.length - 1];
  const next = found.length > PAGE && last !== undefined ? `${last.received_at}~${last.id}` : null;

  const byStatus = new Map(((counts?.results ?? []) as { status: string; n: number }[]).map((row) => [row.status, row.n]));
  const tally: Record<Tab, number> = { look: 0, act: 0, discuss: 0, done: 0 };
  for (const name of Object.keys(TABS) as Tab[]) {
    for (const status of TABS[name]) tally[name] += byStatus.get(status) ?? 0;
  }

  return json(200, {
    items: shown.map(item),
    counts: tally,
    next,
    me: caller.caller === "owner" ? caller.email : null,
  });
}

/** An item the sync adds, as checked; `name` is the teller's for `told` and null for `self`. */
interface NewItem {
  readonly ref: string;
  readonly source: "told" | "self";
  readonly title: string;
  readonly body: string;
  readonly topic: string | null;
  readonly name: string | null;
  readonly status: "received" | "act" | "discuss";
}

/** The kind each status an add may start in carries, as the owner's own moves set it. */
const KIND_OF = { received: null, act: "feedback", discuss: "idea" } as const;

/** A one-line text of at most `max` code units once trimmed, or null. */
function line(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "" || text.length > max || CONTROL.test(text) || !text.isWellFormed()) return null;
  return text;
}

/** The add as an item, or the reason it is refused: its first field that is wrong, in a fixed order. */
function readItem(value: unknown): NewItem | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "item";
  const add = value as Record<string, unknown>;
  const source = add.source;
  if (source !== "told" && source !== "self") return "source";
  const expected = ["body", "ref", "source", "status", "title", "topic", ...(source === "told" ? ["name"] : [])].sort().join(",");
  if (Object.keys(add).sort().join(",") !== expected) return "keys";

  if (typeof add.ref !== "string" || !REF_SHAPE.test(add.ref)) return "ref";
  const title = line(add.title, MAX_TITLE);
  if (title === null) return "title";
  if (typeof add.body !== "string") return "body";
  const body = add.body.trim();
  if (body === "" || body.length > MAX_ITEM_BODY || !body.isWellFormed() || BODY_CONTROL.test(body)) return "body";
  let topic: string | null = null;
  if (add.topic !== null) {
    if (typeof add.topic !== "string" || !isTopic(add.topic)) return "topic";
    topic = add.topic;
  }
  let name: string | null = null;
  if (source === "told") {
    name = line(add.name, MAX_NAME);
    if (name === null) return "name";
  }
  const status = add.status;
  if (status !== "received" && status !== "act" && status !== "discuss") return "status";
  return { ref: add.ref, source, title, body, topic, name, status };
}

async function add(request: Request, env: Bindings, caller: Caller): Promise<Response> {
  if (caller.caller !== "sync") return refuse(403, "sync-only");
  const length = lengthRefusal(request, MAX_ADD_BYTES);
  if (length !== null) return length;

  let found: NewItem | string;
  try {
    found = readItem(JSON.parse(await request.text()));
  } catch {
    found = "item";
  }
  if (typeof found === "string") return refuse(400, found);

  const added = await env.DB.prepare(
    `INSERT INTO inbox (id, received_at, source, topic, body, name, email, status, kind, title, ref)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9, ?10)
     ON CONFLICT (ref) WHERE ref IS NOT NULL DO NOTHING
     RETURNING ${COLUMNS}`,
  )
    .bind(crypto.randomUUID(), new Date().toISOString(), found.source, found.topic, found.body, found.name, found.status, KIND_OF[found.status], found.title, found.ref)
    .first<Row>();
  if (added !== null) return json(201, { item: item(added) });

  const there = await env.DB.prepare(`SELECT ${COLUMNS} FROM inbox WHERE ref = ?1`).bind(found.ref).first<Row>();
  if (there === null) return refuse(500, "store");
  return json(200, { item: item(there) });
}

/** One move, as the UPDATE that makes it and the statuses it starts from; null for a malformed change. */
interface Move {
  readonly from: readonly string[];
  readonly set: string;
  readonly values: readonly (string | null)[];
  /** An extra condition the row must meet, beside its status. */
  readonly where?: string;
  /** The one caller a move belongs to; either may make it when absent. */
  readonly only?: Caller["caller"];
}

function readMove(value: unknown, now: string): Move | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const change = value as Record<string, unknown>;
  const keys = Object.keys(change).sort().join(",");
  const open = ["received", "act", "discuss"];
  switch (change.action) {
    case "act":
    case "discuss":
      if (keys !== "action") return null;
      return { from: open, set: "status = ?2, kind = ?3", values: [change.action, change.action === "act" ? "feedback" : "idea"] };
    case "done":
      if (keys !== "action") return null;
      // A filed item is closed once its issue is: how a filed note gets back to Reply.
      return { from: ["act", "discuss", "filed"], set: "status = 'done'", values: [] };
    case "drop": {
      if (keys !== "action,reason" || typeof change.reason !== "string") return null;
      const reason = change.reason.trim();
      if (reason.length > MAX_REASON || CONTROL.test(reason) || !reason.isWellFormed()) return null;
      return { from: open, set: "status = 'dropped', drop_reason = ?2", values: [reason === "" ? null : reason] };
    }
    case "reopen":
      if (keys !== "action") return null;
      // A closed item goes back to where it was: Filed when it became an issue, else where its kind puts it
      // (To act on, To discuss), or To look at when it was never sorted; a dropped one loses its reason.
      // This is also how the page undoes Done and Drop.
      return {
        from: ["done", "dropped"],
        set: "status = CASE WHEN filed_link IS NOT NULL THEN 'filed' WHEN kind = 'feedback' THEN 'act' WHEN kind = 'idea' THEN 'discuss' ELSE 'received' END, drop_reason = NULL",
        values: [],
      };
    case "unsort":
      if (keys !== "action") return null;
      // Back to To look at, unsorted: how the page undoes Act on it and Talk it through.
      return { from: ["act", "discuss"], set: "status = 'received', kind = NULL", values: [] };
    case "topic":
      if (keys !== "action,topic" || typeof change.topic !== "string" || !isTopic(change.topic)) return null;
      return { from: [...open, "done", "dropped", "filed"], set: "topic = ?2", values: [change.topic] };
    case "reply-opened":
      if (keys !== "action") return null;
      return { from: [...open, "done", "dropped"], set: "reply_opened_at = ?2", values: [now], where: "email IS NOT NULL", only: "owner" };
    case "file": {
      if (keys !== "action,link" || typeof change.link !== "string") return null;
      if (change.link.length > MAX_LINK || !ISSUE_SHAPE.test(change.link)) return null;
      // Filed is something to act on, so it carries that kind: Reply comes back once it is Done.
      return { from: open, set: "status = 'filed', filed_link = ?2, kind = 'feedback'", values: [change.link], only: "sync" };
    }
    default:
      return null;
  }
}

async function change(request: Request, id: string, env: Bindings, caller: Caller): Promise<Response> {
  // Same-origin keeps another site from borrowing the owner's signed-in cookie. The sync's token travels in
  // headers no other site can set, so it has no origin to show.
  if (caller.caller === "owner" && !sameOrigin(request)) return refuse(403, "origin");
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;

  const now = new Date().toISOString();
  let move: Move | null;
  try {
    move = readMove(JSON.parse(await request.text()), now);
  } catch {
    move = null;
  }
  if (move === null) return refuse(400, "change");
  if (move.only !== undefined && move.only !== caller.caller) return refuse(403, `${move.only}-only`);
  if (!ID_SHAPE.test(id)) return refuse(404, "no-item");

  const stamp = 2 + move.values.length;
  const extra = move.where === undefined ? "" : ` AND ${move.where}`;
  const updated = await env.DB.prepare(
    `UPDATE inbox SET ${move.set}, moved_at = ?${stamp} WHERE id = ?1 AND status IN (${slots(move.from.length, stamp + 1)})${extra} RETURNING ${COLUMNS}`,
  )
    .bind(id, ...move.values, now, ...move.from)
    .first<Row>();
  if (updated !== null) return json(200, { item: item(updated) });

  const exists = await env.DB.prepare("SELECT 1 AS found FROM inbox WHERE id = ?1").bind(id).first();
  return exists === null ? refuse(404, "no-item") : refuse(409, "not-from-here");
}

/** Answers every request under /inbox/api/: who is calling first, then the route. */
export async function handleInbox(request: Request, env: Bindings): Promise<Response> {
  const who = await identify(request, env);
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
