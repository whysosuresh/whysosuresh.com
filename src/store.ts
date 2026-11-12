// The store: every thread Suresh keeps, whatever door it came through. A thread is one row in `threads` with a
// number people can say out loud (#42); its history is its rows in `events`, and the words added to it are its
// rows in `comments` (migrations/0006_threads.sql). Two doors write here: the note flow (src/talk.ts), and the
// threads' calls (src/threads.ts), which the owner's page and the recorder sync use. Each door turns its own wire
// into the intents below, so the rules live here once.
//
// Every write that changes a thread writes its event in the same batch, which D1 runs as one transaction: the
// event is an INSERT ... SELECT from the row under the same guard as the change, ahead of the change, so it
// reads the row as it was, and both apply or neither does. A move states its new status once, as one SQL
// expression on the row, and both statements use it, so the event names the status the row really went to.
// A thread's number is one more than the largest, given inside its INSERT; D1 runs one query at a time, and the
// UNIQUE constraint turns any duplicate into an error rather than two #42s. Every write also stamps the thread's
// last activity (`activity_at`, migrations/0008_activity.sql) in the same batch: an arrival, a move, an edit, a
// comment, a page saved, a link set. This file is its only writer, so the rule lives here once.
//
// A thread's main section (`main`, migrations/0009_pages.sql) is its text, a page or a link, whichever was attached
// last. A page's versions are rows in `pages`, each naming its object in the private bucket by a fresh key; the
// bucket is the threads' calls' to write (src/threads.ts), before the row, and this file only keeps the rows.
//
// A thread may be shared with people Suresh invites (`people` and `members`, migrations/0010_members.sql). Every
// read and the one write an invited person may make (a comment) take a `Reader`: the owner and the sync see every
// thread, and an invited person only the threads they have an invitation to that stands, by one SQL condition
// (`readable`) on the query itself. A thread they aren't in is a row the query can't see, so a door answers it
// exactly as a number never used. Their comments see only what everyone in the thread may (`audience`), so the
// owner's "Only me" comments never reach them. Who may call at all is asked of the same tables (`isInvited`), by
// the threads' door and by the answer Cloudflare Access is given at sign-in (src/evaluate.ts), so the two can't
// disagree about who is invited.
//
// One of his own threads may also be public (`public_at`, migrations/0011_public.sql): anyone with its link reads it,
// with no sign-in, through the public calls (src/public.ts), which ask their own queries here (`findPublic`,
// `historyPublic`, `findPublicPage`, `publicPreview`), each holding the public condition (`PUBLIC`) in its own SQL.
// The link names the thread by its key (`share_key`, migrations/0021_share_keys.sql), 128 random bits given the first
// time he makes it public and kept for good, never by its number, so counting numbers opens nothing: a stranger names a
// thread by a `PublicAddress`, and `publicWhere` is the one condition that address opens. A number opens a public
// thread only while `public_by_number` holds, which the migration set for the threads public before keys existed and
// `unpublish` clears.
// A stranger sees only the comments written as Public that are shown. A visitor may send a note on a public thread
// (`addNote`), and answer the questions of its page while the page is its main section (`addAnswer`,
// migrations/0015_visitor_answers.sql): each is a comment for anyone, shown at once, and only he drops it, or shows
// it again (`judgeNote`). A visitor's answer carries the hash of a key their browser keeps (`visitor_key`): answering
// again from it is a new answer, and the newest per question and key is the one that shows (a dropped newest hides
// that key's answer, never bringing back an older one). A stranger reads other people's answers to a question only
// once their own key has answered it (`historyPublic`), so nobody's answer is shaped by the ones before it.
//
// A public thread may also be on his home page (`feed_at`, migrations/0018_feed.sql), a second act of his (`post`,
// `unpost`), so making a thread readable by its link never lists it for everyone who opens the site. Taking a thread
// back from public takes it off the home page in the same statement. The home page reads the newest posted threads
// and the Now line, his one line under the greeting, in one batch (`homeFeed`); the Now line is a history of rows, the
// newest of which is the line (`nowLine`, `setNowLine`).
//
// Everyone he deals with is a person (`people`, migrations/0012_people.sql), numbered as threads are: the people he
// invites, a visitor who wrote from the site or on a public thread with an address, and someone who told him
// something in person. Who a site note or a told thread is from is `threads.person_id`; who wrote an invited
// person's comment or a visitor's note is `comments.person_id`. The person is found or made here, once, in the same
// batch as the write that names them: by the address a visitor typed, lowercased (a visitor's typing never renames
// anyone, so a person made from it is named by what they typed only when new); for a told thread by the person
// number the sync names, else by the told name when exactly one person has it (trimmed, ignoring case), else a new
// person; and an invitation by the address it names, so a person who wrote from the site and is then invited is one
// person, his typed name winning. A comment shows an invited person's name as it stands, and a visitor's as they
// typed it, so linking a note to a person changes nothing anyone else reads. People are his alone to read with the
// sync and to change (`editPerson`): their name, their address while they have none, and his own notes on them.
//
// A comment may sit somewhere other than the thread itself (migrations/0013_anchors.sql): under another comment (a
// reply), as an answer to a question of the thread's page, or on words of a version of the page. `comment` checks
// the place in its own INSERT, under the same reader as the thread: a reader replies only under a comment they can
// see, so an invited person never replies under "Only me", and a reply takes its parent's audience.
//
// Any thread may also be one meeting (migrations/0014_meetings.sql), once it has a when: a day, its time not set yet,
// or an instant in UTC, with a length and a where if said, and the people who will be in the room (`attendees`).
// Being in a meeting grants nothing: an attendee is not a member, so it never opens the thread or answers yes at
// sign-in, and someone with no address can be one. Every row carries its meeting's people by number and name
// (`meeting_people`), so a meeting reads the same in every list, search and answer. `setMeeting` sets or clears the
// meeting, a change of time keeping where it moved from (`from`, as a move does), and clearing it takes its people
// off with it; `attend` and `unattend` change who is in it. A name given to `attend` always makes a new person,
// because both callers hold the people list already and say a number for anyone they know.
//
// One of his own threads whose main section is a page may also be an ask (migrations/0016_asks.sql): a questions page
// handed to many people by one link, /ask/<slug> (src/asks.ts). `makeAsk` makes it a draft under a slug, which never
// changes; `setAskState` opens it (his alone, the door holds that) and closes it, each with its event. An ask's thread
// is never public and never given a link, so its page stays its main section and strangers read only what the ask
// calls say. Each browser that answers gets a thread of its own, a site note (`source` `talk`, with every protection a
// site note has: never public, its words never rewritten) naming the ask (`ask_thread_id`), with the ask's title and
// space, an empty body, and the ask's page as its main section: `answerAsk` keeps the answer and, the first time, the
// thread, in one batch, one thread per ask and browser by its origin (`ask:<the ask's id>:<the key's hash>`), and holds
// the ask being open in each insert's own SQL, so an answer racing a close is kept nowhere. A response thread's pages
// are its ask's (`COALESCE(ask_thread_id, id)` wherever pages are read), and it is never given a page or a link of its
// own. Its answers carry its person, so a person's page shows them (`wordsOfPerson`).

import { LISTS, isList, type List } from "../site/app/standing.js";
import { outsideItems, type OutsideRow } from "./outside-store.ts";

/** Where a thread came from: the site's note flow, something told to him in person, or his own. */
export type Source = "talk" | "told" | "self";
/** Who made a change through a private door. */
export type Author = "owner" | "sync";
/**
 * Who is reading: the owner and the sync read every thread; an invited person, named by the address they signed
 * in with (lowercased), reads only the threads they are in.
 */
export type Reader = { readonly caller: "owner" | "sync" } | { readonly caller: "member"; readonly email: string };
/** Who may read a comment: everyone in the thread, the owner and the sync only ("Only me"), or anyone (a public thread). */
export type Audience = "thread" | "owner" | "public";
/** Who an event names: a private door's caller, the visitor who sent a note, or the copy from the inbox. */
export type Actor = Author | "visitor" | "import";
export type Status = "received" | "act" | "discuss" | "done" | "dropped" | "filed";

/**
 * A list the threads' calls answer, and the statuses it holds: every open thread (pending), each open status alone,
 * and every closed one. The map is the page's and the command line's too (site/app/standing.js); typed here against
 * this file's own statuses, so a status one side lacks fails the Worker's type check.
 */
export const TABS: Readonly<Record<List, readonly Status[]>> = LISTS;
export type Tab = List;
export const isTab = isList;

// The last activity reads the arrival time when it was never set: a thread the code before 0008 created between
// that migration and its deploy. A plain expression, so it is safe in RETURNING.
// Who a thread is from is read with their number, so a page can link the name; a subquery, which RETURNING allows.
// So are a meeting's people, as one JSON array of their numbers, names and addresses (`[]` for none), in no promised
// order: SQLite doesn't order an aggregate, so the door sorts them, and it never emits an address; it reads one only
// to tell an invited reader which attendee is them. A response thread reads its ask's number, slug and title the same way.
export const COLUMNS =
  "id, number, created_at, source, space, title, body, summary, status, kind, sender_name, sender_email, drop_reason, reply_opened_at, origin_ref, filed_link, moved_at, COALESCE(activity_at, created_at) AS activity_at, main, link_url, link_title, public_at, feed_at, share_key, public_by_number, person_id, (SELECT people.number FROM people WHERE people.id = threads.person_id) AS sender_number, meeting_when, meeting_minutes, meeting_where, (SELECT json_group_array(json_object('number', people.number, 'name', people.name, 'email', people.email, 'photo', people.photo_id)) FROM attendees JOIN people ON people.id = attendees.person_id WHERE attendees.thread_id = threads.id) AS meeting_people, ask_slug, ask_state, ask_thread_id, (SELECT asked.number FROM threads AS asked WHERE asked.id = threads.ask_thread_id) AS ask_of_number, (SELECT asked.ask_slug FROM threads AS asked WHERE asked.id = threads.ask_thread_id) AS ask_of_slug, (SELECT asked.title FROM threads AS asked WHERE asked.id = threads.ask_thread_id) AS ask_of_title";

export interface ThreadRow {
  id: string;
  number: number;
  created_at: string;
  source: string;
  space: string | null;
  title: string | null;
  body: string;
  summary: string | null;
  status: string;
  kind: string | null;
  sender_name: string | null;
  sender_email: string | null;
  drop_reason: string | null;
  reply_opened_at: string | null;
  origin_ref: string | null;
  filed_link: string | null;
  moved_at: string | null;
  activity_at: string;
  /** What the thread shows as its main section. */
  main: Main;
  link_url: string | null;
  link_title: string | null;
  /** When he made it public; null while it isn't. */
  public_at: string | null;
  /** When he put it on the home page, which only a public thread may be on; null while it isn't there. */
  feed_at: string | null;
  /** The key in its public link, given the first time he made it public and kept for good; null until then. */
  share_key: string | null;
  /** 1 while its number opens it for strangers too (a thread public before links had keys), else 0. */
  public_by_number: number;
  /** The person a site note or told thread is from, and their number; null for his own and a note with no address. */
  person_id: string | null;
  sender_number: number | null;
  /** Its meeting's when (a day `YYYY-MM-DD`, or an instant in UTC), null while it isn't one; its length in minutes and where. */
  meeting_when: string | null;
  meeting_minutes: number | null;
  meeting_where: string | null;
  /** Its meeting's people, as a JSON array of `{number, name, email, photo}` in no promised order; the address is never shown. */
  meeting_people: string;
  /** His own thread as an ask: its slug and state (`AskState`); null on every other thread. */
  ask_slug: string | null;
  ask_state: string | null;
  /** A response thread: the ask's thread it answers, and that thread's number, slug and title; null on every other. */
  ask_thread_id: string | null;
  ask_of_number: number | null;
  ask_of_slug: string | null;
  ask_of_title: string | null;
  /** On a list's rows only (`LIST_EXTRAS`): how many people the thread is shared with now. */
  shared?: number;
  /** On a list's rows only: 1 when the last word on it is an invited person's or a visitor's, else 0. */
  waiting?: number;
}

/** A thread's main section: its text, a page saved into it, or a link to an artifact on claude.ai. */
export type Main = "text" | "page" | "link";

/** An ask's state: made and not yet before anyone, taking answers, or read and taking none. */
export type AskState = "draft" | "open" | "closed";

/** One saved version of a thread's page. */
export interface PageRow {
  version: number;
  object_key: string;
  created_at: string;
  actor: string;
  bytes: number;
  source_url: string | null;
}

export interface CommentRow {
  id: string;
  thread_id: string;
  /**
   * `owner`, `sync`, `member` for an invited person, or `visitor` for a visitor's comment: a note sent on a public
   * thread or an answer to a public page's question (both `audience` `public`), or an answer to an ask (`thread`).
   */
  author: string;
  body: string;
  created_at: string;
  audience: string;
  /** `shown` or `dropped` (`pending`, a visitor's note waiting for his OK, ended with migrations/0015). */
  state: string;
  /**
   * The person who wrote it (an invited person, or a visitor who typed an address) and their number; null for the
   * owner's and the sync's. `person_name` is their name as it stands for an invited person's comment only.
   */
  person_id: string | null;
  person_name: string | null;
  person_number: number | null;
  /** The photo of an invited person's comment only (`member`); null for every other, a visitor's under their address included. */
  person_photo: string | null;
  /**
   * A visitor's comment only: the name and email they typed, each null when not given. An ask answer carries its
   * thread's name and no email; its person is the thread's.
   */
  sender_name: string | null;
  sender_email: string | null;
  /**
   * Where it sits (migrations/0013_anchors.sql), each null for a general comment: the comment a reply is under, the
   * page's question an answer answers, or the words of a page version a comment is on, with the text either side.
   */
  parent_id: string | null;
  question: string | null;
  quote: string | null;
  quote_prefix: string | null;
  quote_suffix: string | null;
  page_version: number | null;
  /** The address of the person who wrote it, for the door to tell a reader their own; never shown to anyone. */
  person_email: string | null;
  /** A visitor's answer only: the hex SHA-256 of the key their browser keeps (migrations/0015_visitor_answers.sql). */
  visitor_key: string | null;
}

/**
 * Where a comment sits other than on the thread itself: under another comment (a reply), as an answer to one of the
 * thread's page's questions, by the id the page marks it with, or on words of one version of the page, found again by
 * the text either side of them. Exactly one, because a reply sits where its parent does.
 */
export type Anchor =
  | { readonly parent: string }
  | { readonly question: string }
  | { readonly quote: string; readonly prefix: string; readonly suffix: string; readonly version: number };

/** A visitor's note or answer as he rules on it: dropped, or shown again (how the page undoes a drop). */
export type Judgement = "show" | "drop";

/** A person a thread is shared with, as the owner sees them. */
export interface PersonRow {
  id: string;
  number: number;
  email: string;
  name: string | null;
  added_at: string;
  /** Their photo (src/photos.ts), null while they have none. */
  photo_id: string | null;
}

export interface EventRow {
  id: number;
  thread_id: string;
  at: string;
  actor: string;
  type: string;
  data: string;
}

/** How the threads' calls name a thread: by its number. */
export type Locator = { readonly number: number };

type Value = string | number | null;

/** The numbered parameters of one statement: `add` binds a value and answers its `?N`. */
class Params {
  readonly values: Value[] = [];

  add(value: Value): string {
    this.values.push(value);
    return `?${this.values.length}`;
  }

  list(values: readonly Value[]): string {
    return values.map((value) => this.add(value)).join(", ");
  }
}

function locate(locator: Locator, p: Params): string {
  return `number = ${p.add(locator.number)}`;
}

/**
 * The condition a public thread meets, on the row `threads`: he made it public, it is his own, because a site note's
 * and a told thread's words are someone else's, and it has the key its link carries, so nothing can serve or list a
 * public thread nobody can link to. Every public query holds it, so a row changed by hand never leaks.
 */
const PUBLIC = "threads.public_at IS NOT NULL AND threads.source = 'self' AND threads.share_key IS NOT NULL";

/** A public thread's key as its link carries it: 16 random bytes as 32 lowercase hex characters. */
export const SHARE_KEY_SHAPE = /^[0-9a-f]{32}$/;

/** A new key for a public thread's link, from the runtime's random source: 128 bits, as `SHARE_KEY_SHAPE`. */
export function newShareKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * How a stranger named a thread: by its link's key, or by its number, which opens only a thread public before links
 * had keys. Never `key`, which in the public calls is a visitor's own key.
 */
export type PublicAddress = { readonly shareKey: string } | { readonly number: number };

/** The row an address names, on `threads`, whether or not it is public. */
function addressed(address: PublicAddress, p: Params): string {
  return "shareKey" in address ? `threads.share_key = ${p.add(address.shareKey)}` : `threads.number = ${p.add(address.number)}`;
}

/** What makes a thread public to an address: `PUBLIC`, and for a number, that its number still opens it. */
function openTo(address: PublicAddress): string {
  return "shareKey" in address ? PUBLIC : `${PUBLIC} AND threads.public_by_number = 1`;
}

/** The one condition a public read or write holds: the row the address names, public to that address. */
function publicWhere(address: PublicAddress, p: Params): string {
  return `${addressed(address, p)} AND ${openTo(address)}`;
}
/** A thread on the home page and in its feed: public, and posted by him. */
const LISTED = `${PUBLIC} AND threads.feed_at IS NOT NULL`;

/** Every thread: how the store itself looks a thread up after a write it made as the owner or the sync. */
const EVERY_THREAD: Reader = { caller: "owner" };

/** An invitation that stands, to the thread `thread` names (an SQL expression for its id), for the address bound in. */
function standing(thread: string, email: string, p: Params): string {
  return `EXISTS (SELECT 1 FROM members JOIN people ON people.id = members.person_id
    WHERE members.thread_id = ${thread} AND members.removed_at IS NULL AND people.email = ${p.add(email)})`;
}

/**
 * The condition a reader adds to a query on `threads`, as ` AND …`: nothing for the owner and the sync, and for an
 * invited person, an invitation that stands to that thread.
 */
function readable(reader: Reader, p: Params): string {
  return reader.caller === "member" ? ` AND ${standing("threads.id", reader.email, p)}` : "";
}

function statement(db: D1Database, sql: string, p: Params): D1PreparedStatement {
  return db.prepare(sql).bind(...p.values);
}

/** The kind each status a new thread may start in carries, as the owner's own moves set it. */
const KIND_OF = { received: null, act: "feedback", discuss: "idea" } as const;

/** A new thread, as a door checked it. */
export interface NewThread {
  readonly source: Source;
  readonly space: string | null;
  readonly title: string | null;
  readonly body: string;
  readonly senderName: string | null;
  readonly senderEmail: string | null;
  readonly status: keyof typeof KIND_OF;
  /** Where an added thread came from; adding the same one again answers the thread already there. */
  readonly originRef: string | null;
  /** A told thread only: the person the sync names as the teller, by number; null to find them by name. */
  readonly person: number | null;
  /** A response thread only: the id of the ask's thread it answers, which must be open when it is kept. */
  readonly ask?: string;
}

/** The number the next person gets: one more than the largest, given inside their INSERT, as a thread's is. */
const NEXT_PERSON = "(SELECT COALESCE(MAX(number), 0) + 1 FROM people)";

/** Who a new thread is from, as the store finds them: by a typed address, by the sync's number, by a told name, or no one. */
type Sender =
  | { readonly by: "email"; readonly email: string; readonly name: string | null }
  | { readonly by: "number"; readonly number: number }
  | { readonly by: "name"; readonly name: string }
  | null;

function senderOf(thread: NewThread): Sender {
  if (thread.source === "talk") return thread.senderEmail === null ? null : { by: "email", email: thread.senderEmail.trim().toLowerCase(), name: thread.senderName };
  if (thread.source !== "told") return null;
  if (thread.person !== null) return { by: "number", number: thread.person };
  return thread.senderName === null ? null : { by: "name", name: thread.senderName };
}

/** A told name compared as the store compares names: trimmed, ignoring case for ASCII letters. */
function sameName(column: string, name: string, p: Params): string {
  return `lower(trim(${column})) = lower(${p.add(name.trim())})`;
}

/**
 * The person a write names, as two parts of its batch: the statement that makes them when they are new (null when
 * nothing is made), run first, and the SQL expression for their id, bound into the write itself. `when` is a
 * condition the write needs, so nobody is made for a write that isn't kept.
 */
function personOf(db: D1Database, sender: Sender, now: string, when: (p: Params) => string, into: Params): { make: D1PreparedStatement | null; id: string } {
  if (sender === null) return { make: null, id: "NULL" };
  if (sender.by === "number") return { make: null, id: `(SELECT id FROM people WHERE number = ${into.add(sender.number)})` };
  const id = crypto.randomUUID();
  const p = new Params();
  if (sender.by === "email") {
    // A known address makes nobody and renames nobody.
    const make = statement(
      db,
      `INSERT INTO people (id, number, email, name, created_at) SELECT ${p.add(id)}, ${NEXT_PERSON}, ${p.list([sender.email, sender.name, now])} WHERE ${when(p)}
       ON CONFLICT (email) DO NOTHING`,
      p,
    );
    return { make, id: `(SELECT id FROM people WHERE email = ${into.add(sender.email)})` };
  }
  // A told name joins the one person who has it; none, or several, make a new person.
  const make = statement(
    db,
    `INSERT INTO people (id, number, email, name, created_at) SELECT ${p.add(id)}, ${NEXT_PERSON}, NULL, ${p.list([sender.name.trim(), now])}
     WHERE (SELECT COUNT(*) FROM people WHERE ${sameName("name", sender.name, p)}) <> 1 AND ${when(p)}`,
    p,
  );
  return { make, id: `COALESCE((SELECT id FROM people WHERE id = ${into.add(id)}), (SELECT id FROM people WHERE ${sameName("name", sender.name, into)}))` };
}

/** The ask whose thread has the id bound in is open, as a condition any statement can hold. */
function askOpen(askId: string, p: Params): string {
  return `EXISTS (SELECT 1 FROM threads AS ask WHERE ask.id = ${p.add(askId)} AND ask.ask_state = 'open')`;
}

/**
 * A new thread's statements, in the order its batch runs them: the person it is from when they are new, the thread,
 * and its `created` event; `row` is the index of the thread's insert, whose RETURNING is the row when it made one. With
 * an `originRef` already kept, the insert does nothing, and nobody is made. A response thread (`ask`) is kept only
 * while its ask is open, and shows its ask's page.
 */
function createStatements(db: D1Database, thread: NewThread, actor: Actor, now: string, id: string): { statements: D1PreparedStatement[]; row: number } {
  const sender = senderOf(thread);
  const p = new Params();
  // Nobody is made for an add that answers the thread already there, or a response to an ask that isn't open.
  const fresh = (q: Params): string => {
    const conditions = [thread.originRef === null ? "1" : `NOT EXISTS (SELECT 1 FROM threads WHERE origin_ref = ${q.add(thread.originRef)})`];
    if (thread.ask !== undefined) conditions.push(askOpen(thread.ask, q));
    return conditions.join(" AND ");
  };
  const person = personOf(db, sender, now, fresh, p);
  const values = p.list([
    id,
    now,
    now,
    thread.source,
    thread.space,
    thread.title,
    thread.body,
    thread.status,
    KIND_OF[thread.status],
    thread.senderName,
    thread.senderEmail,
    thread.originRef,
  ]);
  const insert = statement(
    db,
    `INSERT INTO threads (id, created_at, activity_at, source, space, title, body, status, kind, sender_name, sender_email, origin_ref, number, person_id, main, ask_thread_id)
     SELECT ${values}, (SELECT COALESCE(MAX(number), 0) + 1 FROM threads), ${person.id}, ${p.add(thread.ask === undefined ? "text" : "page")}, ${p.add(thread.ask ?? null)}
     WHERE ${thread.ask === undefined ? "1" : askOpen(thread.ask, p)}
     ON CONFLICT (origin_ref) WHERE origin_ref IS NOT NULL DO NOTHING
     RETURNING ${COLUMNS}`,
    p,
  );
  // The id is new, so this finds a row only when the insert above made one.
  const e = new Params();
  const event = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data)
     SELECT id, created_at, ${e.add(actor)}, 'created', json_object('source', source, 'status', status) FROM threads WHERE id = ${e.add(id)}`,
    e,
  );
  return { statements: [...(person.make === null ? [] : [person.make]), insert, event], row: person.make === null ? 0 : 1 };
}

/**
 * Keeps a new thread, numbered after the largest, with its `created` event and the person it is from, found or made
 * in the same batch. With an `originRef` already kept, nothing is written and the thread already there is answered,
 * `created` false. `no-person` when the sync names a person number nobody has; then nothing is written.
 */
export async function create(db: D1Database, thread: NewThread, actor: Actor): Promise<{ row: ThreadRow; created: boolean } | null | "no-person"> {
  const sender = senderOf(thread);
  if (sender?.by === "number" && (await db.prepare("SELECT 1 AS yes FROM people WHERE number = ?1").bind(sender.number).first()) === null) return "no-person";
  const made = createStatements(db, thread, actor, new Date().toISOString(), crypto.randomUUID());
  const results = await db.batch<ThreadRow>(made.statements);
  const row = results[made.row]?.results[0];
  if (row !== undefined) return { row, created: true };
  if (thread.originRef === null) return null;
  const there = await db.prepare(`SELECT ${COLUMNS} FROM threads WHERE origin_ref = ?1`).bind(thread.originRef).first<ThreadRow>();
  return there === null ? null : { row: there, created: false };
}

/** A thread by its number, when the reader may read it. */
export async function find(db: D1Database, locator: Locator, reader: Reader): Promise<ThreadRow | null> {
  const p = new Params();
  return statement(db, `SELECT ${COLUMNS} FROM threads WHERE ${locate(locator, p)}${readable(reader, p)}`, p).first<ThreadRow>();
}

/** How many threads have each status, every status there is. */
function countStatement(db: D1Database): D1PreparedStatement {
  return db.prepare("SELECT status, COUNT(*) AS n FROM threads GROUP BY status");
}

/** One tab's threads, with every tab's count, from one batch so the two agree. */
export interface Listed {
  readonly rows: ThreadRow[];
  readonly counts: Record<Tab, number>;
}

async function listed(db: D1Database, page: D1PreparedStatement): Promise<Listed> {
  const [rows, counts] = await db.batch<ThreadRow | { status: string; n: number }>([page, countStatement(db)]);
  const byStatus = new Map(((counts?.results ?? []) as { status: string; n: number }[]).map((row) => [row.status, row.n]));
  const tally = Object.fromEntries(Object.keys(TABS).map((name) => [name, 0])) as Record<Tab, number>;
  for (const name of Object.keys(TABS) as Tab[]) {
    for (const status of TABS[name]) tally[name] += byStatus.get(status) ?? 0;
  }
  return { rows: (rows?.results ?? []) as ThreadRow[], counts: tally };
}

/**
 * Whether the thread `alias` names waits on him: the newest comment by an invited person or a visitor is later than
 * his newest comment or change, as one SQL expression.
 */
function waitingOn(alias: string): string {
  return `(COALESCE((SELECT MAX(created_at) FROM comments WHERE comments.thread_id = ${alias}.id AND comments.author IN ('member', 'visitor')), '')
    > MAX(COALESCE((SELECT MAX(created_at) FROM comments WHERE comments.thread_id = ${alias}.id AND comments.author = 'owner'), ''),
          COALESCE((SELECT MAX(at) FROM events WHERE events.thread_id = ${alias}.id AND events.actor = 'owner'), '')))`;
}

/**
 * What the owner's list says of each row beside the thread: how many people it is shared with now (`shared`),
 * whether the last word on it is someone else's (`waiting`): an invited person's or a visitor's newest comment is later
 * than the owner's newest comment or change, so it waits on him until he comments, moves it or edits it. Derived from
 * the rows already kept, with nothing stored for it; times
 * compare as the ISO strings every writer stamps.
 */
const LIST_EXTRAS = `(SELECT COUNT(*) FROM members WHERE members.thread_id = threads.id AND members.removed_at IS NULL) AS shared,
  ${waitingOn("threads")} AS waiting`;

/** Up to `limit` threads of a tab, newest number first, below `before` when given, each with `LIST_EXTRAS`. */
export async function listByNumber(db: D1Database, tab: Tab, before: number | null, limit: number): Promise<Listed> {
  const p = new Params();
  const statuses = p.list(TABS[tab]);
  const cursor = before === null ? "" : ` AND number < ${p.add(before)}`;
  return listed(db, statement(db, `SELECT ${COLUMNS}, ${LIST_EXTRAS} FROM threads WHERE status IN (${statuses})${cursor} ORDER BY number DESC LIMIT ${limit}`, p));
}

/** Up to `limit` of the threads an invited person is in, most recently active first. */
export async function listShared(db: D1Database, email: string, limit: number): Promise<ThreadRow[]> {
  const p = new Params();
  return (
    await statement(
      db,
      `SELECT ${COLUMNS} FROM threads WHERE ${standing("threads.id", email, p)} ORDER BY COALESCE(activity_at, created_at) DESC, number DESC LIMIT ${limit}`,
      p,
    ).all<ThreadRow>()
  ).results;
}

/**
 * The columns a comment is read with: its own, the number of the person who wrote it, and their name as it stands
 * for an invited person's only, so a visitor's note keeps the name they typed wherever it is shown; and their address,
 * which the door reads only to tell a reader which comments are their own.
 */
const COMMENT_COLUMNS =
  "comments.id, comments.thread_id, comments.author, comments.body, comments.created_at, comments.audience, comments.state, comments.person_id, CASE WHEN comments.author = 'member' THEN people.name END AS person_name, people.number AS person_number, CASE WHEN comments.author = 'member' THEN people.photo_id END AS person_photo, comments.sender_name, comments.sender_email, comments.parent_id, comments.question, comments.quote, comments.quote_prefix, comments.quote_suffix, comments.page_version, people.email AS person_email, comments.visitor_key";

/**
 * Events an invited person never sees: the owner's mail opening, the copy from the old inbox, a visitor's note
 * dropped or sent back to waiting, which would tell them a note arrived that they could never read, and his marking
 * an ask's answers read.
 */
const OWNERS_EVENTS = "'reply-opened', 'imported', 'note-dropped', 'note-held', 'ask-read'";

/**
 * A thread's comments and events, oldest first, up to `limit` of each. An invited person reads only the comments
 * everyone in the thread may that are shown (never "Only me", never a note waiting for his OK or dropped), and not
 * the events that are the owner's own business; the door shapes the rest of what they see (src/threads.ts).
 */
export async function history(db: D1Database, threadId: string, limit: number, reader: Reader): Promise<{ comments: CommentRow[]; events: EventRow[] }> {
  const member = reader.caller === "member";
  const [comments, events] = await db.batch<CommentRow | EventRow>([
    db
      .prepare(
        `SELECT ${COMMENT_COLUMNS} FROM comments LEFT JOIN people ON people.id = comments.person_id
         WHERE comments.thread_id = ?1${member ? " AND comments.audience <> 'owner' AND comments.state = 'shown'" : ""} ORDER BY comments.created_at, comments.id LIMIT ${limit}`,
      )
      .bind(threadId),
    db
      .prepare(`SELECT id, thread_id, at, actor, type, data FROM events WHERE thread_id = ?1${member ? ` AND type NOT IN (${OWNERS_EVENTS})` : ""} ORDER BY id LIMIT ${limit}`)
      .bind(threadId),
  ]);
  return { comments: (comments?.results ?? []) as CommentRow[], events: (events?.results ?? []) as EventRow[] };
}

/** A move a door asks for, as the store's own intent. */
export type Move =
  | { readonly action: "act" | "discuss" | "done" | "reopen" | "unsort" | "reply-opened" | "publish" | "unpublish" | "post" | "unpost" }
  | { readonly action: "drop"; readonly reason: string | null }
  | { readonly action: "space"; readonly space: string }
  | { readonly action: "file"; readonly link: string };

/** A move as SQL: the statuses it starts from, its new status, what else it sets, and the event it writes. */
interface Rule {
  readonly from: readonly Status[];
  /** The new status, as an SQL expression on the row; absent for a move that leaves the status alone. */
  readonly status?: string;
  /** What else the move sets, each `column = <expression>`. */
  readonly sets: (p: Params) => string[];
  /** An extra condition the row must meet, beside its status. */
  readonly where?: string;
  /** The one caller a move belongs to; either may make it when absent. */
  readonly only?: Author;
  /** The event: its type, and its data as an SQL expression on the row before the move. */
  readonly event: (p: Params) => { readonly type: string; readonly data: string };
}

const OPEN: readonly Status[] = ["received", "act", "discuss"];

/** A `moved` event from the row's status to the move's, with any extra fields. */
function moved(to: string, extra: Record<string, Value> = {}): Rule["event"] {
  return (p) => {
    const fields = Object.entries(extra)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => `, '${key}', ${p.add(value)}`)
      .join("");
    return { type: "moved", data: `json_object('from', status, 'to', ${to}${fields})` };
  };
}

function ruleOf(move: Move, now: string): Rule {
  switch (move.action) {
    case "act":
    case "discuss": {
      const to = `'${move.action}'`;
      const kind = move.action === "act" ? "feedback" : "idea";
      return { from: OPEN, status: to, sets: (p) => [`kind = ${p.add(kind)}`], event: moved(to) };
    }
    case "done":
      // A filed thread is closed once its issue is: how a filed note gets back to Reply.
      return { from: ["act", "discuss", "filed"], status: "'done'", sets: () => [], event: moved("'done'") };
    case "drop":
      return { from: OPEN, status: "'dropped'", sets: (p) => [`drop_reason = ${p.add(move.reason)}`], event: moved("'dropped'", { reason: move.reason }) };
    case "reopen": {
      // A closed thread goes back to where it was: Filed when it became an issue, else where its kind puts it
      // (To act on, To discuss), or To look at when it was never sorted; a dropped one loses its reason. This
      // is also how the page undoes Done and Drop.
      const to = "CASE WHEN filed_link IS NOT NULL THEN 'filed' WHEN kind = 'feedback' THEN 'act' WHEN kind = 'idea' THEN 'discuss' ELSE 'received' END";
      return { from: ["done", "dropped"], status: to, sets: () => ["drop_reason = NULL"], event: moved(to) };
    }
    case "unsort":
      // Back to To look at, unsorted: how the page undoes Act on it and Talk it through.
      return { from: ["act", "discuss"], status: "'received'", sets: () => ["kind = NULL"], event: moved("'received'") };
    case "space":
      return {
        from: [...OPEN, "done", "dropped", "filed"],
        sets: (p) => [`space = ${p.add(move.space)}`],
        event: (p) => ({ type: "space", data: `json_object('from', space, 'to', ${p.add(move.space)})` }),
      };
    case "reply-opened":
      // It marks the owner's own mail opening, so it is his alone, and only a thread with an address has one.
      return {
        from: [...OPEN, "done", "dropped"],
        sets: (p) => [`reply_opened_at = ${p.add(now)}`],
        where: "sender_email IS NOT NULL",
        only: "owner",
        event: () => ({ type: "reply-opened", data: "json_object()" }),
      };
    case "publish":
      // Putting words in front of anyone is his act, as an invitation is; only his own threads, never someone
      // else's words. Like `space`, it leaves the status alone.
      return {
        from: [...OPEN, "done", "dropped", "filed"],
        // Its link's key is given the first time and kept for good, so publishing again brings back the same link; the
        // key is made only here, where `makeMove` builds the update, and never written into the event.
        sets: (p) => [`public_at = ${p.add(now)}`, `share_key = COALESCE(share_key, ${p.add(newShareKey())})`],
        // An ask's thread is never public: strangers read an ask only through the ask calls, never its summary.
        where: "source = 'self' AND public_at IS NULL AND ask_slug IS NULL",
        only: "owner",
        event: () => ({ type: "published", data: "json_object()" }),
      };
    case "unpublish":
      // Taking a thread back is never refused while it is public, whatever its row says. It leaves the home page in
      // the same statement, so making it public again never lists it again unasked, and its number stops opening it
      // for good, so making it public again opens it by its link alone. Its key is kept.
      return {
        from: [...OPEN, "done", "dropped", "filed"],
        sets: () => ["public_at = NULL", "feed_at = NULL", "public_by_number = 0"],
        where: "public_at IS NOT NULL",
        only: "owner",
        event: () => ({ type: "unpublished", data: "json_object()" }),
      };
    case "post":
      // Listing a thread on the home page is a second act of his, after making it public: public alone is readable by
      // anyone with the link, and posted is listed for everyone who opens the site. Posting again after taking it off
      // gives it a new date, so it goes back to the top. Like `publish`, it leaves the status alone.
      return {
        from: [...OPEN, "done", "dropped", "filed"],
        sets: (p) => [`feed_at = ${p.add(now)}`],
        where: `${PUBLIC} AND feed_at IS NULL`,
        only: "owner",
        event: () => ({ type: "posted", data: "json_object()" }),
      };
    case "unpost":
      // Taking it off the home page is never refused while it is there; it stays public.
      return {
        from: [...OPEN, "done", "dropped", "filed"],
        sets: () => ["feed_at = NULL"],
        where: "feed_at IS NOT NULL",
        only: "owner",
        event: () => ({ type: "unposted", data: "json_object()" }),
      };
    case "file":
      // Filing an issue needs GitHub, which only the sync holds. Filed is something to act on, so it carries
      // that kind: Reply comes back once it is Done.
      return {
        from: OPEN,
        status: "'filed'",
        sets: (p) => [`filed_link = ${p.add(move.link)}`, "kind = 'feedback'"],
        only: "sync",
        event: moved("'filed'", { link: move.link }),
      };
  }
}

/** The one caller a move belongs to, or null when either may make it; a door checks this before the thread. */
export function onlyFor(move: Move): Author | null {
  return ruleOf(move, "").only ?? null;
}

/**
 * Makes a move and writes its event, or neither: `no-thread` when there is no such thread, `not-his-words` when it
 * would publish a thread that isn't his own, `an-ask` when it would publish an ask's thread, `not-public` when it would
 * post a thread that isn't public, `not-from-here` when the thread isn't where the move starts. Every move stamps
 * `moved_at`.
 */
export async function makeMove(
  db: D1Database,
  locator: Locator,
  move: Move,
  actor: Author,
): Promise<ThreadRow | "no-thread" | "not-from-here" | "not-his-words" | "an-ask" | "not-public"> {
  const now = new Date().toISOString();
  const rule = ruleOf(move, now);
  const guard = (p: Params): string => `${locate(locator, p)} AND status IN (${p.list(rule.from)})${rule.where === undefined ? "" : ` AND ${rule.where}`}`;

  const e = new Params();
  const { type, data } = rule.event(e);
  const event = `INSERT INTO events (thread_id, at, actor, type, data) SELECT id, ${e.add(now)}, ${e.add(actor)}, ${e.add(type)}, ${data} FROM threads WHERE ${guard(e)}`;

  const u = new Params();
  const sets = [...(rule.status === undefined ? [] : [`status = ${rule.status}`]), ...rule.sets(u), `moved_at = ${u.add(now)}`, `activity_at = ?${u.values.length}`];
  const update = `UPDATE threads SET ${sets.join(", ")} WHERE ${guard(u)} RETURNING ${COLUMNS}`;

  const [, updated] = await db.batch<ThreadRow>([statement(db, event, e), statement(db, update, u)]);
  const row = updated?.results[0];
  if (row !== undefined) return row;
  const there = await find(db, locator, EVERY_THREAD);
  if (there === null) return "no-thread";
  if (move.action === "publish" && there.source !== "self") return "not-his-words";
  if (move.action === "post" && (there.public_at === null || there.source !== "self" || there.share_key === null)) return "not-public";
  return move.action === "publish" && there.ask_slug !== null ? "an-ask" : "not-from-here";
}

/** The texts of a thread that can be rewritten: its title, the living summary on top, and the main text. */
export type TextField = "title" | "summary" | "body";

/**
 * Replaces a thread's title, its summary (null clears it) or its main text, and keeps the text it replaced in an
 * `edited` event, so every earlier version stays in the history. A visitor's note keeps their own words: its main
 * text is never rewritten (`visitor-words`); its title and summary are the owner's labels, so they may be. An
 * edit is not a move, so `moved_at` stays as it is; it is activity, so `activity_at` moves.
 */
export async function edit(db: D1Database, locator: Locator, field: TextField, text: string | null, actor: Author): Promise<ThreadRow | "no-thread" | "visitor-words"> {
  const now = new Date().toISOString();
  const guard = (p: Params): string => `${locate(locator, p)}${field === "body" ? " AND source <> 'talk'" : ""}`;
  const e = new Params();
  const event = `INSERT INTO events (thread_id, at, actor, type, data)
    SELECT id, ${e.add(now)}, ${e.add(actor)}, 'edited', json_object('field', ${e.add(field)}, 'before', ${field}) FROM threads WHERE ${guard(e)}`;
  const u = new Params();
  const update = `UPDATE threads SET ${field} = ${u.add(text)}, activity_at = ${u.add(now)} WHERE ${guard(u)} RETURNING ${COLUMNS}`;
  const [, updated] = await db.batch<ThreadRow>([statement(db, event, e), statement(db, update, u)]);
  const row = updated?.results[0];
  if (row !== undefined) return row;
  return (await find(db, locator, EVERY_THREAD)) === null ? "no-thread" : "visitor-words";
}

/**
 * A comment a reply may sit under, as a condition on the comment `alias` names: a root (none of a reply and an answer),
 * shown, and neither a visitor's note nor written for anyone. An answer is changed by answering again, and a reply
 * under a public comment would be a reply strangers read, which the public view doesn't show.
 */
function repliable(alias: string): string {
  return `${alias}.parent_id IS NULL AND ${alias}.question IS NULL AND ${alias}.author <> 'visitor' AND ${alias}.audience <> 'public' AND ${alias}.state = 'shown'`;
}

/**
 * The comments a reader may see, as a condition on the comment `alias` names: all of them for the owner and the sync,
 * and for an invited person, those for everyone that are shown, as `history` answers them.
 */
function visible(alias: string, reader: Reader): string {
  return reader.caller === "member" ? ` AND ${alias}.audience <> 'owner' AND ${alias}.state = 'shown'` : "";
}

/** Why a comment wasn't kept, beyond a thread the reader can't read (null). */
export type CommentRefusal = "not-public" | "no-parent" | "no-replies-here" | "no-version";

/**
 * Adds a comment to a thread the reader may read, which is activity on it; null when there is no such thread, or
 * none they may read, and `not-public` when it is written as Public on a thread that isn't. An invited person's
 * comment names them; the door keeps `owner` to the owner and the sync, and `public` to the owner and members.
 *
 * An `anchor` places it (migrations/0013_anchors.sql), checked in the same INSERT as the thread: a reply's parent is
 * a comment in the same thread the reader can see, that a reply may sit under (`repliable`; `no-parent` when there is
 * no such comment the reader can see, `no-replies-here` when there is one but not of that kind), and the reply takes
 * its parent's audience whatever `audience` says, so a reply under "Only me" stays his; words are on a version the
 * thread's page has (`no-version`). Answers and words are for everyone in the thread, as the door asks.
 */
export async function comment(
  db: D1Database,
  locator: Locator,
  reader: Reader,
  body: string,
  audience: Audience,
  anchor: Anchor | null = null,
): Promise<CommentRow | null | CommentRefusal> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const p = new Params();
  const person = reader.caller === "member" ? `(SELECT id FROM people WHERE email = ${p.add(reader.email)})` : "NULL";
  const parent = anchor !== null && "parent" in anchor ? anchor.parent : null;
  const parentKey = parent === null ? "NULL" : p.add(parent);
  const audienceOf = parent === null ? p.add(audience) : `(SELECT audience FROM comments WHERE id = ${parentKey})`;
  const question = anchor !== null && "question" in anchor ? anchor.question : null;
  const quote = anchor !== null && "quote" in anchor ? anchor : null;
  const placed = [parentKey, p.add(question), p.add(quote?.quote ?? null), p.add(quote?.prefix ?? null), p.add(quote?.suffix ?? null), p.add(quote?.version ?? null)];
  const columns = `${p.add(id)}, id, ${p.add(reader.caller)}, ${p.add(body)}, ${p.add(now)}, ${audienceOf}, ${person}, ${placed.join(", ")}`;
  const conditions = [
    audience === "public" ? ` AND ${PUBLIC}` : "",
    parent === null
      ? ""
      : ` AND EXISTS (SELECT 1 FROM comments AS parent WHERE parent.id = ${parentKey} AND parent.thread_id = threads.id AND ${repliable("parent")}${visible("parent", reader)})`,
    quote === null ? "" : ` AND EXISTS (SELECT 1 FROM pages WHERE pages.thread_id = COALESCE(threads.ask_thread_id, threads.id) AND pages.version = ${p.add(quote.version)})`,
  ];
  const insert = statement(
    db,
    `INSERT INTO comments (id, thread_id, author, body, created_at, audience, person_id, parent_id, question, quote, quote_prefix, quote_suffix, page_version)
     SELECT ${columns} FROM threads WHERE ${locate(locator, p)}${readable(reader, p)}${conditions.join("")}`,
    p,
  );
  // Only the thread the comment above went into is touched, so a refused comment changes nothing.
  const u = new Params();
  const touch = statement(db, `UPDATE threads SET activity_at = ${u.add(now)} WHERE id = (SELECT thread_id FROM comments WHERE id = ${u.add(id)})`, u);
  const r = new Params();
  const read = statement(
    db,
    `SELECT ${COMMENT_COLUMNS} FROM comments LEFT JOIN people ON people.id = comments.person_id WHERE comments.id = ${r.add(id)}`,
    r,
  );
  const [, , added] = await db.batch<CommentRow>([insert, touch, read]);
  const row = added?.results[0];
  if (row !== undefined) return row;
  // Refused: say why, reading only what the reader may read.
  const thread = await find(db, locator, reader);
  if (thread === null) return null;
  if (audience === "public" && anchor === null) return "not-public";
  if (quote !== null) return "no-version";
  if (parent === null) return null;
  const q = new Params();
  const seen = await statement(
    db,
    `SELECT 1 AS found FROM comments AS parent WHERE parent.id = ${q.add(parent)} AND parent.thread_id = ${q.add(thread.id)}${visible("parent", reader)}`,
    q,
  ).first<{ found: number }>();
  return seen === null ? "no-parent" : "no-replies-here";
}

/** The most threads one search answers. */
export const SEARCH_LIMIT = 20;

/**
 * Threads for a search, most recently active first: the one numbered `number` when the words are a number
 * (`42` or `#42`), else every thread whose title, summary or main text holds the words as typed, ignoring case
 * for ASCII letters. `%` and `_` in the words match only themselves. Up to `SEARCH_LIMIT`.
 */
export async function search(db: D1Database, words: string, reader: Reader): Promise<ThreadRow[]> {
  const number = /^#?([1-9]\d{0,8})$/.exec(words);
  const p = new Params();
  if (number !== null) {
    return (await statement(db, `SELECT ${COLUMNS} FROM threads WHERE number = ${p.add(Number(number[1]))}${readable(reader, p)}`, p).all<ThreadRow>()).results;
  }
  const pattern = p.add(`%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const like = (column: string): string => `${column} LIKE ${pattern} ESCAPE '\\'`;
  // The three matches are one condition, in parentheses, so the reader's condition holds for all of them.
  return (
    await statement(
      db,
      `SELECT ${COLUMNS} FROM threads WHERE (${like("title")} OR ${like("summary")} OR ${like("body")})${readable(reader, p)}
       ORDER BY COALESCE(activity_at, created_at) DESC, number DESC LIMIT ${SEARCH_LIMIT}`,
      p,
    ).all<ThreadRow>()
  ).results;
}

/** A page version a door has already written to the bucket, as the store keeps its row. */
export interface NewPage {
  readonly objectKey: string;
  readonly bytes: number;
  readonly sourceUrl: string | null;
}

/**
 * Keeps a new version of a thread's page, numbered after its last, with its `page-saved` event, and makes the
 * page the thread's main section: one batch, so all of it is kept or none. `no-thread` when there is no such thread,
 * `asked` when it is a response thread, whose page is its ask's. Throws when the batch fails, a save racing another for the same version among the ways it can; either way the
 * caller deletes the object it wrote, so no object is left that no row names.
 */
export async function savePage(db: D1Database, number: number, page: NewPage, actor: Author): Promise<{ row: ThreadRow; version: number } | "no-thread" | "asked"> {
  const now = new Date().toISOString();
  const p = new Params();
  const insert = statement(
    db,
    `INSERT INTO pages (thread_id, version, object_key, created_at, actor, bytes, source_url)
     SELECT id, (SELECT COALESCE(MAX(version), 0) + 1 FROM pages WHERE pages.thread_id = threads.id), ${p.list([page.objectKey, now, actor, page.bytes, page.sourceUrl])}
     FROM threads WHERE number = ${p.add(number)} AND ask_thread_id IS NULL`,
    p,
  );
  // The object's key is unique and new, so this finds the row the insert above made, and nothing when it made none.
  const e = new Params();
  const event = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data)
     SELECT thread_id, created_at, actor, 'page-saved', json_object('version', version, 'bytes', bytes) FROM pages WHERE object_key = ${e.add(page.objectKey)}`,
    e,
  );
  const u = new Params();
  const update = statement(
    db,
    `UPDATE threads SET main = 'page', activity_at = ${u.add(now)}
     WHERE id = (SELECT thread_id FROM pages WHERE object_key = ${u.add(page.objectKey)}) RETURNING ${COLUMNS}`,
    u,
  );
  const v = new Params();
  const version = statement(db, `SELECT version FROM pages WHERE object_key = ${v.add(page.objectKey)}`, v);
  const [, , updated, saved] = await db.batch<ThreadRow | { version: number }>([insert, event, update, version]);
  const row = updated?.results[0] as ThreadRow | undefined;
  const kept = saved?.results[0] as { version: number } | undefined;
  if (row !== undefined && kept !== undefined) return { row, version: kept.version };
  return (await find(db, { number }, EVERY_THREAD)) === null ? "no-thread" : "asked";
}

/**
 * One version of a thread's page, by the thread's number; null when either isn't there, or the reader may not read it.
 * A response thread's page is its ask's.
 */
export async function findPage(db: D1Database, number: number, version: number, reader: Reader): Promise<PageRow | null> {
  const p = new Params();
  return statement(
    db,
    `SELECT pages.version, pages.object_key, pages.created_at, pages.actor, pages.bytes, pages.source_url
     FROM pages JOIN threads ON pages.thread_id = COALESCE(threads.ask_thread_id, threads.id)
     WHERE threads.number = ${p.add(number)} AND pages.version = ${p.add(version)}${readable(reader, p)}`,
    p,
  ).first<PageRow>();
}

/** Every version of a thread's page, oldest first; a response thread's are its ask's. */
export async function pagesOf(db: D1Database, threadId: string): Promise<PageRow[]> {
  return (
    await db
      .prepare(
        "SELECT version, object_key, created_at, actor, bytes, source_url FROM pages WHERE thread_id = COALESCE((SELECT ask_thread_id FROM threads WHERE id = ?1), ?1) ORDER BY version",
      )
      .bind(threadId)
      .all<PageRow>()
  ).results;
}

/** A thread that is neither an ask nor a response to one, as a condition on `threads`. */
const NO_ASK = "ask_slug IS NULL AND ask_thread_id IS NULL";

/**
 * Sets a thread's link to an artifact on claude.ai and makes it the main section, or (`url` null) clears it, the
 * main section going back to the page when the thread has one, else to its text. The `link-set` event keeps the
 * address it replaced. A link set again to what it already is still writes its event: it is what was asked. An ask's
 * thread is never given one, so its page stays its main section (`an-ask`), nor is a response thread, whose page is its
 * ask's (`asked`); `no-thread` when there is no such thread. Either way nothing is written.
 */
export async function setLink(db: D1Database, number: number, url: string | null, title: string | null, actor: Author): Promise<ThreadRow | "no-thread" | "an-ask" | "asked"> {
  const now = new Date().toISOString();
  const e = new Params();
  const event = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data)
     SELECT id, ${e.add(now)}, ${e.add(actor)}, 'link-set', json_object('url', ${e.add(url)}, 'title', ${e.add(title)}, 'before', link_url)
     FROM threads WHERE number = ${e.add(number)} AND ${NO_ASK}`,
    e,
  );
  const u = new Params();
  const main =
    url === null ? "CASE WHEN EXISTS (SELECT 1 FROM pages WHERE pages.thread_id = threads.id) THEN 'page' ELSE 'text' END" : "'link'";
  const update = statement(
    db,
    `UPDATE threads SET link_url = ${u.add(url)}, link_title = ${u.add(title)}, main = ${main}, activity_at = ${u.add(now)}
     WHERE number = ${u.add(number)} AND ${NO_ASK} RETURNING ${COLUMNS}`,
    u,
  );
  const [, updated] = await db.batch<ThreadRow>([event, update]);
  const row = updated?.results[0];
  if (row !== undefined) return row;
  const there = await find(db, { number }, EVERY_THREAD);
  if (there === null) return "no-thread";
  return there.ask_slug !== null ? "an-ask" : "asked";
}

/**
 * Whether an address has an invitation that stands, to any thread: who the threads' door admits besides the owner
 * and the sync, and what Cloudflare Access is told at sign-in (src/evaluate.ts). One indexed query.
 */
export async function isInvited(db: D1Database, email: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS yes FROM members JOIN people ON people.id = members.person_id WHERE people.email = ?1 AND members.removed_at IS NULL LIMIT 1")
    .bind(email)
    .first<{ yes: number }>();
  return row !== null;
}

/** The people a thread is shared with now, in the order they were invited. */
export async function peopleOf(db: D1Database, threadId: string): Promise<PersonRow[]> {
  return (
    await db
      .prepare(
        `SELECT people.id, people.number, people.email, people.name, members.added_at, people.photo_id FROM members JOIN people ON people.id = members.person_id
         WHERE members.thread_id = ?1 AND members.removed_at IS NULL ORDER BY members.added_at, people.id`,
      )
      .bind(threadId)
      .all<PersonRow>()
  ).results;
}

/** How many people have an invitation that stands, to any thread: each person once. */
export async function invitedCount(db: D1Database): Promise<number> {
  return (await db.prepare("SELECT COUNT(DISTINCT person_id) AS n FROM members WHERE removed_at IS NULL").first<{ n: number }>())?.n ?? 0;
}

/** A person to invite, as the door checked them: the address lowercased, and the name he typed. */
export interface Invitee {
  readonly email: string;
  readonly name: string;
}

/**
 * Invites a person to a thread, by the owner, in one batch: the person (kept once per address, their name the one
 * typed now; a new one numbered after the largest), the `invited` event (only when they weren't already in it), the
 * invitation (a new one, or a removed one standing again) and the thread's last activity. Inviting someone already
 * in the thread changes nothing but their name. Null when there is no such thread, and then nothing is written, the
 * person included. An address someone typed on the site, or he gave a told person, lands on that person.
 */
export async function invite(db: D1Database, number: number, invitee: Invitee): Promise<ThreadRow | null> {
  const now = new Date().toISOString();
  const p = new Params();
  const person = statement(
    db,
    `INSERT INTO people (id, number, email, name, created_at)
     SELECT ${p.add(crypto.randomUUID())}, ${NEXT_PERSON}, ${p.list([invitee.email, invitee.name, now])} WHERE EXISTS (SELECT 1 FROM threads WHERE number = ${p.add(number)})
     ON CONFLICT (email) DO UPDATE SET name = excluded.name`,
    p,
  );
  const e = new Params();
  const event = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data)
     SELECT threads.id, ${e.add(now)}, 'owner', 'invited', json_object('person', people.id, 'name', people.name)
     FROM threads JOIN people ON people.email = ${e.add(invitee.email)}
     WHERE threads.number = ${e.add(number)} AND NOT ${standing("threads.id", invitee.email, e)}`,
    e,
  );
  const m = new Params();
  const member = statement(
    db,
    `INSERT INTO members (thread_id, person_id, added_at)
     SELECT threads.id, people.id, ${m.add(now)} FROM threads JOIN people ON people.email = ${m.add(invitee.email)} WHERE threads.number = ${m.add(number)}
     ON CONFLICT (thread_id, person_id) DO UPDATE SET added_at = excluded.added_at, removed_at = NULL WHERE members.removed_at IS NOT NULL`,
    m,
  );
  const u = new Params();
  const touch = statement(db, `UPDATE threads SET activity_at = ${u.add(now)} WHERE number = ${u.add(number)} RETURNING ${COLUMNS}`, u);
  const [, , , touched] = await db.batch<ThreadRow>([person, event, member, touch]);
  return touched?.results[0] ?? null;
}

/**
 * Takes back a person's invitation to a thread, by the owner, with its `removed` event and the thread's last
 * activity: one batch. `no-thread` when there is no such thread, `not-invited` when the person has no invitation
 * there that stands; either way nothing is written.
 */
export async function uninvite(db: D1Database, number: number, personId: string): Promise<ThreadRow | "no-thread" | "not-invited"> {
  const now = new Date().toISOString();
  const guard = (p: Params): string =>
    `threads.number = ${p.add(number)} AND EXISTS (SELECT 1 FROM members WHERE members.thread_id = threads.id AND members.person_id = ${p.add(personId)} AND members.removed_at IS NULL)`;
  const e = new Params();
  const event = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data)
     SELECT threads.id, ${e.add(now)}, 'owner', 'removed', json_object('person', people.id, 'name', people.name)
     FROM threads JOIN people ON people.id = ${e.add(personId)} WHERE ${guard(e)}`,
    e,
  );
  const m = new Params();
  const member = statement(
    db,
    `UPDATE members SET removed_at = ${m.add(now)}
     WHERE person_id = ${m.add(personId)} AND removed_at IS NULL AND thread_id = (SELECT id FROM threads WHERE number = ${m.add(number)})`,
    m,
  );
  // The touch runs before the invitation ends, in the same batch, because its guard reads the invitation.
  const u = new Params();
  const touch = statement(db, `UPDATE threads SET activity_at = ${u.add(now)} WHERE ${guard(u)} RETURNING ${COLUMNS}`, u);
  const [, touched] = await db.batch<ThreadRow>([event, touch, member]);
  const row = touched?.results[0];
  if (row !== undefined) return row;
  return (await find(db, { number }, EVERY_THREAD)) === null ? "no-thread" : "not-invited";
}

/** A thread's meeting, as a door checked it: its when (a day `YYYY-MM-DD`, or an instant in UTC), its length in minutes and where, each null when not said. */
export interface Meeting {
  readonly when: string;
  readonly minutes: number | null;
  readonly where: string | null;
}

/** The meeting a row holds now, as a JSON object (null while it isn't one): what an event keeps as `from`. */
const MEETING_NOW = "CASE WHEN meeting_when IS NULL THEN NULL ELSE json_object('when', meeting_when, 'minutes', meeting_minutes, 'where', meeting_where) END";

/** The meeting on the thread numbered `number`, as a condition on `threads`. */
function meetingOn(number: number, p: Params): string {
  return `threads.number = ${p.add(number)} AND threads.meeting_when IS NOT NULL`;
}

/** An attendee event's data, on the row `people`: their number, which invited people never read, and their name. */
const ATTENDEE_DATA = "json_object('person', people.number, 'name', people.name)";

/**
 * Sets a thread's meeting, or (null) clears it, with its event and the thread's last activity: one batch. A set
 * writes `meeting-set` with the meeting it replaced (`from`, null when there was none) and the new one (`to`), each
 * read by everyone in the thread, so the people in a meeting see where it moved from; setting it again to what it
 * is still writes its event, as a link does, because it is what was asked. Clearing writes `meeting-cleared` with
 * `from`, after taking everyone off the meeting, each with an `attendee-removed` event, because a thread that is no
 * meeting has no one in it. `no-thread` when there is no such thread, `not-a-meeting` when clearing one that isn't;
 * either way nothing is written. Not a move, so `moved_at` stays as it is.
 */
export async function setMeeting(db: D1Database, number: number, meeting: Meeting | null, actor: Author): Promise<ThreadRow | "no-thread" | "not-a-meeting"> {
  const now = new Date().toISOString();
  if (meeting !== null) {
    const e = new Params();
    const to = `json_object('when', ${e.add(meeting.when)}, 'minutes', ${e.add(meeting.minutes)}, 'where', ${e.add(meeting.where)})`;
    const event = statement(
      db,
      `INSERT INTO events (thread_id, at, actor, type, data)
       SELECT id, ${e.add(now)}, ${e.add(actor)}, 'meeting-set', json_object('from', ${MEETING_NOW}, 'to', ${to}) FROM threads WHERE number = ${e.add(number)}`,
      e,
    );
    const u = new Params();
    const update = statement(
      db,
      `UPDATE threads SET meeting_when = ${u.add(meeting.when)}, meeting_minutes = ${u.add(meeting.minutes)}, meeting_where = ${u.add(meeting.where)}, activity_at = ${u.add(now)}
       WHERE number = ${u.add(number)} RETURNING ${COLUMNS}`,
      u,
    );
    const [, updated] = await db.batch<ThreadRow>([event, update]);
    return updated?.results[0] ?? "no-thread";
  }
  // Every statement holds the meeting's own condition, and the row is cleared last, so each reads the meeting as it was.
  const r = new Params();
  const removed = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data)
     SELECT threads.id, ${r.add(now)}, ${r.add(actor)}, 'attendee-removed', ${ATTENDEE_DATA}
     FROM attendees JOIN threads ON threads.id = attendees.thread_id JOIN people ON people.id = attendees.person_id
     WHERE ${meetingOn(number, r)} ORDER BY people.number`,
    r,
  );
  const e = new Params();
  const cleared = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data)
     SELECT id, ${e.add(now)}, ${e.add(actor)}, 'meeting-cleared', json_object('from', ${MEETING_NOW}) FROM threads WHERE ${meetingOn(number, e)}`,
    e,
  );
  const d = new Params();
  const off = statement(db, `DELETE FROM attendees WHERE thread_id = (SELECT id FROM threads WHERE ${meetingOn(number, d)})`, d);
  const u = new Params();
  const update = statement(
    db,
    `UPDATE threads SET meeting_when = NULL, meeting_minutes = NULL, meeting_where = NULL, activity_at = ${u.add(now)} WHERE ${meetingOn(number, u)} RETURNING ${COLUMNS}`,
    u,
  );
  const [, , , updated] = await db.batch<ThreadRow>([removed, cleared, off, update]);
  const row = updated?.results[0];
  if (row !== undefined) return row;
  return (await find(db, { number }, EVERY_THREAD)) === null ? "no-thread" : "not-a-meeting";
}

/** Who a door adds to a meeting: a person by their number, or someone new by the name given. */
export type Attendee = { readonly person: number } | { readonly name: string };

/**
 * Adds a person to a thread's meeting, with the `attendee-added` event and the thread's last activity: one batch.
 * A name always makes a new person, with no address, numbered after the largest, and only when the add is kept;
 * someone already in the meeting changes nothing, and the thread is answered as it stands. `no-thread` when there is
 * no such thread, `not-a-meeting` when it has no when, `no-person` when nobody has the number; then nothing is
 * written. Being in a meeting grants nothing: this never touches `members`.
 */
export async function attend(db: D1Database, number: number, who: Attendee, actor: Author): Promise<ThreadRow | "no-thread" | "not-a-meeting" | "no-person"> {
  const now = new Date().toISOString();
  const made = "name" in who ? crypto.randomUUID() : null;
  const person = (p: Params): string => ("person" in who ? `people.number = ${p.add(who.person)}` : `people.id = ${p.add(made)}`);
  const absent = "NOT EXISTS (SELECT 1 FROM attendees WHERE attendees.thread_id = threads.id AND attendees.person_id = people.id)";
  const statements: D1PreparedStatement[] = [];
  if ("name" in who) {
    const p = new Params();
    statements.push(
      statement(
        db,
        `INSERT INTO people (id, number, email, name, created_at) SELECT ${p.add(made)}, ${NEXT_PERSON}, NULL, ${p.list([who.name, now])}
         WHERE EXISTS (SELECT 1 FROM threads WHERE ${meetingOn(number, p)})`,
        p,
      ),
    );
  }
  const e = new Params();
  statements.push(
    statement(
      db,
      `INSERT INTO events (thread_id, at, actor, type, data)
       SELECT threads.id, ${e.add(now)}, ${e.add(actor)}, 'attendee-added', ${ATTENDEE_DATA} FROM threads JOIN people ON ${person(e)} WHERE ${meetingOn(number, e)} AND ${absent}`,
      e,
    ),
  );
  // The touch runs before the person is added, in the same batch, because its guard reads whether they were in it.
  const t = new Params();
  statements.push(
    statement(db, `UPDATE threads SET activity_at = ${t.add(now)} WHERE ${meetingOn(number, t)} AND EXISTS (SELECT 1 FROM people WHERE ${person(t)} AND ${absent})`, t),
  );
  const m = new Params();
  statements.push(
    statement(
      db,
      `INSERT INTO attendees (thread_id, person_id, added_at) SELECT threads.id, people.id, ${m.add(now)} FROM threads JOIN people ON ${person(m)} WHERE ${meetingOn(number, m)}
       ON CONFLICT (thread_id, person_id) DO NOTHING`,
      m,
    ),
  );
  const r = new Params();
  statements.push(statement(db, `SELECT ${COLUMNS} FROM threads WHERE number = ${r.add(number)}`, r));
  const k = new Params();
  statements.push(statement(db, `SELECT 1 AS yes FROM people WHERE ${person(k)}`, k));
  const results = await db.batch<ThreadRow | { yes: number }>(statements);
  const row = results[results.length - 2]?.results[0] as ThreadRow | undefined;
  if (row === undefined) return "no-thread";
  if (row.meeting_when === null) return "not-a-meeting";
  return (results[results.length - 1]?.results.length ?? 0) === 0 ? "no-person" : row;
}

/**
 * Takes a person off a thread's meeting, with the `attendee-removed` event and the thread's last activity: one
 * batch. `no-thread` when there is no such thread, `not-a-meeting` when it has no when, `not-attending` when the
 * person isn't in it; either way nothing is written.
 */
export async function unattend(db: D1Database, number: number, personNumber: number, actor: Author): Promise<ThreadRow | "no-thread" | "not-a-meeting" | "not-attending"> {
  const now = new Date().toISOString();
  const attending = (p: Params): string =>
    `threads.number = ${p.add(number)} AND EXISTS (SELECT 1 FROM attendees JOIN people ON people.id = attendees.person_id
       WHERE attendees.thread_id = threads.id AND people.number = ${p.add(personNumber)})`;
  const e = new Params();
  const event = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data)
     SELECT threads.id, ${e.add(now)}, ${e.add(actor)}, 'attendee-removed', ${ATTENDEE_DATA} FROM threads JOIN people ON people.number = ${e.add(personNumber)} WHERE ${attending(e)}`,
    e,
  );
  // The touch runs before the person is taken off, in the same batch, because its guard reads that they are in it.
  const t = new Params();
  const touch = statement(db, `UPDATE threads SET activity_at = ${t.add(now)} WHERE ${attending(t)}`, t);
  const d = new Params();
  const off = statement(
    db,
    `DELETE FROM attendees WHERE thread_id = (SELECT id FROM threads WHERE number = ${d.add(number)}) AND person_id = (SELECT id FROM people WHERE number = ${d.add(personNumber)})
     RETURNING person_id`,
    d,
  );
  const r = new Params();
  const read = statement(db, `SELECT ${COLUMNS} FROM threads WHERE number = ${r.add(number)}`, r);
  const [, , taken, after] = await db.batch<ThreadRow | { person_id: string }>([event, touch, off, read]);
  const row = after?.results[0] as ThreadRow | undefined;
  if (row === undefined) return "no-thread";
  if ((taken?.results.length ?? 0) > 0) return row;
  return row.meeting_when === null ? "not-a-meeting" : "not-attending";
}

/** A public thread by the address a stranger named it by; null for any address that doesn't open one. */
export async function findPublic(db: D1Database, address: PublicAddress): Promise<ThreadRow | null> {
  const p = new Params();
  return statement(db, `SELECT ${COLUMNS} FROM threads WHERE ${publicWhere(address, p)}`, p).first<ThreadRow>();
}

/**
 * A visitor's answer a stranger may read, as a condition on `comments`: a visitor's, and the newest that key gave to
 * that question (so a change shows in place of what it changed, and a dropped newest hides the key's answer rather
 * than bringing back an older one), to a question the reader's own key (`key`, bound in; null for none) has answered.
 */
function answerShown(key: string): string {
  return `comments.author = 'visitor' AND comments.visitor_key IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM comments AS newer WHERE newer.thread_id = comments.thread_id AND newer.question = comments.question
      AND newer.visitor_key = comments.visitor_key AND (newer.created_at > comments.created_at OR (newer.created_at = comments.created_at AND newer.id > comments.id)))
    AND EXISTS (SELECT 1 FROM comments AS own WHERE own.thread_id = comments.thread_id AND own.question = comments.question AND own.visitor_key = ${key})`;
}

/**
 * A public thread's comments a stranger may read, oldest first, up to `limit`: written as Public, and shown; an answer
 * to a page's question only as `answerShown` holds, for the reader whose key hashes to `key` (null for a reader with
 * none, who reads no answers).
 */
export async function historyPublic(db: D1Database, threadId: string, limit: number, key: string | null): Promise<CommentRow[]> {
  return (
    await db
      .prepare(
        `SELECT ${COMMENT_COLUMNS} FROM comments LEFT JOIN people ON people.id = comments.person_id JOIN threads ON threads.id = comments.thread_id
         WHERE comments.thread_id = ?1 AND comments.audience = 'public' AND comments.state = 'shown' AND ${PUBLIC}
           AND (comments.question IS NULL OR (${answerShown("?2")}))
         ORDER BY comments.created_at, comments.id LIMIT ${limit}`,
      )
      .bind(threadId, key)
      .all<CommentRow>()
  ).results;
}

/**
 * One version of a public thread's page, while the page is its main section: a thread that moved on to a link keeps
 * its earlier pages, and those were never public.
 */
export async function findPublicPage(db: D1Database, address: PublicAddress, version: number): Promise<PageRow | null> {
  const p = new Params();
  return statement(
    db,
    `SELECT pages.version, pages.object_key, pages.created_at, pages.actor, pages.bytes, pages.source_url
     FROM pages JOIN threads ON threads.id = pages.thread_id
     WHERE ${publicWhere(address, p)} AND pages.version = ${p.add(version)} AND threads.main = 'page'`,
    p,
  ).first<PageRow>();
}

/** What a link preview may say of a thread, and whether it is public. */
export interface PreviewRow {
  number: number;
  title: string | null;
  summary: string | null;
  body: string;
  main: Main;
  public: number;
}

/**
 * The threads page's one read (src/pages.ts): a thread's number, title, summary, main text and whether it is public
 * to the address the page was asked by, asked of every address alike with one indexed query (the number's, or the
 * key's unique index), so a private, a missing and a public thread cost the same. Only a public thread's answer is
 * ever used.
 */
export async function publicPreview(db: D1Database, address: PublicAddress): Promise<PreviewRow | null> {
  const p = new Params();
  return statement(db, `SELECT number, title, summary, body, main, (${openTo(address)}) AS public FROM threads WHERE ${addressed(address, p)}`, p).first<PreviewRow>();
}

/** A thread on the home page, as the home page and its feed show it. */
export interface FeedRow {
  number: number;
  /** The key in its public link, the address a reader lands on; every listed thread has one, as `PUBLIC` holds. */
  share_key: string;
  title: string | null;
  body: string;
  /** Its main section as it now stands, `text`, `page` or `link`, which picks the address a reader lands on. */
  main: Main;
  feed_at: string;
  /** The notes a stranger reads under it: shown, written as Public, neither a reply nor an answer to its page. */
  notes: number;
}

/** The Now line under his greeting, and when he set it; an empty text is no line. */
export interface NowRow {
  text: string;
  set_at: string;
}

/** The newest Now line's query: the newest row is the line, because no row is ever updated or deleted. */
const NOW_LINE = "SELECT text, set_at FROM now_lines ORDER BY id DESC LIMIT 1";

/**
 * The home page's one read (src/home.ts), in one batch: the newest `limit` threads he posted, newest first, each
 * holding the public condition in its own SQL beside being posted, so a row changed by hand never lists a private
 * thread; the newest `limit` items from outside, his videos and releases (src/outside-store.ts), which the home page
 * merges with the posts by date; and the Now line, null when he never set one. A note is what a stranger reads under the thread as a note: a
 * comment written as Public and shown, neither a reply (`parent_id`) nor a visitor's answer to the page's questions
 * (`question`), which the page shows under its questions rather than as notes.
 */
export async function homeFeed(db: D1Database, limit: number): Promise<{ items: FeedRow[]; outside: OutsideRow[]; now: NowRow | null }> {
  const [items, now, outside] = await db.batch([
    db
      .prepare(
        `SELECT number, share_key, title, body, main, feed_at,
           (SELECT COUNT(*) FROM comments WHERE comments.thread_id = threads.id AND comments.audience = 'public' AND comments.state = 'shown'
             AND comments.question IS NULL AND comments.parent_id IS NULL) AS notes
         FROM threads WHERE ${LISTED} ORDER BY threads.feed_at DESC, threads.number DESC LIMIT ?1`,
      )
      .bind(limit),
    db.prepare(NOW_LINE),
    outsideItems(db, limit, LISTED),
  ]);
  return {
    items: (items?.results ?? []) as FeedRow[],
    outside: (outside?.results ?? []) as OutsideRow[],
    now: ((now?.results ?? [])[0] as NowRow | undefined) ?? null,
  };
}

/** The Now line as it stands, null when he never set one. */
export async function nowLine(db: D1Database): Promise<NowRow | null> {
  return db.prepare(NOW_LINE).first<NowRow>();
}

/** Sets the Now line: a new row, so every earlier line is kept; an empty text takes the line off the home page. */
export async function setNowLine(db: D1Database, text: string): Promise<NowRow> {
  const row = await db.prepare("INSERT INTO now_lines (text, set_at) VALUES (?1, ?2) RETURNING text, set_at").bind(text, new Date().toISOString()).first<NowRow>();
  if (row === null) throw new Error("the Now line was not kept");
  return row;
}

/** A visitor's note on a public thread, as the door checked it. */
export interface VisitorNote {
  readonly body: string;
  readonly name: string | null;
  readonly email: string | null;
}

/**
 * Keeps a visitor's note on a public thread: a comment for anyone, shown at once, with the name and email they typed, the person that address is (made when new), and the thread's last activity. It writes no event,
 * because a comment is its own entry. The insert holds the public condition itself, so a note racing the thread
 * being taken back is refused, not kept: false then, and nobody is made.
 */
export async function addNote(db: D1Database, address: PublicAddress, note: VisitorNote): Promise<boolean> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const p = new Params();
  const sender: Sender = note.email === null ? null : { by: "email", email: note.email.trim().toLowerCase(), name: note.name };
  const isPublic = (q: Params): string => `EXISTS (SELECT 1 FROM threads WHERE ${publicWhere(address, q)})`;
  const person = personOf(db, sender, now, isPublic, p);
  const insert = statement(
    db,
    `INSERT INTO comments (id, thread_id, author, body, created_at, audience, state, sender_name, sender_email, person_id)
     SELECT ${p.add(id)}, threads.id, 'visitor', ${p.list([note.body, now])}, 'public', 'shown', ${p.list([note.name, note.email])}, ${person.id}
     FROM threads WHERE ${publicWhere(address, p)} RETURNING id`,
    p,
  );
  const u = new Params();
  const touch = statement(db, `UPDATE threads SET activity_at = ${u.add(now)} WHERE id = (SELECT thread_id FROM comments WHERE id = ${u.add(id)})`, u);
  const results = await db.batch<{ id: string }>([...(person.make === null ? [] : [person.make]), insert, touch]);
  return (results[person.make === null ? 0 : 1]?.results.length ?? 0) > 0;
}

/** A visitor's answer to a question of a public thread's page, as the door checked it, with the hash of their key. */
export interface VisitorAnswer {
  readonly question: string;
  readonly body: string;
  readonly name: string;
  readonly key: string;
}

/**
 * Keeps a visitor's answer: a comment for anyone, shown at once, on the question it answers, with the name they typed
 * and their key's hash, and the thread's last activity. Never an email, so it makes no person, and no event, because a
 * comment is its own entry. The insert holds the public condition and the page being the main section itself, so an
 * answer racing the thread being taken back, or moving on to a link, is refused, not kept: false then.
 */
export async function addAnswer(db: D1Database, address: PublicAddress, answer: VisitorAnswer): Promise<boolean> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const p = new Params();
  const insert = statement(
    db,
    `INSERT INTO comments (id, thread_id, author, body, created_at, audience, state, sender_name, question, visitor_key)
     SELECT ${p.add(id)}, threads.id, 'visitor', ${p.list([answer.body, now])}, 'public', 'shown', ${p.list([answer.name, answer.question, answer.key])}
     FROM threads WHERE ${publicWhere(address, p)} AND threads.main = 'page' RETURNING id`,
    p,
  );
  const u = new Params();
  const touch = statement(db, `UPDATE threads SET activity_at = ${u.add(now)} WHERE id = (SELECT thread_id FROM comments WHERE id = ${u.add(id)})`, u);
  const [added] = await db.batch<{ id: string }>([insert, touch]);
  return (added?.results.length ?? 0) > 0;
}

/** What each ruling on a visitor's words starts from, goes to, and the event it writes. */
const JUDGEMENTS = {
  show: { from: ["dropped"], to: "shown", event: "note-shown" },
  drop: { from: ["shown"], to: "dropped", event: "note-dropped" },
} as const satisfies Record<Judgement, { from: readonly string[]; to: string; event: string }>;

/**
 * His ruling on a visitor's note or answer, the owner's alone: dropped, or shown again. One batch
 * with its event, which names the note and the visitor's typed name (never their email), and the thread's last
 * activity. `no-thread` when there is no such thread, `no-note` when it holds no such visitor's note,
 * `not-from-here` when the note isn't where the ruling starts; either way nothing is written.
 */
export async function judgeNote(
  db: D1Database,
  number: number,
  noteId: string,
  judgement: Judgement,
): Promise<CommentRow | "no-thread" | "no-note" | "not-from-here"> {
  const now = new Date().toISOString();
  const rule = JUDGEMENTS[judgement];
  const note = (p: Params): string =>
    `comments.id = ${p.add(noteId)} AND comments.author = 'visitor' AND comments.thread_id = (SELECT id FROM threads WHERE number = ${p.add(number)})`;
  const guard = (p: Params): string => `${note(p)} AND comments.state IN (${p.list(rule.from)})`;

  const e = new Params();
  const event = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data)
     SELECT comments.thread_id, ${e.add(now)}, 'owner', ${e.add(rule.event)}, json_object('note', comments.id, 'name', comments.sender_name) FROM comments WHERE ${guard(e)}`,
    e,
  );
  // The touch runs before the note changes, in the same batch, because its guard reads the note's state.
  const t = new Params();
  const touch = statement(db, `UPDATE threads SET activity_at = ${t.add(now)} WHERE id = (SELECT comments.thread_id FROM comments WHERE ${guard(t)})`, t);
  const u = new Params();
  const update = statement(db, `UPDATE comments SET state = ${u.add(rule.to)} WHERE ${guard(u)} RETURNING id`, u);
  const r = new Params();
  const read = statement(db, `SELECT ${COMMENT_COLUMNS} FROM comments LEFT JOIN people ON people.id = comments.person_id WHERE ${note(r)}`, r);

  const [, , updated, after] = await db.batch<CommentRow | { id: string }>([event, touch, update, read]);
  const row = after?.results[0] as CommentRow | undefined;
  if ((updated?.results.length ?? 0) > 0 && row !== undefined) return row;
  if (row !== undefined) return "not-from-here";
  return (await find(db, { number }, EVERY_THREAD)) === null ? "no-thread" : "no-note";
}

/** A person as the owner and the sync read them: who they are, how he knows them, and when they last were in touch. */
export interface PeopleRow {
  id: string;
  number: number;
  email: string | null;
  name: string | null;
  note: string | null;
  created_at: string;
  /** Their Gravatar, which the hourly run copies once they were invited (src/photos.ts); null while they have none. */
  photo_id: string | null;
  /**
   * Site notes they sent, things they told him, threads shared with them now and taken back, their comments and
   * notes, and the meetings they are in.
   */
  sent: number;
  told: number;
  invited: number;
  removed: number;
  commented: number;
  noted: number;
  met: number;
  /** The latest of when they appeared, their threads and notes, their invitations, and their meetings that have begun. */
  last_contact: string;
  /**
   * 1 while anything of theirs is live: a thread from them that isn't dropped, an invitation that stands or one to a
   * thread that isn't dropped, a comment or note of theirs that isn't dropped on such a thread, or a meeting on one.
   * A person with none was only ever in threads he dropped, which the page folds away.
   */
  live: number;
}

/**
 * The person columns every people read uses, on `people`, with what is derived from the rows that name them. A
 * meeting counts toward their last contact once its when is not after now, compared as the ISO strings every writer
 * stamps: a day counts from its start in UTC, a few hours early or late in another zone, close enough for when they
 * were last in touch.
 */
const PEOPLE_COLUMNS = `people.id, people.number, people.email, people.name, people.note, people.created_at, people.photo_id,
  (SELECT COUNT(*) FROM threads WHERE threads.person_id = people.id AND threads.source = 'talk') AS sent,
  (SELECT COUNT(*) FROM threads WHERE threads.person_id = people.id AND threads.source = 'told') AS told,
  (SELECT COUNT(*) FROM members WHERE members.person_id = people.id AND members.removed_at IS NULL) AS invited,
  (SELECT COUNT(*) FROM members WHERE members.person_id = people.id AND members.removed_at IS NOT NULL) AS removed,
  (SELECT COUNT(*) FROM comments WHERE comments.person_id = people.id AND comments.author = 'member') AS commented,
  (SELECT COUNT(*) FROM comments WHERE comments.person_id = people.id AND comments.author = 'visitor') AS noted,
  (SELECT COUNT(*) FROM attendees WHERE attendees.person_id = people.id) AS met,
  MAX(people.created_at,
    COALESCE((SELECT MAX(created_at) FROM threads WHERE threads.person_id = people.id), ''),
    COALESCE((SELECT MAX(created_at) FROM comments WHERE comments.person_id = people.id), ''),
    COALESCE((SELECT MAX(added_at) FROM members WHERE members.person_id = people.id), ''),
    COALESCE((SELECT MAX(threads.meeting_when) FROM attendees JOIN threads ON threads.id = attendees.thread_id
              WHERE attendees.person_id = people.id AND threads.meeting_when <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), '')) AS last_contact,
  (EXISTS (SELECT 1 FROM threads WHERE threads.person_id = people.id AND threads.status <> 'dropped')
    OR EXISTS (SELECT 1 FROM members JOIN threads ON threads.id = members.thread_id
               WHERE members.person_id = people.id AND (members.removed_at IS NULL OR threads.status <> 'dropped'))
    OR EXISTS (SELECT 1 FROM comments JOIN threads ON threads.id = comments.thread_id
               WHERE comments.person_id = people.id AND comments.state <> 'dropped' AND threads.status <> 'dropped')
    OR EXISTS (SELECT 1 FROM attendees JOIN threads ON threads.id = attendees.thread_id
               WHERE attendees.person_id = people.id AND threads.status <> 'dropped')) AS live`;

/** The people order: whoever was last in touch first. */
const PEOPLE_ORDER = "ORDER BY last_contact DESC, people.number DESC";

/** Up to `limit` people, whoever was last in touch first. */
export async function listPeople(db: D1Database, limit: number): Promise<PeopleRow[]> {
  return (await db.prepare(`SELECT ${PEOPLE_COLUMNS} FROM people ${PEOPLE_ORDER} LIMIT ${limit}`).all<PeopleRow>()).results;
}

/** One person by their number; null when nobody has it. */
export async function findPerson(db: D1Database, number: number): Promise<PeopleRow | null> {
  return db.prepare(`SELECT ${PEOPLE_COLUMNS} FROM people WHERE people.number = ?1`).bind(number).first<PeopleRow>();
}

/**
 * People for a search, whoever was last in touch first: those whose name or address holds the words as typed,
 * ignoring case for ASCII letters, `%` and `_` matching only themselves. Up to `SEARCH_LIMIT`.
 */
export async function searchPeople(db: D1Database, words: string): Promise<PeopleRow[]> {
  const p = new Params();
  const pattern = p.add(`%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  return (
    await statement(
      db,
      `SELECT ${PEOPLE_COLUMNS} FROM people WHERE (people.name LIKE ${pattern} ESCAPE '\\' OR people.email LIKE ${pattern} ESCAPE '\\')
       ${PEOPLE_ORDER} LIMIT ${SEARCH_LIMIT}`,
      p,
    ).all<PeopleRow>()
  ).results;
}

/**
 * A thread a person is in, with how: it is from them (`mine`), their invitation to it, how many comments or notes of
 * theirs it holds, and whether they are in its meeting (`attends`).
 */
export interface PersonThreadRow extends ThreadRow {
  mine: number;
  membership: "invited" | "removed" | null;
  wrote: number;
  attends: number;
}

/** Up to `limit` of the threads a person is in, most recently active first: from them, shared with them, written on, or met on. */
export async function threadsOfPerson(db: D1Database, personId: string, limit: number): Promise<PersonThreadRow[]> {
  return (
    await db
      .prepare(
        `SELECT ${COLUMNS}, (threads.person_id IS ?1) AS mine,
           (SELECT CASE WHEN members.removed_at IS NULL THEN 'invited' ELSE 'removed' END FROM members
            WHERE members.thread_id = threads.id AND members.person_id = ?1) AS membership,
           (SELECT COUNT(*) FROM comments WHERE comments.thread_id = threads.id AND comments.person_id = ?1) AS wrote,
           EXISTS (SELECT 1 FROM attendees WHERE attendees.thread_id = threads.id AND attendees.person_id = ?1) AS attends
         FROM threads
         WHERE threads.person_id = ?1
           OR EXISTS (SELECT 1 FROM members WHERE members.thread_id = threads.id AND members.person_id = ?1)
           OR EXISTS (SELECT 1 FROM comments WHERE comments.thread_id = threads.id AND comments.person_id = ?1)
           OR EXISTS (SELECT 1 FROM attendees WHERE attendees.thread_id = threads.id AND attendees.person_id = ?1)
         ORDER BY COALESCE(activity_at, created_at) DESC, number DESC LIMIT ${limit}`,
      )
      .bind(personId)
      .all<PersonThreadRow>()
  ).results;
}

/**
 * Something a person said: a site note (`note`), a comment as an invited person (`comment`), a note on a public thread
 * (`public-note`), or an answer to an ask (`answer`), on the thread it made them.
 */
export interface WordsRow {
  kind: "note" | "comment" | "public-note" | "answer";
  number: number;
  title: string | null;
  body: string;
  at: string;
  /** A comment's or note's state and audience; null for a site note. */
  state: string | null;
  audience: string | null;
}

/**
 * Up to `limit` of what a person said, newest first, each with the thread it is on. A response thread's body is empty,
 * so it is no note: its answers are what they said.
 */
export async function wordsOfPerson(db: D1Database, personId: string, limit: number): Promise<WordsRow[]> {
  return (
    await db
      .prepare(
        `SELECT 'note' AS kind, threads.number, threads.title, threads.body, threads.created_at AS at, NULL AS state, NULL AS audience, threads.id AS key
         FROM threads WHERE threads.person_id = ?1 AND threads.source = 'talk' AND threads.ask_thread_id IS NULL
         UNION ALL
         SELECT CASE WHEN comments.author = 'member' THEN 'comment' WHEN threads.ask_thread_id IS NOT NULL THEN 'answer' ELSE 'public-note' END, threads.number, threads.title, comments.body, comments.created_at,
           comments.state, comments.audience, comments.id
         FROM comments JOIN threads ON threads.id = comments.thread_id WHERE comments.person_id = ?1
         ORDER BY at DESC, key DESC LIMIT ${limit}`,
      )
      .bind(personId)
      .all<WordsRow>()
  ).results;
}

/** A change the owner makes to a person: their name, their address while they have none, or his notes on them (null clears them). */
export type PersonChange = { readonly name: string } | { readonly email: string } | { readonly note: string | null };

/**
 * Changes a person, by the owner. An address is given once, lowercased, and only while they have none, because it
 * is what an invited person signs in with: `has-email` when they have one, `email-taken` with the number of the
 * person who holds it. `no-person` when nobody has the number. Answers the person as they now stand.
 */
export async function editPerson(
  db: D1Database,
  number: number,
  change: PersonChange,
): Promise<PeopleRow | "no-person" | "has-email" | { readonly taken: number }> {
  const p = new Params();
  let update: string;
  if ("email" in change) {
    const email = p.add(change.email);
    update = `UPDATE people SET email = ${email} WHERE number = ${p.add(number)} AND email IS NULL AND NOT EXISTS (SELECT 1 FROM people WHERE email = ${email}) RETURNING id`;
  } else {
    const [column, value] = "name" in change ? ["name", change.name] : ["note", change.note];
    update = `UPDATE people SET ${column} = ${p.add(value)} WHERE number = ${p.add(number)} RETURNING id`;
  }
  const changed = await statement(db, update, p).first<{ id: string }>();
  const person = await findPerson(db, number);
  if (person === null) return "no-person";
  if (changed !== null || !("email" in change)) return person;
  if (person.email !== null) return "has-email";
  const holder = await db.prepare("SELECT number FROM people WHERE email = ?1").bind(change.email).first<{ number: number }>();
  return holder === null ? person : { taken: holder.number };
}

/** An ask as its own calls find it by slug: its thread's id, number, title, space, state and main section. */
export interface AskRow {
  id: string;
  number: number;
  title: string | null;
  space: string | null;
  state: AskState;
  main: Main;
}

/** The ask with that slug, whatever its state; null when no thread has it. One indexed query, whatever the slug. */
export async function findAsk(db: D1Database, slug: string): Promise<AskRow | null> {
  return db.prepare("SELECT id, number, title, space, ask_state AS state, main FROM threads WHERE ask_slug = ?1").bind(slug).first<AskRow>();
}

/** One version of an ask's page, while the ask is open or closed and its page is its main section; null otherwise. */
export async function findAskPage(db: D1Database, slug: string, version: number): Promise<PageRow | null> {
  return db
    .prepare(
      `SELECT pages.version, pages.object_key, pages.created_at, pages.actor, pages.bytes, pages.source_url
       FROM pages JOIN threads ON threads.id = pages.thread_id
       WHERE threads.ask_slug = ?1 AND threads.ask_state IN ('open', 'closed') AND threads.main = 'page' AND pages.version = ?2`,
    )
    .bind(slug, version)
    .first<PageRow>();
}

/** The origin a browser's response thread to an ask is kept under: one per ask and key. */
function askOrigin(askId: string, key: string): string {
  return `ask:${askId}:${key}`;
}

/** Whether the browser whose key hashes to `key` has a thread for the ask yet. */
export async function hasAnswered(db: D1Database, askId: string, key: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 AS yes FROM threads WHERE origin_ref = ?1 AND ask_thread_id = ?2").bind(askOrigin(askId, key), askId).first()) !== null;
}

/** A browser's own answer, as the ask's read gives it back to that browser alone. */
export interface OwnAnswerRow {
  question: string;
  body: string;
  at: string;
}

/**
 * The newest answer per question the browser whose key hashes to `key` gave an ask, from its own thread, by question:
 * a dropped newest hides that question's answer, never bringing back an older one. Nobody reads anyone else's.
 */
export async function ownAnswers(db: D1Database, askId: string, key: string): Promise<OwnAnswerRow[]> {
  return (
    await db
      .prepare(
        `SELECT comments.question, comments.body, comments.created_at AS at FROM comments JOIN threads ON threads.id = comments.thread_id
         WHERE threads.origin_ref = ?1 AND threads.ask_thread_id = ?3 AND comments.author = 'visitor' AND comments.question IS NOT NULL AND comments.visitor_key = ?2 AND comments.state = 'shown'
           AND NOT EXISTS (SELECT 1 FROM comments AS newer WHERE newer.thread_id = comments.thread_id AND newer.question = comments.question
             AND newer.visitor_key = comments.visitor_key AND (newer.created_at > comments.created_at OR (newer.created_at = comments.created_at AND newer.id > comments.id)))
         ORDER BY comments.question`,
      )
      .bind(askOrigin(askId, key), key, askId)
      .all<OwnAnswerRow>()
  ).results;
}

/** A visitor's answer to an ask, as the door checked it, with the hash of their browser's key. */
export interface AskAnswer {
  readonly question: string;
  readonly body: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly key: string;
}

/**
 * Keeps a visitor's answer to an open ask, in one batch: the first time from their browser, the thread it makes (a site
 * note with the ask's title and space, its `created` event, and the person their email is, made when new), then the
 * answer on that thread, for everyone in it, shown at once, with their key's hash and the thread's person, and the
 * thread's last activity. The name and email are the thread's, written when it is made and never after. Each insert
 * holds the ask being open in its own SQL, so an answer racing a close is refused whole: false then.
 */
export async function answerAsk(db: D1Database, ask: Pick<AskRow, "id" | "title" | "space">, answer: AskAnswer): Promise<boolean> {
  const now = new Date().toISOString();
  const origin = askOrigin(ask.id, answer.key);
  const made = createStatements(
    db,
    { source: "talk", space: ask.space, title: ask.title, body: "", senderName: answer.name, senderEmail: answer.email, status: "received", originRef: origin, person: null, ask: ask.id },
    "visitor",
    now,
    crypto.randomUUID(),
  );
  const id = crypto.randomUUID();
  const p = new Params();
  const insert = statement(
    db,
    `INSERT INTO comments (id, thread_id, author, body, created_at, audience, state, sender_name, question, visitor_key, person_id)
     SELECT ${p.add(id)}, threads.id, 'visitor', ${p.list([answer.body, now])}, 'thread', 'shown', threads.sender_name, ${p.list([answer.question, answer.key])}, threads.person_id
     FROM threads WHERE threads.origin_ref = ${p.add(origin)} AND threads.ask_thread_id = ${p.add(ask.id)} AND ${askOpen(ask.id, p)} RETURNING id`,
    p,
  );
  const u = new Params();
  const touch = statement(db, `UPDATE threads SET activity_at = ${u.add(now)} WHERE id = (SELECT thread_id FROM comments WHERE id = ${u.add(id)})`, u);
  const results = await db.batch<ThreadRow | { id: string }>([...made.statements, insert, touch]);
  return (results[made.statements.length]?.results.length ?? 0) > 0;
}

/**
 * Makes one of his own threads an ask, a draft under `slug`, with its `ask-drafted` event and the thread's last
 * activity: one batch. Only a thread of his own whose main section is a page, that isn't public, an ask or a response
 * already, under a slug no thread has. Refused, nothing is written: `no-thread`, `not-his-words`, `an-ask`, `public`,
 * `no-page`, or `slug-taken`.
 */
export async function makeAsk(
  db: D1Database,
  number: number,
  slug: string,
  actor: Author,
): Promise<ThreadRow | "no-thread" | "not-his-words" | "an-ask" | "public" | "no-page" | "slug-taken"> {
  const now = new Date().toISOString();
  const guard = (p: Params): string =>
    `number = ${p.add(number)} AND source = 'self' AND public_at IS NULL AND main = 'page' AND ${NO_ASK}
     AND NOT EXISTS (SELECT 1 FROM threads AS other WHERE other.ask_slug = ${p.add(slug)})`;
  const e = new Params();
  const event = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data) SELECT id, ${e.add(now)}, ${e.add(actor)}, 'ask-drafted', json_object('slug', ${e.add(slug)}) FROM threads WHERE ${guard(e)}`,
    e,
  );
  const u = new Params();
  const update = statement(db, `UPDATE threads SET ask_slug = ${u.add(slug)}, ask_state = 'draft', activity_at = ${u.add(now)} WHERE ${guard(u)} RETURNING ${COLUMNS}`, u);
  const [, updated] = await db.batch<ThreadRow>([event, update]);
  const row = updated?.results[0];
  if (row !== undefined) return row;
  const there = await find(db, { number }, EVERY_THREAD);
  if (there === null) return "no-thread";
  if (there.source !== "self") return "not-his-words";
  if (there.ask_slug !== null) return "an-ask";
  if (there.public_at !== null) return "public";
  return there.main === "page" ? "slug-taken" : "no-page";
}

/** What opening and closing an ask start from, go to, and the event each writes. */
const ASK_CHANGES = {
  open: { from: ["draft", "closed"], to: "open", event: "ask-opened" },
  close: { from: ["open"], to: "closed", event: "ask-closed" },
} as const satisfies Record<string, { from: readonly AskState[]; to: AskState; event: string }>;

/** An ask's change of state: opened, or closed. */
export type AskChange = keyof typeof ASK_CHANGES;

/**
 * Opens or closes an ask, with its event and the thread's last activity: one batch. Who may (only he opens) is the
 * door's to hold. `no-thread`, `not-an-ask` when the thread has no slug, `not-from-here` when it isn't where the change
 * starts; then nothing is written.
 */
export async function setAskState(db: D1Database, number: number, change: AskChange, actor: Author): Promise<ThreadRow | "no-thread" | "not-an-ask" | "not-from-here"> {
  const now = new Date().toISOString();
  const rule = ASK_CHANGES[change];
  const guard = (p: Params): string => `number = ${p.add(number)} AND ask_slug IS NOT NULL AND ask_state IN (${p.list(rule.from)})`;
  const e = new Params();
  const event = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data) SELECT id, ${e.add(now)}, ${e.add(actor)}, ${e.add(rule.event)}, json_object('slug', ask_slug) FROM threads WHERE ${guard(e)}`,
    e,
  );
  const u = new Params();
  const update = statement(db, `UPDATE threads SET ask_state = ${u.add(rule.to)}, activity_at = ${u.add(now)} WHERE ${guard(u)} RETURNING ${COLUMNS}`, u);
  const [, updated] = await db.batch<ThreadRow>([event, update]);
  const row = updated?.results[0];
  if (row !== undefined) return row;
  const there = await find(db, { number }, EVERY_THREAD);
  if (there === null) return "no-thread";
  return there.ask_slug === null ? "not-an-ask" : "not-from-here";
}

/** An ask as Asks lists it: its thread's number and title, its slug and state, how many answered, and when last. */
export interface AskListRow {
  number: number;
  title: string | null;
  slug: string;
  state: AskState;
  answered: number;
  last_answered_at: string | null;
}

/** The most asks Asks lists. */
const ASKS_LIMIT = 500;

/** Every ask, drafts first, then open, then closed, newest number first in each. */
export async function listAsks(db: D1Database): Promise<AskListRow[]> {
  return (
    await db
      .prepare(
        `SELECT number, title, ask_slug AS slug, ask_state AS state,
           (SELECT COUNT(*) FROM threads AS response WHERE response.ask_thread_id = threads.id) AS answered,
           (SELECT MAX(comments.created_at) FROM comments JOIN threads AS response ON response.id = comments.thread_id
            WHERE response.ask_thread_id = threads.id AND comments.author = 'visitor') AS last_answered_at
         FROM threads WHERE ask_slug IS NOT NULL
         ORDER BY CASE ask_state WHEN 'draft' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, number DESC LIMIT ${ASKS_LIMIT}`,
      )
      .all<AskListRow>()
  ).results;
}

/** Who answered an ask: each response thread's number, the name its respondent gave, when it was made, and whether it waits on him. */
export interface AnsweredRow {
  number: number;
  name: string | null;
  at: string;
  waiting: number;
}

/** The threads that answer the ask whose thread has that id, first answered first. */
export async function answeredBy(db: D1Database, askId: string): Promise<AnsweredRow[]> {
  return (
    await db
      .prepare(`SELECT number, sender_name AS name, created_at AS at, ${waitingOn("threads")} AS waiting FROM threads WHERE ask_thread_id = ?1 ORDER BY created_at, number`)
      .bind(askId)
      .all<AnsweredRow>()
  ).results;
}

/**
 * Marks an ask's answers read, the owner's alone: one `ask-read` event by him on each of its response threads that
 * waits on him now, in one batch, so each stops waiting; a response thread that doesn't wait gets nothing. It leaves
 * their last activity alone, so a respondent he invited back never sees a thread move for his reading it. There is no undoing it, because events are never deleted. Answers how many were marked; `no-thread`,
 * or `not-an-ask` when the thread has no slug.
 */
export async function markAskRead(db: D1Database, number: number): Promise<{ marked: number } | "no-thread" | "not-an-ask"> {
  const now = new Date().toISOString();
  const waiting = (p: Params): string =>
    `response.ask_thread_id = (SELECT id FROM threads WHERE number = ${p.add(number)} AND ask_slug IS NOT NULL) AND ${waitingOn("response")}`;
  const e = new Params();
  const event = statement(
    db,
    `INSERT INTO events (thread_id, at, actor, type, data) SELECT response.id, ${e.add(now)}, 'owner', 'ask-read', json_object() FROM threads AS response WHERE ${waiting(e)} RETURNING id`,
    e,
  );
  const marked = await event.all<{ id: number }>();
  const there = await find(db, { number }, EVERY_THREAD);
  if (there === null) return "no-thread";
  if (there.ask_slug === null) return "not-an-ask";
  return { marked: marked.results.length };
}
