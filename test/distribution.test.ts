// Distribution's calls, run as production runs them: the Worker's bundle in workerd (test/harness.ts), with a local D1
// and Cloudflare Access played for the threads' application. What it holds: the sync writes an act once by its
// origin (a second write answers 200 with the act already there and makes nobody), names its person by number (404
// for a number nobody has, writing nothing), by a name one person has (joining them) or by a name two people share or
// nobody has (a new person with no address, who then counts it); a void sets `voided_at` once, and a voided act is in
// no read and no count; every field outside its shape is refused 400 naming it, and an act over its cap 413; a
// platform write replaces the row and leaves its `event` act; a reading replaces its week's; the room answers one
// product's platforms, its acts of the last 35 days newest first (or since a day, at most 90 back), its readings, the
// open threads of the collection named Distribution in its space, and the newest Engage log thread; the owner reads
// and is refused every write with `sync-only`, from his own page or not; an invited person is refused every call
// with `owner-only` before anything is read; signed out nobody gets in; and a wrong method or path is refused.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { THREADS, startHarness, type Harness } from "./harness.ts";

const KIRAN = "kiran@example.com";

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

/** A call under /threads/api/, by its path after that; a body makes it a POST, from the site's own page unless told otherwise. */
async function call(path: string, request: { as?: Who; body?: unknown; origin?: string | null; raw?: string; method?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(request.as ?? "owner") };
  if (request.body === undefined && request.raw === undefined) return harness.fetch(`${THREADS}/threads/api${path}`, { headers, method: request.method ?? "GET" });
  headers["Content-Type"] = "application/json";
  if (request.origin !== null) headers.Origin = request.origin ?? THREADS;
  const body = request.raw ?? JSON.stringify(request.body);
  return harness.fetch(`${THREADS}/threads/api${path}`, { method: request.method ?? "POST", headers, body: new TextEncoder().encode(body) });
}

async function answer<T>(response: Response, status = 200): Promise<T> {
  const text = await response.text();
  expect([response.status, text]).toEqual([status, expect.any(String)]);
  return JSON.parse(text) as T;
}

async function reasonOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { reason: string }).reason];
}

interface Act {
  id: string;
  ref: string;
  at: string;
  product: string;
  platform: string;
  kind: string;
  audience: string | null;
  url: string | null;
  conversation: string | null;
  person: { number: number; name: string | null } | null;
  line: string;
  createdAt: string;
  voidedAt: string | null;
}

interface Room {
  product: string;
  since: string;
  platforms: { platform: string; state: string; note: string | null; until: string | null; pace: number | null; changedAt: string }[];
  acts: Act[];
  truncated: boolean;
  readings: { metric: string; week: string; value: number; readAt: string }[];
  work: { collection: number | null; threads: { number: number; title: string; place: number }[] };
  log: { number: number; title: string | null } | null;
}

/** Now, `days` days back, as an instant. */
function ago(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

let refs = 0;
/** An act as the sync writes it, with every required field and the ones given. */
function actOf(fields: Record<string, unknown> = {}): Record<string, unknown> {
  refs += 1;
  return { ref: `engage:run-${refs}`, at: ago(1), product: "stigmer", platform: "bluesky", kind: "reply", line: `Replied ${refs}.`, ...fields };
}

async function write(fields: Record<string, unknown> = {}, status = 201): Promise<Act> {
  return (await answer<{ act: Act }>(await call("/distribution/acts", { as: "sync", body: actOf(fields) }), status)).act;
}

async function room(query = "?product=stigmer", as: Who = "owner"): Promise<Room> {
  return answer<Room>(await call(`/distribution${query}`, { as }));
}

interface Person {
  number: number;
  name: string | null;
  email: string | null;
  lastContact: string;
  dropped: boolean;
  counts: Record<string, number>;
}

async function person(number: number): Promise<{ person: Person; acts: Act[] }> {
  return answer(await call(`/people/${number}`, { as: "sync" }));
}

async function everyone(): Promise<Person[]> {
  return (await answer<{ people: Person[] }>(await call("/people", { as: "sync" }))).people;
}

describe("an act", () => {
  it("is kept once by its origin: a second write answers the act already there and changes nothing", async () => {
    const fields = actOf({ audience: "peer", url: "https://bsky.app/profile/someone/post/1", conversation: "https://bsky.app/profile/someone/post/0" });
    const first = (await answer<{ act: Act }>(await call("/distribution/acts", { as: "sync", body: fields }), 201)).act;
    expect(first).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      ref: fields.ref,
      at: fields.at,
      product: "stigmer",
      platform: "bluesky",
      kind: "reply",
      audience: "peer",
      url: "https://bsky.app/profile/someone/post/1",
      conversation: "https://bsky.app/profile/someone/post/0",
      person: null,
      line: fields.line,
      createdAt: expect.any(String),
      voidedAt: null,
    });
    const again = (await answer<{ act: Act }>(await call("/distribution/acts", { as: "sync", body: { ...fields, line: "Something else." } }), 200)).act;
    expect(again).toEqual(first);
    expect((await room()).acts).toEqual([first]);
  });

  it("stores its moment as its instant in UTC, whatever zone it was written in", async () => {
    const act = await write({ at: "2026-11-18T09:30+05:30" }, 201);
    expect(act.at).toBe("2026-11-18T04:00:00.000Z");
  });

  it("names a person by number, and is refused 404 with nothing written for a number nobody has", async () => {
    const made = await write({ person: { name: "Kiran Rao" } });
    const number = made.person?.number ?? 0;
    expect(made.person).toEqual({ number, name: "Kiran Rao" });
    const byNumber = await write({ person: number });
    expect(byNumber.person).toEqual({ number, name: "Kiran Rao" });
    const before = (await room()).acts.length;
    expect(await reasonOf(await call("/distribution/acts", { as: "sync", body: actOf({ person: 999 }) }))).toEqual([404, "no-person"]);
    expect((await room()).acts).toHaveLength(before);
  });

  it("joins the one person who has the name, ignoring case and spaces, and makes a new person when two share it or nobody has it", async () => {
    const first = await write({ person: { name: "Kiran Rao" } });
    const joined = await write({ person: { name: "  kiran rao " } });
    expect(joined.person?.number).toBe(first.person?.number);
    // A second Kiran Rao (a meeting's attendee is always someone new) means the name no longer says who.
    const database = await harness.db();
    await database.prepare("INSERT INTO people (id, number, email, name, created_at) VALUES ('second', 50, NULL, 'Kiran Rao', '2026-11-18T00:00:00.000Z')").run();
    const third = await write({ person: { name: "Kiran Rao" } });
    expect([first.person?.number, 50]).not.toContain(third.person?.number);
    expect((await everyone()).filter((one) => one.name === "Kiran Rao")).toHaveLength(3);
    const fresh = await person(third.person?.number ?? 0);
    expect([fresh.person.email, fresh.person.counts.acted]).toEqual([null, 1]);
    const nobody = await write({ person: { name: "Someone New" } });
    expect((await person(nobody.person?.number ?? 0)).person.email).toBeNull();
  });

  it("makes nobody when its origin is already there", async () => {
    const fields = actOf({ person: { name: "Noor Ali" } });
    await answer(await call("/distribution/acts", { as: "sync", body: fields }), 201);
    await answer(await call("/distribution/acts", { as: "sync", body: { ...fields, person: { name: "Someone Else" } } }), 200);
    expect((await everyone()).map((one) => one.name)).toEqual(["Noor Ali"]);
  });

  it("shows on its person's page and counts toward their last contact, until it is voided", async () => {
    const act = await write({ person: { name: "Noor Ali" }, at: "2026-11-17T10:00:00.000Z" });
    const number = act.person?.number ?? 0;
    const read = await person(number);
    expect(read.acts.map((one) => one.id)).toEqual([act.id]);
    expect([read.person.counts.acted, read.person.dropped]).toEqual([1, false]);
    await answer(await call(`/distribution/acts/${act.id}/void`, { as: "sync", method: "POST" }));
    const after = await person(number);
    expect([after.acts, after.person.counts.acted, after.person.dropped]).toEqual([[], 0, true]);
  });
});

describe("a void", () => {
  it("sets voided_at once, keeps the act out of every read and count, and answers it unchanged the second time", async () => {
    const kept = await write();
    const wrong = await write({ kind: "in", audience: "buyer", person: { name: "Noor Ali" } });
    const voided = (await answer<{ act: Act }>(await call(`/distribution/acts/${wrong.id}/void`, { as: "sync", method: "POST" }))).act;
    expect(voided).toEqual({ ...wrong, voidedAt: expect.any(String) });
    const again = (await answer<{ act: Act }>(await call(`/distribution/acts/${wrong.id}/void`, { as: "sync", method: "POST" }))).act;
    expect(again).toEqual(voided);
    expect((await room()).acts.map((one) => one.id)).toEqual([kept.id]);
    expect((await room(`?product=stigmer&since=${ago(80).slice(0, 10)}`)).acts.map((one) => one.id)).toEqual([kept.id]);
    // Its origin stays taken: writing it again answers the voided act, never a second one.
    expect((await answer<{ act: Act }>(await call("/distribution/acts", { as: "sync", body: actOf({ ref: wrong.ref }) }), 200)).act.voidedAt).not.toBeNull();
  });

  it("answers 404 for an id no act has", async () => {
    expect(await reasonOf(await call("/distribution/acts/00000000-0000-4000-8000-000000000000/void", { as: "sync", method: "POST" }))).toEqual([404, "no-act"]);
    expect(await reasonOf(await call("/distribution/acts/not-an-id/void", { as: "sync", method: "POST" }))).toEqual([404, "no-act"]);
  });
});

describe("what an act may hold", () => {
  const long = `https://www.linkedin.com/feed/update/urn:li:activity:${"7".repeat(19)}?commentUrn=${"x".repeat(400)}`;

  it.each([
    ["act", "[]"],
    ["keys", JSON.stringify({ ref: "engage:a", at: "2026-11-18T00:00:00.000Z", product: "stigmer", platform: "bluesky", kind: "reply" })],
    ["keys", JSON.stringify({ ...actOf(), extra: 1 })],
    ["ref", JSON.stringify(actOf({ ref: "no-colon" }))],
    ["ref", JSON.stringify(actOf({ ref: "platform:stigmer:reddit:x" }))],
    ["ref", JSON.stringify(actOf({ ref: "ask:x" }))],
    ["ref", JSON.stringify(actOf({ ref: `engage:${"x".repeat(191)}` }))],
    ["at", JSON.stringify(actOf({ at: "2026-11-18" }))],
    ["at", JSON.stringify(actOf({ at: "2026-11-18T10:00" }))],
    ["at", JSON.stringify(actOf({ at: "2026-02-30T10:00:00Z" }))],
    ["product", JSON.stringify(actOf({ product: "feed-said-so" }))],
    ["platform", JSON.stringify(actOf({ platform: "Bluesky" }))],
    ["platform", JSON.stringify(actOf({ platform: "-x" }))],
    ["platform", JSON.stringify(actOf({ platform: "a".repeat(31) }))],
    ["kind", JSON.stringify(actOf({ kind: "like" }))],
    ["line", JSON.stringify(actOf({ line: " " }))],
    ["line", JSON.stringify(actOf({ line: "x".repeat(201) }))],
    ["line", JSON.stringify(actOf({ line: "two\nlines" }))],
    ["audience", JSON.stringify(actOf({ audience: "friend" }))],
    ["url", JSON.stringify(actOf({ url: "javascript:alert(1)" }))],
    ["url", JSON.stringify(actOf({ url: "https://example.com/a b" }))],
    ["url", JSON.stringify(actOf({ url: `https://example.com/${"x".repeat(2048)}` }))],
    ["conversation", JSON.stringify(actOf({ conversation: "ftp://example.com" }))],
    ["person", JSON.stringify(actOf({ person: 0 }))],
    ["person", JSON.stringify(actOf({ person: 1.5 }))],
    ["person", JSON.stringify(actOf({ person: { name: "" } }))],
    ["person", JSON.stringify(actOf({ person: { name: "A", email: "a@example.com" } }))],
    ["person", JSON.stringify(actOf({ person: "Kiran" }))],
  ])("refuses 400 %s for %s", async (reason, raw) => {
    expect(await reasonOf(await call("/distribution/acts", { as: "sync", raw }))).toEqual([400, reason]);
    expect((await room()).acts).toEqual([]);
  });

  it("takes a long address, and refuses a body over the act's cap with 413", async () => {
    expect((await write({ url: long })).url).toBe(long);
    expect(await reasonOf(await call("/distribution/acts", { as: "sync", body: actOf({ line: "x".repeat(150), url: `https://example.com/${"x".repeat(2000)}`, conversation: `https://example.com/${"y".repeat(2020)}` }) }))).toEqual([413, "too-large"]);
  });

  it("takes every optional field as null", async () => {
    const act = await write({ audience: null, url: null, conversation: null, person: null });
    expect([act.audience, act.url, act.conversation, act.person]).toEqual([null, null, null, null]);
  });
});

describe("a platform", () => {
  it("is replaced by each write, which leaves its event act in the log", async () => {
    const set = (body: unknown): Promise<Response> => call("/distribution/platforms/stigmer/reddit", { as: "sync", body });
    const first = (await answer<{ platform: Room["platforms"][number] }>(await set({ state: "hold", note: "Posts held back; look again in a month", until: "2026-12-05", pace: null }))).platform;
    expect(first).toEqual({ platform: "reddit", state: "hold", note: "Posts held back; look again in a month", until: "2026-12-05", pace: null, changedAt: expect.any(String) });
    await answer(await set({ state: "active", note: null, until: null, pace: 3 }));
    const read = await room();
    expect(read.platforms).toEqual([{ platform: "reddit", state: "active", note: null, until: null, pace: 3, changedAt: expect.any(String) }]);
    expect(read.acts.map((one) => [one.kind, one.platform, one.line, one.ref.startsWith("platform:stigmer:reddit:")])).toEqual([
      ["event", "reddit", "Now active", true],
      ["event", "reddit", "Now on hold: Posts held back; look again in a month", true],
    ]);
    expect((await room("?product=capsjump")).platforms).toEqual([]);
  });

  it.each([
    ["/distribution/platforms/feed-said-so/reddit", { state: "hold", note: null, until: null, pace: null }, "product"],
    ["/distribution/platforms/stigmer/Reddit", { state: "hold", note: null, until: null, pace: null }, "platform"],
    ["/distribution/platforms/stigmer/reddit", { state: "banned", note: null, until: null, pace: null }, "state"],
    ["/distribution/platforms/stigmer/reddit", { state: "hold", note: "x".repeat(141), until: null, pace: null }, "state"],
    ["/distribution/platforms/stigmer/reddit", { state: "hold", note: null, until: "2026-12-32", pace: null }, "state"],
    ["/distribution/platforms/stigmer/reddit", { state: "hold", note: null, until: null, pace: 15 }, "state"],
    ["/distribution/platforms/stigmer/reddit", { state: "hold", note: null, until: null }, "state"],
  ])("refuses %s with %j", async (path, body, reason) => {
    expect(await reasonOf(await call(path, { as: "sync", body }))).toEqual([400, reason]);
    expect((await room()).platforms).toEqual([]);
  });
});

describe("a week's readings", () => {
  it("replaces what the week already had, metric by metric, in one write", async () => {
    const set = (week: string, body: unknown): Promise<Response> => call(`/distribution/readings/stigmer/${week}`, { as: "sync", body });
    const now = new Date();
    const thisWeek = await weekOf(now);
    await answer(await set(thisWeek, { outside_stars: 3, downloads: 40 }));
    const second = await answer<{ readings: { metric: string; value: number }[] }>(await set(thisWeek, { outside_stars: 4 }));
    expect(second.readings.map((one) => [one.metric, one.value])).toEqual([
      ["downloads", 40],
      ["outside_stars", 4],
    ]);
    expect((await room()).readings.map((one) => [one.metric, one.week, one.value])).toEqual([
      ["downloads", thisWeek, 40],
      ["outside_stars", thisWeek, 4],
    ]);
    expect((await room("?product=capsjump")).readings).toEqual([]);
  });

  it.each([
    ["/distribution/readings/stigmer/2026-W54", { a: 1 }, "week"],
    ["/distribution/readings/stigmer/2026-47", { a: 1 }, "week"],
    ["/distribution/readings/other/2026-W47", { a: 1 }, "product"],
    ["/distribution/readings/stigmer/2026-W47", {}, "readings"],
    ["/distribution/readings/stigmer/2026-W47", { a: -1 }, "readings"],
    ["/distribution/readings/stigmer/2026-W47", { a: 1.5 }, "readings"],
    ["/distribution/readings/stigmer/2026-W47", { "Outside stars": 1 }, "readings"],
    ["/distribution/readings/stigmer/2026-W47", [1], "readings"],
  ])("refuses %s with %j", async (path, body, reason) => {
    expect(await reasonOf(await call(path, { as: "sync", body }))).toEqual([400, reason]);
  });
});

/** The ISO week a moment falls in, as the Worker reads it from the journal's one helper. */
async function weekOf(moment: Date): Promise<string> {
  const { weekOf: of } = await import("../site/app/journal.js");
  return of(moment.toISOString().slice(0, 10));
}

describe("the room", () => {
  it("answers one product's acts of the last 35 days, newest first, and further back only when asked, at most 90 days", async () => {
    const recent = await write({ at: ago(2) });
    const newest = await write({ at: ago(0.5) });
    const old = await write({ at: ago(40) });
    await write({ at: ago(1), product: "capsjump" });
    const read = await room();
    expect([read.product, read.acts.map((one) => one.id), read.truncated]).toEqual(["stigmer", [newest.id, recent.id], false]);
    expect((await room(`?product=stigmer&since=${ago(60).slice(0, 10)}`)).acts.map((one) => one.id)).toEqual([newest.id, recent.id, old.id]);
    expect(await reasonOf(await call(`/distribution?product=stigmer&since=${ago(92).slice(0, 10)}`))).toEqual([400, "since"]);
    expect((await room("?product=capsjump")).acts).toHaveLength(1);
  });

  it("answers the open threads of the collection named Distribution in the product's space, in his order, and the newest Engage log", async () => {
    expect((await room()).work).toEqual({ collection: null, threads: [] });
    const add = async (title: string, space: string, ref: string, status = "act"): Promise<number> =>
      (await answer<{ thread: { number: number } }>(await call("/threads", { as: "sync", body: { ref, source: "self", title, body: "Work.", space, status } }), 201)).thread.number;
    const showHn = await add("A launch post", "stigmer", "chat:work-1");
    const listing = await add("Directory listings", "capsjump", "chat:work-2");
    const warm = await add("A guide to write", "stigmer", "chat:work-3");
    const done = await add("Finished", "stigmer", "chat:work-4");
    await answer(await call(`/threads/${done}`, { as: "sync", body: { action: "done" } }));
    await add("Not kept", "stigmer", "chat:work-5");
    const made = await answer<{ collection: { number: number } }>(await call("/collections", { as: "sync", body: { name: "DISTRIBUTION" } }), 201);
    for (const thread of [warm, showHn, listing, done]) await answer(await call(`/collections/${made.collection.number}/threads`, { as: "sync", body: { add: thread } }));
    await add("Engage log, 2026 Q3", "stigmer", "log:engage-2026-Q3");
    const log = await add("Engage log, 2026 Q4", "stigmer", "log:engage-2026-Q4");
    const read = await room();
    expect(read.work.collection).toBe(made.collection.number);
    expect(read.work.threads.map((one) => [one.number, one.title, one.place])).toEqual([
      [warm, "A guide to write", 1],
      [showHn, "A launch post", 2],
    ]);
    expect(read.log).toEqual({ number: log, title: "Engage log, 2026 Q4" });
    expect((await room("?product=capsjump")).work.threads.map((one) => one.number)).toEqual([listing]);
  });

  it.each([
    ["", "query"],
    ["?product=stigmer&product=capsjump", "query"],
    ["?product=stigmer&tab=x", "query"],
    ["?product=feed-said-so", "product"],
    ["?product=stigmer&since=yesterday", "since"],
    ["?product=stigmer&since=2026-02-30", "since"],
  ])("refuses the query %j", async (query, reason) => {
    expect(await reasonOf(await call(`/distribution${query}`))).toEqual([400, reason]);
  });

  it("reads the same for the owner and the sync", async () => {
    await write();
    expect(await room("?product=stigmer", "sync")).toEqual(await room("?product=stigmer", "owner"));
  });
});

describe("who may call", () => {
  it("refuses the owner every write with sync-only, from his own page or not, writing nothing", async () => {
    const act = await write();
    const writes: [string, unknown][] = [
      ["/distribution/acts", actOf()],
      [`/distribution/acts/${act.id}/void`, {}],
      ["/distribution/platforms/stigmer/reddit", { state: "hold", note: null, until: null, pace: null }],
      ["/distribution/readings/stigmer/2026-W47", { outside_stars: 1 }],
    ];
    for (const [path, body] of writes) {
      for (const origin of [THREADS, null, "https://example.com"]) expect([path, origin, ...(await reasonOf(await call(path, { body, origin })))]).toEqual([path, origin, 403, "sync-only"]);
    }
    const read = await room();
    expect([read.acts.map((one) => [one.id, one.voidedAt]), read.platforms, read.readings]).toEqual([[[act.id, null]], [], []]);
  });

  it("refuses an invited person every call with owner-only before anything is read", async () => {
    const thread = (await answer<{ thread: { number: number } }>(await call("/threads", { as: "sync", body: { ref: "chat:shared", source: "self", title: "Shared", body: "x", space: "stigmer", status: "act" } }), 201)).thread.number;
    await answer(await call(`/threads/${thread}/people`, { body: { add: { email: KIRAN, name: "Kiran" } } }));
    const as = { email: KIRAN };
    for (const path of ["/distribution?product=stigmer", "/distribution?product=nonsense", "/distribution"]) expect([path, ...(await reasonOf(await call(path, { as })))]).toEqual([path, 403, "owner-only"]);
    const writes: [string, unknown][] = [
      ["/distribution/acts", actOf()],
      ["/distribution/acts/00000000-0000-4000-8000-000000000000/void", {}],
      ["/distribution/platforms/stigmer/reddit", { state: "hold", note: null, until: null, pace: null }],
      ["/distribution/readings/stigmer/2026-W47", { outside_stars: 1 }],
    ];
    for (const [path, body] of writes) expect([path, ...(await reasonOf(await call(path, { as, body })))]).toEqual([path, 403, "owner-only"]);
    expect((await room()).acts).toEqual([]);
  });

  it("lets nobody signed out in", async () => {
    for (const path of ["/distribution?product=stigmer", "/distribution/acts"]) expect((await harness.fetch(`${THREADS}/threads/api${path}`, { method: path.endsWith("acts") ? "POST" : "GET" })).status).toBe(401);
  });

  it("refuses a method or a path it doesn't take", async () => {
    const methods: [string, string, string][] = [
      ["/distribution?product=stigmer", "POST", "GET"],
      ["/distribution/acts", "GET", "POST"],
      ["/distribution/platforms/stigmer/reddit", "GET", "POST"],
      ["/distribution/readings/stigmer/2026-W47", "DELETE", "POST"],
    ];
    for (const [path, method, allow] of methods) {
      const response = await call(path, { as: "sync", method });
      expect([path, response.status, response.headers.get("Allow")]).toEqual([path, 405, allow]);
    }
    for (const path of ["/distribution/other", "/distribution/acts/x", "/distribution/acts/x/undo", "/distribution/platforms/stigmer", "/distribution/readings/stigmer/2026-W47/x"]) {
      expect([path, ...(await reasonOf(await call(path, { as: "sync" })))]).toEqual([path, 404, "not-found"]);
    }
    expect(await reasonOf(await call("/distribution/acts?x=1", { as: "sync", body: actOf() }))).toEqual([400, "query"]);
  });
});
