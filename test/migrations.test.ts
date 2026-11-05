// The migrations that move data, run on the harness's D1 as the deploy runs them: a table staged as the earlier
// migrations left it, then the next one applied. What it holds for 0006, which makes every inbox row a thread:
// every row is copied with its id, fields and status, numbered from 1 by when it arrived; each copied thread's
// history begins with a `created` event at its arrival, by the visitor or the sync, then an `imported` event
// with where it stood; the inbox's door answers each row as the item it was, in its old names and order; and the
// next new thread is numbered after the copies.

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
    await harness.migrate();
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
    await harness.migrate();
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
    await harness.migrate();
    const database = await harness.db();
    expect((await database.prepare("SELECT COUNT(*) AS n FROM threads").first<{ n: number }>())?.n).toBe(0);
    expect((await database.prepare("SELECT COUNT(*) AS n FROM events").first<{ n: number }>())?.n).toBe(0);
  });
});
