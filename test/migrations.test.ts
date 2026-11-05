// The migrations that move data, run on the harness's D1 as the deploy runs them: a table staged as the earlier
// migrations left it, then the next one applied. What it holds for 0006, which makes every inbox row a thread:
// every row is copied with its id, fields and status, numbered from 1 by when it arrived; each copied thread's
// history begins with a `created` event at its arrival, by the visitor or the sync, then an `imported` event
// with where it stood; the inbox's door answers each row as the item it was, in its old names and order; and the
// next new thread is numbered after the copies. For 0007, which retires the inbox's table a deploy later: a row
// the old code added between 0006 and its deploy is copied with its history and numbered after the last thread;
// a move the old code made in that gap wins, with an `imported` event; a thread moved later on the new code
// keeps its own move; a ref a thread already holds is never kept twice; and the table is gone. For 0008, each
// thread's last activity: the latest of its arrival, its events and its comments, the inbox's copy left out.

import { afterEach, describe, expect, it } from "vitest";
import { OWNER, SITE, startHarness, type Harness } from "./harness.ts";

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

async function inboxTab(target: Harness, tab: string): Promise<unknown> {
  const response = await target.fetch(`${SITE}/inbox/api/items?tab=${tab}`, { headers: { "Cf-Access-Jwt-Assertion": target.access.token() } });
  expect(response.status).toBe(200);
  return response.json();
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

  it("leaves the inbox's door answering each row as the item it always was, in its tab, newest first", async () => {
    harness = await stage(ROWS);
    // The code that runs now reads what later migrations add, so they are applied too; they move no copied row.
    await harness.migrate();
    const tabs: Record<string, string[]> = { look: ["received"], act: ["act"], discuss: ["discuss"], done: ["done", "dropped", "filed"] };
    const counts = Object.fromEntries(Object.entries(tabs).map(([tab, statuses]) => [tab, ROWS.filter((row) => statuses.includes(row.status)).length]));
    for (const [tab, statuses] of Object.entries(tabs)) {
      const items = ROWS.filter((row) => statuses.includes(row.status))
        .sort((a, b) => (a.received_at === b.received_at ? b.id.localeCompare(a.id) : b.received_at.localeCompare(a.received_at)))
        .map((row) => ({
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
        }));
      expect(await inboxTab(harness, tab)).toEqual({ items, counts, next: null, me: OWNER });
    }
  });

  it("numbers the next new thread after the copies", async () => {
    harness = await stage(ROWS);
    await harness.migrate();
    const response = await harness.fetch(`${SITE}/threads/api/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.syncClaims("threads"), { app: "threads" }) },
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
    // 0008 adds each thread's last activity; everything 0007 found stays as it was.
    expect(after.map(({ activity_at: _activity, ...rest }) => rest)).toEqual(before);
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
