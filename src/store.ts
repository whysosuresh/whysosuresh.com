// The store: every thread Suresh keeps, whatever door it came through. A thread is one row in `threads` with a
// number people can say out loud (#42); its history is its rows in `events`, and the words added to it are its
// rows in `comments` (migrations/0006_threads.sql). Three doors write here: the note flow (src/talk.ts), the
// inbox's page and the sync through the inbox's calls (src/inbox.ts), and the threads' calls (src/threads.ts).
// Each door turns its own wire into the intents below, so the rules live here once, whatever a door names them.
//
// Every write that changes a thread writes its event in the same batch, which D1 runs as one transaction: the
// event is an INSERT ... SELECT from the row under the same guard as the change, ahead of the change, so it
// reads the row as it was, and both apply or neither does. A move states its new status once, as one SQL
// expression on the row, and both statements use it, so the event names the status the row really went to.
// A thread's number is one more than the largest, given inside its INSERT; D1 runs one query at a time, and the
// UNIQUE constraint turns any duplicate into an error rather than two #42s. Every write also stamps the thread's
// last activity (`activity_at`, migrations/0008_activity.sql) in the same batch: an arrival, a move, an edit, a
// comment. This file is its only writer, so the rule lives here once.

/** Where a thread came from: the site's note flow, something told to him in person, or his own. */
export type Source = "talk" | "told" | "self";
/** Who wrote a comment or made a change through a private door. */
export type Author = "owner" | "sync";
/** Who an event names: a private door's caller, the visitor who sent a note, or the copy from the inbox. */
export type Actor = Author | "visitor" | "import";
export type Status = "received" | "act" | "discuss" | "done" | "dropped" | "filed";

/** A tab, and the statuses it shows. */
export const TABS = {
  look: ["received"],
  act: ["act"],
  discuss: ["discuss"],
  done: ["done", "dropped", "filed"],
} as const satisfies Record<string, readonly Status[]>;
export type Tab = keyof typeof TABS;

export function isTab(value: string): value is Tab {
  return Object.hasOwn(TABS, value);
}

// The last activity reads the arrival time when it was never set: a thread the code before 0008 created between
// that migration and its deploy. A plain expression, so it is safe in RETURNING.
export const COLUMNS =
  "id, number, created_at, source, space, title, body, summary, status, kind, sender_name, sender_email, drop_reason, reply_opened_at, origin_ref, filed_link, moved_at, COALESCE(activity_at, created_at) AS activity_at";

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
}

export interface CommentRow {
  id: string;
  thread_id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface EventRow {
  id: number;
  thread_id: string;
  at: string;
  actor: string;
  type: string;
  data: string;
}

/** How a door names a thread: the inbox by its id, the threads' calls by its number. */
export type Locator = { readonly id: string } | { readonly number: number };

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
  return "id" in locator ? `id = ${p.add(locator.id)}` : `number = ${p.add(locator.number)}`;
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
}

/**
 * Keeps a new thread, numbered after the largest, with its `created` event. With an `originRef` already kept,
 * nothing is written and the thread already there is answered, `created` false.
 */
export async function create(db: D1Database, thread: NewThread, actor: Actor): Promise<{ row: ThreadRow; created: boolean } | null> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const p = new Params();
  const insert = statement(
    db,
    `INSERT INTO threads (id, number, created_at, activity_at, source, space, title, body, status, kind, sender_name, sender_email, origin_ref)
     VALUES (${p.add(id)}, (SELECT COALESCE(MAX(number), 0) + 1 FROM threads), ${p.list([
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
     ])})
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
  const [inserted] = await db.batch<ThreadRow>([insert, event]);
  const row = inserted?.results[0];
  if (row !== undefined) return { row, created: true };
  if (thread.originRef === null) return null;
  const there = await db.prepare(`SELECT ${COLUMNS} FROM threads WHERE origin_ref = ?1`).bind(thread.originRef).first<ThreadRow>();
  return there === null ? null : { row: there, created: false };
}

export async function find(db: D1Database, locator: Locator): Promise<ThreadRow | null> {
  const p = new Params();
  return statement(db, `SELECT ${COLUMNS} FROM threads WHERE ${locate(locator, p)}`, p).first<ThreadRow>();
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
  const tally: Record<Tab, number> = { look: 0, act: 0, discuss: 0, done: 0 };
  for (const name of Object.keys(TABS) as Tab[]) {
    for (const status of TABS[name]) tally[name] += byStatus.get(status) ?? 0;
  }
  return { rows: (rows?.results ?? []) as ThreadRow[], counts: tally };
}

/** Up to `limit` threads of a tab, newest first by when they arrived, after the cursor's thread when given. */
export async function listByTime(db: D1Database, tab: Tab, after: { at: string; id: string } | null, limit: number): Promise<Listed> {
  const p = new Params();
  const statuses = p.list(TABS[tab]);
  const cursor = after === null ? "" : ` AND (created_at < ${p.add(after.at)} OR (created_at = ?${p.values.length} AND id < ${p.add(after.id)}))`;
  return listed(db, statement(db, `SELECT ${COLUMNS} FROM threads WHERE status IN (${statuses})${cursor} ORDER BY created_at DESC, id DESC LIMIT ${limit}`, p));
}

/** Up to `limit` threads of a tab, newest number first, below `before` when given. */
export async function listByNumber(db: D1Database, tab: Tab, before: number | null, limit: number): Promise<Listed> {
  const p = new Params();
  const statuses = p.list(TABS[tab]);
  const cursor = before === null ? "" : ` AND number < ${p.add(before)}`;
  return listed(db, statement(db, `SELECT ${COLUMNS} FROM threads WHERE status IN (${statuses})${cursor} ORDER BY number DESC LIMIT ${limit}`, p));
}

/** A thread's comments and events, oldest first, up to `limit` of each. */
export async function history(db: D1Database, threadId: string, limit: number): Promise<{ comments: CommentRow[]; events: EventRow[] }> {
  const [comments, events] = await db.batch<CommentRow | EventRow>([
    db.prepare(`SELECT id, thread_id, author, body, created_at FROM comments WHERE thread_id = ?1 ORDER BY created_at, id LIMIT ${limit}`).bind(threadId),
    db.prepare(`SELECT id, thread_id, at, actor, type, data FROM events WHERE thread_id = ?1 ORDER BY id LIMIT ${limit}`).bind(threadId),
  ]);
  return { comments: (comments?.results ?? []) as CommentRow[], events: (events?.results ?? []) as EventRow[] };
}

/** A move a door asks for, as the store's own intent. */
export type Move =
  | { readonly action: "act" | "discuss" | "done" | "reopen" | "unsort" | "reply-opened" }
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
 * Makes a move and writes its event, or neither: `no-thread` when there is no such thread, `not-from-here` when
 * the thread isn't where the move starts. Every move stamps `moved_at`.
 */
export async function makeMove(db: D1Database, locator: Locator, move: Move, actor: Author): Promise<ThreadRow | "no-thread" | "not-from-here"> {
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
  return (await find(db, locator)) === null ? "no-thread" : "not-from-here";
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
  return (await find(db, locator)) === null ? "no-thread" : "visitor-words";
}

/** Adds a comment to a thread, which is activity on it; null when there is no such thread. */
export async function comment(db: D1Database, locator: Locator, author: Author, body: string): Promise<CommentRow | null> {
  const now = new Date().toISOString();
  const p = new Params();
  const columns = `${p.add(crypto.randomUUID())}, id, ${p.add(author)}, ${p.add(body)}, ${p.add(now)}`;
  const insert = statement(
    db,
    `INSERT INTO comments (id, thread_id, author, body, created_at) SELECT ${columns} FROM threads WHERE ${locate(locator, p)}
     RETURNING id, thread_id, author, body, created_at`,
    p,
  );
  const u = new Params();
  const touch = statement(db, `UPDATE threads SET activity_at = ${u.add(now)} WHERE ${locate(locator, u)}`, u);
  const [added] = await db.batch<CommentRow>([insert, touch]);
  return added?.results[0] ?? null;
}

/** The most threads one search answers. */
export const SEARCH_LIMIT = 20;

/**
 * Threads for a search, most recently active first: the one numbered `number` when the words are a number
 * (`42` or `#42`), else every thread whose title, summary or main text holds the words as typed, ignoring case
 * for ASCII letters. `%` and `_` in the words match only themselves. Up to `SEARCH_LIMIT`.
 */
export async function search(db: D1Database, words: string): Promise<ThreadRow[]> {
  const number = /^#?([1-9]\d{0,8})$/.exec(words);
  const p = new Params();
  if (number !== null) {
    return (await statement(db, `SELECT ${COLUMNS} FROM threads WHERE number = ${p.add(Number(number[1]))}`, p).all<ThreadRow>()).results;
  }
  const pattern = p.add(`%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const like = (column: string): string => `${column} LIKE ${pattern} ESCAPE '\\'`;
  return (
    await statement(
      db,
      `SELECT ${COLUMNS} FROM threads WHERE ${like("title")} OR ${like("summary")} OR ${like("body")}
       ORDER BY COALESCE(activity_at, created_at) DESC, number DESC LIMIT ${SEARCH_LIMIT}`,
      p,
    ).all<ThreadRow>()
  ).results;
}
