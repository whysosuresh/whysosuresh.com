// Sharing a thread, run as production runs it: the Worker's bundle in workerd (test/harness.ts), with a local D1
// and Cloudflare Access played for the threads' application, an invited person signing in by their own address.
// What it holds: the owner invites a person to a thread and takes the invitation back, from his own page only,
// each with its event, which names the person and never their address; a person is kept once per address; his
// own address is refused. A signed-in address with no invitation that stands is refused at the door with 403
// `caller`, as a stranger always was, and so is a person removed from their last thread. An invitation opens
// exactly one thread: for an invited person, every other thread answers exactly as a number never used, on the
// thread, its page, a comment, a search and their list; and every call that isn't theirs is refused with 403
// `owner-only` before anything is read. What they see of their thread: no visitor's email, origin, issue link,
// drop reason or mail opening, no earlier version of any text, no "Only me" comment, and the people by name only.
// They reply, answer and comment on words, never under an Only me comment, and their own comments are told apart from
// a namesake's by their address, which is never shown. They read a meeting of a thread they are in, its people by name only and its
// history with where it moved from, their own place marked as theirs by their address; being in a meeting grants
// nothing, at the door or at sign-in. The owner's list says how many people each thread is shared with, and which wait on him: an invited person had
// the last word, until he comments, moves or edits. Someone who answered one of his asks and whom he invited back to
// their own thread reads it with the ask's page and their answers, which read as their own (by the address the thread
// was made with) and as nobody else's, answers again there as themselves, never sees who else answered or the ask's
// own thread, and is refused every ask call.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OWNER, THREADS as HEY, startHarness, type Harness } from "./harness.ts";

const THREADS = `${HEY}/threads/api/threads`;
const MEERA = "meera@example.com";
const DEV = "dev@example.org";

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

/** Who a call is from: the owner, the sync, or a person signed in by that address. */
type Who = "owner" | "sync" | { readonly email: string };

interface Call {
  as?: Who;
  method?: string;
  body?: unknown;
  /** The Origin header; the site's own by default for a POST, none for null. */
  origin?: string | null;
}

function token(as: Who): string {
  if (as === "owner") return harness.access.token(harness.access.ownerClaims());
  if (as === "sync") return harness.access.token(harness.access.syncClaims());
  return harness.access.token(harness.access.memberClaims(as.email));
}

/** A call under /threads/api/, by its path after that. */
async function call(path: string, request: Call = {}): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(request.as ?? "owner") };
  const method = request.method ?? (request.body === undefined ? "GET" : "POST");
  if (method === "GET") return harness.fetch(`${HEY}/threads/api${path}`, { headers });
  headers["Content-Type"] = "application/json";
  if (request.origin !== null) headers.Origin = request.origin ?? HEY;
  return harness.fetch(`${HEY}/threads/api${path}`, { method, headers, body: new TextEncoder().encode(JSON.stringify(request.body ?? {})) });
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
  const body = { ref: `chat:members-${refs}`, source: "self", title: `Thread ${refs}`, body: `Body ${refs}`, space: "company", status: "act", ...fields };
  return (await answer<{ thread: { number: number } }>(await call("/threads", { as: "sync", body }), 201)).thread.number;
}

interface People {
  people: { id: string; name: string; email: string; addedAt: string }[];
  invitedCount: number;
}

async function invite(number: number, email: string, name = "Meera"): Promise<People> {
  return answer<People>(await call(`/threads/${number}/people`, { body: { add: { email, name } } }));
}

async function removeFrom(number: number, personId: string): Promise<People> {
  return answer<People>(await call(`/threads/${number}/people`, { body: { remove: personId } }));
}

async function count(sql: string, ...values: unknown[]): Promise<number> {
  return (await (await harness.db()).prepare(sql).bind(...values).first<{ n: number }>())?.n ?? 0;
}

interface Shown {
  thread: Record<string, unknown>;
  people: Record<string, unknown>[];
  comments: { author: string; name: string | null; audience: string; body: string }[];
  events: { type: string; actor: string; data: Record<string, unknown> }[];
}

describe("inviting", () => {
  it("keeps the person once, by their address lowercased, with an event naming them and never their address", async () => {
    const n = await thread();
    const first = await invite(n, "Meera@Example.com", "  Meera  ");
    expect(first.people).toEqual([{ id: expect.any(String), number: 1, name: "Meera", email: MEERA, addedAt: expect.any(String), photo: null }]);
    expect(first.invitedCount).toBe(1);
    const shown = await answer<Shown>(await call(`/threads/${n}`));
    const invited = shown.events.filter((event) => event.type === "invited");
    expect(invited).toEqual([{ id: expect.any(Number), at: expect.any(String), actor: "owner", type: "invited", data: { person: first.people[0]?.id, name: "Meera" } }]);
    expect(JSON.stringify(shown.events)).not.toContain("example.com");
    expect(shown.people).toEqual(first.people);
  });

  it("is said once: inviting someone already in the thread writes no event and only renames them", async () => {
    const n = await thread();
    await invite(n, MEERA);
    const again = await invite(n, MEERA, "Meera K.");
    expect(again.people.map((person) => person.name)).toEqual(["Meera K."]);
    expect(await count("SELECT COUNT(*) AS n FROM events WHERE type = 'invited'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(1);
  });

  it("counts each person once across threads", async () => {
    const [a, b] = [await thread(), await thread()];
    await invite(a, MEERA);
    await invite(b, MEERA);
    expect((await invite(b, DEV, "Dev")).invitedCount).toBe(2);
  });

  it("is the owner's alone, from his own page", async () => {
    const n = await thread();
    expect(await reasonOf(await call(`/threads/${n}/people`, { as: "sync", body: { add: { email: MEERA, name: "Meera" } } }))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await call(`/threads/${n}/people`, { as: "sync" }))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await call(`/threads/${n}/people`, { origin: "https://elsewhere.example", body: { add: { email: MEERA, name: "Meera" } } }))).toEqual([403, "origin"]);
    expect(await reasonOf(await call(`/threads/${n}/people`, { origin: null, body: { add: { email: MEERA, name: "Meera" } } }))).toEqual([403, "origin"]);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
  });

  it.each([
    ["no name", { add: { email: MEERA } }],
    ["an empty name", { add: { email: MEERA, name: " " } }],
    ["a name longer than 80", { add: { email: MEERA, name: "M".repeat(81) } }],
    ["a name on two lines", { add: { email: MEERA, name: "Meera\nK." } }],
    ["no address", { add: { name: "Meera" } }],
    ["an address with no @", { add: { email: "meera.example.com", name: "Meera" } }],
    ["an address ending in a full stop", { add: { email: "meera@example.com.", name: "Meera" } }],
    ["an address with an empty part in its domain", { add: { email: "meera@example..com", name: "Meera" } }],
    ["two addresses", { add: { email: `${MEERA}, ${DEV}`, name: "Meera" } }],
    ["another key", { add: { email: MEERA, name: "Meera", role: "view" } }],
    ["both add and remove", { add: { email: MEERA, name: "Meera" }, remove: "x" }],
    ["a remove that isn't an id", { remove: "meera" }],
  ])("refuses %s with 400, writing nothing", async (_, body) => {
    const n = await thread();
    expect(await reasonOf(await call(`/threads/${n}/people`, { body }))).toEqual([400, "person"]);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
  });

  it("refuses the owner's own address in any case", async () => {
    const n = await thread();
    expect(await reasonOf(await call(`/threads/${n}/people`, { body: { add: { email: OWNER.toUpperCase(), name: "Me" } } }))).toEqual([400, "owner"]);
  });

  it("to a thread that isn't there is 404, and keeps no person", async () => {
    expect(await reasonOf(await call("/threads/99/people", { body: { add: { email: MEERA, name: "Meera" } } }))).toEqual([404, "no-thread"]);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
  });

  it("taken back writes its event, and a second time is 409; inviting again stands again", async () => {
    const n = await thread();
    const id = (await invite(n, MEERA)).people[0]?.id ?? "";
    expect((await removeFrom(n, id)).people).toEqual([]);
    expect(await reasonOf(await call(`/threads/${n}/people`, { body: { remove: id } }))).toEqual([409, "not-invited"]);
    expect((await invite(n, MEERA)).people.map((person) => person.id)).toEqual([id]);
    const types = (await answer<Shown>(await call(`/threads/${n}`))).events.map((event) => event.type).filter((type) => type !== "created");
    expect(types).toEqual(["invited", "removed", "invited"]);
  });
});

describe("who gets in", () => {
  it("refuses a signed-in address with no invitation with 403 caller, on every call", async () => {
    const n = await thread();
    for (const path of ["/me", "/threads", `/threads/${n}`, "/search?q=Thread", "/sign-in"]) {
      expect(await reasonOf(await call(path, { as: { email: MEERA } }))).toEqual([403, "caller"]);
    }
  });

  it("admits an invited person as themselves", async () => {
    await invite(await thread(), MEERA);
    expect(await answer(await call("/me", { as: { email: "MEERA@example.com" } }))).toEqual({ caller: "member", email: MEERA, ownerPhoto: null, photo: null });
    expect(await answer(await call("/me"))).toEqual({ caller: "owner", email: OWNER, ownerPhoto: null });
    expect(await answer(await call("/me", { as: "sync" }))).toEqual({ caller: "sync", email: null, ownerPhoto: null });
  });

  it("refuses a person removed from their last thread on their next call, and keeps one still in another", async () => {
    const [a, b] = [await thread(), await thread()];
    const id = (await invite(a, MEERA)).people[0]?.id ?? "";
    await invite(b, MEERA);
    await removeFrom(a, id);
    expect(await reasonOf(await call(`/threads/${a}`, { as: { email: MEERA } }))).toEqual([404, "no-thread"]);
    expect((await call(`/threads/${b}`, { as: { email: MEERA } })).status).toBe(200);
    await removeFrom(b, id);
    expect(await reasonOf(await call(`/threads/${b}`, { as: { email: MEERA } }))).toEqual([403, "caller"]);
  });
});

describe("an invitation opens exactly one thread", () => {
  /** #a is Meera's; #b is not, and its title holds a word only it has. */
  async function stage(): Promise<{ a: number; b: number }> {
    const a = await thread({ title: "Who owns what", body: "Areas and owners." });
    const b = await thread({ title: "Quietplan for pricing", body: "Not for Meera." });
    await invite(a, MEERA);
    return { a, b };
  }
  const meera = { as: { email: MEERA } } as const;

  it("answers another thread exactly as a number never used", async () => {
    const { b } = await stage();
    const hidden = await call(`/threads/${b}`, meera);
    const never = await call("/threads/999", meera);
    expect([hidden.status, await hidden.text()]).toEqual([never.status, await never.text()]);
    expect(hidden.status).toBe(404);
  });

  it("answers another thread's page as missing, and their own thread's page", async () => {
    const { a, b } = await stage();
    for (const n of [a, b]) {
      const saved = await harness.fetch(`${THREADS}/${n}/pages`, {
        method: "POST",
        headers: { "Content-Type": "text/html; charset=utf-8", "Cf-Access-Jwt-Assertion": token("sync") },
        body: new TextEncoder().encode(`<!doctype html><title>${n}</title><p>Page ${n}</p>`),
      });
      expect(saved.status).toBe(201);
    }
    expect((await call(`/threads/${a}/pages/1`, meera)).status).toBe(200);
    expect(await reasonOf(await call(`/threads/${b}/pages/1`, meera))).toEqual([404, "no-thread"]);
  });

  it("refuses a comment on another thread as missing, writing nothing and touching nothing", async () => {
    const { b } = await stage();
    const before = await count("SELECT COUNT(*) AS n FROM comments");
    const activity = await (await harness.db()).prepare("SELECT activity_at AS at FROM threads WHERE number = ?1").bind(b).first<{ at: string }>();
    expect(await reasonOf(await call(`/threads/${b}/comments`, { ...meera, body: { body: "Hello" } }))).toEqual([404, "no-thread"]);
    expect(await count("SELECT COUNT(*) AS n FROM comments")).toBe(before);
    expect(await (await harness.db()).prepare("SELECT activity_at AS at FROM threads WHERE number = ?1").bind(b).first<{ at: string }>()).toEqual(activity);
  });

  it("searches only their threads: by a word in another's title, by its number, and by their own", async () => {
    const { a, b } = await stage();
    const found = async (q: string): Promise<number[]> =>
      (await answer<{ threads: { number: number }[] }>(await call(`/search?q=${encodeURIComponent(q)}`, meera))).threads.map((one) => one.number);
    expect(await found("Quietplan")).toEqual([]);
    expect(await found(`#${b}`)).toEqual([]);
    expect(await found("owns")).toEqual([a]);
    expect(await found(`${a}`)).toEqual([a]);
    // The owner still finds both.
    expect((await answer<{ threads: unknown[] }>(await call("/search?q=Quietplan"))).threads).toHaveLength(1);
  });

  it("lists only their threads, most recently active first, and refuses a tab", async () => {
    const { a } = await stage();
    const c = await thread();
    await invite(c, MEERA);
    expect((await answer<{ threads: { number: number }[] }>(await call("/threads", meera))).threads.map((one) => one.number)).toEqual([c, a]);
    expect(await reasonOf(await call("/threads?tab=act", meera))).toEqual([403, "owner-only"]);
    // The owner's list with no query is still not a list.
    expect(await reasonOf(await call("/threads"))).toEqual([400, "query"]);
  });

  /** A call an invited person may not make, on the thread numbered `n`: its path and its body. */
  type Made = (n: number) => readonly [string, unknown];
  it.each<[string, Made]>([
    ["a move", (n) => [`/threads/${n}`, { action: "done" }]],
    ["a text", (n) => [`/threads/${n}/text`, { field: "title", text: "Mine" }]],
    ["a link", (n) => [`/threads/${n}/link`, { url: "https://claude.ai/artifact/x", title: "x" }]],
    ["a page", (n) => [`/threads/${n}/pages`, {}]],
    ["the people", (n) => [`/threads/${n}/people`, { add: { email: DEV, name: "Dev" } }]],
    ["an add", () => ["/threads", { title: "Mine", body: "x", space: "company", status: "act" }]],
  ])("refuses %s with 403 owner-only, the same for their thread, another and a number never used", async (_, made) => {
    const { a, b } = await stage();
    for (const n of [a, b, 999]) {
      const [path, body] = made(n);
      expect(await reasonOf(await call(path, { ...meera, body }))).toEqual([403, "owner-only"]);
    }
    expect(await reasonOf(await call(`/threads/${a}/people`, meera))).toEqual([403, "owner-only"]);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(1);
  });
});

describe("what an invited person sees", () => {
  /** A visitor's note, as the note flow keeps it, moved, renamed, summarised, opened for a reply and shared. */
  async function shared(): Promise<number> {
    const database = await harness.db();
    await database
      .prepare(
        `INSERT INTO threads (id, number, created_at, activity_at, source, space, body, status, sender_name, sender_email)
         VALUES (?1, (SELECT COALESCE(MAX(number), 0) + 1 FROM threads), ?2, ?2, 'talk', 'stigmer', 'My own words.', 'received', 'Asha', 'asha@example.com')`,
      )
      .bind(crypto.randomUUID(), new Date().toISOString())
      .run();
    const n = (await database.prepare("SELECT MAX(number) AS n FROM threads").first<{ n: number }>())?.n ?? 0;
    await database
      .prepare("INSERT INTO events (thread_id, at, actor, type, data) SELECT id, created_at, 'import', 'imported', json_object('status', 'received') FROM threads WHERE number = ?1")
      .bind(n)
      .run();
    expect((await call(`/threads/${n}/text`, { body: { field: "summary", text: "Private first draft." } })).status).toBe(200);
    expect((await call(`/threads/${n}/text`, { body: { field: "summary", text: "Decided: yes." } })).status).toBe(200);
    expect((await call(`/threads/${n}`, { body: { action: "reply-opened" } })).status).toBe(200);
    expect((await call(`/threads/${n}`, { body: { action: "drop", reason: "Junk" } })).status).toBe(200);
    expect((await call(`/threads/${n}`, { body: { action: "reopen" } })).status).toBe(200);
    expect((await call(`/threads/${n}/comments`, { body: { body: "For everyone." } })).status).toBe(201);
    expect((await call(`/threads/${n}/comments`, { body: { body: "Only me: her budget.", audience: "owner" } })).status).toBe(201);
    expect((await call(`/threads/${n}/comments`, { as: "sync", body: { body: "Claude's private note.", audience: "owner" } })).status).toBe(201);
    await invite(n, MEERA);
    await invite(n, DEV, "Dev");
    return n;
  }

  it("is what the thread says now: no address, origin, issue link, drop reason or mail opening", async () => {
    const n = await shared();
    const seen = await answer<Shown>(await call(`/threads/${n}`, { as: { email: MEERA } }));
    expect(Object.keys(seen.thread).sort()).toEqual(
      ["activityAt", "ask", "body", "createdAt", "feedAt", "id", "kind", "link", "main", "meeting", "movedAt", "number", "publicAt", "senderName", "source", "space", "status", "summary", "title"].sort(),
    );
    expect(seen.thread).toMatchObject({ senderName: "Asha", summary: "Decided: yes.", body: "My own words." });
    expect(JSON.stringify(seen)).not.toMatch(/asha@example\.com|meera@|dev@|Junk|Private first draft/);
  });

  it("never carries a public thread's link, which he and the sync hand out, and they read", async () => {
    const n = await thread({ source: "self" });
    await invite(n, MEERA);
    expect((await call(`/threads/${n}`, { body: { action: "publish" } })).status).toBe(200);
    const theirs = await answer<Shown>(await call(`/threads/${n}`, { as: { email: MEERA } }));
    expect(theirs.thread).not.toHaveProperty("shareKey");
    expect(theirs.thread).not.toHaveProperty("publicByNumber");
    const key = (await answer<Shown>(await call(`/threads/${n}`))).thread.shareKey;
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect((await answer<Shown>(await call(`/threads/${n}`, { as: "sync" }))).thread).toMatchObject({ shareKey: key, publicByNumber: false });
    expect(JSON.stringify(await answer<unknown>(await call(`/threads/${n}`, { as: { email: MEERA } })))).not.toContain(String(key));
    const list = await answer<{ threads: Record<string, unknown>[] }>(await call("/threads", { as: { email: MEERA } }));
    expect(JSON.stringify(list)).not.toContain(String(key));
  });

  it("is the history without earlier texts, reply marks, imports, reasons or ids", async () => {
    const n = await shared();
    const seen = await answer<Shown>(await call(`/threads/${n}`, { as: { email: MEERA } }));
    expect(seen.events.map((event) => [event.type, event.data])).toEqual([
      ["edited", { field: "summary" }],
      ["edited", { field: "summary" }],
      ["moved", { from: "received", to: "dropped" }],
      ["moved", { from: "dropped", to: "received" }],
      ["invited", { name: "Meera" }],
      ["invited", { name: "Dev" }],
    ]);
    // The owner's own view keeps all of it.
    const his = await answer<Shown>(await call(`/threads/${n}`));
    expect(his.events.map((event) => event.type)).toEqual(["imported", "edited", "edited", "reply-opened", "moved", "moved", "invited", "invited"]);
    expect(his.events[1]?.data).toEqual({ field: "summary", before: null });
    expect(his.events[2]?.data).toEqual({ field: "summary", before: "Private first draft." });
  });

  it("shows the comments for everyone and never an Only me one, and the people by name, the owner first", async () => {
    const n = await shared();
    const seen = await answer<Shown>(await call(`/threads/${n}`, { as: { email: MEERA } }));
    expect(seen.comments.map((comment) => comment.body)).toEqual(["For everyone."]);
    expect(seen.people).toEqual([{ name: "Suresh", owner: true }, { name: "Meera", photo: null }, { name: "Dev", photo: null }]);
    const his = await answer<Shown>(await call(`/threads/${n}`));
    expect(his.comments.map((comment) => [comment.author, comment.audience, comment.body])).toEqual([
      ["owner", "thread", "For everyone."],
      ["owner", "owner", "Only me: her budget."],
      ["sync", "owner", "Claude's private note."],
    ]);
  });

  it("takes their comment, for everyone, by name, from the site's own page only", async () => {
    const n = await shared();
    const meera = { as: { email: MEERA } } as const;
    const added = await answer<{ comment: Record<string, unknown> }>(await call(`/threads/${n}/comments`, { ...meera, body: { body: "Thanks!" } }), 201);
    expect(added.comment).toMatchObject({ author: "member", name: "Meera", audience: "thread", body: "Thanks!" });
    expect(await reasonOf(await call(`/threads/${n}/comments`, { ...meera, body: { body: "Hidden?", audience: "owner" } }))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await call(`/threads/${n}/comments`, { ...meera, origin: "https://elsewhere.example", body: { body: "x" } }))).toEqual([403, "origin"]);
    expect(await reasonOf(await call(`/threads/${n}/comments`, { ...meera, origin: null, body: { body: "x" } }))).toEqual([403, "origin"]);
    const dev = await answer<Shown>(await call(`/threads/${n}`, { as: { email: DEV } }));
    expect(dev.comments.at(-1)).toMatchObject({ author: "member", name: "Meera", body: "Thanks!" });
  });

  it("takes their reply, answer and comment on words, and never lets them reply to an Only me comment they can't see", async () => {
    const n = await shared();
    const meera = { as: { email: MEERA } } as const;
    const his = await answer<{ comments: { id: string; audience: string }[] }>(await call(`/threads/${n}`));
    const open = his.comments.find((one) => one.audience === "thread");
    const secret = his.comments.find((one) => one.audience === "owner");
    const reply = await answer<{ comment: Record<string, unknown> }>(await call(`/threads/${n}/comments`, { ...meera, body: { body: "Agreed.", parent: open?.id } }), 201);
    expect(reply.comment).toMatchObject({ author: "member", name: "Meera", audience: "thread", parent: open?.id, mine: true });
    expect(await reasonOf(await call(`/threads/${n}/comments`, { ...meera, body: { body: "Peek.", parent: secret?.id } }))).toEqual([404, "no-parent"]);
    expect(await count("SELECT COUNT(*) AS n FROM comments WHERE body = 'Peek.'")).toBe(0);
    const answered = await answer<{ comment: Record<string, unknown> }>(await call(`/threads/${n}/comments`, { ...meera, body: { body: "Fine as is.", question: "order" } }), 201);
    expect(answered.comment).toMatchObject({ question: "order", audience: "thread", mine: true });
    expect(JSON.stringify(answered)).not.toMatch(/meera@|personNumber/);
  });

  it("says which comments are theirs by their address, never by their name, and tells another person nothing of it", async () => {
    const n = await shared();
    await call(`/threads/${n}/comments`, { as: { email: MEERA }, body: { body: "Mine.", question: "order" } });
    await invite(n, "other@example.com", "Meera");
    await call(`/threads/${n}/comments`, { as: { email: "other@example.com" }, body: { body: "Also Meera.", question: "order" } });
    const seen = await answer<{ comments: { body: string; name: string | null; mine: boolean }[] }>(await call(`/threads/${n}`, { as: { email: MEERA } }));
    expect(seen.comments.map((one) => [one.body, one.name, one.mine])).toEqual([
      ["For everyone.", null, false],
      ["Mine.", "Meera", true],
      ["Also Meera.", "Meera", false],
    ]);
    expect(JSON.stringify(seen)).not.toMatch(/meera@|other@/);
    const his = await answer<{ comments: { body: string; mine: boolean }[] }>(await call(`/threads/${n}`));
    expect(his.comments.filter((one) => one.mine).map((one) => one.body)).toEqual(["For everyone.", "Only me: her budget."]);
  });

  it("refuses a comment's audience that is none of thread, owner and public", async () => {
    const n = await thread();
    expect(await reasonOf(await call(`/threads/${n}/comments`, { body: { body: "x", audience: "everyone" } }))).toEqual([400, "comment"]);
  });
});

describe("the owner's list", () => {
  type Row = { number: number; shared: number; waiting: boolean };
  async function rowOf(n: number, tab = "act"): Promise<Row | undefined> {
    return (await answer<{ threads: Row[] }>(await call(`/threads?tab=${tab}`))).threads.find((one) => one.number === n);
  }
  const meera = { as: { email: MEERA } } as const;

  it("says how many people each thread is shared with now", async () => {
    const [a, b] = [await thread(), await thread()];
    await invite(a, MEERA);
    const dev = (await invite(a, DEV, "Dev")).people.find((p) => p.email === DEV)?.id ?? "";
    expect([(await rowOf(a))?.shared, (await rowOf(b))?.shared]).toEqual([2, 0]);
    await removeFrom(a, dev);
    expect((await rowOf(a))?.shared).toBe(1);
  });

  it("waits on him once an invited person has the last word, until he comments", async () => {
    const n = await thread();
    await invite(n, MEERA);
    expect((await rowOf(n))?.waiting).toBe(false);
    await call(`/threads/${n}/comments`, { ...meera, body: { body: "Over to you." } });
    expect((await rowOf(n))?.waiting).toBe(true);
    // The sync's word doesn't answer them; his own does.
    await call(`/threads/${n}/comments`, { as: "sync", body: { body: "Noted." } });
    expect((await rowOf(n))?.waiting).toBe(true);
    await call(`/threads/${n}/comments`, { body: { body: "Thanks.", audience: "owner" } });
    expect((await rowOf(n))?.waiting).toBe(false);
  });

  it("stops waiting when he moves or edits it", async () => {
    const [moved, edited] = [await thread(), await thread()];
    for (const n of [moved, edited]) {
      await invite(n, MEERA);
      await call(`/threads/${n}/comments`, { ...meera, body: { body: "Over to you." } });
      expect((await rowOf(n))?.waiting).toBe(true);
    }
    // Comments made within the same millisecond as the next change would compare equal; the next change is later.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await call(`/threads/${moved}`, { body: { action: "done" } })).status).toBe(200);
    expect((await rowOf(moved, "done"))?.waiting).toBe(false);
    expect((await call(`/threads/${edited}/text`, { body: { field: "summary", text: "Agreed." } })).status).toBe(200);
    expect((await rowOf(edited))?.waiting).toBe(false);
  });
});

describe("a meeting, as an invited person sees it", () => {
  /** A thread shared with Meera that is a meeting, with Dev (who has an address and no invitation) and Leela (who has neither) in it. */
  async function stage(): Promise<{ n: number; dev: number }> {
    const n = await thread();
    await invite(n, MEERA);
    const other = await thread();
    // Dev is a person with an address by an invitation to another thread, taken back, so he can't sign in.
    const dev = (await invite(other, DEV, "Dev")).people[0]?.id ?? "";
    await removeFrom(other, dev);
    const devNumber = (await (await harness.db()).prepare("SELECT number FROM people WHERE email = ?1").bind(DEV).first<{ number: number }>())?.number ?? 0;
    const meeting = (body: unknown): Promise<Response> => call(`/threads/${n}/meeting`, { body });
    await answer(await meeting({ when: "2026-11-09", minutes: null, where: null }));
    await answer(await meeting({ when: "2026-11-09T09:30:00.000Z", minutes: 45, where: "Meet" }));
    await answer(await call(`/threads/${n}/attendees`, { body: { add: { person: devNumber } } }));
    await answer(await call(`/threads/${n}/attendees`, { body: { add: { name: "Leela" } } }));
    return { n, dev: devNumber };
  }

  it("is its when, length and where, and its people by name only, on their thread and their list", async () => {
    const { n } = await stage();
    const meeting = { when: "2026-11-09T09:30:00.000Z", minutes: 45, where: "Meet", attendees: [{ name: "Dev", photo: null }, { name: "Leela", photo: null }] };
    expect((await answer<Shown>(await call(`/threads/${n}`, { as: { email: MEERA } }))).thread.meeting).toEqual(meeting);
    const listed = await answer<{ threads: Record<string, unknown>[] }>(await call("/threads", { as: { email: MEERA } }));
    expect(listed.threads.map((row) => row.meeting)).toEqual([meeting]);
  });

  it("is its history with where it moved from, and the people by name, never their numbers", async () => {
    const { n } = await stage();
    const events = (await answer<Shown>(await call(`/threads/${n}`, { as: { email: MEERA } }))).events.filter((event) => event.type.startsWith("meeting-") || event.type.startsWith("attendee-"));
    expect(events.map(({ type, data }) => ({ type, data }))).toEqual([
      { type: "meeting-set", data: { from: null, to: { when: "2026-11-09", minutes: null, where: null } } },
      {
        type: "meeting-set",
        data: { from: { when: "2026-11-09", minutes: null, where: null }, to: { when: "2026-11-09T09:30:00.000Z", minutes: 45, where: "Meet" } },
      },
      { type: "attendee-added", data: { name: "Dev" } },
      { type: "attendee-added", data: { name: "Leela" } },
    ]);
  });

  it("marks their own place in a meeting as theirs, by the address they signed in with, and shows no address", async () => {
    const { n } = await stage();
    const meeraNumber = (await (await harness.db()).prepare("SELECT number FROM people WHERE email = ?1").bind(MEERA).first<{ number: number }>())?.number ?? 0;
    await answer(await call(`/threads/${n}/attendees`, { body: { add: { person: meeraNumber } } }));
    // A namesake with no address is someone else, never "you".
    await answer(await call(`/threads/${n}/attendees`, { body: { add: { name: "Meera" } } }));
    const seen = await answer<Shown>(await call(`/threads/${n}`, { as: { email: MEERA } }));
    expect((seen.thread.meeting as { attendees: unknown[] }).attendees).toEqual([{ name: "Dev", photo: null }, { name: "Leela", photo: null }, { name: "Meera", photo: null, you: true }, { name: "Meera", photo: null }]);
    const listed = JSON.stringify(await answer(await call("/threads", { as: { email: MEERA } })));
    expect(listed).toContain('"you":true');
    expect(JSON.stringify(seen)).not.toMatch(/meera@|dev@/);
    // The owner and the sync read the thread's people with their addresses, as always; its meeting carries none.
    for (const caller of ["owner", "sync"] as const) {
      expect(JSON.stringify((await answer<Shown>(await call(`/threads/${n}`, { as: caller }))).thread.meeting)).not.toMatch(/meera@|dev@|email/);
    }
    const owner = await answer<Shown>(await call(`/threads/${n}`));
    expect(JSON.stringify(owner.thread.meeting)).not.toContain("you");
  });

  it("grants an attendee with an address nothing: the door refuses them, and so does the sign-in's answer", async () => {
    await stage();
    for (const path of ["/me", "/threads", "/threads/1"]) {
      expect(await reasonOf(await call(path, { as: { email: DEV } }))).toEqual([403, "caller"]);
    }
    const asked = await harness.fetch(`${HEY}/api/access/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: new TextEncoder().encode(JSON.stringify({ token: harness.access.token(harness.access.evaluationClaims(DEV)) })),
    });
    const verdict = (await answer<{ token: string }>(asked)).token.split(".")[1] ?? "";
    expect(JSON.parse(Buffer.from(verdict, "base64url").toString("utf8"))).toMatchObject({ success: false });
    // The invited person signs in as before.
    expect((await call("/me", { as: { email: MEERA } })).status).toBe(200);
  });
});

describe("a respondent he invites back to their thread", () => {
  const QUESTIONS = '<!doctype html><p data-thread-question="stood-out">What stood out?</p><p data-thread-question="fit">Where would it fit?</p>';

  /** An open ask answered once by Meera from her browser, and her thread, which he invited her back to. */
  async function invitedBack(): Promise<{ ask: number; theirs: number }> {
    const ask = await thread({ title: "Tuesday demo" });
    const saved = await harness.fetch(`${THREADS}/${ask}/pages`, {
      method: "POST",
      headers: { "Content-Type": "text/html; charset=utf-8", "Cf-Access-Jwt-Assertion": token("sync") },
      body: new TextEncoder().encode(QUESTIONS),
    });
    expect(saved.status).toBe(201);
    await answer(await call(`/threads/${ask}/ask`, { as: "sync", body: { slug: "tuesday-demo" } }));
    await answer(await call(`/threads/${ask}/ask`, { body: { action: "open" } }));
    const sent = await harness.fetch(`${HEY}/api/asks/tuesday-demo/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: HEY, "CF-Connecting-IP": "203.0.113.9" },
      body: new TextEncoder().encode(JSON.stringify({ question: "stood-out", body: "The resume after the crash.", name: "Meera", email: MEERA, token: "pass", key: "c3".repeat(32) })),
    });
    expect(sent.status).toBe(201);
    const theirs = await count("SELECT number AS n FROM threads WHERE ask_thread_id IS NOT NULL");
    await invite(theirs, MEERA);
    return { ask, theirs };
  }

  it("reads their thread as an answer to the ask, by its slug and title, with the ask's page and their answer as their own", async () => {
    const { theirs } = await invitedBack();
    type Read = Omit<Shown, "comments"> & { comments: { author: string; body: string; mine: boolean }[]; page: { version: number } | null; answeredBy?: unknown };
    const shown = await answer<Read>(await call(`/threads/${theirs}`, { as: { email: MEERA } }));
    expect(shown.thread.ask).toEqual({ slug: "tuesday-demo", title: "Tuesday demo" });
    expect(shown.page?.version).toBe(1);
    expect(shown.comments.map((one) => [one.author, one.body, one.mine])).toEqual([["visitor", "The resume after the crash.", true]]);
    expect(shown.answeredBy).toBeUndefined();
    const frame = await call(`/threads/${theirs}/pages/1`, { as: { email: MEERA } });
    expect(frame.status).toBe(200);
    expect(await frame.text()).toContain("What stood out?");
  });

  it("reads their answer as nobody else's, to another person he invites to the same thread", async () => {
    const { theirs } = await invitedBack();
    await invite(theirs, DEV, "Dev");
    const read = async (email: string): Promise<[string, boolean][]> =>
      (await answer<{ comments: { body: string; mine: boolean }[] }>(await call(`/threads/${theirs}`, { as: { email } }))).comments.map((one) => [one.body, one.mine]);
    expect(await read(DEV)).toEqual([["The resume after the crash.", false]]);
    expect(await read(MEERA)).toEqual([["The resume after the crash.", true]]);
  });

  it("answers again there as themselves, on a question the page asks, and every answer of theirs reads as their own", async () => {
    const { theirs } = await invitedBack();
    const meera = { as: { email: MEERA } } as const;
    const again = await answer<{ comment: Record<string, unknown> }>(await call(`/threads/${theirs}/comments`, { ...meera, body: { body: "Our support triage.", question: "fit" } }), 201);
    expect(again.comment).toMatchObject({ author: "member", name: "Meera", question: "fit", mine: true });
    await answer(await call(`/threads/${theirs}/comments`, { ...meera, body: { body: "The resume, and how fast.", question: "stood-out" } }), 201);
    const shown = await answer<{ comments: { author: string; body: string; question: string | null; mine: boolean }[] }>(await call(`/threads/${theirs}`, meera));
    expect(shown.comments.filter((one) => one.question === "stood-out").map((one) => [one.author, one.body, one.mine])).toEqual([
      ["visitor", "The resume after the crash.", true],
      ["member", "The resume, and how fast.", true],
    ]);
  });

  it("never reads the ask's own thread or its page, and is refused every ask call", async () => {
    const { ask, theirs } = await invitedBack();
    const meera = { as: { email: MEERA } } as const;
    expect(await reasonOf(await call(`/threads/${ask}`, meera))).toEqual([404, "no-thread"]);
    expect((await call(`/threads/${ask}/pages/1`, meera)).status).toBe(404);
    expect(await reasonOf(await call("/asks", meera))).toEqual([403, "owner-only"]);
    for (const body of [{ action: "read" }, { action: "close" }, { action: "open" }, { slug: "mine" }]) {
      expect([body, await reasonOf(await call(`/threads/${theirs}/ask`, { ...meera, body }))]).toEqual([body, [403, "owner-only"]]);
    }
  });
});
