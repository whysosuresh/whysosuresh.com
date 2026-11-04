// The inbox's own calls under /inbox/api/, behind Cloudflare Access and the Worker's own check of who is
// calling (src/access.ts): the owner, signed in by an email code, and the recorder sync, by its service token.
//
//   GET  /inbox/api/items?tab=look|act|discuss|done[&before=<cursor>]   owner and sync
//   POST /inbox/api/items/<id>   {"action": ...}                        owner only
//
// A list answers one tab, newest first, 50 at a time, with a cursor for the rest and every tab's count, so a
// page stays the same size however many notes arrive. A change names one move the inbox allows, and the
// server holds the rules: each is one UPDATE that matches only the statuses the move starts from, so two
// open tabs can't both win, and a refused move says 409 rather than guess. Nothing personal is logged: a
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
  done: ["done", "dropped"],
} as const satisfies Record<string, readonly string[]>;
type Tab = keyof typeof TABS;

/** The most items one list answers. */
export const PAGE = 50;
/** The longest drop reason, in UTF-16 code units of the trimmed text. */
const MAX_REASON = 120;
/** A change is one small JSON object; anything larger is refused before it is read. */
const MAX_CHANGE_BYTES = 1024;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A cursor: the last item's received time and id, joined by `~`. */
const CURSOR_SHAPE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)~([0-9a-f-]{36})$/;

const COLUMNS = "id, received_at, source, topic, body, name, email, status, kind, drop_reason, reply_opened_at";

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
}

function item(row: Row): { readonly [key: string]: JsonValue } {
  return {
    id: row.id,
    receivedAt: row.received_at,
    source: row.source,
    topic: row.topic,
    body: row.body,
    name: row.name,
    email: row.email,
    status: row.status,
    kind: row.kind,
    dropReason: row.drop_reason,
    replyOpenedAt: row.reply_opened_at,
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

/** One move, as the UPDATE that makes it and the statuses it starts from; null for a malformed change. */
interface Move {
  readonly from: readonly string[];
  readonly set: string;
  readonly values: readonly (string | null)[];
  /** An extra condition the row must meet, beside its status. */
  readonly where?: string;
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
      return { from: ["act", "discuss"], set: "status = 'done'", values: [] };
    case "drop": {
      if (keys !== "action,reason" || typeof change.reason !== "string") return null;
      const reason = change.reason.trim();
      if (reason.length > MAX_REASON || CONTROL.test(reason) || !reason.isWellFormed()) return null;
      return { from: open, set: "status = 'dropped', drop_reason = ?2", values: [reason === "" ? null : reason] };
    }
    case "reopen":
      if (keys !== "action") return null;
      // Done goes back to where its kind puts it; Dropped goes back to To look at, without its reason.
      return {
        from: ["done", "dropped"],
        set: "status = CASE WHEN status = 'dropped' OR kind IS NULL THEN 'received' WHEN kind = 'feedback' THEN 'act' ELSE 'discuss' END, drop_reason = NULL",
        values: [],
      };
    case "topic":
      if (keys !== "action,topic" || typeof change.topic !== "string" || !isTopic(change.topic)) return null;
      return { from: [...open, "done", "dropped"], set: "topic = ?2", values: [change.topic] };
    case "reply-opened":
      if (keys !== "action") return null;
      return { from: [...open, "done", "dropped"], set: "reply_opened_at = ?2", values: [now], where: "email IS NOT NULL" };
    default:
      return null;
  }
}

async function change(request: Request, id: string, env: Bindings, caller: Caller): Promise<Response> {
  if (caller.caller !== "owner") return refuse(403, "read-only");
  if (!sameOrigin(request)) return refuse(403, "origin");
  const declared = request.headers.get("Content-Length");
  if (declared === null || !/^\d{1,12}$/.test(declared)) return refuse(411, "length");
  if (Number(declared) > MAX_CHANGE_BYTES) return refuse(413, "too-large");
  if (!isJson(request)) return refuse(415, "type");

  let move: Move | null;
  try {
    move = readMove(JSON.parse(await request.text()), new Date().toISOString());
  } catch {
    move = null;
  }
  if (move === null) return refuse(400, "change");
  if (!ID_SHAPE.test(id)) return refuse(404, "no-item");

  const first = 2 + move.values.length;
  const extra = move.where === undefined ? "" : ` AND ${move.where}`;
  const updated = await env.DB.prepare(
    `UPDATE inbox SET ${move.set} WHERE id = ?1 AND status IN (${slots(move.from.length, first)})${extra} RETURNING ${COLUMNS}`,
  )
    .bind(id, ...move.values, ...move.from)
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
    if (request.method !== "GET") return json(405, { reason: "method" }, { Allow: "GET" });
    return list(url, env, who);
  }
  const one = /^\/inbox\/api\/items\/([^/]+)$/.exec(url.pathname);
  if (one) {
    if (request.method !== "POST") return json(405, { reason: "method" }, { Allow: "POST" });
    return change(request, one[1] ?? "", env, who);
  }
  return json(404, { reason: "not-found" });
}
