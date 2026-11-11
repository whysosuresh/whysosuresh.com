// Meetings, run as production runs them: the Worker's bundle in workerd (test/harness.ts), with a local D1 and
// Cloudflare Access played for the threads' application. What it holds: any thread can be one meeting, set by the
// owner from his own page and by the sync, and every shape of a thread says so (`meeting`, null while it isn't one:
// a thread's call, a tab's rows, a search, a person's threads). Its when is a day, kept as given, or a moment with
// its zone, kept as its instant in UTC; a day that isn't on the calendar, a time with no zone, a year outside 2000 to
// 2100, and every malformed length or where are refused, and nothing is written. Each change is an event: a set
// keeps where the meeting moved from (`from`), a clear takes its people off first, each with their own event, and a
// thread that is no meeting can't be cleared or attended. People are added by number, or by name as someone new,
// a new person every time with no address, made only when the add is kept; added twice changes nothing; taken off
// twice is refused. Its people read in one order, by name ignoring case, then by number. The calls are the owner's
// and the sync's: an invited person is refused before anything is read, a GET isn't taken, the owner's writes come
// only from his own page, and signed out nobody gets in. His own changes on a shared thread answer an invited
// person's last word ("waiting"), and the sync's don't. What invited people and strangers read of a meeting is
// test/members.test.ts's and test/public.test.ts's.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { THREADS, startHarness, type Harness } from "./harness.ts";

const MEERA = "meera@example.com";

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
  const body = { ref: `chat:meetings-${refs}`, source: "self", title: `Thread ${refs}`, body: `Body ${refs}`, space: "company", status: "act", ...fields };
  return (await answer<{ thread: { number: number } }>(await call("/threads", { as: "sync", body }), 201)).thread.number;
}

/** A told thread, which makes its teller a person with no address; answers their number. */
async function told(name: string): Promise<number> {
  refs += 1;
  const body = { ref: `chat:meetings-${refs}`, source: "told", name, title: `Told ${refs}`, body: "Said so.", space: "company", status: "act" };
  return (await answer<{ thread: { senderNumber: number } }>(await call("/threads", { as: "sync", body }), 201)).thread.senderNumber;
}

interface Meeting {
  when: string;
  minutes: number | null;
  where: string | null;
  attendees: { number?: number; name: string | null }[];
}

interface Thread {
  number: number;
  meeting: Meeting | null;
  activityAt: string;
  movedAt: string | null;
}

interface Event {
  id: number;
  actor: string;
  type: string;
  data: Record<string, unknown>;
}

/** Sets a thread's meeting as `as` does; answers the thread. */
async function meet(number: number, change: { when: string | null; minutes?: number | null; where?: string | null }, as: Who = "owner"): Promise<Thread> {
  const body = { minutes: null, where: null, ...change };
  return (await answer<{ thread: Thread }>(await call(`/threads/${number}/meeting`, { as, body }))).thread;
}

/** Changes a meeting's people as `as` does; answers the thread. */
async function attendees(number: number, change: unknown, as: Who = "owner"): Promise<Thread> {
  return (await answer<{ thread: Thread }>(await call(`/threads/${number}/attendees`, { as, body: change }))).thread;
}

async function shown(number: number, as: Who = "owner"): Promise<{ thread: Thread; events: Event[] }> {
  return answer(await call(`/threads/${number}`, { as }));
}

/** A thread's events of the meeting's own kinds, oldest first. */
async function meetingEvents(number: number): Promise<Event[]> {
  return (await shown(number)).events.filter((event) => event.type.startsWith("meeting-") || event.type.startsWith("attendee-"));
}

describe("a meeting's when", () => {
  it("keeps a day as given, with its time not set, and every thread that isn't one says null", async () => {
    const [n, other] = [await thread(), await thread()];
    expect((await shown(other)).thread.meeting).toBeNull();
    expect(await meet(n, { when: "2026-11-09" })).toMatchObject({ meeting: { when: "2026-11-09", minutes: null, where: null, attendees: [] } });
    expect((await shown(n)).thread.meeting).toEqual({ when: "2026-11-09", minutes: null, where: null, attendees: [] });
  });

  it("keeps a moment as its instant in UTC, whatever zone it was given in, with its length and where", async () => {
    const n = await thread();
    const kept = await meet(n, { when: "2026-11-09T15:00+05:30", minutes: 45, where: "  Asha's office  " });
    expect(kept.meeting).toEqual({ when: "2026-11-09T09:30:00.000Z", minutes: 45, where: "Asha's office", attendees: [] });
    expect((await meet(n, { when: "2026-11-09T01:15:30.5-08:00" })).meeting?.when).toBe("2026-11-09T09:15:30.500Z");
    expect((await meet(n, { when: "2026-11-09T09:30Z" })).meeting?.when).toBe("2026-11-09T09:30:00.000Z");
    // A moment early in the day east of UTC is the day before in UTC.
    expect((await meet(n, { when: "2026-11-10T01:00+05:30" })).meeting?.when).toBe("2026-11-09T19:30:00.000Z");
  });

  it("refuses a day that isn't on the calendar, a time with no zone, a year out of range and every other shape, writing nothing", async () => {
    const n = await thread();
    const before = await count("SELECT COUNT(*) AS n FROM events");
    const wrong: unknown[] = [
      { when: "2026-02-30", minutes: null, where: null },
      { when: "2026-02-29", minutes: null, where: null },
      { when: "2026-13-01", minutes: null, where: null },
      { when: "2026-11-09T15:00", minutes: null, where: null },
      { when: "2026-11-09T15:00:00", minutes: null, where: null },
      { when: "2026-11-09 15:00Z", minutes: null, where: null },
      { when: "2026-11-09T24:00Z", minutes: null, where: null },
      { when: "2026-11-09T15:60Z", minutes: null, where: null },
      { when: "2026-11-09T15:00+15:00", minutes: null, where: null },
      { when: "2026-02-30T15:00Z", minutes: null, where: null },
      { when: "1999-12-31", minutes: null, where: null },
      { when: "2101-01-01", minutes: null, where: null },
      { when: "2000-01-01T01:00+05:30", minutes: null, where: null },
      { when: "9 Nov", minutes: null, where: null },
      { when: "", minutes: null, where: null },
      { when: 20261109, minutes: null, where: null },
      { when: "2026-11-09", minutes: 4, where: null },
      { when: "2026-11-09", minutes: 1441, where: null },
      { when: "2026-11-09", minutes: 30.5, where: null },
      { when: "2026-11-09", minutes: "30", where: null },
      { when: "2026-11-09", minutes: null, where: "" },
      { when: "2026-11-09", minutes: null, where: "x".repeat(201) },
      { when: "2026-11-09", minutes: null, where: "Two\nlines" },
      { when: null, minutes: 30, where: null },
      { when: null, minutes: null, where: "Somewhere" },
      { when: "2026-11-09", minutes: null },
      { when: "2026-11-09", minutes: null, where: null, with: [] },
      "2026-11-09",
      null,
    ];
    for (const body of wrong) expect([body, ...(await reasonOf(await call(`/threads/${n}/meeting`, { body })))]).toEqual([body, 400, "meeting"]);
    expect(await count("SELECT COUNT(*) AS n FROM events")).toBe(before);
    expect((await shown(n)).thread.meeting).toBeNull();
  });

  it("takes the first and last years and the widest zones", async () => {
    const n = await thread();
    expect((await meet(n, { when: "2000-01-01" })).meeting?.when).toBe("2000-01-01");
    expect((await meet(n, { when: "2100-12-31T23:59Z" })).meeting?.when).toBe("2100-12-31T23:59:00.000Z");
    expect((await meet(n, { when: "2026-11-09T12:00+14:00" })).meeting?.when).toBe("2026-11-08T22:00:00.000Z");
    expect((await meet(n, { when: "2026-11-09", minutes: 5, where: "x".repeat(200) })).meeting?.minutes).toBe(5);
    expect((await meet(n, { when: "2026-11-09", minutes: 1440 })).meeting?.minutes).toBe(1440);
  });

  it("is on a tab's rows, a search's threads and a person's threads", async () => {
    const asha = await told("Asha");
    const n = await thread({ title: "Plan the demo" });
    await meet(n, { when: "2026-11-09" });
    await attendees(n, { add: { person: asha } });
    const expected = { when: "2026-11-09", minutes: null, where: null, attendees: [{ number: asha, name: "Asha" }] };
    const tab = await answer<{ threads: Thread[] }>(await call("/threads?tab=act"));
    expect(tab.threads.find((row) => row.number === n)?.meeting).toEqual(expected);
    expect(tab.threads.filter((row) => row.number !== n).every((row) => row.meeting === null)).toBe(true);
    const found = await answer<{ threads: Thread[] }>(await call("/search?q=demo"));
    expect(found.threads.map((row) => row.meeting)).toEqual([expected]);
    const person = await answer<{ threads: (Thread & { roles: string[] })[] }>(await call(`/people/${asha}`));
    expect(person.threads.find((row) => row.number === n)).toMatchObject({ meeting: expected, roles: ["met"] });
  });
});

describe("setting and clearing a meeting", () => {
  it("writes meeting-set with where it moved from, and stamps the thread's activity but not a move", async () => {
    const n = await thread();
    const start = (await shown(n)).thread;
    await tick();
    const first = await meet(n, { when: "2026-11-09" });
    expect(first.activityAt > start.activityAt).toBe(true);
    expect(first.movedAt).toBe(start.movedAt);
    await meet(n, { when: "2026-11-10T09:30Z", minutes: 30, where: "Meet" }, "sync");
    await meet(n, { when: "2026-11-10T09:30Z", minutes: 30, where: "Meet" });
    expect((await meetingEvents(n)).map(({ actor, type, data }) => ({ actor, type, data }))).toEqual([
      { actor: "owner", type: "meeting-set", data: { from: null, to: { when: "2026-11-09", minutes: null, where: null } } },
      {
        actor: "sync",
        type: "meeting-set",
        data: { from: { when: "2026-11-09", minutes: null, where: null }, to: { when: "2026-11-10T09:30:00.000Z", minutes: 30, where: "Meet" } },
      },
      // Set again to what it is: still what was asked, so still written.
      {
        actor: "owner",
        type: "meeting-set",
        data: { from: { when: "2026-11-10T09:30:00.000Z", minutes: 30, where: "Meet" }, to: { when: "2026-11-10T09:30:00.000Z", minutes: 30, where: "Meet" } },
      },
    ]);
  });

  it("clears it, taking everyone off it first, each with an event, and then can't clear it again", async () => {
    const [asha, dev] = [await told("Asha"), await told("Dev")];
    const n = await thread();
    await meet(n, { when: "2026-11-09", minutes: 60, where: "Office" });
    await attendees(n, { add: { person: dev } });
    await attendees(n, { add: { person: asha } });
    const cleared = await meet(n, { when: null });
    expect(cleared.meeting).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM attendees")).toBe(0);
    const events = (await meetingEvents(n)).slice(3).map(({ type, data }) => ({ type, data }));
    expect(events).toEqual([
      { type: "attendee-removed", data: { person: asha, name: "Asha" } },
      { type: "attendee-removed", data: { person: dev, name: "Dev" } },
      { type: "meeting-cleared", data: { from: { when: "2026-11-09", minutes: 60, where: "Office" } } },
    ]);
    const before = await count("SELECT COUNT(*) AS n FROM events");
    expect(await reasonOf(await call(`/threads/${n}/meeting`, { body: { when: null, minutes: null, where: null } }))).toEqual([409, "not-a-meeting"]);
    expect(await count("SELECT COUNT(*) AS n FROM events")).toBe(before);
    // Set again, it starts with no one in it.
    expect((await meet(n, { when: "2026-11-12" })).meeting?.attendees).toEqual([]);
  });

  it("answers a thread that isn't there with 404 on both calls, writing nothing", async () => {
    expect(await reasonOf(await call("/threads/999/meeting", { body: { when: "2026-11-09", minutes: null, where: null } }))).toEqual([404, "no-thread"]);
    expect(await reasonOf(await call("/threads/999/meeting", { body: { when: null, minutes: null, where: null } }))).toEqual([404, "no-thread"]);
    expect(await reasonOf(await call("/threads/999/attendees", { body: { add: { name: "Leela" } } }))).toEqual([404, "no-thread"]);
    expect(await reasonOf(await call("/threads/999/attendees", { body: { remove: 1 } }))).toEqual([404, "no-thread"]);
    expect(await reasonOf(await call("/threads/x1/meeting", { body: { when: "2026-11-09", minutes: null, where: null } }))).toEqual([404, "no-thread"]);
    expect([await count("SELECT COUNT(*) AS n FROM events"), await count("SELECT COUNT(*) AS n FROM people")]).toEqual([0, 0]);
  });
});

describe("a meeting's people", () => {
  it("adds a person by number once, with an event, and adding them again changes nothing", async () => {
    const asha = await told("Asha");
    const n = await thread();
    const set = await meet(n, { when: "2026-11-09" });
    await tick();
    const added = await attendees(n, { add: { person: asha } });
    expect(added.meeting?.attendees).toEqual([{ number: asha, name: "Asha" }]);
    expect(added.activityAt > set.activityAt).toBe(true);
    const again = await attendees(n, { add: { person: asha } }, "sync");
    expect(again).toEqual(added);
    expect((await meetingEvents(n)).filter((event) => event.type === "attendee-added").map(({ actor, data }) => ({ actor, data }))).toEqual([
      { actor: "owner", data: { person: asha, name: "Asha" } },
    ]);
    // Being in a meeting is not being invited.
    expect(await count("SELECT COUNT(*) AS n FROM members")).toBe(0);
  });

  it("makes someone new for every name, with no address, each with their own number", async () => {
    const asha = await told("Asha");
    const n = await thread();
    await meet(n, { when: "2026-11-09" });
    await attendees(n, { add: { name: "  Asha  " } });
    const both = await attendees(n, { add: { name: "Asha" } }, "sync");
    const numbers = (both.meeting?.attendees ?? []).map((person) => person.number);
    expect(both.meeting?.attendees.map((person) => person.name)).toEqual(["Asha", "Asha"]);
    expect(new Set([asha, ...numbers]).size).toBe(3);
    expect(await count("SELECT COUNT(*) AS n FROM people WHERE email IS NULL AND name = 'Asha'")).toBe(3);
  });

  it("refuses a thread that is no meeting, making nobody, and a number nobody has", async () => {
    const n = await thread();
    expect(await reasonOf(await call(`/threads/${n}/attendees`, { body: { add: { name: "Leela" } } }))).toEqual([409, "not-a-meeting"]);
    expect(await reasonOf(await call(`/threads/${n}/attendees`, { body: { add: { person: 1 } } }))).toEqual([409, "not-a-meeting"]);
    expect(await reasonOf(await call(`/threads/${n}/attendees`, { body: { remove: 1 } }))).toEqual([409, "not-a-meeting"]);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
    await meet(n, { when: "2026-11-09" });
    const before = await count("SELECT COUNT(*) AS n FROM events");
    expect(await reasonOf(await call(`/threads/${n}/attendees`, { body: { add: { person: 42 } } }))).toEqual([404, "no-person"]);
    expect([await count("SELECT COUNT(*) AS n FROM events"), await count("SELECT COUNT(*) AS n FROM attendees")]).toEqual([before, 0]);
  });

  it("takes a person off with an event, and refuses taking them off again", async () => {
    const [asha, dev] = [await told("Asha"), await told("Dev")];
    const n = await thread();
    await meet(n, { when: "2026-11-09" });
    await attendees(n, { add: { person: asha } });
    await attendees(n, { add: { person: dev } });
    const left = await attendees(n, { remove: asha }, "sync");
    expect(left.meeting?.attendees).toEqual([{ number: dev, name: "Dev" }]);
    expect((await meetingEvents(n)).at(-1)).toMatchObject({ actor: "sync", type: "attendee-removed", data: { person: asha, name: "Asha" } });
    const before = await count("SELECT COUNT(*) AS n FROM events");
    expect(await reasonOf(await call(`/threads/${n}/attendees`, { body: { remove: asha } }))).toEqual([409, "not-attending"]);
    expect(await reasonOf(await call(`/threads/${n}/attendees`, { body: { remove: 77 } }))).toEqual([409, "not-attending"]);
    expect(await count("SELECT COUNT(*) AS n FROM events")).toBe(before);
    // A person's meeting rows go, and the person stays.
    expect(await count("SELECT COUNT(*) AS n FROM people WHERE number = ?1", asha)).toBe(1);
  });

  it("reads in one order: by name ignoring case, then by number, someone with no name last", async () => {
    const zed = await told("zed");
    const n = await thread();
    await meet(n, { when: "2026-11-09" });
    await attendees(n, { add: { person: zed } });
    for (const name of ["Bea", "al", "Al"]) await attendees(n, { add: { name } });
    // A visitor who typed only an address is a person with no name.
    await (await harness.db()).prepare("INSERT INTO people (id, number, email, name, created_at) VALUES ('p-nameless', 90, 'x@example.com', NULL, '2026-11-01T00:00:00.000Z')").run();
    const all = await attendees(n, { add: { person: 90 } });
    expect(all.meeting?.attendees.map((person) => person.name)).toEqual(["al", "Al", "Bea", "zed", null]);
    const [first, second] = all.meeting?.attendees ?? [];
    expect((first?.number ?? 0) < (second?.number ?? 0)).toBe(true);
  });

  it("refuses every other shape of change", async () => {
    const n = await thread();
    await meet(n, { when: "2026-11-09" });
    const wrong: unknown[] = [
      {},
      { add: { person: 0 } },
      { add: { person: 1.5 } },
      { add: { person: "1" } },
      { add: { name: "" } },
      { add: { name: "   " } },
      { add: { name: "x".repeat(81) } },
      { add: { name: "Two\nlines" } },
      { add: { person: 1, name: "Asha" } },
      { add: { email: MEERA, name: "Meera" } },
      { remove: "1" },
      { remove: 0 },
      { add: { person: 1 }, remove: 1 },
      [],
    ];
    for (const body of wrong) expect([body, ...(await reasonOf(await call(`/threads/${n}/attendees`, { body })))]).toEqual([body, 400, "attendee"]);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
  });
});

describe("who may change a meeting", () => {
  it("is the owner from his own page and the sync from anywhere", async () => {
    const n = await thread();
    const body = { when: "2026-11-09", minutes: null, where: null };
    for (const origin of [null, "https://elsewhere.example"]) {
      expect(await reasonOf(await call(`/threads/${n}/meeting`, { body, origin }))).toEqual([403, "origin"]);
      expect(await reasonOf(await call(`/threads/${n}/attendees`, { body: { add: { name: "Leela" } }, origin }))).toEqual([403, "origin"]);
    }
    expect((await shown(n)).thread.meeting).toBeNull();
    expect((await answer<{ thread: Thread }>(await call(`/threads/${n}/meeting`, { as: "sync", body, origin: null }))).thread.meeting?.when).toBe("2026-11-09");
    expect((await answer<{ thread: Thread }>(await call(`/threads/${n}/attendees`, { as: "sync", body: { add: { name: "Leela" } }, origin: null }))).thread.meeting?.attendees).toEqual([
      { number: 1, name: "Leela" },
    ]);
  });

  it("refuses an invited person before anything is read, on their own thread and on a number never used", async () => {
    const n = await thread();
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    await meet(n, { when: "2026-11-09" });
    const meera = { as: { email: MEERA } } as const;
    const before = await count("SELECT COUNT(*) AS n FROM events");
    for (const number of [n, 999]) {
      expect(await reasonOf(await call(`/threads/${number}/meeting`, { ...meera, body: { when: null, minutes: null, where: null } }))).toEqual([403, "owner-only"]);
      expect(await reasonOf(await call(`/threads/${number}/attendees`, { ...meera, body: { add: { name: "Leela" } } }))).toEqual([403, "owner-only"]);
    }
    expect(await count("SELECT COUNT(*) AS n FROM events")).toBe(before);
    expect((await shown(n)).thread.meeting?.when).toBe("2026-11-09");
  });

  it("takes no GET, and lets nobody in signed out", async () => {
    const n = await thread();
    for (const part of ["meeting", "attendees"]) {
      const got = await call(`/threads/${n}/${part}`);
      expect([got.status, got.headers.get("Allow")]).toEqual([405, "POST"]);
      const signedOut = await harness.fetch(`${THREADS}/threads/api/threads/${n}/${part}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: THREADS },
        body: JSON.stringify({ when: "2026-11-09", minutes: null, where: null }),
      });
      expect(signedOut.status).toBe(401);
    }
    expect((await shown(n)).thread.meeting).toBeNull();
  });

  it("answers an invited person's last word when the owner changes the meeting, and not when the sync does", async () => {
    const n = await thread();
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    await tick();
    await answer(await call(`/threads/${n}/comments`, { as: { email: MEERA }, body: { body: "Monday works." } }), 201);
    const waiting = async (): Promise<boolean> =>
      ((await answer<{ threads: (Thread & { waiting: boolean })[] }>(await call("/threads?tab=act"))).threads.find((row) => row.number === n)?.waiting ?? false);
    expect(await waiting()).toBe(true);
    await meet(n, { when: "2026-11-09" }, "sync");
    expect(await waiting()).toBe(true);
    await tick();
    await meet(n, { when: "2026-11-09" });
    expect(await waiting()).toBe(false);
  });
});
