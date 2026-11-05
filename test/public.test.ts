// Public threads, run as production runs them: the Worker's bundle in workerd (test/harness.ts), with a local D1 and
// R2, Turnstile played, and Cloudflare Access played for the private calls. What it holds: making a thread public
// and taking it back are moves, the owner's alone, and only his own threads may be public. Every number that isn't
// a public thread (private, shared with people, a site note, a told thread, missing, not a number) answers the same
// 404 bytes on the thread, its page and its notes. A public answer holds no email, status, origin, people, events,
// ids, last activity or page source, and only the comments written as Public that are shown. A page version is
// served only while the page is the thread's main section. A visitor's note waits for his OK, answers no number, is
// refused once the thread is taken back, and counts against the note flow's daily limits. Only he shows, drops or
// holds a note; members see shown notes and never a waiting or dropped one, an email, or the events that would
// tell them one arrived. The sync never writes for anyone. A public thread's address carries its title and preview
// tags, escaped, with no ETag; a private and a missing number get the shell byte for byte.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SITE, startHarness, type Harness } from "./harness.ts";

const MEERA = "meera@example.com";
/** The note flow's limit per network, stated here as the contract. */
const PER_NETWORK = 20;

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

/** A private call under /threads/api/, by its path after that. */
async function call(path: string, request: { as?: Who; body?: unknown; origin?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(request.as ?? "owner") };
  if (request.body === undefined) return harness.fetch(`${SITE}/threads/api${path}`, { headers });
  headers["Content-Type"] = "application/json";
  if (request.origin !== null) headers.Origin = request.origin ?? SITE;
  return harness.fetch(`${SITE}/threads/api${path}`, { method: "POST", headers, body: new TextEncoder().encode(JSON.stringify(request.body)) });
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
/** A thread the sync adds: his own unless told otherwise. Answers its number. */
async function thread(fields: Record<string, unknown> = {}): Promise<number> {
  refs += 1;
  const body = { ref: `chat:public-${refs}`, source: "self", title: `Thread ${refs}`, body: `Body ${refs}`, space: "company", status: "act", ...fields };
  return (await answer<{ thread: { number: number } }>(await call("/threads", { as: "sync", body }), 201)).thread.number;
}

async function move(number: number, action: string, as: Who = "owner"): Promise<Response> {
  return call(`/threads/${number}`, { as, body: { action } });
}

async function published(fields: Record<string, unknown> = {}): Promise<number> {
  const n = await thread(fields);
  await answer(await move(n, "publish"));
  return n;
}

/** A site note, as the note flow keeps it; answers its number. */
async function siteNote(): Promise<number> {
  const response = await harness.fetch(`${SITE}/api/talk`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE, "CF-Connecting-IP": "198.51.100.9" },
    body: new TextEncoder().encode(JSON.stringify({ topic: "stigmer", body: "Lost at install.", name: "Asha", email: "asha@example.com", token: "pass" })),
  });
  expect(response.status).toBe(201);
  const row = await (await harness.db()).prepare("SELECT number FROM threads WHERE source = 'talk' ORDER BY number DESC").first<{ number: number }>();
  return row?.number ?? 0;
}

async function publicRead(path: string, init: RequestInit = {}): Promise<Response> {
  return harness.fetch(`${SITE}/api/threads/${path}`, init);
}

interface Note {
  body?: string;
  name?: string;
  email?: string;
  token?: string;
  [key: string]: unknown;
}

async function sendNote(number: number | string, note: Note = {}, options: { ip?: string; origin?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "CF-Connecting-IP": options.ip ?? "203.0.113.7" };
  if (options.origin !== null) headers.Origin = options.origin ?? SITE;
  const body = { body: "Loved this. **not bold**", name: "Tomás", email: "tomas@example.com", token: "pass", ...note };
  return harness.fetch(`${SITE}/api/threads/${number}/notes`, { method: "POST", headers, body: new TextEncoder().encode(JSON.stringify(body)) });
}

interface Shown {
  thread: Record<string, unknown>;
  comments: { id: string; author: string; name: string | null; audience: string; state: string; body: string; senderEmail?: string | null }[];
  events: { type: string; actor: string; data: Record<string, unknown> }[];
}

async function shown(number: number, as: Who = "owner"): Promise<Shown> {
  return answer<Shown>(await call(`/threads/${number}`, { as }));
}

async function noteOn(number: number): Promise<string> {
  expect((await sendNote(number)).status).toBe(201);
  const note = (await shown(number)).comments.find((comment) => comment.author === "visitor" && comment.state === "pending");
  return note?.id ?? "";
}

async function judge(number: number, noteId: string, action: string, as: Who = "owner", origin?: string | null): Promise<Response> {
  return call(`/threads/${number}/comments/${noteId}`, { as, body: { action }, ...(origin === undefined ? {} : { origin }) });
}

async function savePage(number: number, html: string): Promise<void> {
  const response = await harness.fetch(`${SITE}/threads/api/threads/${number}/pages`, {
    method: "POST",
    headers: { "Content-Type": "text/html; charset=utf-8", "Cf-Access-Jwt-Assertion": token("sync") },
    body: new TextEncoder().encode(html),
  });
  expect(response.status).toBe(201);
}

describe("making a thread public", () => {
  it("is a move that sets when, leaves the status alone, and writes its event; taking it back clears it", async () => {
    const n = await thread();
    const made = await answer<{ thread: { publicAt: string | null; status: string } }>(await move(n, "publish"));
    expect(made.thread.status).toBe("act");
    expect(made.thread.publicAt).toEqual(expect.any(String));
    const back = await answer<{ thread: { publicAt: string | null } }>(await move(n, "unpublish"));
    expect(back.thread.publicAt).toBeNull();
    expect((await shown(n)).events.map((event) => [event.type, event.actor])).toEqual([
      ["created", "sync"],
      ["published", "owner"],
      ["unpublished", "owner"],
    ]);
  });

  it("is the owner's alone, refused to the sync and to invited people before anything is read", async () => {
    const n = await thread();
    expect(await reasonOf(await move(n, "publish", "sync"))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await move(999, "publish", "sync"))).toEqual([403, "owner-only"]);
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    expect(await reasonOf(await move(n, "publish", { email: MEERA }))).toEqual([403, "owner-only"]);
    await answer(await move(n, "publish"));
    expect(await reasonOf(await move(n, "unpublish", "sync"))).toEqual([403, "owner-only"]);
  });

  it("is refused for a site note and a told thread, whose words are someone else's", async () => {
    const told = await thread({ source: "told", name: "Ravi" });
    expect(await reasonOf(await move(told, "publish"))).toEqual([409, "not-his-words"]);
    expect(await reasonOf(await move(await siteNote(), "publish"))).toEqual([409, "not-his-words"]);
  });

  it("is refused when it is already public, and taking back one that isn't is refused too", async () => {
    const n = await published();
    expect(await reasonOf(await move(n, "publish"))).toEqual([409, "not-from-here"]);
    await answer(await move(n, "unpublish"));
    expect(await reasonOf(await move(n, "unpublish"))).toEqual([409, "not-from-here"]);
    expect(await reasonOf(await move(999, "publish"))).toEqual([404, "no-thread"]);
  });

  it("can always be taken back while public, whatever its row says", async () => {
    const n = await published();
    await (await harness.db()).prepare("UPDATE threads SET source = 'told' WHERE number = ?1").bind(n).run();
    await answer(await move(n, "unpublish"));
  });

  it("puts the public time and the waiting notes on the owner's list", async () => {
    const n = await published();
    await noteOn(n);
    await noteOn(n);
    const list = await answer<{ threads: { number: number; publicAt: string | null; pending: number }[] }>(await call("/threads?tab=act"));
    expect(list.threads.find((row) => row.number === n)).toMatchObject({ publicAt: expect.any(String), pending: 2 });
  });
});

describe("a number that isn't a public thread", () => {
  /** Every kind of number a stranger may try that isn't public, each staged. */
  async function notPublic(): Promise<string[]> {
    const priv = await thread();
    const invited = await thread();
    await answer(await call(`/threads/${invited}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    const talk = await siteNote();
    const told = await thread({ source: "told", name: "Ravi" });
    const taken = await published();
    await answer(await move(taken, "unpublish"));
    // A site note and a told thread made public by hand still never show.
    await (await harness.db()).prepare("UPDATE threads SET public_at = '2026-11-05T00:00:00.000Z' WHERE number IN (?1, ?2)").bind(talk, told).run();
    return [String(priv), String(invited), String(talk), String(told), String(taken), "999", "0", "042", "abc"];
  }

  it("answers the same 404 bytes on the thread, its page and its notes", async () => {
    const numbers = await notPublic();
    const seen = new Set<string>();
    for (const n of numbers) {
      for (const response of [await publicRead(n), await publicRead(`${n}/pages/1`), await sendNote(n)]) {
        expect(response.status).toBe(404);
        expect(response.headers.get("x-robots-tag")).toBe("noindex");
        seen.add(await response.text());
      }
    }
    expect([...seen]).toEqual([JSON.stringify({ reason: "no-thread" })]);
    expect(await (await harness.db()).prepare("SELECT COUNT(*) AS n FROM comments WHERE author = 'visitor'").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("answers any other path under /api/threads/ the same way, and other methods with 405", async () => {
    const n = await published();
    expect(await (await publicRead(`${n}/people`)).text()).toBe(JSON.stringify({ reason: "no-thread" }));
    expect((await publicRead(`${n}`, { method: "POST" })).status).toBe(405);
    expect((await publicRead(`${n}/notes`)).status).toBe(405);
    expect((await publicRead(`${n}`, { method: "HEAD" })).status).toBe(200);
  });
});

describe("a public thread, as anyone reads it", () => {
  it("says what the thread says, and nothing of his own business", async () => {
    const n = await published({ title: "Shipping 0.1.0, in public", body: "## Why\n\nBecause." });
    await answer(await call(`/threads/${n}/text`, { body: { field: "summary", text: "Decided: ship Friday." } }));
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    const response = await publicRead(String(n));
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const read = await answer<{ thread: Record<string, unknown>; page: unknown; comments: unknown[]; truncated: boolean }>(response);
    expect(read).toEqual({
      thread: { number: n, title: "Shipping 0.1.0, in public", summary: "Decided: ship Friday.", space: "company", main: "text", body: "## Why\n\nBecause.", link: null, createdAt: expect.any(String) },
      page: null,
      comments: [],
      truncated: false,
    });
    const text = JSON.stringify(read);
    for (const word of ["example.com", "status", "ref", "people", "events", "activityAt", "\"id\"", "Meera"]) expect(text).not.toContain(word);
  });

  it("shows only the comments written as Public that are shown, by name", async () => {
    const n = await published();
    await answer(await call(`/threads/${n}/comments`, { body: { body: "For the people here." } }), 201);
    await answer(await call(`/threads/${n}/comments`, { body: { body: "Only me.", audience: "owner" } }), 201);
    await answer(await call(`/threads/${n}/comments`, { as: "sync", body: { body: "From a recording." } }), 201);
    await answer(await call(`/threads/${n}/comments`, { body: { body: "For anyone.", audience: "public" } }), 201);
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    await answer(await call(`/threads/${n}/comments`, { as: { email: MEERA }, body: { body: "Agreed, publicly.", audience: "public" } }), 201);
    const waiting = await noteOn(n);
    const shownNote = await noteOn(n);
    await answer(await judge(n, shownNote, "show"));
    const dropped = await noteOn(n);
    await answer(await judge(n, dropped, "drop"));
    void waiting;
    const read = await answer<{ comments: Record<string, unknown>[] }>(await publicRead(String(n)));
    expect(read.comments).toEqual([
      { author: "owner", name: "Suresh", body: "For anyone.", createdAt: expect.any(String) },
      { author: "member", name: "Meera", body: "Agreed, publicly.", createdAt: expect.any(String) },
      { author: "visitor", name: "Tomás", body: "Loved this. **not bold**", createdAt: expect.any(String) },
    ]);
    expect(JSON.stringify(read)).not.toContain("tomas@example.com");
  });

  it("names a visitor who gave no name as null", async () => {
    const n = await published();
    expect((await sendNote(n, { name: "", email: "" })).status).toBe(201);
    const note = (await shown(n)).comments[0];
    await answer(await judge(n, note?.id ?? "", "show"));
    const read = await answer<{ comments: Record<string, unknown>[] }>(await publicRead(String(n)));
    expect(read.comments).toEqual([{ author: "visitor", name: null, body: "Loved this. **not bold**", createdAt: expect.any(String) }]);
  });

  it("shows a link only while the link is the main section, and the text only while the text is", async () => {
    const n = await published();
    await answer(await call(`/threads/${n}/link`, { body: { url: "https://claude.ai/artifact/abc", title: "The plan" } }));
    const read = await answer<{ thread: Record<string, unknown> }>(await publicRead(String(n)));
    expect(read.thread).toMatchObject({ main: "link", body: null, link: { url: "https://claude.ai/artifact/abc", title: "The plan" } });
  });

  it("serves a page's versions, sealed, without their claude.ai source, only while the page is the main section", async () => {
    const n = await published();
    await savePage(n, "<!doctype html><p>One</p>");
    await savePage(n, "<!doctype html><p>Two</p>");
    const read = await answer<{ thread: Record<string, unknown>; page: unknown }>(await publicRead(String(n)));
    expect(read.thread).toMatchObject({ main: "page", body: null });
    expect(read.page).toEqual({ version: 2, savedAt: expect.any(String), versions: [{ version: 1, savedAt: expect.any(String) }, { version: 2, savedAt: expect.any(String) }] });
    const frame = await publicRead(`${n}/pages/1`);
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(frame.headers.get("x-robots-tag")).toBe("noindex");
    expect(await frame.text()).toContain("<p>One</p>");
    expect((await publicRead(`${n}/pages/3`)).status).toBe(404);

    await answer(await call(`/threads/${n}/link`, { body: { url: "https://claude.ai/artifact/abc", title: "Moved on" } }));
    expect(await (await publicRead(`${n}/pages/1`)).text()).toBe(JSON.stringify({ reason: "no-thread" }));
    expect((await answer<{ page: unknown }>(await publicRead(String(n)))).page).toBeNull();
  });
});

describe("a note on a public thread", () => {
  it("waits for his OK, keeps the name and email typed, answers no number, and writes no event", async () => {
    const n = await published();
    const response = await sendNote(n);
    expect(response.status).toBe(201);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(await response.text()).toBe("{}");
    const view = await shown(n);
    expect(view.comments).toEqual([
      { id: expect.any(String), author: "visitor", name: "Tomás", audience: "public", state: "pending", body: "Loved this. **not bold**", createdAt: expect.any(String), senderEmail: "tomas@example.com" },
    ]);
    expect(view.events.map((event) => event.type)).toEqual(["created", "published"]);
    expect((await shown(n, "sync")).comments[0]?.senderEmail).toBe("tomas@example.com");
  });

  it("is refused once the thread is taken back", async () => {
    const n = await published();
    await answer(await move(n, "unpublish"));
    expect(await (await sendNote(n)).text()).toBe(JSON.stringify({ reason: "no-thread" }));
  });

  it.each([
    ["another origin", {}, { origin: "https://elsewhere.example" }, [403, "origin"]],
    ["no origin", {}, { origin: null }, [403, "origin"]],
    ["a failed bot check", { token: "fail" }, {}, [403, "bot-check"]],
    ["a topic, as the note flow's", { topic: "stigmer" }, {}, [400, "form"]],
    ["an empty note", { body: "  " }, {}, [400, "body"]],
    ["a bad email", { email: "not an address" }, {}, [400, "form"]],
  ] as const)("with %s is refused", async (_, note, options, expected) => {
    const n = await published();
    expect(await reasonOf(await sendNote(n, note, options))).toEqual(expected);
  });

  it("checks the bot before it reads the thread", async () => {
    expect(await reasonOf(await sendNote(999, { token: "fail" }))).toEqual([403, "bot-check"]);
  });

  it("counts against the note flow's daily limit per network", async () => {
    const n = await published();
    for (let i = 0; i < PER_NETWORK; i += 1) expect((await sendNote(n, {}, { ip: "192.0.2.44" })).status).toBe(201);
    expect(await reasonOf(await sendNote(n, {}, { ip: "192.0.2.44" }))).toEqual([429, "limit"]);
    const talk = await harness.fetch(`${SITE}/api/talk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SITE, "CF-Connecting-IP": "192.0.2.44" },
      body: new TextEncoder().encode(JSON.stringify({ topic: "stigmer", body: "x", name: "", email: "", token: "pass" })),
    });
    expect(await reasonOf(talk)).toEqual([429, "limit"]);
  });
});

describe("his OK on a note", () => {
  it("shows it, drops it, and sends either back to waiting, each with its event and never the email", async () => {
    const n = await published();
    const id = await noteOn(n);
    expect((await answer<{ comment: Record<string, unknown> }>(await judge(n, id, "show"))).comment).toMatchObject({ state: "shown", senderEmail: "tomas@example.com" });
    expect((await answer<{ comment: Record<string, unknown> }>(await judge(n, id, "hold"))).comment).toMatchObject({ state: "pending" });
    expect((await answer<{ comment: Record<string, unknown> }>(await judge(n, id, "drop"))).comment).toMatchObject({ state: "dropped" });
    expect((await answer<{ comment: Record<string, unknown> }>(await judge(n, id, "hold"))).comment).toMatchObject({ state: "pending" });
    const events = (await shown(n)).events.filter((event) => event.type.startsWith("note-"));
    expect(events.map((event) => [event.type, event.actor, event.data])).toEqual([
      ["note-shown", "owner", { note: id, name: "Tomás" }],
      ["note-held", "owner", { note: id, name: "Tomás" }],
      ["note-dropped", "owner", { note: id, name: "Tomás" }],
      ["note-held", "owner", { note: id, name: "Tomás" }],
    ]);
  });

  it("is refused when the note isn't where the ruling starts, or isn't a visitor's note on that thread", async () => {
    const n = await published();
    const other = await published();
    const id = await noteOn(n);
    expect(await reasonOf(await judge(n, id, "hold"))).toEqual([409, "not-from-here"]);
    await answer(await judge(n, id, "drop"));
    expect(await reasonOf(await judge(n, id, "show"))).toEqual([409, "not-from-here"]);
    expect(await reasonOf(await judge(other, id, "show"))).toEqual([404, "no-note"]);
    const mine = await answer<{ comment: { id: string } }>(await call(`/threads/${n}/comments`, { body: { body: "Mine." } }), 201);
    expect(await reasonOf(await judge(n, mine.comment.id, "drop"))).toEqual([404, "no-note"]);
    expect(await reasonOf(await judge(999, id, "show"))).toEqual([404, "no-thread"]);
    expect(await reasonOf(await judge(n, "not-an-id", "show"))).toEqual([404, "no-note"]);
    expect(await reasonOf(await judge(n, id, "approve"))).toEqual([400, "change"]);
  });

  it("is the owner's alone, from his own page, refused before anything is read", async () => {
    const n = await published();
    const id = await noteOn(n);
    expect(await reasonOf(await judge(n, id, "show", "sync"))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await judge(999, id, "show", "sync"))).toEqual([403, "owner-only"]);
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    expect(await reasonOf(await judge(n, id, "show", { email: MEERA }))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await judge(n, id, "show", "owner", "https://elsewhere.example"))).toEqual([403, "origin"]);
    expect((await shown(n)).comments[0]?.state).toBe("pending");
  });
});

describe("what invited people see on a public thread", () => {
  it("is the shown notes by name, never a waiting or dropped one, an email, or the events that would tell of one", async () => {
    const n = await published();
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    const shownNote = await noteOn(n);
    await answer(await judge(n, shownNote, "show"));
    const dropped = await noteOn(n);
    await answer(await judge(n, dropped, "drop"));
    const held = await noteOn(n);
    await answer(await judge(n, held, "show"));
    await answer(await judge(n, held, "hold"));
    await noteOn(n);
    await answer(await call(`/threads/${n}/comments`, { body: { body: "Mine, for anyone.", audience: "public" } }), 201);

    const view = await shown(n, { email: MEERA });
    expect(view.thread.publicAt).toEqual(expect.any(String));
    expect(view.comments.map((comment) => [comment.author, comment.name, comment.state, comment.audience])).toEqual([
      ["visitor", "Tomás", "shown", "public"],
      ["owner", null, "shown", "public"],
    ]);
    expect(JSON.stringify(view)).not.toContain("tomas@example.com");
    expect(view.events.map((event) => event.type)).toEqual(["created", "published", "invited", "note-shown", "note-shown"]);
  });
});

describe("writing for anyone", () => {
  it("is refused on a thread that isn't public, and never taken from the sync", async () => {
    const n = await thread();
    expect(await reasonOf(await call(`/threads/${n}/comments`, { body: { body: "x", audience: "public" } }))).toEqual([409, "not-public"]);
    expect(await reasonOf(await call(`/threads/999/comments`, { body: { body: "x", audience: "public" } }))).toEqual([404, "no-thread"]);
    await answer(await move(n, "publish"));
    expect(await reasonOf(await call(`/threads/${n}/comments`, { as: "sync", body: { body: "x", audience: "public" } }))).toEqual([403, "not-for-sync"]);
    expect(await (await harness.db()).prepare("SELECT COUNT(*) AS n FROM comments").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("is open to an invited person only on a public thread they are in", async () => {
    const n = await thread();
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    expect(await reasonOf(await call(`/threads/${n}/comments`, { as: { email: MEERA }, body: { body: "x", audience: "public" } }))).toEqual([409, "not-public"]);
    const other = await published();
    expect(await reasonOf(await call(`/threads/${other}/comments`, { as: { email: MEERA }, body: { body: "x", audience: "public" } }))).toEqual([404, "no-thread"]);
  });
});

describe("a public thread's address", () => {
  async function page(path: string, headers: Record<string, string> = {}): Promise<Response> {
    return harness.fetch(`${SITE}${path}`, { headers });
  }

  it("is the shell byte for byte for a private and a missing number", async () => {
    const n = await thread();
    const [priv, missing, today] = [await page(`/threads/${n}`), await page("/threads/999"), await page("/threads/")];
    const shell = await today.text();
    expect(await priv.text()).toBe(shell);
    expect(await missing.text()).toBe(shell);
    expect(priv.headers.get("etag")).toBe(today.headers.get("etag"));
  });

  it("carries the thread's title and preview tags, escaped, with no ETag, never answered from a revalidation", async () => {
    const n = await published({ title: `Quotes "<b>&</b>" and 'more'` });
    await answer(await call(`/threads/${n}/text`, { body: { field: "summary", text: "Decided: **ship** it, see [the plan](https://example.org) and #3." } }));
    const shell = await page("/threads/");
    const response = await page(`/threads/${n}-quotes`, { "If-None-Match": shell.headers.get("etag") ?? "" });
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBe(shell.headers.get("content-security-policy"));
    const html = await response.text();
    expect(html).toContain(`<title>#${n} Quotes &quot;&lt;b&gt;&amp;&lt;/b&gt;&quot; and &#39;more&#39; · whysosuresh.com</title>`.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    expect(html).toContain(`<meta property="og:title" content="#${n} Quotes &quot;&lt;b&gt;&amp;&lt;/b&gt;&quot; and &#39;more&#39; · whysosuresh.com">`);
    expect(html).toContain('<meta property="og:description" content="Decided: ship it, see the plan and #3.">');
    expect(html).toContain(`<meta property="og:url" content="${SITE}/threads/${n}">`);
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain("<b>&</b>");
  });

  it("describes a thread by its text's first paragraph only while the text is what it shows", async () => {
    const n = await published({ body: "First *paragraph* here.\n\nSecond one." });
    expect(await (await page(`/threads/${n}`)).text()).toContain('<meta property="og:description" content="First paragraph here.">');
    await savePage(n, "<!doctype html><p>A page</p>");
    const html = await (await page(`/threads/${n}`)).text();
    expect(html).toContain('property="og:title"');
    expect(html).not.toContain("og:description");
  });

  it("cuts a long description at a space, with an ellipsis, under 200 characters", async () => {
    const n = await published({ body: "word ".repeat(80) });
    const description = /og:description" content="([^"]*)"/.exec(await (await page(`/threads/${n}`)).text())?.[1] ?? "";
    expect(description.length).toBeLessThanOrEqual(200);
    expect(description.endsWith("word…")).toBe(true);
  });

  it("goes back to the plain shell once the thread is taken back", async () => {
    const n = await published();
    expect(await (await page(`/threads/${n}`)).text()).toContain("og:title");
    await answer(await move(n, "unpublish"));
    expect(await (await page(`/threads/${n}`)).text()).toBe(await (await page("/threads/")).text());
  });
});
