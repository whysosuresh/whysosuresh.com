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
//                                             {"body", "parent"} | {"body", "question"} | {"body", "quote", "prefix", "suffix", "version"}
//                                             owner and invited people
//   POST /threads/api/threads/<n>/comments/<id>   {"action": "show" | "drop" | "hold"}   owner
//   POST /threads/api/threads/<n>/text        {"field": ..., "text": ...}      owner and sync
//   POST /threads/api/threads/<n>/pages[?from=<claude.ai address>]   an HTML document   sync
//   GET  /threads/api/threads/<n>/pages/<version>                             everyone
//   POST /threads/api/threads/<n>/link        {"url": ..., "title": ...}       owner and sync
//   GET  /threads/api/threads/<n>/people                                      owner
//   POST /threads/api/threads/<n>/people      {"add": {"email", "name"}} | {"remove": <person id>}   owner
//   POST /threads/api/threads/<n>/meeting     {"when", "minutes", "where"}     owner and sync
//   POST /threads/api/threads/<n>/attendees   {"add": {"person": <n>}} | {"add": {"name"}} | {"remove": <n>}   owner and sync
//   GET  /threads/api/search?q=<words or a number>                            everyone
//   GET  /threads/api/sign-in?next=<a threads page>                           everyone
//   GET  /threads/api/people[/<n>], POST /threads/api/people/<n>               owner and sync read; owner writes (src/people.ts)
//
// An invited person reads only the threads they are in: every read takes the caller as its reader, and the
// store's queries see no other thread, so one they aren't in answers 404 `no-thread`, exactly as a number never
// used. Every call that isn't theirs (a move, a text, a link, a page, a meeting, an add, a tab's list, the people) is refused
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
// threads page he came from (/me when it names none), never anywhere else. A thread's main section is its text, a page or a link (`main`):
// a page is a Claude artifact's own HTML, which the sync saves as a new version (the object in the private bucket
// first, then its row, the object deleted again when the row isn't kept) and the threads page frames from its own
// address, sealed by that answer's headers (src/page.ts); a link is an address on claude.ai, for an artifact that
// only works there, and an empty one clears it. Every thread answers its last activity (`activityAt`). The
// owner's writes must come from his own page; `reply-opened` is his alone and `file` the sync's. Nothing
// personal is logged: a refusal's line holds its status and reason only.
//
// One of his own threads may be public: `publish` and `unpublish` are moves, his alone, and a thread that isn't his
// own (a site note, a told thread) is never published (409 `not-his-words`). Every reader's thread says when it was
// made public (`publicAt`). A comment's audience is the writer's own choice: `public` (anyone, on a public thread
// only, 409 `not-public` elsewhere) from the owner or an invited person, never from the sync, so nothing it
// transcribes is published without him. A visitor's note on a public thread, and a visitor's answer to its page's
// questions (src/public.ts), are shown at once: he drops either at its own address, shows it again (the page's Undo),
// or sends it back to waiting, and the owner's list counts the notes waiting on each thread (`pending`) and says a
// thread waits on him when a visitor wrote last. An invited person never reads words that aren't shown, and nobody but
// the owner and the sync ever reads a visitor's email. A visitor's answer names the key it came from (`visitor`, the
// first 16 hex characters of the key's hash), so the page shows each visitor's newest answer apart from another
// visitor who typed the same name; it can't be used to answer as anyone.
//
// Everyone he deals with is a person with a number (src/people.ts holds their calls). To the owner and the sync, a
// thread names the person it is from (`senderNumber`), a comment its writer's (`personNumber`), a thread's people
// theirs (`number`), and a search answers the people whose name or address holds the words beside the threads
// (`people`), so a name on his page opens that person. An invited person's shapes gain none of these, and every
// people call refuses them. The sync's add may name a told thread's teller by number (`person`); a number nobody
// has is refused 404 `no-person`, and nothing is written.
//
// Any thread may be one meeting, and every thread says so (`meeting`, null while it isn't one): its when, a day
// (`2026-11-09`, its time not set) or an instant in UTC that each reader shows in their own zone, its length and
// where, and the people who will be in the room (`attendees`), in one order for every reader, by name. The owner
// and the sync set and clear it, and add and remove its people: being in a meeting grants nothing, so an attendee
// is never invited, can't sign in for it, and may be someone with no address, added by name as someone new
// (`{"name"}` always makes a new person; a person already known is added by number). Clearing a meeting takes its
// people off with it. Invited people read the meeting of a thread they are in, its people by name only, and its
// history's events with where a meeting moved from; strangers on a public thread never read it (src/public.ts).
// Refusals: 400 `meeting` or `attendee` for a malformed call; 404 `no-thread`, `no-person`; 409 `not-a-meeting` for
// a thread with no when, `not-attending` for removing someone who isn't in it.

import { identify, type Caller, type Refusal } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { json, type JsonValue } from "./json.ts";
import { servePage, withSkeleton } from "./page.ts";
import { handlePeople, personView } from "./people.ts";
import { sameOrigin } from "./request.ts";
import {
  attend,
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
  searchPeople,
  setLink,
  setMeeting,
  unattend,
  uninvite,
  judgeNote,
  type Anchor,
  type Audience,
  type CommentRow,
  type Judgement,
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
  MAX_PERSON_NAME,
  MAX_TITLE,
  exactly,
  lengthRefusal,
  line,
  readAdd,
  readEmail,
  readJson,
  readMove,
  readOwnAdd,
  quoted,
  readAttendee,
  readMeeting,
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
 * Where the sign-in may send the owner on: the threads page's own addresses, as src/pages.ts serves them (/me,
 * the list at /threads/, a thread at /threads/<n> with its title after it, everyone at /threads/people and a
 * person at /threads/people/<n> with their name after it), and nowhere else. Anything else goes to /me.
 */
const NEXT_SHAPE = /^(?:\/me|\/threads\/(?:[1-9]\d{0,8}(?:-[a-z0-9-]{0,80})?|people(?:\/[1-9]\d{0,8}(?:-[a-z0-9-]{0,80})?)?)?)$/;
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
/** A person's or a comment's id, as the store gives it. */
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** How invited people see the owner among a thread's people: the site is his, and so is every thread. */
const OWNER_NAME = "Suresh";
/** The id a page marks a question with (`data-thread-question`), which stays fixed across its versions. */
const QUESTION_SHAPE = /^[a-z0-9-]{1,40}$/;
/** The most words a comment on a page may quote, in UTF-16 code units, and the most text kept either side of them. */
const MAX_QUOTE = 500;
const MAX_CONTEXT = 64;
/** A page's version as a comment on its words names it. */
const MAX_VERSION = 999_999_999;
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
    publicAt: row.public_at,
    meeting: meetingView(row, reader),
  };
  if (reader.caller === "member") return said;
  return {
    ...said,
    senderNumber: row.sender_number,
    senderEmail: row.sender_email,
    dropReason: row.drop_reason,
    replyOpenedAt: row.reply_opened_at,
    ref: row.origin_ref,
    filedLink: row.filed_link,
  };
}

/** A meeting's person as every row carries them. */
interface MeetingPerson {
  readonly number: number;
  readonly name: string | null;
}

/** Names compared ignoring case, someone with no name after everyone named, then by number: one order for every reader. */
function byName(a: MeetingPerson, b: MeetingPerson): number {
  if (a.name === null || b.name === null) return a.name === b.name ? a.number - b.number : a.name === null ? 1 : -1;
  const [x, y] = [a.name.toLowerCase(), b.name.toLowerCase()];
  return x < y ? -1 : x > y ? 1 : a.number - b.number;
}

/**
 * A thread's meeting as its reader sees it, or null while it isn't one: its when, length and where, and its people
 * in name order, by number and name to the owner and the sync, by name only to invited people.
 */
function meetingView(row: ThreadRow, reader: Reader): JsonValue {
  if (row.meeting_when === null) return null;
  const people = (JSON.parse(row.meeting_people) as MeetingPerson[]).sort(byName);
  return {
    when: row.meeting_when,
    minutes: row.meeting_minutes,
    where: row.meeting_where,
    attendees: reader.caller === "member" ? people.map((person) => ({ name: person.name })) : people.map((person) => ({ number: person.number, name: person.name })),
  };
}

/** The people on a thread: by id, number, name and address to the owner and the sync; by name only, the owner first, to the people themselves. */
function peopleView(people: readonly PersonRow[], reader: Reader): JsonValue {
  if (reader.caller === "member") return [{ name: OWNER_NAME, owner: true }, ...people.map((person) => ({ name: person.name }))];
  return people.map((person) => ({ id: person.id, number: person.number, name: person.name, email: person.email, addedAt: person.added_at }));
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

/**
 * A comment, with who may read it, its state, and the name of who wrote it: the invited person's, or the name a
 * visitor typed (null for the owner's and the sync's, and a visitor who gave none). A visitor's email, and the number
 * of the person who wrote it, reach the owner and the sync only.
 */
function commentView(row: CommentRow, reader: Reader): { readonly [key: string]: JsonValue } {
  const said = {
    id: row.id,
    author: row.author,
    name: row.person_name ?? row.sender_name,
    audience: row.audience,
    state: row.state,
    body: row.body,
    createdAt: row.created_at,
    parent: row.parent_id,
    question: row.question,
    quote:
      row.quote === null || row.page_version === null
        ? null
        : { text: row.quote, prefix: row.quote_prefix ?? "", suffix: row.quote_suffix ?? "", version: row.page_version },
    mine: isMine(row, reader),
    ...(row.visitor_key === null ? {} : { visitor: row.visitor_key.slice(0, 16) }),
  };
  if (reader.caller === "member") return said;
  const owners = row.person_number === null ? said : { ...said, personNumber: row.person_number };
  return row.author === "visitor" ? { ...owners, senderEmail: row.sender_email } : owners;
}

/**
 * Whether the reader wrote a comment, so the page can show their own answer in its box and their comments as theirs:
 * the owner's for him, the sync's for the sync, and for an invited person the comments whose person has their address,
 * never their name, which two people may share. The address itself is never shown.
 */
function isMine(row: CommentRow, reader: Reader): boolean {
  if (reader.caller !== "member") return row.author === reader.caller;
  return row.author === "member" && row.person_email === reader.email;
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
    threads: shown.map((row) => ({ ...thread(row, caller), shared: row.shared ?? 0, waiting: row.waiting === 1, pending: row.pending ?? 0 })),
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
  if (kept === "no-person") return refuse(404, "no-person");
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
    comments: comments.slice(0, HISTORY).map((row) => commentView(row, caller)),
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
  if (moved === "not-his-words") return refuse(409, "not-his-words");
  return json(200, { thread: thread(moved, caller) });
}

/**
 * A comment as the wire asks for it: its body, its audience, and where it sits, or null when it is none of the shapes
 * below. `parent` is a comment's id as given, any string, because one that can't be an id is answered as a comment
 * that isn't there (404 `no-parent`), not as a malformed call.
 */
function readComment(given: unknown): { body: string; audience: string; anchor: Anchor | null } | null {
  const plain = exactly(given, ["body"]) ?? exactly(given, ["audience", "body"]);
  const reply = exactly(given, ["body", "parent"]);
  const answer = exactly(given, ["body", "question"]);
  const words = exactly(given, ["body", "prefix", "quote", "suffix", "version"]);
  const fields = plain ?? reply ?? answer ?? words;
  const body = fields === null ? null : text(fields.body, MAX_BODY);
  if (fields === null || body === null || body === "") return null;
  if (plain !== null) {
    const audience = plain.audience ?? "thread";
    return typeof audience === "string" ? { body, audience, anchor: null } : null;
  }
  if (reply !== null) return typeof reply.parent === "string" ? { body, audience: "thread", anchor: { parent: reply.parent } } : null;
  if (answer !== null) {
    return typeof answer.question === "string" && QUESTION_SHAPE.test(answer.question) ? { body, audience: "thread", anchor: { question: answer.question } } : null;
  }
  const quote = quoted(words?.quote, MAX_QUOTE);
  const prefix = quoted(words?.prefix, MAX_CONTEXT);
  const suffix = quoted(words?.suffix, MAX_CONTEXT);
  const version = words?.version;
  if (quote === null || quote.trim() === "" || prefix === null || suffix === null) return null;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > MAX_VERSION) return null;
  return { body, audience: "thread", anchor: { quote, prefix, suffix, version } };
}

/**
 * Adds a comment: Markdown, for everyone in the thread (`audience` `thread`, the default), from the owner or the
 * sync for them alone (`owner`, his "Only me"), or, from the owner or an invited person on a public thread, for
 * anyone (`public`). The sync never writes for anyone. A comment may also sit somewhere (src/store.ts, `Anchor`):
 * under another (`parent`, taking its audience), as an answer to the page's question (`question`), or on words of a
 * version of the page (`quote`, `prefix`, `suffix`, `version`); each of those is for everyone in the thread, or for
 * whoever its parent is for, and never the sync's, because answers and words come from a page and a reply from a person.
 */
async function addComment(request: Request, number: number, env: Bindings, caller: Caller): Promise<Response> {
  const length = lengthRefusal(request, MAX_TEXT_BYTES);
  if (length !== null) return length;
  const asked = readComment(await readJson(request));
  const audience = asked?.audience;
  if (asked === null || (audience !== "thread" && audience !== "owner" && audience !== "public")) return refuse(400, "comment");
  if (audience === "owner" && caller.caller === "member") return refuse(403, "owner-only");
  if ((audience === "public" || asked.anchor !== null) && caller.caller === "sync") return refuse(403, "not-for-sync");
  const anchor = asked.anchor;
  if (anchor !== null && "parent" in anchor && !ID_SHAPE.test(anchor.parent)) {
    return (await find(env.DB, { number }, caller)) === null ? refuse(404, "no-thread") : refuse(404, "no-parent");
  }

  const added = await comment(env.DB, { number }, caller, asked.body, audience satisfies Audience, anchor);
  if (added === null) return refuse(404, "no-thread");
  if (added === "not-public" || added === "no-replies-here") return refuse(409, added);
  if (added === "no-parent" || added === "no-version") return refuse(404, added);
  return json(201, { comment: commentView(added, caller) });
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
  const threads = (await search(env.DB, trimmed, caller)).map((row) => thread(row, caller));
  // People are the owner's and the sync's alone; an invited person's answer is threads only, as it always was.
  if (caller.caller === "member") return json(200, { threads });
  return json(200, { threads, people: (await searchPeople(env.DB, trimmed)).map(personView) });
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
  const email = readEmail(fields.email, env);
  const name = line(fields.name, MAX_PERSON_NAME);
  if (email === "person" || name === null) return "person";
  if (email === "owner") return "owner";
  return { email: email.email, name };
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
  if (removing === null || typeof removing.remove !== "string" || !ID_SHAPE.test(removing.remove)) return refuse(400, "person");
  const row = await uninvite(env.DB, number, removing.remove);
  if (row === "no-thread") return refuse(404, "no-thread");
  if (row === "not-invited") return refuse(409, "not-invited");
  return peopleAnswer(row, env, caller);
}

/** Sets a thread's meeting, or clears it with `when` null: the owner's and the sync's. Answers the thread. */
async function replaceMeeting(request: Request, number: number, env: Bindings, caller: Writer): Promise<Response> {
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const asked = readMeeting(await readJson(request));
  if (asked === null) return refuse(400, "meeting");
  const set = await setMeeting(env.DB, number, asked.meeting, caller.caller);
  if (set === "no-thread") return refuse(404, "no-thread");
  if (set === "not-a-meeting") return refuse(409, "not-a-meeting");
  return json(200, { thread: thread(set, caller) });
}

/** Adds a person to a thread's meeting, by number or as someone new by name, or takes one off: the owner's and the sync's. Answers the thread. */
async function changeAttendees(request: Request, number: number, env: Bindings, caller: Writer): Promise<Response> {
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const asked = readAttendee(await readJson(request));
  if (asked === null) return refuse(400, "attendee");
  const changed = "add" in asked ? await attend(env.DB, number, asked.add, caller.caller) : await unattend(env.DB, number, asked.remove, caller.caller);
  if (changed === "no-thread" || changed === "no-person") return refuse(404, changed);
  if (changed === "not-a-meeting" || changed === "not-attending") return refuse(409, changed);
  return json(200, { thread: thread(changed, caller) });
}

/** A thread's people, for the owner's Share. */
async function readPeople(number: number, env: Bindings, caller: Caller): Promise<Response> {
  const row = await find(env.DB, { number }, caller);
  if (row === null) return refuse(404, "no-thread");
  return peopleAnswer(row, env, caller);
}

/** His ruling on a visitor's note or answer: dropped, shown again (Undo), or back to waiting. The owner's alone. */
async function judge(request: Request, number: number, noteId: string, env: Bindings, caller: Caller): Promise<Response> {
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const fields = exactly(await readJson(request), ["action"]);
  const action = fields?.action;
  if (action !== "show" && action !== "drop" && action !== "hold") return refuse(400, "change");
  if (!ID_SHAPE.test(noteId)) return refuse(404, "no-note");
  const judged = await judgeNote(env.DB, number, noteId, action satisfies Judgement);
  if (judged === "no-thread" || judged === "no-note") return refuse(404, judged);
  if (judged === "not-from-here") return refuse(409, "not-from-here");
  return json(200, { comment: commentView(judged, caller) });
}

/** Sends a caller Access has just signed in back to the threads page they came from, or to /me. */
function signedIn(url: URL): Response {
  const next = url.searchParams.get("next");
  const to = next !== null && NEXT_SHAPE.test(next) ? next : "/me";
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
  if (url.pathname === "/threads/api/people" || url.pathname.startsWith("/threads/api/people/")) {
    return handlePeople(request, url, env, who, (row) => thread(row, who));
  }
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
  const ruling = /^\/threads\/api\/threads\/([^/]+)\/comments\/([^/]+)$/.exec(url.pathname);
  if (ruling !== null) {
    if (request.method !== "POST") return json(405, { reason: "method" }, { Allow: "POST" });
    // A ruling on a note is the owner's alone, refused before anything is read, and only from his own page.
    if (who.caller !== "owner") return refuse(403, "owner-only");
    if (!sameOrigin(request)) return refuse(403, "origin");
    const [, number = "", noteId = ""] = ruling;
    return NUMBER_SHAPE.test(number) ? judge(request, Number(number), noteId, env, who) : refuse(404, "no-thread");
  }
  const route = /^\/threads\/api\/threads\/([^/]+)(?:\/(comments|text|pages|link|people|meeting|attendees))?$/.exec(url.pathname);
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
  if (part === "meeting") return replaceMeeting(request, number, env, who);
  if (part === "attendees") return changeAttendees(request, number, env, who);
  return move(request, number, env, who);
}
