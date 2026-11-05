// The threads' own calls under /threads/api/, behind their own Cloudflare Access application and the Worker's
// own check of who is calling (src/access.ts, with that application's tag): the owner, signed in by an email
// code; the recorder sync, by its service token; and people the owner invited to a thread, signed in by an email
// code too, admitted only while their address has an invitation that stands (`isInvited`, src/store.ts; anyone
// else Access signed in is refused with 403 `caller`, as a stranger always was). A thread is named by its number,
// the one people say out loud (#42).
//
//   GET  /threads/api/me                                                      everyone: who is calling
//   GET  /threads/api/threads?tab=look|act|discuss|done[&before=<number>]   owner and sync
//   GET  /threads/api/threads                                                 invited: the threads they are in
//   POST /threads/api/threads                 {"ref": ..., "source": ..., ...}   sync
//   POST /threads/api/threads                 {"title", "body", "space", "status"}   owner
//   GET  /threads/api/threads/<n>                                             everyone
//   POST /threads/api/threads/<n>             {"action": ...}                  owner and sync
//   POST /threads/api/threads/<n>/comments    {"body": ..., "audience"?: ...}  everyone
//   POST /threads/api/threads/<n>/text        {"field": ..., "text": ...}      owner and sync
//   POST /threads/api/threads/<n>/pages[?from=<claude.ai address>]   an HTML document   sync
//   GET  /threads/api/threads/<n>/pages/<version>                             everyone
//   POST /threads/api/threads/<n>/link        {"url": ..., "title": ...}       owner and sync
//   GET  /threads/api/threads/<n>/people                                      owner
//   POST /threads/api/threads/<n>/people      {"add": {"email", "name"}} | {"remove": <person id>}   owner
//   GET  /threads/api/search?q=<words or a number>                            everyone
//   GET  /threads/api/sign-in?next=<a threads page>                           everyone
//
// An invited person reads only the threads they are in: every read takes the caller as its reader, and the
// store's queries see no other thread, so one they aren't in answers 404 `no-thread`, exactly as a number never
// used. Every call that isn't theirs (a move, a text, a link, a page, an add, a tab's list, the people) is refused
// with 403 `owner-only` before anything is read, so the refusal says nothing about a number. What they see of a
// thread is shaped here (`thread`, `commentView`, `eventView`): never a visitor's email, the origin, the issue
// link, a drop reason, the owner's mail opening or an earlier version of any text, and never an "Only me"
// comment (`audience` `owner`, which only the owner and the sync may write). The people on a thread are the
// owner's to change, from his own page: the sync never invites anyone, because an invitation grants access.
//
// A list answers one tab, newest number first, 50 at a time, with the number to go on from and every tab's count;
// each row also says how many people the thread is shared with (`shared`) and whether its last word is an invited
// person's (`waiting`, which the owner's Today shows). `me` says who is calling, and to the owner and invited people
// their own address (the owner's page needs it to open Gmail as him). The sync's add (src/wire.ts)
// answers the thread already there when its `ref` comes again; the owner's add is a thread he starts from his page, with a title, a space and an open tab. A thread's
// own call answers it with its comments and its history, oldest first, up to 500 of each. A move is one of the
// store's moves (src/store.ts), which holds their rules. A comment adds Markdown to a
// thread. A text replaces the thread's title, its living summary (an empty one clears it) or its main text,
// keeping the text it replaced in the history; a visitor's own words are never rewritten (409 `visitor-words`).
// Text has its own call because a move is capped at 1 KiB. A search answers up to 20 threads for ⌘K: the one
// with that number, or those whose title, summary or text hold the words. The sign-in is where the page sends a
// signed-out owner: Access signs him in at the edge before the call arrives, and the call sends him on to the
// threads page he came from, never anywhere else. A thread's main section is its text, a page or a link (`main`):
// a page is a Claude artifact's own HTML, which the sync saves as a new version (the object in the private bucket
// first, then its row, the object deleted again when the row isn't kept) and the threads page frames from its own
// address, sealed by that answer's headers (src/page.ts); a link is an address on claude.ai, for an artifact that
// only works there, and an empty one clears it. Every thread answers its last activity (`activityAt`). The
// owner's writes must come from his own page; `reply-opened` is his alone and `file` the sync's. Nothing
// personal is logged: a refusal's line holds its status and reason only.

import { identify, type Caller, type Refusal } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { json, type JsonValue } from "./json.ts";
import { servePage, withSkeleton } from "./page.ts";
import { sameOrigin } from "./request.ts";
import {
  comment,
  create,
  edit,
  find,
  history,
  invite,
  invitedCount,
  isInvited,
  isTab,
  findPage,
  listByNumber,
  listShared,
  makeMove,
  onlyFor,
  pagesOf,
  peopleOf,
  savePage,
  search,
  setLink,
  uninvite,
  type CommentRow,
  type EventRow,
  type PageRow,
  type PersonRow,
  type Reader,
  type ThreadRow,
} from "./store.ts";
import {
  MAX_BODY,
  MAX_CHANGE_BYTES,
  MAX_TEXT_BYTES,
  MAX_TITLE,
  lengthRefusal,
  line,
  readAdd,
  readJson,
  readMove,
  readOwnAdd,
  refuse,
  text,
} from "./wire.ts";

/** The most threads one list answers. */
const PAGE = 50;
/** The most comments, and the most events, one thread's call answers; `truncated` says there are more. */
const HISTORY = 500;
/** The longest living summary, in UTF-16 code units of the trimmed text. */
const MAX_SUMMARY = 4000;
/** A thread's number as a path or a cursor names it: no sign, no leading zero, at most nine digits. */
const NUMBER_SHAPE = /^[1-9]\d{0,8}$/;
/** The longest search, in UTF-16 code units of the trimmed words. */
const MAX_SEARCH = 100;
/**
 * Where the sign-in may send the owner on: the threads page's own addresses, as src/pages.ts serves them (Today
 * and the list at /threads/, a thread at /threads/<n> with its title after it), and nowhere else.
 */
const NEXT_SHAPE = /^\/threads\/(?:[1-9]\d{0,8}(?:-[a-z0-9-]{0,80})?)?$/;
/** The largest page: claude.ai holds a page to "16MB or smaller", and 16 MiB is at least that. */
export const MAX_PAGE_BYTES = 16 * 1024 * 1024;
/** The only place a link, or a page's source, may point: an address on claude.ai. */
const CLAUDE = "https://claude.ai/";
/** The longest such address. */
const MAX_ADDRESS = 500;
/** The longest link title, in UTF-16 code units of the trimmed text. */
const MAX_LINK_TITLE = 200;
/** The most threads an invited person's list answers, by last activity, in one page. */
const SHARED_PAGE = 200;
/** The longest name the owner gives a person he invites, in UTF-16 code units of the trimmed text. */
const MAX_PERSON_NAME = 80;
/** The longest email address. */
const MAX_EMAIL = 254;
/**
 * An email address as an invitation takes it: one `@`, a domain of two or more dot-separated parts with none empty (so
 * no trailing dot, which a dictated address often carries and which no sign-in could ever match), and none of the
 * characters that would split or quote it in a mail draft's recipients.
 */
const EMAIL_SHAPE = /^[^\s@,;:<>()"\[\]\\]+@(?:[^\s@,;:<>()"\[\]\\.]+\.)+[^\s@,;:<>()"\[\]\\.]+$/;
/** A person's id, as the store gives it. */
const PERSON_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** How invited people see the owner among a thread's people: the site is his, and so is every thread. */
const OWNER_NAME = "Suresh";
/** What an event's data may say that an invited person never reads: earlier texts, drop reasons, issue links, people's ids. */
const OWNERS_DATA = new Set(["before", "reason", "link", "person"]);

/** A caller who may change a thread itself: the owner and the sync, never an invited person. */
type Writer = Exclude<Caller, { caller: "member" }>;

/** A thread as its reader sees it: everything for the owner and the sync, and for an invited person, what the thread says. */
function thread(row: ThreadRow, reader: Reader): { readonly [key: string]: JsonValue } {
  const said = {
    number: row.number,
    id: row.id,
    createdAt: row.created_at,
    source: row.source,
    space: row.space,
    title: row.title,
    body: row.body,
    summary: row.summary,
    senderName: row.sender_name,
    status: row.status,
    kind: row.kind,
    movedAt: row.moved_at,
    activityAt: row.activity_at,
    main: row.main,
    link: row.link_url === null ? null : { url: row.link_url, title: row.link_title },
  };
  if (reader.caller === "member") return said;
  return {
    ...said,
    senderEmail: row.sender_email,
    dropReason: row.drop_reason,
    replyOpenedAt: row.reply_opened_at,
    ref: row.origin_ref,
    filedLink: row.filed_link,
  };
}

/** The people on a thread: by id, name and address to the owner and the sync; by name only, the owner first, to the people themselves. */
function peopleView(people: readonly PersonRow[], reader: Reader): JsonValue {
  if (reader.caller === "member") return [{ name: OWNER_NAME, owner: true }, ...people.map((person) => ({ name: person.name }))];
  return people.map((person) => ({ id: person.id, name: person.name, email: person.email, addedAt: person.added_at }));
}

/** A thread's page as its call answers it: the newest version, and every version; null when it has none. */
function pageView(pages: readonly PageRow[]): JsonValue {
  const newest = pages[pages.length - 1];
  if (newest === undefined) return null;
  return {
    version: newest.version,
    savedAt: newest.created_at,
    source: newest.source_url,
    versions: pages.map((page) => ({ version: page.version, savedAt: page.created_at, actor: page.actor, bytes: page.bytes, source: page.source_url })),
  };
}

/** An address on claude.ai, as a link or a page's source names it, or null when it isn't one. */
function claudeAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_ADDRESS || !value.startsWith(CLAUDE) || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.origin === "https://claude.ai" && url.username === "" && url.password === "" ? value : null;
  } catch {
    return null;
  }
}

/** A comment, with who may read it and the name of the invited person who wrote it (null for the owner's and the sync's). */
function commentView(row: CommentRow): { readonly [key: string]: JsonValue } {
  return { id: row.id, author: row.author, name: row.person_name, audience: row.audience, body: row.body, createdAt: row.created_at };
}

/** An event; an invited person reads its data without what is the owner's own (`OWNERS_DATA`). */
function eventView(row: EventRow, reader: Reader): { readonly [key: string]: JsonValue } {
  const data = JSON.parse(row.data) as { [key: string]: JsonValue };
  const shown = reader.caller === "member" ? Object.fromEntries(Object.entries(data).filter(([key]) => !OWNERS_DATA.has(key))) : data;
  return { id: row.id, at: row.at, actor: row.actor, type: row.type, data: shown };
}

/** Who is calling, for the threads page: the caller, and their address (none for the sync). */
function me(caller: Caller): Response {
  return json(200, { caller: caller.caller, email: caller.caller === "sync" ? null : caller.email });
}

/** An invited person's threads: every one they are in, most recently active first. */
async function listOwn(env: Bindings, email: string, caller: Caller): Promise<Response> {
  return json(200, { threads: (await listShared(env.DB, email, SHARED_PAGE)).map((row) => thread(row, caller)) });
}

async function list(url: URL, env: Bindings, caller: Writer): Promise<Response> {
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
  return json(200, {
    threads: shown.map((row) => ({ ...thread(row, caller), shared: row.shared ?? 0, waiting: row.waiting === 1 })),
    counts,
    next: rows.length > PAGE && last !== undefined ? last.number : null,
  });
}

async function add(request: Request, env: Bindings, caller: Writer): Promise<Response> {
  if (caller.caller === "owner" && !sameOrigin(request)) return refuse(403, "origin");
  const length = lengthRefusal(request, MAX_TEXT_BYTES);
  if (length !== null) return length;

  const given = await readJson(request);
  const found = caller.caller === "sync" ? readAdd(given) : readOwnAdd(given);
  if (typeof found === "string") return refuse(400, found);

  const kept = await create(env.DB, found, caller.caller);
  if (kept === null) return refuse(500, "store");
  return json(kept.created ? 201 : 200, { thread: thread(kept.row, caller) });
}

async function show(number: number, env: Bindings, caller: Caller): Promise<Response> {
  const row = await find(env.DB, { number }, caller);
  if (row === null) return refuse(404, "no-thread");
  const [{ comments, events }, pages, people] = await Promise.all([
    history(env.DB, row.id, HISTORY + 1, caller),
    pagesOf(env.DB, row.id),
    peopleOf(env.DB, row.id),
  ]);
  return json(200, {
    thread: thread(row, caller),
    page: pageView(pages),
    people: peopleView(people, caller),
    comments: comments.slice(0, HISTORY).map(commentView),
    events: events.slice(0, HISTORY).map((event) => eventView(event, caller)),
    truncated: comments.length > HISTORY || events.length > HISTORY,
  });
}

async function move(request: Request, number: number, env: Bindings, caller: Writer): Promise<Response> {
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const change = readMove(await readJson(request));
  if (change === null) return refuse(400, "change");
  const only = onlyFor(change);
  if (only !== null && only !== caller.caller) return refuse(403, `${only}-only`);

  const moved = await makeMove(env.DB, { number }, change, caller.caller);
  if (moved === "no-thread") return refuse(404, "no-thread");
  if (moved === "not-from-here") return refuse(409, "not-from-here");
  return json(200, { thread: thread(moved, caller) });
}

/** Exactly the given keys, as a record; null for anything else. */
function exactly(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === [...keys].sort().join(",") ? record : null;
}

/**
 * Adds a comment: Markdown, for everyone in the thread (`audience` `thread`, the default) or, from the owner or the
 * sync, for them alone (`owner`, his "Only me"). An invited person's comment is always for everyone in the thread.
 */
async function addComment(request: Request, number: number, env: Bindings, caller: Caller): Promise<Response> {
  const length = lengthRefusal(request, MAX_TEXT_BYTES);
  if (length !== null) return length;
  const given = await readJson(request);
  const fields = exactly(given, ["body"]) ?? exactly(given, ["audience", "body"]);
  const body = fields === null ? null : text(fields.body, MAX_BODY);
  const audience = fields?.audience ?? "thread";
  if (body === null || body === "" || (audience !== "thread" && audience !== "owner")) return refuse(400, "comment");
  if (audience === "owner" && caller.caller === "member") return refuse(403, "owner-only");

  const added = await comment(env.DB, { number }, caller, body, audience);
  if (added === null) return refuse(404, "no-thread");
  return json(201, { comment: commentView(added) });
}

async function replaceText(request: Request, number: number, env: Bindings, caller: Writer): Promise<Response> {
  const length = lengthRefusal(request, MAX_TEXT_BYTES);
  if (length !== null) return length;
  const fields = exactly(await readJson(request), ["field", "text"]);
  const field = fields?.field;
  if (fields === null || (field !== "title" && field !== "summary" && field !== "body")) return refuse(400, "text");
  // A title is one line and never empty; an empty summary clears it; a main text, once written, is never emptied.
  const given = field === "title" ? line(fields.text, MAX_TITLE) : text(fields.text, field === "summary" ? MAX_SUMMARY : MAX_BODY);
  if (given === null || (field === "body" && given === "")) return refuse(400, "text");

  const edited = await edit(env.DB, { number }, field, given === "" ? null : given, caller.caller);
  if (edited === "no-thread") return refuse(404, "no-thread");
  if (edited === "visitor-words") return refuse(409, "visitor-words");
  return json(200, { thread: thread(edited, caller) });
}

async function lookUp(url: URL, env: Bindings, caller: Caller): Promise<Response> {
  const words = url.searchParams.get("q");
  if (words === null || [...url.searchParams.keys()].some((key) => key !== "q") || url.searchParams.getAll("q").length !== 1) return refuse(400, "query");
  const trimmed = line(words, MAX_SEARCH);
  if (trimmed === null) return refuse(400, "query");
  return json(200, { threads: (await search(env.DB, trimmed, caller)).map((row) => thread(row, caller)) });
}

/**
 * Keeps a new version of a thread's page: the sync's alone. The body is the HTML document itself, well-formed
 * UTF-8, at most 16 MiB by its declared length before anything is read; `from`, when given, is the claude.ai address
 * it was read from. The object is written first, under a fresh key, then its row; when the row isn't kept (no such
 * thread, or a save racing another for the version) the object is deleted again.
 */
async function addPage(request: Request, url: URL, number: number, env: Bindings, caller: Writer): Promise<Response> {
  if (caller.caller !== "sync") return refuse(403, "sync-only");
  if ([...url.searchParams.keys()].some((key) => key !== "from") || url.searchParams.getAll("from").length > 1) return refuse(400, "query");
  const given = url.searchParams.get("from");
  const source = given === null ? null : claudeAddress(given);
  if (given !== null && source === null) return refuse(400, "from");
  const declared = request.headers.get("Content-Length");
  if (declared === null || !/^\d{1,12}$/.test(declared)) return refuse(411, "length");
  if (Number(declared) > MAX_PAGE_BYTES) return refuse(413, "too-large");
  if ((request.headers.get("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() !== "text/html") return refuse(415, "type");

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_PAGE_BYTES) return refuse(413, "too-large");
  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return refuse(400, "encoding");
  }
  if (html.trim() === "") return refuse(400, "page");
  const stored = new TextEncoder().encode(withSkeleton(html));
  if (stored.byteLength > MAX_PAGE_BYTES) return refuse(413, "too-large");

  const objectKey = `pages/${crypto.randomUUID()}.html`;
  await env.PAGES.put(objectKey, stored, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  let saved: Awaited<ReturnType<typeof savePage>>;
  try {
    saved = await savePage(env.DB, number, { objectKey, bytes: stored.byteLength, sourceUrl: source }, caller.caller);
  } catch {
    await env.PAGES.delete(objectKey);
    return refuse(409, "busy");
  }
  if (saved === null) {
    await env.PAGES.delete(objectKey);
    return refuse(404, "no-thread");
  }
  return json(201, { version: saved.version, thread: thread(saved.row, caller) });
}

/** One version of a thread's page, as its frame loads it (src/page.ts); a missing one answers as a missing thread. */
async function readPage(request: Request, number: number, given: string, env: Bindings, caller: Caller): Promise<Response> {
  if (!NUMBER_SHAPE.test(given)) return refuse(404, "no-thread");
  const page = await findPage(env.DB, number, Number(given), caller);
  if (page === null) return refuse(404, "no-thread");
  return (await servePage(env.PAGES, page.object_key, request)) ?? refuse(404, "no-thread");
}

/** Sets a thread's link to an artifact on claude.ai, with a title, or clears it with an empty address. */
async function replaceLink(request: Request, number: number, env: Bindings, caller: Writer): Promise<Response> {
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const fields = exactly(await readJson(request), ["title", "url"]);
  if (fields === null || typeof fields.url !== "string" || typeof fields.title !== "string") return refuse(400, "link");
  const clearing = fields.url === "";
  const url = clearing ? null : claudeAddress(fields.url);
  const title = fields.title.trim() === "" ? null : line(fields.title, MAX_LINK_TITLE);
  if ((!clearing && url === null) || (fields.title.trim() !== "" && title === null)) return refuse(400, "link");
  const row = await setLink(env.DB, number, url, clearing ? null : title, caller.caller);
  if (row === null) return refuse(404, "no-thread");
  return json(200, { thread: thread(row, caller) });
}

/** A thread's people, as the owner's Share reads them, with how many people have access to any of his threads. */
async function peopleAnswer(row: ThreadRow, env: Bindings, caller: Caller): Promise<Response> {
  const [people, count] = await Promise.all([peopleOf(env.DB, row.id), invitedCount(env.DB)]);
  return json(200, { people: peopleView(people, caller), invitedCount: count });
}

/** The person an invitation names, as the store takes them, or the reason it is refused. */
function readInvitee(value: unknown, env: Bindings): { email: string; name: string } | "person" | "owner" {
  const fields = exactly(value, ["email", "name"]);
  if (fields === null) return "person";
  const address = line(fields.email, MAX_EMAIL);
  const name = line(fields.name, MAX_PERSON_NAME);
  if (address === null || name === null || !EMAIL_SHAPE.test(address)) return "person";
  const email = address.toLowerCase();
  if (email === (env.INBOX_OWNER_EMAIL ?? "").trim().toLowerCase()) return "owner";
  return { email, name };
}

/**
 * Invites a person to a thread, or takes their invitation back: the owner's alone, from his own page. Answers the
 * thread's people as they now stand, with the count of everyone invited to any thread.
 */
async function changePeople(request: Request, number: number, env: Bindings, caller: Caller): Promise<Response> {
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const given = await readJson(request);
  const adding = exactly(given, ["add"]);
  const removing = exactly(given, ["remove"]);
  if (adding !== null) {
    const invitee = readInvitee(adding.add, env);
    if (typeof invitee === "string") return refuse(400, invitee);
    const row = await invite(env.DB, number, invitee);
    if (row === null) return refuse(404, "no-thread");
    return peopleAnswer(row, env, caller);
  }
  if (removing === null || typeof removing.remove !== "string" || !PERSON_ID_SHAPE.test(removing.remove)) return refuse(400, "person");
  const row = await uninvite(env.DB, number, removing.remove);
  if (row === "no-thread") return refuse(404, "no-thread");
  if (row === "not-invited") return refuse(409, "not-invited");
  return peopleAnswer(row, env, caller);
}

/** A thread's people, for the owner's Share. */
async function readPeople(number: number, env: Bindings, caller: Caller): Promise<Response> {
  const row = await find(env.DB, { number }, caller);
  if (row === null) return refuse(404, "no-thread");
  return peopleAnswer(row, env, caller);
}

/** Sends a caller Access has just signed in back to the threads page they came from, or to the threads. */
function signedIn(url: URL): Response {
  const next = url.searchParams.get("next");
  const to = next !== null && NEXT_SHAPE.test(next) ? next : "/threads/";
  return json(303, { next: to }, { Location: to });
}

/**
 * Who is calling, admitted: the owner and the sync as Access's token names them, and anyone else it signed in only
 * while their address has an invitation that stands; anyone else is refused with 403 `caller`.
 */
async function admit(request: Request, env: Bindings): Promise<Caller | Refusal> {
  const who = await identify(request, env, env.THREADS_ACCESS_AUD);
  if (!("candidate" in who)) return who;
  return (await isInvited(env.DB, who.candidate)) ? { caller: "member", email: who.candidate } : { status: 403, reason: "caller" };
}

/** Answers every request under /threads/api/: who is calling first, then the route. */
export async function handleThreads(request: Request, env: Bindings): Promise<Response> {
  const who = await admit(request, env);
  if (!("caller" in who)) return refuse(who.status, who.reason);

  const url = new URL(request.url);
  if (url.pathname === "/threads/api/search" || url.pathname === "/threads/api/sign-in" || url.pathname === "/threads/api/me") {
    if (request.method !== "GET") return json(405, { reason: "method" }, { Allow: "GET" });
    if (url.pathname === "/threads/api/me") return me(who);
    return url.pathname === "/threads/api/search" ? lookUp(url, env, who) : signedIn(url);
  }
  if (url.pathname === "/threads/api/threads") {
    if (request.method !== "GET" && request.method !== "POST") return json(405, { reason: "method" }, { Allow: "GET, POST" });
    // An invited person's list is the one with no query: their own threads. Every tab, and every add, is the owner's.
    if (who.caller === "member") return request.method === "GET" && url.search === "" ? listOwn(env, who.email, who) : refuse(403, "owner-only");
    return request.method === "GET" ? list(url, env, who) : add(request, env, who);
  }
  const version = /^\/threads\/api\/threads\/([^/]+)\/pages\/([^/]+)$/.exec(url.pathname);
  if (version !== null) {
    if (request.method !== "GET") return json(405, { reason: "method" }, { Allow: "GET" });
    const [, number = "", page = ""] = version;
    return NUMBER_SHAPE.test(number) ? readPage(request, Number(number), page, env, who) : refuse(404, "no-thread");
  }
  const route = /^\/threads\/api\/threads\/([^/]+)(?:\/(comments|text|pages|link|people))?$/.exec(url.pathname);
  if (route === null) return json(404, { reason: "not-found" });
  const [, given = "", part] = route;
  const readable = part === undefined || part === "people";
  const reading = readable && request.method === "GET";
  if (!reading && request.method !== "POST") return json(405, { reason: "method" }, { Allow: readable ? "GET, POST" : "POST" });
  // Same-origin keeps another site from borrowing a signed-in person's cookie. The sync's token travels in
  // headers no other site can set, so it has no origin to show.
  if (!reading && who.caller !== "sync" && !sameOrigin(request)) return refuse(403, "origin");
  // Anything that isn't a thread's number is answered as a thread that isn't there.
  if (!NUMBER_SHAPE.test(given)) return refuse(404, "no-thread");
  const number = Number(given);

  // Every refusal of a call that isn't the caller's comes before anything is read, so it says nothing about the
  // number: an invited person reads a thread and comments on it, and nothing else; the people are the owner's alone.
  if (part === "people") {
    if (who.caller !== "owner") return refuse(403, "owner-only");
    return reading ? readPeople(number, env, who) : changePeople(request, number, env, who);
  }
  if (reading) return show(number, env, who);
  if (part === "comments") return addComment(request, number, env, who);
  if (who.caller === "member") return refuse(403, "owner-only");
  if (part === "text") return replaceText(request, number, env, who);
  if (part === "pages") return addPage(request, url, number, env, who);
  if (part === "link") return replaceLink(request, number, env, who);
  return move(request, number, env, who);
}
