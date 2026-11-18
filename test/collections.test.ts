// Collections, run as production runs them: the Worker's bundle in workerd (test/harness.ts), with a local D1 and
// Cloudflare Access played for the threads' application. What it holds: the owner and the sync make collections with
// names unique ignoring case; the list answers every pinned one in pinning order and pages the rest, the most recently
// changed first, or searches all of them; a collection answers its threads in his order, paged, filtered to the open
// or closed ones and searched; adding puts a thread at the end (once), taking one out closes the gap, and moving one
// takes it to the place asked for, clamped, so the order stays dense from the first place after every change, even
// with writes racing; keeping and taking out write the thread's owner-only `kept` and `unkept` lines and leave its
// status and last activity alone; a rule keeps every new thread of his or the sync's whose title begins with it,
// never one he took out whose origin comes again, never on a title edit, never a visitor's; a thread's own read and
// a search name its collections for the owner and the sync only; renaming, describing, pinning and deleting change
// only the collection, and deleting leaves the threads and their history; an invited person sees no collection not
// shared with them and is refused every write before anything is read (test/members.test.ts holds a shared one), signed out nobody gets in, and the owner's writes come only from his own page.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SITE, THREADS, startHarness, type Harness } from "./harness.ts";

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

/** A call under /threads/api/, by its path after that. */
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

let refs = 0;
/** A thread the sync adds; answers its number. */
async function thread(fields: Record<string, unknown> = {}): Promise<number> {
  refs += 1;
  const added = await call("/threads", { as: "sync", body: { ref: `chat:kept-${refs}`, source: "self", title: `Thread ${refs}`, body: `Body ${refs}`, space: "company", status: "act", ...fields } });
  return (await answer<{ thread: { number: number } }>(added, 201)).thread.number;
}

interface Collection {
  number: number;
  name: string;
  description: string | null;
  rule: string | null;
  pinned: boolean;
  changedAt: string;
  createdAt: string;
  threads: number;
}

interface Listed {
  pinned: Collection[];
  collections: Collection[];
  next: number | null;
  count: number;
}

interface Kept {
  collection: Collection;
  threads: { number: number; title: string; status: string; place: number }[];
  next: number | null;
  count: number;
}

async function collection(name: string, as: Who = "owner", description?: string): Promise<number> {
  const body = description === undefined ? { name } : { name, description };
  return (await answer<{ collection: Collection }>(await call("/collections", { as, body }), 201)).collection.number;
}

async function add(c: number, t: number, as: Who = "owner"): Promise<{ collection: Collection; place: number | null }> {
  return answer(await call(`/collections/${c}/threads`, { as, body: { add: t } }));
}

/** The thread numbers of a collection in his order, read straight from its rows, after asserting the order is dense from 0. */
async function order(c: number): Promise<number[]> {
  const rows = (
    await (await harness.db())
      .prepare("SELECT threads.number, collection_threads.position FROM collection_threads JOIN threads ON threads.id = collection_threads.thread_id WHERE collection_number = ?1 ORDER BY position")
      .bind(c)
      .all<{ number: number; position: number }>()
  ).results;
  expect(rows.map((row) => row.position)).toEqual(rows.map((_, index) => index));
  return rows.map((row) => row.number);
}

async function events(t: number): Promise<{ type: string; actor: string; data: Record<string, unknown> }[]> {
  const read = await answer<{ events: { type: string; actor: string; data: Record<string, unknown> }[] }>(await call(`/threads/${t}`));
  return read.events;
}

describe("making collections", () => {
  it("lets the owner and the sync make one, its name unique ignoring case", async () => {
    const made = await answer<{ collection: Collection }>(await call("/collections", { body: { name: "  Every screen  ", description: "Every design page." } }), 201);
    expect(made.collection).toEqual({
      number: 1,
      name: "Every screen",
      description: "Every design page.",
      rule: null,
      pinned: false,
      changedAt: expect.any(String),
      createdAt: made.collection.changedAt,
      threads: 0,
      publicAt: null,
      shareKey: null,
      hidden: 0,
    });
    expect(await collection("Story deck", "sync")).toBe(2);
    expect(await reasonOf(await call("/collections", { body: { name: "every SCREEN" } }))).toEqual([409, "name-taken"]);
    expect(await reasonOf(await call("/collections", { as: "sync", body: { name: "Every screen" } }))).toEqual([409, "name-taken"]);
  });

  it("never gives a deleted collection's number to another", async () => {
    await collection("One");
    const two = await collection("Two");
    await answer(await call(`/collections/${two}`, { body: { delete: true } }));
    expect(await collection("Three")).toBe(3);
  });

  it("refuses a malformed collection, writing nothing", async () => {
    const refused: unknown[] = [{}, { name: "" }, { name: "   " }, { name: "x".repeat(81) }, { name: 7 }, { name: "Bell\u0007" }, { name: "A", description: "x".repeat(281) }, { name: "A", extra: 1 }, "A"];
    for (const body of refused) expect(await reasonOf(await call("/collections", { body }))).toEqual([400, "collection"]);
    expect(await answer<Listed>(await call("/collections"))).toEqual({ pinned: [], collections: [], next: null, count: 0 });
    expect(await collection("x".repeat(80))).toBe(1);
  });
});

describe("the list", () => {
  it("answers the pinned ones in pinning order, then the rest most recently changed first, 25 a page", async () => {
    for (let n = 1; n <= 30; n += 1) await collection(`Set ${n}`);
    await answer(await call("/collections/7", { body: { pinned: true } }));
    await answer(await call("/collections/3", { body: { pinned: true } }));
    // Pinning again keeps its first place on the menu.
    await answer(await call("/collections/7", { body: { pinned: true } }));
    const first = await answer<Listed>(await call("/collections"));
    expect(first.pinned.map((c) => c.number)).toEqual([7, 3]);
    expect(first.pinned.every((c) => c.pinned)).toBe(true);
    expect(first.collections.map((c) => c.number)).toEqual([30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 6, 5]);
    expect([first.next, first.count]).toEqual([5, 28]);
    const second = await answer<Listed>(await call(`/collections?after=${first.next}`));
    expect(second.collections.map((c) => c.number)).toEqual([4, 2, 1]);
    expect([second.next, second.count]).toEqual([null, 28]);
    // A change moves a collection to the top.
    await add(1, await thread());
    expect((await answer<Listed>(await call("/collections"))).collections[0]?.number).toBe(1);
  });

  it("searches every collection by name or description, pinned or not, with no pinned list", async () => {
    await collection("Every screen", "owner", "Design pages");
    await collection("Story deck");
    await collection("Design notes");
    await answer(await call("/collections/1", { body: { pinned: true } }));
    const found = await answer<Listed>(await call("/collections?q=design"));
    expect(found.pinned).toEqual([]);
    expect(found.collections.map((c) => c.number).sort()).toEqual([1, 3]);
    expect(found.count).toBe(2);
    expect((await answer<Listed>(await call("/collections?q=100%25"))).collections).toEqual([]);
    expect((await answer<Listed>(await call("/collections?q="))).pinned.map((c) => c.number)).toEqual([1]);
  });

  it("refuses a query it doesn't take", async () => {
    for (const query of ["?x=1", "?after=0", "?after=abc", "?after=1&after=2", "?q=a&q=b", `?q=${"x".repeat(101)}`]) {
      expect([query, ...(await reasonOf(await call(`/collections${query}`)))]).toEqual([query, 400, "query"]);
    }
  });
});

describe("a collection's threads", () => {
  it("answers them in his order, 50 a page, filtered and searched", async () => {
    const c = await collection("Every decision");
    const numbers: number[] = [];
    for (let n = 1; n <= 55; n += 1) numbers.push(await thread({ title: n % 10 === 0 ? `Decision ${n} about pricing` : `Decision ${n}` }));
    for (const t of numbers) await add(c, t);
    await answer(await call(`/threads/${numbers[1]}`, { body: { action: "done" } }));
    const first = await answer<Kept>(await call(`/collections/${c}`));
    expect(first.collection.threads).toBe(55);
    expect(first.threads.map((t) => t.place)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(first.threads.map((t) => t.number)).toEqual(numbers.slice(0, 50));
    expect([first.next, first.count]).toEqual([50, 55]);
    const second = await answer<Kept>(await call(`/collections/${c}?after=50`));
    expect(second.threads.map((t) => t.number)).toEqual(numbers.slice(50));
    expect(second.next).toBe(null);
    const done = await answer<Kept>(await call(`/collections/${c}?status=done`));
    expect([done.threads.map((t) => [t.number, t.place]), done.count]).toEqual([[[numbers[1], 2]], 1]);
    expect((await answer<Kept>(await call(`/collections/${c}?status=open`))).count).toBe(54);
    const pricing = await answer<Kept>(await call(`/collections/${c}?q=PRICING`));
    expect(pricing.threads.map((t) => t.place)).toEqual([10, 20, 30, 40, 50]);
    expect((await answer<Kept>(await call(`/collections/${c}?q=%23${numbers[4]}`))).threads.map((t) => t.number)).toEqual([numbers[4]]);
  });

  it("answers a collection nobody has, and a query it doesn't take", async () => {
    expect(await reasonOf(await call("/collections/9"))).toEqual([404, "no-collection"]);
    expect(await reasonOf(await call("/collections/abc"))).toEqual([404, "no-collection"]);
    await collection("One");
    for (const query of ["?status=dropped", "?after=0", "?q=a&q=b", "?y=1"]) {
      expect([query, ...(await reasonOf(await call(`/collections/1${query}`)))]).toEqual([query, 400, "query"]);
    }
  });
});

describe("keeping, taking out and moving", () => {
  it("keeps a thread at the end once, and leaves its status and last activity alone", async () => {
    const c = await collection("Every screen");
    const [a, b] = [await thread(), await thread()];
    const before = await answer<{ thread: { status: string; activityAt: string } }>(await call(`/threads/${a}`));
    expect(await add(c, a)).toEqual({ collection: expect.objectContaining({ number: c, threads: 1 }), place: 1 });
    expect((await add(c, b, "sync")).place).toBe(2);
    expect((await add(c, a)).place).toBe(1);
    expect(await order(c)).toEqual([a, b]);
    const after = await answer<{ thread: { status: string; activityAt: string } }>(await call(`/threads/${a}`));
    expect([after.thread.status, after.thread.activityAt]).toEqual([before.thread.status, before.thread.activityAt]);
    const kept = (await events(a)).filter((event) => event.type === "kept");
    expect(kept).toEqual([expect.objectContaining({ actor: "owner", data: { collection: c, name: "Every screen" } })]);
    expect((await events(b)).filter((event) => event.type === "kept")).toEqual([expect.objectContaining({ actor: "sync" })]);
  });

  it("lets a thread sit in several collections", async () => {
    const [one, two] = [await collection("One"), await collection("Two")];
    const t = await thread();
    await add(one, t);
    await add(two, t);
    const read = await answer<{ collections: { number: number; name: string }[] }>(await call(`/threads/${t}`));
    expect(read.collections).toEqual([
      { number: one, name: "One" },
      { number: two, name: "Two" },
    ]);
    expect((await answer<{ collections: unknown[] }>(await call(`/threads/${t}`, { as: "sync" }))).collections).toHaveLength(2);
  });

  it("takes a thread out and closes the gap, with its unkept line", async () => {
    const c = await collection("Set");
    const ts = [await thread(), await thread(), await thread(), await thread()];
    for (const t of ts) await add(c, t);
    const out = await answer<{ collection: Collection; place: number | null }>(await call(`/collections/${c}/threads`, { body: { remove: ts[1] } }));
    expect([out.collection.threads, out.place]).toEqual([3, null]);
    expect(await order(c)).toEqual([ts[0], ts[2], ts[3]]);
    expect((await events(ts[1] ?? 0)).map((event) => event.type)).toEqual(["created", "kept", "unkept"]);
    expect(await reasonOf(await call(`/collections/${c}/threads`, { body: { remove: ts[1] } }))).toEqual([409, "not-kept"]);
    await answer(await call(`/collections/${c}/threads`, { body: { remove: ts[3] } }));
    await answer(await call(`/collections/${c}/threads`, { body: { remove: ts[0] } }));
    expect(await order(c)).toEqual([ts[2]]);
  });

  it("moves a thread to any place, clamped, keeping the order dense", async () => {
    const c = await collection("Set");
    const ts: number[] = [];
    for (let n = 0; n < 6; n += 1) ts.push(await thread());
    for (const t of ts) await add(c, t);
    const [a, b, d, e, f, g] = ts as [number, number, number, number, number, number];
    const move = async (t: number, to: number): Promise<number | null> =>
      (await answer<{ place: number | null }>(await call(`/collections/${c}/threads`, { body: { move: t, to } }))).place;
    expect(await move(f, 1)).toBe(1);
    expect(await order(c)).toEqual([f, a, b, d, e, g]);
    expect(await move(f, 4)).toBe(4);
    expect(await order(c)).toEqual([a, b, d, f, e, g]);
    expect(await move(a, 999)).toBe(6);
    expect(await order(c)).toEqual([b, d, f, e, g, a]);
    expect(await move(g, 5)).toBe(5);
    expect(await order(c)).toEqual([b, d, f, e, g, a]);
    expect(await reasonOf(await call(`/collections/${c}/threads`, { body: { move: await thread(), to: 1 } }))).toEqual([409, "not-kept"]);
  });

  it("keeps the order dense with the page and the sync writing at once", async () => {
    const c = await collection("Race");
    const ts: number[] = [];
    for (let n = 0; n < 8; n += 1) ts.push(await thread());
    for (const t of ts.slice(0, 6)) await add(c, t);
    await Promise.all([
      call(`/collections/${c}/threads`, { body: { move: ts[0], to: 6 } }),
      call(`/collections/${c}/threads`, { as: "sync", body: { move: ts[5], to: 1 } }),
      call(`/collections/${c}/threads`, { as: "sync", body: { remove: ts[2] } }),
      call(`/collections/${c}/threads`, { body: { add: ts[6] } }),
      call(`/collections/${c}/threads`, { as: "sync", body: { add: ts[7] } }),
      call(`/collections/${c}/threads`, { body: { move: ts[3], to: 3 } }),
    ]);
    expect((await order(c)).sort((x, y) => x - y)).toEqual([ts[0], ts[1], ts[3], ts[4], ts[5], ts[6], ts[7]].sort((x, y) => (x ?? 0) - (y ?? 0)));
  });

  it("answers a collection or a thread nobody has, and refuses a malformed change", async () => {
    const c = await collection("Set");
    const t = await thread();
    expect(await reasonOf(await call("/collections/9/threads", { body: { add: t } }))).toEqual([404, "no-collection"]);
    expect(await reasonOf(await call(`/collections/${c}/threads`, { body: { add: 999 } }))).toEqual([404, "no-thread"]);
    expect(await reasonOf(await call(`/collections/${c}/threads`, { body: { remove: 999 } }))).toEqual([404, "no-thread"]);
    for (const body of [{}, { add: 0 }, { add: "1" }, { add: 1.5 }, { move: t }, { move: t, to: 0 }, { add: t, remove: t }]) {
      expect(await reasonOf(await call(`/collections/${c}/threads`, { body }))).toEqual([400, "change"]);
    }
    expect(await order(c)).toEqual([]);
  });
});

describe("a rule", () => {
  it("keeps every new thread of his or the sync's whose title begins with it, at the end", async () => {
    const c = await collection("Every screen");
    const early = await thread({ title: "Design page: before the rule" });
    await answer(await call(`/collections/${c}`, { body: { rule: "Design page:" } }));
    const first = await thread({ title: "design PAGE: the door" });
    const other = await thread({ title: "Something else" });
    const mine = await answer<{ thread: { number: number } }>(await call("/threads", { body: { title: "Design page: Today", body: "", space: "company", status: "act" } }), 201);
    expect(await order(c)).toEqual([first, mine.thread.number]);
    expect(other).toBeGreaterThan(early);
    expect((await events(first)).filter((event) => event.type === "kept")).toEqual([
      expect.objectContaining({ actor: "sync", data: { collection: c, name: "Every screen", rule: "Design page:" } }),
    ]);
    const listed = await answer<Listed>(await call("/collections"));
    expect(listed.collections[0]?.rule).toBe("Design page:");
  });

  it("never keeps again a thread he took out when its origin comes again, nor on a title edit", async () => {
    const c = await collection("Every screen");
    await answer(await call(`/collections/${c}`, { body: { rule: "Design page:" } }));
    const body = { ref: "chat:design-1", source: "self", title: "Design page: one", body: "x", space: "company", status: "act" };
    const t = (await answer<{ thread: { number: number } }>(await call("/threads", { as: "sync", body }), 201)).thread.number;
    await answer(await call(`/collections/${c}/threads`, { body: { remove: t } }));
    expect((await call("/threads", { as: "sync", body })).status).toBe(200);
    const edited = await thread({ title: "Plain" });
    await answer(await call(`/threads/${edited}/text`, { body: { field: "title", text: "Design page: renamed" } }));
    expect(await order(c)).toEqual([]);
  });

  it("never keeps a visitor's note", async () => {
    const c = await collection("Notes");
    await answer(await call(`/collections/${c}`, { body: { rule: "A" } }));
    const sent = await harness.fetch(`${SITE}/api/talk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SITE, "CF-Connecting-IP": "198.51.100.7" },
      body: new TextEncoder().encode(JSON.stringify({ topic: "stigmer", body: "A note.", name: "Ana", email: "ana@example.com", token: "pass" })),
    });
    expect(sent.status).toBe(201);
    expect(await order(c)).toEqual([]);
  });

  it("is cleared by null or an empty rule", async () => {
    const c = await collection("Set");
    await answer(await call(`/collections/${c}`, { body: { rule: "X" } }));
    expect((await answer<{ collection: Collection }>(await call(`/collections/${c}`, { body: { rule: null } }))).collection.rule).toBe(null);
    await answer(await call(`/collections/${c}`, { body: { rule: "X" } }));
    expect((await answer<{ collection: Collection }>(await call(`/collections/${c}`, { body: { rule: "  " } }))).collection.rule).toBe(null);
    await thread({ title: "X marks" });
    expect(await order(c)).toEqual([]);
  });
});

describe("changing a collection", () => {
  it("renames it, never onto another's name, describes it and pins it", async () => {
    const c = await collection("Every screen");
    await collection("Story deck");
    expect((await answer<{ collection: Collection }>(await call(`/collections/${c}`, { body: { name: "EVERY screen" } }))).collection.name).toBe("EVERY screen");
    expect(await reasonOf(await call(`/collections/${c}`, { body: { name: "story DECK" } }))).toEqual([409, "name-taken"]);
    expect((await answer<{ collection: Collection }>(await call(`/collections/${c}`, { as: "sync", body: { description: "Pages." } }))).collection.description).toBe("Pages.");
    expect((await answer<{ collection: Collection }>(await call(`/collections/${c}`, { body: { description: "" } }))).collection.description).toBe(null);
    expect((await answer<{ collection: Collection }>(await call(`/collections/${c}`, { as: "sync", body: { pinned: true } }))).collection.pinned).toBe(true);
    expect((await answer<{ collection: Collection }>(await call(`/collections/${c}`, { body: { pinned: false } }))).collection.pinned).toBe(false);
  });

  it("deletes it for good, leaving its threads and their history as written", async () => {
    const c = await collection("Every screen");
    const t = await thread();
    await add(c, t);
    expect(await answer(await call(`/collections/${c}`, { body: { delete: true } }))).toEqual({ deleted: true });
    expect(await reasonOf(await call(`/collections/${c}`))).toEqual([404, "no-collection"]);
    expect(await reasonOf(await call(`/collections/${c}`, { body: { delete: true } }))).toEqual([404, "no-collection"]);
    const read = await answer<{ thread: { number: number }; collections: unknown[] }>(await call(`/threads/${t}`));
    expect([read.thread.number, read.collections]).toEqual([t, []]);
    expect((await events(t)).filter((event) => event.type === "kept")).toEqual([expect.objectContaining({ data: { collection: c, name: "Every screen" } })]);
  });

  it("refuses a change that isn't exactly one field", async () => {
    await collection("Set");
    for (const body of [{}, { name: "A", description: "B" }, { pinned: "yes" }, { delete: false }, { rule: 7 }, { name: "" }, { description: "x".repeat(281) }]) {
      expect(await reasonOf(await call("/collections/1", { body }))).toEqual([400, "collection"]);
    }
    expect(await reasonOf(await call("/collections/9", { body: { name: "Z" } }))).toEqual([404, "no-collection"]);
  });
});

describe("a thread's read and a search", () => {
  it("name its collections for the owner and the sync, never for an invited person", async () => {
    const c = await collection("Every screen");
    const t = await thread({ title: "The door" });
    await add(c, t);
    await answer(await call(`/threads/${t}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    const theirs = await answer<Record<string, unknown>>(await call(`/threads/${t}`, { as: { email: MEERA } }));
    expect(theirs).not.toHaveProperty("collections");
    expect(JSON.stringify(theirs)).not.toContain("Every screen");
    const found = await answer<{ collections: Collection[] }>(await call("/search?q=every"));
    expect(found.collections.map((one) => one.number)).toEqual([c]);
    expect((await answer<{ collections: Collection[] }>(await call("/search?q=screen", { as: "sync" }))).collections).toHaveLength(1);
    // Collections not shared with them never appear in their search (test/members.test.ts holds the shared ones).
    expect(await answer(await call("/search?q=door", { as: { email: MEERA } }))).toEqual({ threads: [expect.objectContaining({ number: t })], collections: [] });
  });
});

describe("who may call", () => {
  it("shows an invited person no collection not shared with them, and refuses them every write before anything is read", async () => {
    const t = await thread();
    await answer(await call(`/threads/${t}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    await collection("Every screen");
    const as = { email: MEERA };
    expect(await answer(await call("/collections", { as }))).toEqual({ pinned: [], collections: [], next: null, count: 0 });
    for (const path of ["/collections/1", "/collections/9"]) expect([path, ...(await reasonOf(await call(path, { as })))]).toEqual([path, 404, "no-collection"]);
    expect(await reasonOf(await call("/collections/1/people", { as }))).toEqual([403, "owner-only"]);
    const writes: [string, unknown][] = [
      ["/collections", { name: "Mine" }],
      ["/collections/1", { name: "Mine" }],
      ["/collections/1", { delete: true }],
      ["/collections/1/threads", { add: t }],
    ];
    for (const [path, body] of writes) expect([path, ...(await reasonOf(await call(path, { as, body })))]).toEqual([path, 403, "owner-only"]);
    expect(await order(1)).toEqual([]);
  });

  it("lets nobody signed out in", async () => {
    await collection("Every screen");
    for (const path of ["/collections", "/collections/1"]) expect((await harness.fetch(`${THREADS}/threads/api${path}`)).status).toBe(401);
  });

  it("takes the owner's writes only from his own page, and the sync's with no origin", async () => {
    expect(await reasonOf(await call("/collections", { body: { name: "A" }, origin: null }))).toEqual([403, "origin"]);
    expect(await reasonOf(await call("/collections", { body: { name: "A" }, origin: "https://example.com" }))).toEqual([403, "origin"]);
    expect((await call("/collections", { as: "sync", body: { name: "A" }, origin: null })).status).toBe(201);
    expect(await reasonOf(await call("/collections/1/threads", { body: { add: 1 }, origin: "https://example.com" }))).toEqual([403, "origin"]);
  });

  it("refuses a method or a path it doesn't take", async () => {
    await collection("Set");
    const headers = { "Cf-Access-Jwt-Assertion": token("owner"), Origin: THREADS };
    expect((await harness.fetch(`${THREADS}/threads/api/collections`, { method: "DELETE", headers })).status).toBe(405);
    expect((await harness.fetch(`${THREADS}/threads/api/collections/1/threads`, { headers })).status).toBe(405);
    expect(await reasonOf(await call("/collections/1/share"))).toEqual([404, "not-found"]);
    expect(await reasonOf(await call("/collections/1?x=1", { body: { name: "B" } }))).toEqual([400, "query"]);
  });
});
