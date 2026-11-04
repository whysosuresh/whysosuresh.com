// The inbox's command-line client: how the recorder sync, and any session on Suresh's Mac, lists, adds and
// moves items in the private inbox at whysosuresh.com/inbox through its calls (src/inbox.ts), as the sync's
// Cloudflare Access service token. Its client id is wrangler.jsonc's public var; its secret comes only from
// the environment (`INBOX_SYNC_CLIENT_SECRET`), is sent only in the Access header, and is never printed or
// written anywhere. Every answer is one JSON line on stdout; a refusal exits non-zero with the Worker's
// reason. This module is the logic, with fetch, the environment and the streams handed in, so the tests
// drive it with a played fetch; tools/inbox/inbox.ts is the entry point that hands it the real ones.

import { readFileSync } from "node:fs";

/** Where the inbox's calls live. */
export const ORIGIN = "https://whysosuresh.com";
/** The environment variable that carries the service token's secret. */
export const SECRET_VARIABLE = "INBOX_SYNC_CLIENT_SECRET";
const TABS = ["look", "act", "discuss", "done"];
const ACTIONS = ["act", "discuss", "unsort", "done", "drop", "reopen", "topic", "file"];
/** The pages one `list` follows at most: 50 items each, far beyond what any tab holds. */
const MAX_PAGES = 200;

export const USAGE = `Usage: inbox <verb> [arguments]

  list <look|act|discuss|done>    every item in that tab, newest first, one JSON line each
  add                             items from stdin, one JSON object per line; one result line each
  move <id> <action> [--reason <text>] [--topic <topic>] [--link <issue address>]
                                  one move: act, discuss, unsort, done, drop, reopen, topic, file

The service token's secret is read from ${SECRET_VARIABLE}; the client id from wrangler.jsonc.
Exit status: 0 when every request was answered as asked, 1 on any refusal, 2 on a usage error.
`;

/** What the client needs from the world. */
export interface Io {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The whole of stdin, read only by `add`. */
  readonly stdin: () => Promise<string>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The service token's client id. */
  readonly clientId: string;
}

/** The sync's client id, read from wrangler.jsonc's vars as the Worker reads it. */
export function readClientId(wranglerPath: URL): string {
  const value = /"INBOX_SYNC_CLIENT_ID": "([^"]+)"/.exec(readFileSync(wranglerPath, "utf8"))?.[1];
  if (value === undefined) throw new Error("wrangler.jsonc names no INBOX_SYNC_CLIENT_ID");
  return value;
}

/** One answer from the inbox: its status and its JSON, or a reason when it isn't the Worker's JSON. */
interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

class Usage extends Error {}

async function call(io: Io, secret: string, path: string, init: { method: string; body?: string }): Promise<Answer> {
  const headers: Record<string, string> = { "CF-Access-Client-Id": io.clientId, "CF-Access-Client-Secret": secret };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    // A refused service token is sent to Access's sign-in page; following it would only fetch HTML.
    response = await io.fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
  } catch {
    return { status: 0, body: { reason: "unreachable" } };
  }
  if (response.status >= 300 && response.status < 400) return { status: response.status, body: { reason: "sign-in" } };
  const type = response.headers.get("Content-Type") ?? "";
  if (!type.startsWith("application/json")) return { status: response.status, body: { reason: response.status === 401 ? "token" : `http-${response.status}` } };
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) return { status: response.status, body: body as Record<string, unknown> };
  } catch {
    // Falls through to the reason below.
  }
  return { status: response.status, body: { reason: "answer" } };
}

function reasonOf(answer: Answer): string {
  return typeof answer.body.reason === "string" ? answer.body.reason : `http-${answer.status}`;
}

async function list(io: Io, secret: string, args: readonly string[]): Promise<number> {
  const [tab, ...rest] = args;
  if (tab === undefined || !TABS.includes(tab) || rest.length > 0) throw new Usage(`list takes one tab: ${TABS.join(", ")}`);
  let before: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query: string = `?tab=${tab}${before === null ? "" : `&before=${encodeURIComponent(before)}`}`;
    const answer = await call(io, secret, `/inbox/api/items${query}`, { method: "GET" });
    if (answer.status !== 200) {
      io.err(`inbox: list refused (${answer.status} ${reasonOf(answer)})`);
      return 1;
    }
    const items = Array.isArray(answer.body.items) ? (answer.body.items as unknown[]) : [];
    for (const one of items) io.out(JSON.stringify(one));
    before = typeof answer.body.next === "string" ? answer.body.next : null;
    if (before === null) return 0;
  }
  io.err(`inbox: list stopped after ${MAX_PAGES} pages`);
  return 1;
}

async function add(io: Io, secret: string, args: readonly string[]): Promise<number> {
  if (args.length > 0) throw new Usage("add takes its items on stdin, one JSON object per line");
  const lines = (await io.stdin()).split("\n");
  let failed = false;
  let any = false;
  for (const [index, text] of lines.entries()) {
    if (text.trim() === "") continue;
    any = true;
    const line = index + 1;
    try {
      JSON.parse(text);
    } catch {
      io.out(JSON.stringify({ line, status: 0, reason: "not-json" }));
      failed = true;
      continue;
    }
    const answer = await call(io, secret, "/inbox/api/items", { method: "POST", body: text });
    if (answer.status === 200 || answer.status === 201) {
      io.out(JSON.stringify({ line, status: answer.status, item: answer.body.item ?? null }));
    } else {
      io.out(JSON.stringify({ line, status: answer.status, reason: reasonOf(answer) }));
      failed = true;
    }
  }
  if (!any) throw new Usage("add read no items on stdin");
  return failed ? 1 : 0;
}

/** The flags `move` takes, each with a value, and the change key each fills. */
const FLAGS: Record<string, string> = { "--reason": "reason", "--topic": "topic", "--link": "link" };

async function move(io: Io, secret: string, args: readonly string[]): Promise<number> {
  const [id, action, ...rest] = args;
  if (id === undefined || action === undefined || !ACTIONS.includes(action)) throw new Usage(`move takes an id and an action: ${ACTIONS.join(", ")}`);
  const change: Record<string, string> = { action };
  for (let i = 0; i < rest.length; i += 2) {
    const key = FLAGS[rest[i] ?? ""];
    const value = rest[i + 1];
    if (key === undefined || value === undefined) throw new Usage(`move: unknown flag or missing value at ${rest[i] ?? ""}`);
    change[key] = value;
  }
  // The inbox requires a drop's reason key, and an empty one means none.
  if (action === "drop" && change.reason === undefined) change.reason = "";
  const answer = await call(io, secret, `/inbox/api/items/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(change) });
  if (answer.status !== 200) {
    io.err(`inbox: move refused (${answer.status} ${reasonOf(answer)})`);
    return 1;
  }
  io.out(JSON.stringify(answer.body.item ?? null));
  return 0;
}

/** Runs one command line; answers the exit status. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  const [verb, ...args] = argv;
  if (verb === undefined || verb === "--help" || verb === "-h" || verb === "help") {
    (verb === undefined ? io.err : io.out)(USAGE);
    return verb === undefined ? 2 : 0;
  }
  const secret = io.env[SECRET_VARIABLE] ?? "";
  if (secret === "") {
    io.err(`inbox: ${SECRET_VARIABLE} is not set`);
    return 2;
  }
  try {
    if (verb === "list") return await list(io, secret, args);
    if (verb === "add") return await add(io, secret, args);
    if (verb === "move") return await move(io, secret, args);
    throw new Usage(`unknown verb: ${verb}`);
  } catch (error) {
    if (error instanceof Usage) {
      io.err(`inbox: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }
}
