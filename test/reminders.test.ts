// Reminders, run as production runs them: the Worker's bundle in workerd (test/harness.ts), with a local D1 and
// Cloudflare Access played for the threads' application. What it holds: any thread can carry a reminder, set by the
// owner from his own page and by the sync, once on a day or every N days from a day, and his and the sync's every shape
// of a thread says it (`reminder`, null while it has none: a thread's call, a tab's rows). A weekly series started on a
// day gone by is next due on its coming day, not due at once, and a reminder for once on a day gone by is refused.
// Later moves one time and never the series, so Done afterwards lands back on its day; Done on the day, late after
// missed weeks and early each land on the next day after today, never a missed one, and a reminder for once ends; a
// second Done for the same day, racing or not, is refused as stale and advances nothing. A reminder never moves its
// thread: the status and when it last moved stay, and only its last activity is stamped. Each change is an event of
// his own. The reminders' list answers today in his zone and every reminder soonest first, due or not, a dropped
// thread's never due until it is reopened. Malformed calls, a thread with none and a number nobody has are refused
// and nothing is written. The calls are the owner's and the sync's: an invited person is refused before anything is
// read, the owner's writes come only from his own page, signed out nobody gets in, and an invited person never reads a
// reminder, in a thread, their list, a collection shared with them or its history; nor does a stranger reading a
// public thread, a public collection or an ask. His own reminder changes answer an invited person's last word
// ("waiting"), and the sync's don't.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays, todayIn } from "../site/app/reminders.js";
import { THREADS, startHarness, type Harness } from "./harness.ts";

const MEERA = "meera@example.com";
const QUESTIONS = '<!doctype html><p data-thread-question="stood-out">What stood out?</p>';

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});
afterAll(async () => {
  await harness.dispose();
});
beforeEach(async () => {
  await harness.reset();
});

type Who = "owner" | "sync" | { readonly email: string };

function token(as: Who): string {
  if (as === "owner") return harness.access.token(harness.access.ownerClaims());
  if (as === "sync") return harness.access.token(harness.access.syncClaims());
  return harness.access.token(harness.access.memberClaims(as.email));
}

/** A call under /threads/api/, by its path after that: a GET with no body, else a POST from the site's own page unless `origin` says otherwise. */
async function call(path: string, request: { as?: Who; body?: unknown; origin?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(request.as ?? "owner") };
  if (request.body === undefined) return harness.fetch(`${THREADS}/threads/api${path}`, { headers });
  headers["Content-Type"] = "application/json";
  if (request.origin !== null) headers.Origin = request.origin ?? THREADS;
  return harness.fetch(`${THREADS}/threads/api${path}`, { method: "POST", headers, body: new TextEncoder().encode(JSON.stringify(request.body)) });
}

async function answer<T>(response: Response, status = 200): Promise<T> {
  const text = await response.text();
  expect([response.status, text]).toEqual([status, expect.any(String)]);
  return JSON.parse(text) as T;
}

async function reasonOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { reason: string }).reason];
}

/** A few milliseconds, so two writes never share a timestamp. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

async function count(sql: string, ...values: unknown[]): Promise<number> {
  return (await (await harness.db()).prepare(sql).bind(...values).first<{ n: number }>())?.n ?? 0;
}

let refs = 0;
/** A thread the sync adds; answers its number. */
async function thread(fields: Record<string, unknown> = {}): Promise<number> {
  refs += 1;
  const body = { ref: `chat:reminders-${refs}`, source: "self", title: `Thread ${refs}`, body: `Body ${refs}`, space: "company", status: "act", ...fields };
  return (await answer<{ thread: { number: number } }>(await call("/threads", { as: "sync", body }), 201)).thread.number;
}

interface Reminder {
  start: string;
  on: string;
  every: number | null;
}

interface Thread {
  number: number;
  status: string;
  reminder?: Reminder | null;
  activityAt: string;
  movedAt: string | null;
}

interface Event {
  id: number;
  actor: string;
  type: string;
  data: Record<string, unknown>;
}

interface Listed {
  today: string;
  reminders: { number: number; title: string; status: string; reminder: Reminder; due: boolean; dueSince: string | null }[];
}

/** A change to a thread's reminder as `as` makes it; answers the thread. */
async function remind(number: number, body: unknown, as: Who = "owner"): Promise<Thread> {
  return (await answer<{ thread: Thread }>(await call(`/threads/${number}/reminder`, { as, body }))).thread;
}

async function shown(number: number, as: Who = "owner"): Promise<{ thread: Thread; events: Event[] }> {
  return answer(await call(`/threads/${number}`, { as }));
}

/** A thread's reminder events, oldest first. */
async function reminderEvents(number: number): Promise<Event[]> {
  return (await shown(number)).events.filter((event) => event.type.startsWith("reminder-"));
}

async function listed(as: Who = "owner"): Promise<Listed> {
  return answer(await call("/reminders", { as }));
}

/** Today in his zone, as the Worker reads it. */
function today(): string {
  return todayIn(Date.now());
}

/** Moves a reminder to days gone by, as time passing would: its series' start and its next due day. */
async function backdate(number: number, start: string, on: string): Promise<void> {
  await (await harness.db()).prepare("UPDATE threads SET remind_start = ?1, remind_on = ?2 WHERE number = ?3").bind(start, on, number).run();
}

describe("setting a reminder", () => {
  it("keeps once on a day and every N days from a day, says it on the thread and its tab, and never moves the thread", async () => {
    const n = await thread();
    const before = (await shown(n)).thread;
    expect(before.reminder).toBeNull();
    await tick();
    const set = await remind(n, { start: today(), every: 7 });
    expect(set.reminder).toEqual({ start: today(), on: today(), every: 7 });
    expect([set.status, set.movedAt]).toEqual([before.status, before.movedAt]);
    expect(set.activityAt > before.activityAt).toBe(true);
    const row = (await answer<{ threads: Thread[] }>(await call("/threads?tab=act"))).threads.find((one) => one.number === n);
    expect(row?.reminder).toEqual({ start: today(), on: today(), every: 7 });

    const once = await remind(n, { start: addDays(today(), 2), every: null }, "sync");
    expect(once.reminder).toEqual({ start: addDays(today(), 2), on: addDays(today(), 2), every: null });
    expect(await reminderEvents(n)).toEqual([
      expect.objectContaining({ actor: "owner", type: "reminder-set", data: { from: null, to: { start: today(), on: today(), every: 7 } } }),
      expect.objectContaining({
        actor: "sync",
        type: "reminder-set",
        data: { from: { start: today(), on: today(), every: 7 }, to: { start: addDays(today(), 2), on: addDays(today(), 2), every: null } },
      }),
    ]);
  });

  it("brings a repeat started on a day gone by to its coming day, and refuses once on a day gone by", async () => {
    const n = await thread();
    expect((await remind(n, { start: addDays(today(), -10), every: 7 })).reminder).toEqual({ start: addDays(today(), -10), on: addDays(today(), 4), every: 7 });
    expect((await remind(n, { start: addDays(today(), -14), every: 7 })).reminder?.on).toBe(today());
    const events = await count("SELECT COUNT(*) AS n FROM events");
    expect(await reasonOf(await call(`/threads/${n}/reminder`, { body: { start: addDays(today(), -1), every: null } }))).toEqual([400, "reminder"]);
    expect(await count("SELECT COUNT(*) AS n FROM events")).toBe(events);
    expect((await shown(n)).thread.reminder?.start).toBe(addDays(today(), -14));
  });

  it("refuses every malformed call, a thread with none and a number nobody has, writing nothing", async () => {
    const n = await thread();
    const events = await count("SELECT COUNT(*) AS n FROM events");
    for (const body of [
      { start: "2026-02-30", every: 7 },
      { start: today(), every: 0 },
      { start: today(), every: 367 },
      { start: today(), every: 1.5 },
      { start: today(), every: "7" },
      { start: null, every: 7 },
      { start: today() },
      { start: `${today()}T09:00:00Z`, every: null },
      { start: "1999-12-31", every: 7 },
      { snooze: "tomorrow" },
      { snooze: addDays(today(), 1), every: 7 },
      { action: "done" },
      { action: "skip", on: today() },
      { action: "done", on: "today" },
      [],
      "done",
    ]) {
      expect([body, await reasonOf(await call(`/threads/${n}/reminder`, { body }))]).toEqual([body, [400, "reminder"]]);
    }
    expect(await reasonOf(await call(`/threads/${n}/reminder`, { body: { start: null, every: null } }))).toEqual([409, "not-a-reminder"]);
    expect(await reasonOf(await call(`/threads/${n}/reminder`, { body: { snooze: addDays(today(), 1) } }))).toEqual([409, "not-a-reminder"]);
    expect(await reasonOf(await call(`/threads/${n}/reminder`, { body: { action: "done", on: today() } }))).toEqual([409, "not-a-reminder"]);
    for (const body of [{ start: today(), every: 7 }, { start: null, every: null }, { snooze: addDays(today(), 1) }, { action: "done", on: today() }]) {
      expect(await reasonOf(await call("/threads/999/reminder", { body }))).toEqual([404, "no-thread"]);
    }
    expect(await count("SELECT COUNT(*) AS n FROM events")).toBe(events);
  });

  it("clears it, keeping what it was", async () => {
    const n = await thread();
    await remind(n, { start: today(), every: 14 });
    expect((await remind(n, { start: null, every: null })).reminder).toBeNull();
    expect((await reminderEvents(n)).at(-1)).toMatchObject({ type: "reminder-cleared", data: { from: { start: today(), on: today(), every: 14 } } });
    expect((await listed()).reminders).toEqual([]);
  });
});

describe("Later", () => {
  it("moves one time and keeps the series, so Done lands back on its day", async () => {
    const n = await thread();
    await remind(n, { start: today(), every: 7 });
    const later = await remind(n, { snooze: addDays(today(), 1) });
    expect(later.reminder).toEqual({ start: today(), on: addDays(today(), 1), every: 7 });
    expect((await reminderEvents(n)).at(-1)).toMatchObject({ type: "reminder-snoozed", data: { from: today(), to: addDays(today(), 1) } });
    const done = await remind(n, { action: "done", on: addDays(today(), 1) });
    expect(done.reminder).toEqual({ start: today(), on: addDays(today(), 7), every: 7 });
  });

  it("refuses a day gone by, and takes today", async () => {
    const n = await thread();
    await remind(n, { start: addDays(today(), 3), every: null });
    expect(await reasonOf(await call(`/threads/${n}/reminder`, { body: { snooze: addDays(today(), -1) } }))).toEqual([400, "reminder"]);
    expect((await remind(n, { snooze: today() })).reminder?.on).toBe(today());
  });
});

describe("Done", () => {
  it("on the day goes to the next time on its rhythm, and ends a reminder for once", async () => {
    const weekly = await thread();
    await remind(weekly, { start: today(), every: 7 });
    expect((await remind(weekly, { action: "done", on: today() })).reminder).toEqual({ start: today(), on: addDays(today(), 7), every: 7 });
    expect((await reminderEvents(weekly)).at(-1)).toMatchObject({ actor: "owner", type: "reminder-done", data: { day: today(), next: addDays(today(), 7) } });

    const once = await thread();
    await remind(once, { start: today(), every: null });
    const ended = await remind(once, { action: "done", on: today() }, "sync");
    expect(ended.reminder).toBeNull();
    expect((await reminderEvents(once)).at(-1)).toMatchObject({ actor: "sync", type: "reminder-done", data: { day: today(), next: null } });
  });

  it("late, after missed weeks, lands on the next time after today and never on a missed one", async () => {
    const n = await thread();
    await remind(n, { start: today(), every: 7 });
    await backdate(n, addDays(today(), -21), addDays(today(), -14));
    const due = (await listed()).reminders.find((one) => one.number === n);
    expect([due?.due, due?.dueSince]).toEqual([true, addDays(today(), -14)]);
    expect((await remind(n, { action: "done", on: addDays(today(), -14) })).reminder?.on).toBe(addDays(today(), 7));
  });

  it("early skips that time", async () => {
    const n = await thread();
    await remind(n, { start: addDays(today(), 3), every: 7 });
    expect((await remind(n, { action: "done", on: addDays(today(), 3) })).reminder?.on).toBe(addDays(today(), 10));
  });

  it("twice for the same day, racing or not, advances once and refuses the other as stale", async () => {
    const n = await thread();
    await remind(n, { start: today(), every: 7 });
    const both = await Promise.all([1, 2].map(() => call(`/threads/${n}/reminder`, { body: { action: "done", on: today() } })));
    expect(both.map((one) => one.status).sort()).toEqual([200, 409]);
    expect((await shown(n)).thread.reminder?.on).toBe(addDays(today(), 7));
    expect((await reminderEvents(n)).filter((event) => event.type === "reminder-done")).toHaveLength(1);
    expect(await reasonOf(await call(`/threads/${n}/reminder`, { body: { action: "done", on: today() } }))).toEqual([409, "stale"]);
    expect((await shown(n)).thread.reminder?.on).toBe(addDays(today(), 7));
  });
});

describe("the reminders' list", () => {
  it("answers today in his zone and every reminder soonest first, due or not, on any status", async () => {
    const [ahead, overdue, onDone, none] = [await thread({ title: "Ahead" }), await thread({ title: "Overdue" }), await thread({ title: "On a done one", status: "act" }), await thread()];
    await remind(ahead, { start: addDays(today(), 2), every: null });
    await remind(overdue, { start: today(), every: 7 });
    await backdate(overdue, addDays(today(), -9), addDays(today(), -2));
    await answer(await call(`/threads/${onDone}`, { body: { action: "done" } }));
    await remind(onDone, { start: today(), every: 1 });
    expect((await shown(onDone)).thread.status).toBe("done");
    const read = await listed("sync");
    expect(read.today).toBe(today());
    expect(read.reminders).toEqual([
      { number: overdue, title: "Overdue", status: "act", reminder: { start: addDays(today(), -9), on: addDays(today(), -2), every: 7 }, due: true, dueSince: addDays(today(), -2) },
      { number: onDone, title: "On a done one", status: "done", reminder: { start: today(), on: today(), every: 1 }, due: true, dueSince: null },
      { number: ahead, title: "Ahead", status: "act", reminder: { start: addDays(today(), 2), on: addDays(today(), 2), every: null }, due: false, dueSince: null },
    ]);
    expect(read.reminders.some((one) => one.number === none)).toBe(false);
  });

  it("keeps a dropped thread's reminder, never due, until it is reopened", async () => {
    const n = await thread();
    await remind(n, { start: today(), every: 7 });
    await answer(await call(`/threads/${n}`, { body: { action: "drop", reason: "" } }));
    expect((await listed()).reminders.map((one) => [one.number, one.status, one.due])).toEqual([[n, "dropped", false]]);
    await answer(await call(`/threads/${n}`, { body: { action: "reopen" } }));
    expect((await listed()).reminders.map((one) => one.due)).toEqual([true]);
  });
});

describe("who may", () => {
  it("refuses an invited person both calls before anything is read, even on their own thread", async () => {
    const n = await thread();
    await remind(n, { start: today(), every: 7 });
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    const meera = { as: { email: MEERA } } as const;
    const events = await count("SELECT COUNT(*) AS n FROM events");
    for (const number of [n, 999]) {
      for (const body of [{ start: today(), every: 1 }, { snooze: addDays(today(), 1) }, { action: "done", on: today() }]) {
        expect(await reasonOf(await call(`/threads/${number}/reminder`, { ...meera, body }))).toEqual([403, "owner-only"]);
      }
    }
    expect(await reasonOf(await call("/reminders", meera))).toEqual([403, "owner-only"]);
    expect(await count("SELECT COUNT(*) AS n FROM events")).toBe(events);
  });

  it("takes the owner's writes only from his own page, the sync's from anywhere, and nobody signed out", async () => {
    const n = await thread();
    expect(await reasonOf(await call(`/threads/${n}/reminder`, { body: { start: today(), every: 7 }, origin: "https://example.com" }))).toEqual([403, "origin"]);
    expect((await remind(n, { start: today(), every: 7 }, "sync")).reminder?.every).toBe(7);
    for (const path of [`/threads/api/threads/${n}/reminder`, "/threads/api/reminders"]) {
      const signedOut = await harness.fetch(`${THREADS}${path}`, path.endsWith("reminder") ? { method: "POST", headers: { "Content-Type": "application/json", Origin: THREADS }, body: "{}" } : {});
      expect(signedOut.status).toBe(401);
    }
  });

  it("answers the list to GET alone and the change to POST alone", async () => {
    const n = await thread();
    const got = await call(`/threads/${n}/reminder`);
    expect([got.status, got.headers.get("Allow")]).toEqual([405, "POST"]);
    const posted = await call("/reminders", { body: {} });
    expect([posted.status, posted.headers.get("Allow")]).toEqual([405, "GET"]);
  });

  it("answers an invited person's last word when the owner changes a reminder, and not when the sync does", async () => {
    const n = await thread();
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    await tick();
    await answer(await call(`/threads/${n}/comments`, { as: { email: MEERA }, body: { body: "Monday works." } }), 201);
    const waiting = async (): Promise<boolean> =>
      ((await answer<{ threads: (Thread & { waiting: boolean })[] }>(await call("/threads?tab=act"))).threads.find((row) => row.number === n)?.waiting ?? false);
    expect(await waiting()).toBe(true);
    await remind(n, { start: today(), every: 7 }, "sync");
    expect(await waiting()).toBe(true);
    await tick();
    await remind(n, { action: "done", on: today() });
    expect(await waiting()).toBe(false);
  });
});

describe("what others read", () => {
  it("never shows an invited person a reminder: not on the thread, their list, a collection shared with them or its history", async () => {
    const n = await thread();
    await remind(n, { start: today(), every: 7 });
    await remind(n, { snooze: addDays(today(), 1) });
    await remind(n, { action: "done", on: addDays(today(), 1) });
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    const c = (await answer<{ collection: { number: number } }>(await call("/collections", { body: { name: "Shared" } }), 201)).collection.number;
    await answer(await call(`/collections/${c}/threads`, { body: { add: n } }));
    await answer(await call(`/collections/${c}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    const meera = { as: { email: MEERA } } as const;
    const theirs = await shown(n, meera.as);
    expect("reminder" in theirs.thread).toBe(false);
    expect(theirs.events.some((event) => event.type.startsWith("reminder-"))).toBe(false);
    for (const path of [`/threads/${n}`, "/threads", `/collections/${c}`, "/collections"]) {
      const text = await (await call(path, meera)).text();
      expect([path, /remind/i.test(text)]).toEqual([path, false]);
    }
    expect((await reminderEvents(n)).map((event) => event.type)).toEqual(["reminder-set", "reminder-snoozed", "reminder-done"]);
  });

  it("never shows a stranger one: not on a public thread, a public collection or an ask", async () => {
    const pub = await thread({ title: "Public" });
    await answer(await call(`/threads/${pub}`, { body: { action: "publish" } }));
    await remind(pub, { start: today(), every: 7 });
    const key = (await shown(pub)).thread as Thread & { shareKey: string };
    const c = (await answer<{ collection: { number: number } }>(await call("/collections", { body: { name: "Open" } }), 201)).collection.number;
    await answer(await call(`/collections/${c}/threads`, { body: { add: pub } }));
    const collectionKey = (await answer<{ collection: { shareKey: string } }>(await call(`/collections/${c}`, { body: { public: true } }))).collection.shareKey;

    const asked = await thread({ title: "Asked" });
    const saved = await harness.fetch(`${THREADS}/threads/api/threads/${asked}/pages`, {
      method: "POST",
      headers: { "Content-Type": "text/html; charset=utf-8", "Cf-Access-Jwt-Assertion": token("sync") },
      body: new TextEncoder().encode(QUESTIONS),
    });
    expect(saved.status).toBe(201);
    await answer(await call(`/threads/${asked}/ask`, { as: "sync", body: { slug: "reminded" } }));
    await answer(await call(`/threads/${asked}/ask`, { body: { action: "open" } }));
    await remind(asked, { start: today(), every: 7 });

    for (const path of [`/api/threads/${key.shareKey}`, `/api/collections/${collectionKey}`, `/api/collections/${collectionKey}/threads/${pub}`, "/api/asks/reminded"]) {
      const response = await harness.fetch(`${THREADS}${path}`);
      const text = await response.text();
      expect([path, response.status, /remind/i.test(text.replaceAll("reminded", ""))]).toEqual([path, 200, false]);
    }
  });
});
