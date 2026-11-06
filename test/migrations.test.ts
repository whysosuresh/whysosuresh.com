// The migrations that move data, run on the harness's D1 as the deploy runs them: a table staged as the earlier
// migrations left it, then the next one applied. What it holds for 0006, which makes every inbox row a thread:
// every row is copied with its id, fields and status, numbered from 1 by when it arrived; each copied thread's
// history begins with a `created` event at its arrival, by the visitor or the sync, then an `imported` event
// with where it stood; the threads' list answers each row in its tab with the fields it had; and the
// next new thread is numbered after the copies. For 0007, which retires the inbox's table a deploy later: a row
// the old code added between 0006 and its deploy is copied with its history and numbered after the last thread;
// a move the old code made in that gap wins, with an `imported` event; a thread moved later on the new code
// keeps its own move; a ref a thread already holds is never kept twice; and the table is gone. For 0008, each
// thread's last activity: the latest of its arrival, its events and its comments, the inbox's copy left out. For
// 0010, the people a thread is shared with: every comment written before it is for everyone in the thread and by
// no invited person, and no one is invited. For 0012, which rebuilds `people` in place so everyone he deals with is
// a person: every person keeps their id, each address on a site note or visitor's note and each told name becomes
// one person, all numbered by age; each thread and note is linked to its person, one with no address to nobody; and
// the invitations stay joined, the foreign keys enforced, and the invited person signs in. For 0013, where a comment
// sits: every earlier comment is a general one, and a reply's parent is a comment that is there. For 0014, meetings:
// every earlier thread is no meeting and no one attends, an attendee names a thread and a person that are there, and
// is kept once per thread and person. For 0015, visitors' answers: a note still waiting for his OK is shown, every
// other comment keeps its state, no earlier comment has a visitor's key, and the answers' budget starts empty. For
// 0016, asks: every earlier thread is no ask and answers none, a slug is kept once, a response names a thread that is
// there, one DELETE clears an ask's thread with the threads that answer it, which the harness's reset relies on, and
// the asks' two budgets start empty.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { SITE, startHarness, type Harness } from "./harness.ts";

let harness: Harness | null = null;

afterEach(async () => {
  await harness?.dispose();
  harness = null;
});

/** An inbox row as 0005 left the table. */
interface InboxRow {
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

const BLANK = { topic: null, name: null, email: null, kind: null, drop_reason: null, reply_opened_at: null, title: null, ref: null, filed_link: null, moved_at: null };

/** Rows as the live inbox holds them: notes, told and own items, in every tab, two arriving at the same moment. */
const ROWS: InboxRow[] = [
  { ...BLANK, id: "00000000-0000-4000-8000-000000000003", received_at: "2026-11-03T10:00:00.000Z", source: "talk", topic: "stigmer", body: "Feedback.", name: "Asha", email: "asha@example.com", status: "act", kind: "feedback", moved_at: "2026-11-04T08:00:00.000Z" },
  { ...BLANK, id: "00000000-0000-4000-8000-000000000001", received_at: "2026-11-04T09:00:00.000Z", source: "self", topic: "other", body: "**An idea.**", status: "discuss", kind: "idea", title: "An idea", ref: "issue:stigmer/stigmer-cloud#1" },
  { ...BLANK, id: "00000000-0000-4000-8000-000000000002", received_at: "2026-11-04T09:00:00.000Z", source: "told", body: "He said so.", name: "Dev", status: "filed", kind: "feedback", title: "Try this", ref: "recorder:a:1", filed_link: "https://github.com/example/notes/issues/2", moved_at: "2026-11-04T12:00:00.000Z" },
  { ...BLANK, id: "00000000-0000-4000-8000-000000000004", received_at: "2026-11-02T07:00:00.000Z", source: "talk", topic: "videos", body: "Junk.", status: "dropped", drop_reason: "spam", reply_opened_at: "2026-11-03T00:00:00.000Z", moved_at: "2026-11-03T01:00:00.000Z" },
  { ...BLANK, id: "00000000-0000-4000-8000-000000000005", received_at: "2026-11-05T06:00:00.000Z", source: "talk", topic: "capsjump", body: "Hello.", status: "received" },
];

async function stage(rows: InboxRow[]): Promise<Harness> {
  const staged = await startHarness({ through: "0005" });
  const database = await staged.db();
  const columns = Object.keys(BLANK).concat(["id", "received_at", "source", "body", "status"]);
  if (rows.length === 0) return staged;
  await database.batch(
    rows.map((row) =>
      database
        .prepare(`INSERT INTO inbox (${columns.join(", ")}) VALUES (${columns.map((_, i) => `?${i + 1}`).join(", ")})`)
        .bind(...columns.map((column) => row[column as keyof InboxRow])),
    ),
  );
  return staged;
}

async function threadsTab(target: Harness, tab: string): Promise<{ threads: Record<string, unknown>[]; counts: Record<string, number>; next: number | null }> {
  const response = await target.fetch(`${SITE}/threads/api/threads?tab=${tab}`, { headers: { "Cf-Access-Jwt-Assertion": target.access.token() } });
  expect(response.status).toBe(200);
  return (await response.json()) as { threads: Record<string, unknown>[]; counts: Record<string, number>; next: number | null };
}

describe("0006, every inbox row a thread", () => {
  it("copies every row with its id and fields, numbered from 1 by when it arrived", async () => {
    harness = await stage(ROWS);
    await harness.migrate("0006");
    const threads = (await (await harness.db()).prepare("SELECT * FROM threads ORDER BY number").all<Record<string, unknown>>()).results;
    // By arrival, and by id for the two that arrived at the same moment.
    const order = ["004", "003", "001", "002", "005"].map((n) => `00000000-0000-4000-8000-000000000${n}`);
    expect(threads.map((thread) => [thread.number, thread.id])).toEqual(order.map((id, i) => [i + 1, id]));
    for (const thread of threads) {
      const row = ROWS.find((candidate) => candidate.id === thread.id);
      expect(thread).toEqual({
        id: row?.id,
        number: thread.number,
        created_at: row?.received_at,
        source: row?.source,
        space: row?.topic,
        title: row?.title,
        body: row?.body,
        summary: null,
        status: row?.status,
        kind: row?.kind,
        sender_name: row?.name,
        sender_email: row?.email,
        drop_reason: row?.drop_reason,
        reply_opened_at: row?.reply_opened_at,
        origin_ref: row?.ref,
        filed_link: row?.filed_link,
        moved_at: row?.moved_at,
      });
    }
  });

  it("starts each history with its arrival, by whoever brought it, then where it stood when copied", async () => {
    harness = await stage(ROWS);
    const before = new Date().toISOString();
    await harness.migrate("0006");
    const events = (await (await harness.db()).prepare("SELECT * FROM events ORDER BY id").all<{ id: number; thread_id: string; at: string; actor: string; type: string; data: string }>()).results;
    expect(events).toHaveLength(ROWS.length * 2);
    for (const row of ROWS) {
      const own = events.filter((event) => event.thread_id === row.id);
      expect(own.map((event) => [event.actor, event.type, JSON.parse(event.data)])).toEqual([
        [row.source === "talk" ? "visitor" : "sync", "created", { source: row.source }],
        ["import", "imported", { status: row.status }],
      ]);
      expect(own[0]?.at).toBe(row.received_at);
      expect(own[1]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect((own[1]?.at ?? "") >= before.slice(0, 19)).toBe(true);
    }
  });

  it("leaves each row on the threads' list in its tab with the fields it had, newest number first", async () => {
    harness = await stage(ROWS);
    // The code that runs now reads what later migrations add, so they are applied too; they move no copied row.
    await harness.migrate();
    const tabs: Record<string, string[]> = { pending: ["received", "act", "discuss"], look: ["received"], act: ["act"], discuss: ["discuss"], done: ["done", "dropped", "filed"] };
    const counts = Object.fromEntries(Object.entries(tabs).map(([tab, statuses]) => [tab, ROWS.filter((row) => statuses.includes(row.status)).length]));
    for (const [tab, statuses] of Object.entries(tabs)) {
      const expected = ROWS.filter((row) => statuses.includes(row.status))
        .sort((a, b) => (a.received_at === b.received_at ? b.id.localeCompare(a.id) : b.received_at.localeCompare(a.received_at)))
        .map((row) => ({
          id: row.id,
          createdAt: row.received_at,
          source: row.source,
          space: row.topic,
          title: row.title,
          body: row.body,
          senderName: row.name,
          senderEmail: row.email,
          status: row.status,
          kind: row.kind,
          dropReason: row.drop_reason,
          replyOpenedAt: row.reply_opened_at,
          ref: row.ref,
          filedLink: row.filed_link,
          movedAt: row.moved_at,
        }));
      const answer = await threadsTab(harness, tab);
      expect(answer.threads).toEqual(expected.map((thread) => expect.objectContaining(thread)));
      expect([answer.counts, answer.next]).toEqual([counts, null]);
    }
  });

  it("numbers the next new thread after the copies", async () => {
    harness = await stage(ROWS);
    await harness.migrate();
    const response = await harness.fetch(`${SITE}/threads/api/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.syncClaims()) },
      body: new TextEncoder().encode(JSON.stringify({ ref: "chat:after-the-copy", source: "self", title: "After", body: "After the copy.", space: "company", status: "received" })),
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { thread: { number: number } }).thread.number).toBe(ROWS.length + 1);
  });

  it("copies an empty inbox into no threads", async () => {
    harness = await stage([]);
    await harness.migrate("0006");
    const database = await harness.db();
    expect((await database.prepare("SELECT COUNT(*) AS n FROM threads").first<{ n: number }>())?.n).toBe(0);
    expect((await database.prepare("SELECT COUNT(*) AS n FROM events").first<{ n: number }>())?.n).toBe(0);
  });
});

describe("0007, the inbox retired a deploy later", () => {
  /** The live inbox after 0006, then what the old code wrote before the new code was deployed. */
  async function gap(): Promise<Harness> {
    const staged = await stage(ROWS);
    await staged.migrate("0006");
    const database = await staged.db();
    await database.batch([
      // A note that arrived in the gap.
      database
        .prepare("INSERT INTO inbox (id, received_at, source, topic, body, name, email, status) VALUES (?1, ?2, 'talk', 'stigmer', 'Sent in the gap.', NULL, NULL, 'received')")
        .bind("00000000-0000-4000-8000-000000000006", "2026-11-05T06:44:15.000Z"),
      // A move made in the gap: To look at to To discuss.
      database.prepare("UPDATE inbox SET status = 'discuss', kind = 'idea', moved_at = '2026-11-05T06:44:16.000Z' WHERE id = ?1").bind("00000000-0000-4000-8000-000000000005"),
      // A move made in the gap on a thread the new code then moved again, later: the thread's own move stands.
      database.prepare("UPDATE inbox SET status = 'done', moved_at = '2026-11-05T06:44:17.000Z' WHERE id = ?1").bind("00000000-0000-4000-8000-000000000003"),
      database.prepare("UPDATE threads SET status = 'discuss', kind = 'idea', moved_at = '2026-11-05T07:00:00.000Z' WHERE id = ?1").bind("00000000-0000-4000-8000-000000000003"),
      // A gap add whose ref the new code then kept as a thread of its own.
      database
        .prepare("INSERT INTO inbox (id, received_at, source, body, status, title, ref) VALUES (?1, '2026-11-05T06:44:18.000Z', 'self', 'Twice.', 'received', 'Twice', 'chat:twice')")
        .bind("00000000-0000-4000-8000-000000000007"),
      database
        .prepare("INSERT INTO threads (id, number, created_at, source, body, status, title, origin_ref) VALUES (?1, 6, '2026-11-05T06:50:00.000Z', 'self', 'Twice.', 'received', 'Twice', 'chat:twice')")
        .bind("00000000-0000-4000-8000-000000000008"),
    ]);
    return staged;
  }

  async function thread(target: Harness, id: string): Promise<Record<string, unknown> | null> {
    return (await target.db()).prepare("SELECT * FROM threads WHERE id = ?1").bind(id).first<Record<string, unknown>>();
  }

  async function eventsOf(target: Harness, id: string): Promise<[string, string, unknown][]> {
    const rows = (await (await target.db()).prepare("SELECT actor, type, data FROM events WHERE thread_id = ?1 ORDER BY id").bind(id).all<{ actor: string; type: string; data: string }>()).results;
    return rows.map((row) => [row.actor, row.type, JSON.parse(row.data)]);
  }

  it("copies a row the gap added, numbered after the last thread, with its history", async () => {
    harness = await gap();
    await harness.migrate();
    const copied = await thread(harness, "00000000-0000-4000-8000-000000000006");
    expect(copied).toMatchObject({ number: 7, source: "talk", space: "stigmer", body: "Sent in the gap.", status: "received", created_at: "2026-11-05T06:44:15.000Z" });
    expect(await eventsOf(harness, "00000000-0000-4000-8000-000000000006")).toEqual([
      ["visitor", "created", { source: "talk" }],
      ["import", "imported", { status: "received" }],
    ]);
  });

  it("replays a move the gap made, with an imported event", async () => {
    harness = await gap();
    await harness.migrate();
    expect(await thread(harness, "00000000-0000-4000-8000-000000000005")).toMatchObject({ status: "discuss", kind: "idea", moved_at: "2026-11-05T06:44:16.000Z" });
    expect(await eventsOf(harness, "00000000-0000-4000-8000-000000000005")).toEqual([
      ["visitor", "created", { source: "talk" }],
      ["import", "imported", { status: "received" }],
      ["import", "imported", { status: "discuss" }],
    ]);
  });

  it("keeps a thread's own later move over the gap's earlier one", async () => {
    harness = await gap();
    await harness.migrate();
    expect(await thread(harness, "00000000-0000-4000-8000-000000000003")).toMatchObject({ status: "discuss", kind: "idea", moved_at: "2026-11-05T07:00:00.000Z" });
    expect(await eventsOf(harness, "00000000-0000-4000-8000-000000000003")).toHaveLength(2);
  });

  it("never keeps a ref twice, and leaves every other thread as it was", async () => {
    harness = await gap();
    const before = (await (await harness.db()).prepare("SELECT * FROM threads WHERE id NOT IN (?1, ?2) ORDER BY number").bind("00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000005").all()).results;
    await harness.migrate();
    const database = await harness.db();
    expect((await database.prepare("SELECT COUNT(*) AS n FROM threads WHERE origin_ref = 'chat:twice'").first<{ n: number }>())?.n).toBe(1);
    expect(await thread(harness, "00000000-0000-4000-8000-000000000007")).toBeNull();
    const after = (await database.prepare("SELECT * FROM threads WHERE id NOT IN (?1, ?2, ?3) ORDER BY number").bind("00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000005", "00000000-0000-4000-8000-000000000006").all<Record<string, unknown>>()).results;
    // Later migrations add a thread's last activity, its main section, who it is from, its meeting and its ask; everything 0007 found stays as it was.
    expect(
      after.map(
        ({
          activity_at: _activity,
          main: _main,
          link_url: _url,
          link_title: _title,
          public_at: _public,
          person_id: _person,
          meeting_when: _when,
          meeting_minutes: _minutes,
          meeting_where: _where,
          ask_slug: _slug,
          ask_state: _state,
          ask_thread_id: _asked,
          ...rest
        }) => rest,
      ),
    ).toEqual(before);
  });

  it("drops the inbox's table", async () => {
    harness = await gap();
    await harness.migrate();
    const tables = (await (await harness.db()).prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'inbox'").all()).results;
    expect(tables).toEqual([]);
  });
});

describe("0008, each thread's last activity", () => {
  it("is the latest of its arrival, its events and its comments, never the day the inbox became threads", async () => {
    harness = await startHarness({ through: "0007" });
    const database = await harness.db();
    const thread = (id: string, number: number, at: string) =>
      database
        .prepare("INSERT INTO threads (id, number, created_at, source, body, status) VALUES (?1, ?2, ?3, 'self', 'x', 'received')")
        .bind(id, number, at);
    const event = (id: string, at: string, type: string) =>
      database.prepare("INSERT INTO events (thread_id, at, actor, type, data) VALUES (?1, ?2, 'sync', ?3, '{}')").bind(id, at, type);
    const said = (id: string, at: string) =>
      database.prepare("INSERT INTO comments (id, thread_id, author, body, created_at) VALUES (?1, ?2, 'sync', 'x', ?3)").bind(crypto.randomUUID(), id, at);
    const [a, b, c] = ["a", "b", "c"].map((n) => `00000000-0000-4000-8000-00000000000${n}`) as [string, string, string];
    await database.batch([
      thread(a, 1, "2026-11-01T00:00:00.000Z"),
      thread(b, 2, "2026-11-01T00:00:00.000Z"),
      thread(c, 3, "2026-11-01T00:00:00.000Z"),
      event(a, "2026-11-01T00:00:00.000Z", "created"),
      event(a, "2026-11-05T00:00:00.000Z", "imported"),
      event(b, "2026-11-02T00:00:00.000Z", "moved"),
      said(b, "2026-11-03T00:00:00.000Z"),
      event(c, "2026-11-04T00:00:00.000Z", "edited"),
      said(c, "2026-11-02T00:00:00.000Z"),
    ]);
    await harness.migrate();
    const rows = (await database.prepare("SELECT id, activity_at FROM threads ORDER BY number").all<{ id: string; activity_at: string }>()).results;
    expect(rows.map((row) => row.activity_at)).toEqual(["2026-11-01T00:00:00.000Z", "2026-11-03T00:00:00.000Z", "2026-11-04T00:00:00.000Z"]);
  });
});

describe("0010, the people a thread is shared with", () => {
  it("leaves every earlier comment for everyone in the thread, by no invited person, with no one invited", async () => {
    harness = await startHarness({ through: "0009" });
    const database = await harness.db();
    await database.batch([
      database.prepare("INSERT INTO threads (id, number, created_at, source, body, status) VALUES ('t1', 1, '2026-11-01T00:00:00.000Z', 'self', 'x', 'act')"),
      database.prepare("INSERT INTO comments (id, thread_id, author, body, created_at) VALUES ('c1', 't1', 'owner', 'Mine.', '2026-11-02T00:00:00.000Z')"),
      database.prepare("INSERT INTO comments (id, thread_id, author, body, created_at) VALUES ('c2', 't1', 'sync', 'Claude.', '2026-11-03T00:00:00.000Z')"),
    ]);
    await harness.migrate();
    const comments = (await database.prepare("SELECT id, author, audience, person_id FROM comments ORDER BY id").all()).results;
    expect(comments).toEqual([
      { id: "c1", author: "owner", audience: "thread", person_id: null },
      { id: "c2", author: "sync", audience: "thread", person_id: null },
    ]);
    for (const table of ["people", "members"]) {
      expect((await database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n).toBe(0);
    }
  });
});

describe("0011, public threads and the notes on them", () => {
  it("leaves every thread private and every earlier comment shown, with no visitor's name or email", async () => {
    harness = await startHarness({ through: "0010" });
    const database = await harness.db();
    await database.batch([
      database.prepare("INSERT INTO threads (id, number, created_at, source, body, status) VALUES ('t1', 1, '2026-11-01T00:00:00.000Z', 'self', 'x', 'act')"),
      database.prepare("INSERT INTO comments (id, thread_id, author, body, created_at, audience) VALUES ('c1', 't1', 'owner', 'Mine.', '2026-11-02T00:00:00.000Z', 'owner')"),
      database.prepare("INSERT INTO comments (id, thread_id, author, body, created_at) VALUES ('c2', 't1', 'sync', 'Claude.', '2026-11-03T00:00:00.000Z')"),
    ]);
    await harness.migrate();
    expect(await database.prepare("SELECT public_at FROM threads").first()).toEqual({ public_at: null });
    const comments = (await database.prepare("SELECT id, audience, state, sender_name, sender_email FROM comments ORDER BY id").all()).results;
    expect(comments).toEqual([
      { id: "c1", audience: "owner", state: "shown", sender_name: null, sender_email: null },
      { id: "c2", audience: "thread", state: "shown", sender_name: null, sender_email: null },
    ]);
  });
});

describe("0012, everyone he deals with is a person", () => {
  /** The tables as 0011 left them: an invited person with a comment, site notes, told threads and visitors' notes. */
  async function staged(): Promise<Harness> {
    const target = await startHarness({ through: "0011" });
    const database = await target.db();
    const thread = (id: string, number: number, at: string, source: string, name: string | null, email: string | null, status = "received") =>
      database
        .prepare("INSERT INTO threads (id, number, created_at, source, body, status, sender_name, sender_email) VALUES (?1, ?2, ?3, ?4, 'Words.', ?5, ?6, ?7)")
        .bind(id, number, at, source, status, name, email);
    const comment = (id: string, thread: string, at: string, author: string, person: string | null, name: string | null, email: string | null, state = "shown") =>
      database
        .prepare("INSERT INTO comments (id, thread_id, author, body, created_at, audience, state, person_id, sender_name, sender_email) VALUES (?1, ?2, ?3, 'Said.', ?4, 'public', ?5, ?6, ?7, ?8)")
        .bind(id, thread, author, at, state, person, name, email);
    await database.batch([
      thread("t1", 1, "2026-11-01T00:00:00.000Z", "self", null, null),
      // Asha wrote twice from the site, her address typed two ways; the newest name she typed names her.
      thread("t2", 2, "2026-11-02T00:00:00.000Z", "talk", "Asha", "Asha@Example.com"),
      thread("t3", 3, "2026-11-04T00:00:00.000Z", "talk", "Asha S.", " asha@example.com "),
      // A note with no address links to nobody.
      thread("t4", 4, "2026-11-03T00:00:00.000Z", "talk", "Nobody", null),
      // Dev told him things twice, his name said two ways; the newest names him.
      thread("t5", 5, "2026-11-05T00:00:00.000Z", "told", "Dev K.", null),
      thread("t6", 6, "2026-11-06T00:00:00.000Z", "told", " dev k. ", null),
      // The site note of someone he later invited.
      thread("t7", 7, "2026-11-01T12:00:00.000Z", "talk", "Meera from the site", "meera@example.com", "dropped"),
      database.prepare("INSERT INTO people (id, email, name, created_at) VALUES ('p-meera', 'meera@example.com', 'Meera', '2026-11-02T12:00:00.000Z')"),
      database.prepare("INSERT INTO members (thread_id, person_id, added_at) VALUES ('t1', 'p-meera', '2026-11-02T12:00:00.000Z')"),
      comment("c1", "t1", "2026-11-03T00:00:00.000Z", "member", "p-meera", null, null),
      // A visitor's note typed with Meera's address, and one by a stranger, and one with no address.
      comment("c2", "t1", "2026-11-04T00:00:00.000Z", "visitor", null, "M.", "MEERA@example.com", "pending"),
      comment("c3", "t1", "2026-11-01T00:00:00.000Z", "visitor", null, "Lin", "lin@example.net", "dropped"),
      comment("c4", "t1", "2026-11-05T00:00:00.000Z", "visitor", null, "Shy", null),
    ]);
    return target;
  }

  it("keeps every person with their id, adds everyone else he dealt with, and numbers them all by age", async () => {
    harness = await staged();
    await harness.migrate();
    const database = await harness.db();
    const people = (await database.prepare("SELECT id, number, email, name, note, created_at FROM people ORDER BY number").all<Record<string, unknown>>()).results;
    expect(people.map(({ id: _id, ...rest }) => rest)).toEqual([
      { number: 1, email: "lin@example.net", name: "Lin", note: null, created_at: "2026-11-01T00:00:00.000Z" },
      { number: 2, email: "asha@example.com", name: "Asha S.", note: null, created_at: "2026-11-02T00:00:00.000Z" },
      { number: 3, email: "meera@example.com", name: "Meera", note: null, created_at: "2026-11-02T12:00:00.000Z" },
      { number: 4, email: null, name: "dev k.", note: null, created_at: "2026-11-05T00:00:00.000Z" },
    ]);
    expect(people[2]?.id).toBe("p-meera");
    for (const person of people.filter((row) => row.id !== "p-meera")) {
      expect(person.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect((await database.prepare("SELECT name FROM sqlite_master WHERE name = 'people_before'").all()).results).toEqual([]);
  });

  it("links each site note, told thread and visitor's note to its person, and a note with no address to nobody", async () => {
    harness = await staged();
    await harness.migrate();
    const database = await harness.db();
    const named = async (sql: string): Promise<Record<string, unknown>[]> => (await database.prepare(sql).all<Record<string, unknown>>()).results;
    expect(await named("SELECT threads.id, people.number FROM threads LEFT JOIN people ON people.id = threads.person_id ORDER BY threads.number")).toEqual([
      { id: "t1", number: null },
      { id: "t2", number: 2 },
      { id: "t3", number: 2 },
      { id: "t4", number: null },
      { id: "t5", number: 4 },
      { id: "t6", number: 4 },
      { id: "t7", number: 3 },
    ]);
    expect(await named("SELECT comments.id, people.number FROM comments LEFT JOIN people ON people.id = comments.person_id ORDER BY comments.id")).toEqual([
      { id: "c1", number: 3 },
      { id: "c2", number: 3 },
      { id: "c3", number: 1 },
      { id: "c4", number: null },
    ]);
    // What a visitor typed stays as typed.
    expect(await named("SELECT sender_name, sender_email FROM comments WHERE id = 'c2'")).toEqual([{ sender_name: "M.", sender_email: "MEERA@example.com" }]);
  });

  it("leaves the invitation joined, the foreign keys enforced, and the invited person signing in", async () => {
    harness = await staged();
    await harness.migrate();
    const database = await harness.db();
    expect(await database.prepare("SELECT members.thread_id, people.email FROM members JOIN people ON people.id = members.person_id").all().then((r) => r.results)).toEqual([
      { thread_id: "t1", email: "meera@example.com" },
    ]);
    await expect(database.prepare("INSERT INTO members (thread_id, person_id, added_at) VALUES ('t1', 'p-nobody', 'x')").run()).rejects.toThrow(/FOREIGN KEY/);
    await expect(database.prepare("UPDATE threads SET person_id = 'p-nobody' WHERE id = 't1'").run()).rejects.toThrow(/FOREIGN KEY/);
    const me = await harness.fetch(`${SITE}/threads/api/me`, { headers: { "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.memberClaims("meera@example.com")) } });
    expect(me.status).toBe(200);
  });

  it("never turns the deferred foreign keys off by hand, which would forget a child left without a parent", async () => {
    // SQLite clears the violations it deferred when the pragma is turned off, so the commit would no longer refuse
    // them; the deferral ends with the commit instead. A rebuild that loses a parent is then refused whole.
    const sql = readFileSync(new URL("../migrations/0012_people.sql", import.meta.url), "utf8");
    expect(sql.split("\n").filter((line) => !line.startsWith("--") && /defer_foreign_keys/i.test(line))).toEqual(["PRAGMA defer_foreign_keys = on;"]);
    harness = await startHarness({ through: "0011" });
    const database = await harness.db();
    await database.batch([
      database.prepare("INSERT INTO threads (id, number, created_at, source, body, status) VALUES ('t1', 1, '2026-11-01T00:00:00.000Z', 'self', 'x', 'act')"),
      database.prepare("INSERT INTO people (id, email, name, created_at) VALUES ('p1', 'a@example.com', 'A', '2026-11-01T00:00:00.000Z')"),
      database.prepare("INSERT INTO members (thread_id, person_id, added_at) VALUES ('t1', 'p1', '2026-11-01T00:00:00.000Z')"),
    ]);
    const lost = ["PRAGMA defer_foreign_keys = on", "DROP TABLE people", "CREATE TABLE people (id TEXT PRIMARY KEY, email TEXT)"];
    await expect(database.batch(lost.map((statement) => database.prepare(statement)))).rejects.toThrow();
    expect(await database.prepare("SELECT id, email FROM people").all().then((r) => r.results)).toEqual([{ id: "p1", email: "a@example.com" }]);
  });
});

describe("0013, where a comment sits", () => {
  it("leaves every earlier comment a general one, and refuses a reply to a comment that isn't there", async () => {
    harness = await startHarness({ through: "0012" });
    const database = await harness.db();
    await database.batch([
      database.prepare("INSERT INTO threads (id, number, created_at, source, body, status) VALUES ('t1', 1, '2026-11-01T00:00:00.000Z', 'self', 'x', 'act')"),
      database.prepare("INSERT INTO comments (id, thread_id, author, body, created_at, audience) VALUES ('c1', 't1', 'owner', 'Mine.', '2026-11-02T00:00:00.000Z', 'owner')"),
      database.prepare("INSERT INTO comments (id, thread_id, author, body, created_at, state, sender_name) VALUES ('c2', 't1', 'visitor', 'Hi.', '2026-11-03T00:00:00.000Z', 'pending', 'Asha')"),
    ]);
    await harness.migrate("0013");
    const comments = (await database.prepare("SELECT id, audience, state, parent_id, question, quote, quote_prefix, quote_suffix, page_version FROM comments ORDER BY id").all()).results;
    const general = { parent_id: null, question: null, quote: null, quote_prefix: null, quote_suffix: null, page_version: null };
    expect(comments).toEqual([
      { id: "c1", audience: "owner", state: "shown", ...general },
      { id: "c2", audience: "thread", state: "pending", ...general },
    ]);
    await expect(
      database.prepare("INSERT INTO comments (id, thread_id, author, body, created_at, parent_id) VALUES ('c3', 't1', 'owner', 'Re.', '2026-11-04T00:00:00.000Z', 'c-nobody')").run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe("0015, visitors' answers", () => {
  it("shows every waiting note, leaves every other state alone, and gives no earlier comment a key", async () => {
    harness = await startHarness({ through: "0014" });
    const database = await harness.db();
    await database.batch([
      database.prepare("INSERT INTO threads (id, number, created_at, source, body, status, public_at) VALUES ('t1', 1, '2026-11-01T00:00:00.000Z', 'self', 'x', 'act', '2026-11-01T00:00:00.000Z')"),
      database.prepare("INSERT INTO comments (id, thread_id, author, body, created_at, audience) VALUES ('c1', 't1', 'owner', 'Mine.', '2026-11-02T00:00:00.000Z', 'owner')"),
      database.prepare("INSERT INTO comments (id, thread_id, author, body, created_at, audience, state, sender_name) VALUES ('c2', 't1', 'visitor', 'Hi.', '2026-11-03T00:00:00.000Z', 'public', 'pending', 'Asha')"),
      database.prepare("INSERT INTO comments (id, thread_id, author, body, created_at, audience, state, sender_name) VALUES ('c3', 't1', 'visitor', 'Spam.', '2026-11-03T00:00:00.000Z', 'public', 'dropped', 'Bot')"),
    ]);
    await harness.migrate();
    expect((await database.prepare("SELECT id, state, visitor_key FROM comments ORDER BY id").all()).results).toEqual([
      { id: "c1", state: "shown", visitor_key: null },
      { id: "c2", state: "shown", visitor_key: null },
      { id: "c3", state: "dropped", visitor_key: null },
    ]);
    expect(await database.prepare("SELECT COUNT(*) AS n FROM answer_senders").first<{ n: number }>()).toEqual({ n: 0 });
    const read = (await (await harness.fetch(`${SITE}/api/threads/1`)).json()) as { comments: { body: string }[] };
    expect(read.comments.map((comment) => comment.body)).toEqual(["Hi."]);
  });
});

describe("0014, meetings", () => {
  it("leaves every earlier thread no meeting, and keeps an attendee once, only of a thread and a person that are there", async () => {
    harness = await startHarness({ through: "0013" });
    const database = await harness.db();
    await database.batch([
      database.prepare("INSERT INTO threads (id, number, created_at, source, body, status) VALUES ('t1', 1, '2026-11-01T00:00:00.000Z', 'self', 'x', 'act')"),
      database.prepare("INSERT INTO people (id, number, email, name, created_at) VALUES ('p1', 1, NULL, 'Dev', '2026-11-01T00:00:00.000Z')"),
    ]);
    await harness.migrate();
    expect(await database.prepare("SELECT meeting_when, meeting_minutes, meeting_where FROM threads").all().then((r) => r.results)).toEqual([
      { meeting_when: null, meeting_minutes: null, meeting_where: null },
    ]);
    expect((await threadsTab(harness, "act")).threads.map((row) => row.meeting)).toEqual([null]);
    await database.prepare("INSERT INTO attendees (thread_id, person_id, added_at) VALUES ('t1', 'p1', '2026-11-02T00:00:00.000Z')").run();
    await expect(database.prepare("INSERT INTO attendees (thread_id, person_id, added_at) VALUES ('t1', 'p1', '2026-11-03T00:00:00.000Z')").run()).rejects.toThrow(/UNIQUE|PRIMARY/);
    await expect(database.prepare("INSERT INTO attendees (thread_id, person_id, added_at) VALUES ('t1', 'p-nobody', '2026-11-03T00:00:00.000Z')").run()).rejects.toThrow(/FOREIGN KEY/);
    await expect(database.prepare("INSERT INTO attendees (thread_id, person_id, added_at) VALUES ('t-nobody', 'p1', '2026-11-03T00:00:00.000Z')").run()).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe("0016, asks", () => {
  it("leaves every earlier thread no ask, keeps a slug once, and refuses a response to a thread that isn't there", async () => {
    harness = await startHarness({ through: "0015" });
    const database = await harness.db();
    await database.prepare("INSERT INTO threads (id, number, created_at, source, body, status) VALUES ('t1', 1, '2026-11-01T00:00:00.000Z', 'self', 'x', 'act')").run();
    await harness.migrate();
    expect(await database.prepare("SELECT ask_slug, ask_state, ask_thread_id FROM threads").all().then((r) => r.results)).toEqual([
      { ask_slug: null, ask_state: null, ask_thread_id: null },
    ]);
    expect((await threadsTab(harness, "act")).threads.map((row) => row.ask)).toEqual([null]);
    await database.batch([
      database.prepare("UPDATE threads SET ask_slug = 'demo', ask_state = 'open' WHERE id = 't1'"),
      database.prepare("INSERT INTO threads (id, number, created_at, source, body, status, ask_thread_id) VALUES ('t2', 2, '2026-11-02T00:00:00.000Z', 'talk', '', 'received', 't1')"),
    ]);
    await expect(
      database.prepare("INSERT INTO threads (id, number, created_at, source, body, status, ask_slug) VALUES ('t3', 3, '2026-11-02T00:00:00.000Z', 'self', 'y', 'act', 'demo')").run(),
    ).rejects.toThrow(/UNIQUE/);
    await expect(
      database.prepare("INSERT INTO threads (id, number, created_at, source, body, status, ask_thread_id) VALUES ('t4', 4, '2026-11-02T00:00:00.000Z', 'talk', '', 'received', 't-nobody')").run(),
    ).rejects.toThrow(/FOREIGN KEY/);
    await expect(database.prepare("DELETE FROM threads WHERE id = 't1'").run()).rejects.toThrow(/FOREIGN KEY/);
    await database.prepare("DELETE FROM threads").run();
    expect(await database.prepare("SELECT COUNT(*) AS n FROM threads").first<{ n: number }>()).toEqual({ n: 0 });
    for (const table of ["ask_thread_senders", "ask_answer_senders"]) expect(await database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>()).toEqual({ n: 0 });
  });
});
