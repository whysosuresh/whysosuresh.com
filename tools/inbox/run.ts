// The inbox's command-line client: how the recorder sync, and any session on Suresh's Mac, lists, adds, moves,
// comments on, rewrites and reads the threads in Suresh's private inbox through the threads' calls
// (src/threads.ts), naming each thread by its number, and reads the people he deals with (src/people.ts) by
// theirs, without changing any, as the sync's Cloudflare Access service token. Its client
// id is wrangler.jsonc's public var; its secret comes only from the environment (`INBOX_SYNC_CLIENT_SECRET`), is
// sent only in the Access header, and is never printed or written anywhere. Every answer is one JSON line on
// stdout; a refusal exits non-zero with the Worker's reason. Words (a comment, a summary, a main text) come on
// stdin, so quotes and line breaks need no escaping. A page (a Claude artifact's own HTML) comes from a file,
// because pages are large, and is refused here past the Worker's 16 MiB before it is sent; a link is an address on
// claude.ai. This module is the logic, with fetch, the environment and
// the streams handed in, so the tests drive it with a played fetch; tools/inbox/inbox.ts is the entry point
// that hands it the real ones.

import { readFileSync } from "node:fs";

/** The site the calls go to. */
export const ORIGIN = "https://whysosuresh.com";
/** The environment variable that carries the service token's secret. */
export const SECRET_VARIABLE = "INBOX_SYNC_CLIENT_SECRET";
const TABS = ["look", "act", "discuss", "done"];
const ACTIONS = ["act", "discuss", "unsort", "done", "drop", "reopen", "space", "file"];
const FIELDS = ["summary", "body"];
/** The largest page the Worker keeps: 16 MiB, claude.ai's own limit. */
export const MAX_PAGE_BYTES = 16 * 1024 * 1024;
/** The pages one `list` follows at most: 50 threads each, far beyond what any tab holds. */
const MAX_PAGES = 200;
/** A thread's number: no sign, no leading zero, at most nine digits. */
const NUMBER_SHAPE = /^[1-9]\d{0,8}$/;
/** Where the threads' calls live. */
const THREADS = "/threads/api/threads";
/** Where the people calls live. */
const PEOPLE = "/threads/api/people";

export const USAGE = `Usage: inbox <verb> [arguments]

  list <look|act|discuss|done>    every thread in that tab, newest number first, one JSON line each
  add                             threads from stdin, one JSON object per line; one result line each
  move <number> <action> [--reason <text>] [--space <space>] [--link <issue address>]
                                  one move: act, discuss, unsort, done, drop, reopen, space, file
  comment <number> [--only-me]    a comment from stdin (Markdown), added to the thread; --only-me keeps it
                                  from the people the thread is shared with
  edit <number> <summary|body>    the thread's living summary or main text, replaced by stdin;
                                  an empty summary clears it
  show <number>                   the thread with its comments and history, its page's versions, its
                                  link and the people it is shared with, as one JSON line
  page <number> <file> [--from <claude.ai address>]
                                  the HTML file as the thread's page, a new version of it; --from names the
                                  artifact it was read from
  link <number> <claude.ai address> [--title <text>]
                                  the thread's link to an artifact that only works on claude.ai
  link <number> --clear           the link removed; the thread shows its page again, or its text
  people                          everyone he deals with, whoever was last in touch first, one JSON line each
  person <number>                 one person (by their number) with their threads and what they said, as
                                  one JSON line

The service token's secret is read from ${SECRET_VARIABLE}; the client id from wrangler.jsonc.
Exit status: 0 when every request was answered as asked, 1 on any refusal, 2 on a usage error.
`;

/** What the client needs from the world. */
export interface Io {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The whole of stdin, read only by `add`, `comment` and `edit`. */
  readonly stdin: () => Promise<string>;
  /** A file's bytes, read only by `page`; throws when it can't be read. */
  readonly readFile: (path: string) => Uint8Array;
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

async function call(io: Io, secret: string, path: string, init: { method: string; body?: string | Uint8Array; type?: string }): Promise<Answer> {
  const headers: Record<string, string> = { "CF-Access-Client-Id": io.clientId, "CF-Access-Client-Secret": secret };
  if (init.body !== undefined) headers["Content-Type"] = init.type ?? "application/json";
  let response: Response;
  try {
    // A refused service token is sent to Access's sign-in page; following it would only fetch HTML.
    const sent: RequestInit = { method: init.method, headers, redirect: "manual" };
    if (init.body !== undefined) sent.body = init.body;
    response = await io.fetch(`${ORIGIN}${path}`, sent);
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

/** The thread's number from the command line, or a usage error naming the verb. */
function numberOf(verb: string, given: string | undefined): string {
  if (given === undefined || !NUMBER_SHAPE.test(given)) throw new Usage(`${verb} takes a thread's number, such as 42`);
  return given;
}

/** Prints one key of a 200 or 201 answer, or reports the refusal; answers the exit status. */
function report(io: Io, verb: string, answer: Answer, key: string | null): number {
  if (answer.status !== 200 && answer.status !== 201) {
    io.err(`inbox: ${verb} refused (${answer.status} ${reasonOf(answer)})`);
    return 1;
  }
  io.out(JSON.stringify(key === null ? answer.body : (answer.body[key] ?? null)));
  return 0;
}

async function list(io: Io, secret: string, args: readonly string[]): Promise<number> {
  const [tab, ...rest] = args;
  if (tab === undefined || !TABS.includes(tab) || rest.length > 0) throw new Usage(`list takes one tab: ${TABS.join(", ")}`);
  let before: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query: string = `?tab=${tab}${before === null ? "" : `&before=${before}`}`;
    const answer = await call(io, secret, `${THREADS}${query}`, { method: "GET" });
    if (answer.status !== 200) {
      io.err(`inbox: list refused (${answer.status} ${reasonOf(answer)})`);
      return 1;
    }
    const threads = Array.isArray(answer.body.threads) ? (answer.body.threads as unknown[]) : [];
    for (const one of threads) io.out(JSON.stringify(one));
    before = typeof answer.body.next === "number" && NUMBER_SHAPE.test(String(answer.body.next)) ? String(answer.body.next) : null;
    if (before === null) return 0;
  }
  io.err(`inbox: list stopped after ${MAX_PAGES} pages`);
  return 1;
}

async function add(io: Io, secret: string, args: readonly string[]): Promise<number> {
  if (args.length > 0) throw new Usage("add takes its threads on stdin, one JSON object per line");
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
    const answer = await call(io, secret, THREADS, { method: "POST", body: text });
    if (answer.status === 200 || answer.status === 201) {
      io.out(JSON.stringify({ line, status: answer.status, thread: answer.body.thread ?? null }));
    } else {
      io.out(JSON.stringify({ line, status: answer.status, reason: reasonOf(answer) }));
      failed = true;
    }
  }
  if (!any) throw new Usage("add read no threads on stdin");
  return failed ? 1 : 0;
}

/** The flags `move` takes, each with a value, and the change key each fills. */
const FLAGS: Record<string, string> = { "--reason": "reason", "--space": "space", "--link": "link" };

async function move(io: Io, secret: string, args: readonly string[]): Promise<number> {
  const [given, action, ...rest] = args;
  const number = numberOf("move", given);
  if (action === undefined || !ACTIONS.includes(action)) throw new Usage(`move takes a thread's number and an action: ${ACTIONS.join(", ")}`);
  const change: Record<string, string> = { action };
  for (let i = 0; i < rest.length; i += 2) {
    const key = FLAGS[rest[i] ?? ""];
    const value = rest[i + 1];
    if (key === undefined || value === undefined) throw new Usage(`move: unknown flag or missing value at ${rest[i] ?? ""}`);
    change[key] = value;
  }
  // The inbox requires a drop's reason key, and an empty one means none.
  if (action === "drop" && change.reason === undefined) change.reason = "";
  return report(io, "move", await call(io, secret, `${THREADS}/${number}`, { method: "POST", body: JSON.stringify(change) }), "thread");
}

/**
 * A comment's Markdown from stdin, as is: quotes and line breaks need no escaping. `--only-me` writes it for the
 * owner alone, never shown to the people a thread is shared with.
 */
async function comment(io: Io, secret: string, args: readonly string[]): Promise<number> {
  const [given, ...rest] = args;
  const number = numberOf("comment", given);
  const onlyMe = rest.length === 1 && rest[0] === "--only-me";
  if (rest.length > 0 && !onlyMe) throw new Usage("comment takes a thread's number and --only-me at most, and its words on stdin");
  const body = await io.stdin();
  if (body.trim() === "") throw new Usage("comment read nothing on stdin");
  const sent = onlyMe ? { body, audience: "owner" } : { body };
  return report(io, "comment", await call(io, secret, `${THREADS}/${number}/comments`, { method: "POST", body: JSON.stringify(sent) }), "comment");
}

/** A thread's living summary or main text, replaced by stdin; nothing on stdin clears the summary. */
async function edit(io: Io, secret: string, args: readonly string[]): Promise<number> {
  const [given, field, ...rest] = args;
  const number = numberOf("edit", given);
  if (field === undefined || !FIELDS.includes(field) || rest.length > 0) throw new Usage(`edit takes a thread's number and ${FIELDS.join(" or ")}, and the text on stdin`);
  const text = await io.stdin();
  if (field === "body" && text.trim() === "") throw new Usage("edit body read nothing on stdin; a thread always has a main text");
  return report(io, "edit", await call(io, secret, `${THREADS}/${number}/text`, { method: "POST", body: JSON.stringify({ field, text }) }), "thread");
}

/** A thread with its comments and history, as the Worker answers it. */
async function show(io: Io, secret: string, args: readonly string[]): Promise<number> {
  const [given, ...rest] = args;
  const number = numberOf("show", given);
  if (rest.length > 0) throw new Usage("show takes one thread's number");
  return report(io, "show", await call(io, secret, `${THREADS}/${number}`, { method: "GET" }), null);
}

/** A file as a new version of the thread's page, refused here when it is larger than the Worker keeps. */
async function page(io: Io, secret: string, args: readonly string[]): Promise<number> {
  const [given, file, ...rest] = args;
  const number = numberOf("page", given);
  if (file === undefined || file.startsWith("--")) throw new Usage("page takes a thread's number and an HTML file");
  let from: string | null = null;
  if (rest.length > 0) {
    if (rest.length !== 2 || rest[0] !== "--from" || rest[1] === undefined) throw new Usage("page takes only --from <claude.ai address> after the file");
    from = rest[1];
  }
  let bytes: Uint8Array;
  try {
    bytes = io.readFile(file);
  } catch {
    io.err(`inbox: page can't read ${file}`);
    return 1;
  }
  if (bytes.byteLength > MAX_PAGE_BYTES) {
    io.err(`inbox: page refused (${file} is ${bytes.byteLength} bytes; the most is ${MAX_PAGE_BYTES})`);
    return 1;
  }
  const query = from === null ? "" : `?${new URLSearchParams({ from }).toString()}`;
  return report(io, "page", await call(io, secret, `${THREADS}/${number}/pages${query}`, { method: "POST", body: bytes, type: "text/html; charset=utf-8" }), "version");
}

/** A thread's link to an artifact on claude.ai, with a title, or removed with --clear. */
async function link(io: Io, secret: string, args: readonly string[]): Promise<number> {
  const [given, address, ...rest] = args;
  const number = numberOf("link", given);
  if (address === undefined) throw new Usage("link takes a thread's number and a claude.ai address, or --clear");
  let change: { url: string; title: string };
  if (address === "--clear") {
    if (rest.length > 0) throw new Usage("link --clear takes nothing more");
    change = { url: "", title: "" };
  } else {
    if (rest.length !== 0 && (rest.length !== 2 || rest[0] !== "--title" || rest[1] === undefined)) throw new Usage("link takes only --title <text> after the address");
    change = { url: address, title: rest[1] ?? "" };
  }
  return report(io, "link", await call(io, secret, `${THREADS}/${number}/link`, { method: "POST", body: JSON.stringify(change) }), "thread");
}

/** Everyone, one line each, as the Worker answers them; it says when there were more than it answered. */
async function people(io: Io, secret: string, args: readonly string[]): Promise<number> {
  if (args.length > 0) throw new Usage("people takes nothing more");
  const answer = await call(io, secret, PEOPLE, { method: "GET" });
  if (answer.status !== 200) {
    io.err(`inbox: people refused (${answer.status} ${reasonOf(answer)})`);
    return 1;
  }
  const everyone = Array.isArray(answer.body.people) ? (answer.body.people as unknown[]) : [];
  for (const one of everyone) io.out(JSON.stringify(one));
  if (answer.body.truncated === true) io.err("inbox: people answered only the people last in touch; there are more");
  return 0;
}

/** One person, with their threads and what they said, as the Worker answers them. */
async function person(io: Io, secret: string, args: readonly string[]): Promise<number> {
  const [given, ...rest] = args;
  if (given === undefined || !NUMBER_SHAPE.test(given) || rest.length > 0) throw new Usage("person takes one person's number, such as 7");
  return report(io, "person", await call(io, secret, `${PEOPLE}/${given}`, { method: "GET" }), null);
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
    if (verb === "comment") return await comment(io, secret, args);
    if (verb === "edit") return await edit(io, secret, args);
    if (verb === "show") return await show(io, secret, args);
    if (verb === "page") return await page(io, secret, args);
    if (verb === "link") return await link(io, secret, args);
    if (verb === "people") return await people(io, secret, args);
    if (verb === "person") return await person(io, secret, args);
    throw new Usage(`unknown verb: ${verb}`);
  } catch (error) {
    if (error instanceof Usage) {
      io.err(`inbox: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }
}
