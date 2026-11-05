// The threads' calls under /threads/api/, run as production runs them: the Worker's bundle in workerd
// (test/harness.ts), with a local D1 and Cloudflare Access played for the threads' own application. What it
// holds: a list answers one tab newest number first, 50 at a time, with the number to go on from and every tab's
// count; an add is numbered after the last, once per ref, and numbers stay unique under adds at the same time; a
// thread's call answers it with its comments and its history, oldest first; every move by number writes its
// event in the same transaction, a refused one writes nothing, and `reopen`'s event names the status it really
// went to; a comment and a text, each from either caller, an edit keeping the text it replaced and leaving
// `moved_at` alone, and a visitor's own words never rewritten; the owner's writes only from his own page, the
// sync alone adding and filing, the owner alone marking his mail opened; each door refuses the other's token;
// and the inbox's moves are in the same history.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SITE, startHarness, type App, type Harness } from "./harness.ts";

/** The most a list answers, and the most comments or events a thread's call answers: the contract, stated here. */
const PAGE = 50;
const HISTORY = 500;
const THREADS = `${SITE}/threads/api/threads`;

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

interface Thread {
  number: number;
  id: string;
  createdAt: string;
  source: string;
  space: string | null;
  title: string | null;
  body: string;
  summary: string | null;
  senderName: string | null;
  senderEmail: string | null;
  status: string;
  kind: string | null;
  dropReason: string | null;
  replyOpenedAt: string | null;
  ref: string | null;
  filedLink: string | null;
  movedAt: string | null;
}

interface Event {
  id: number;
  at: string;
  actor: string;
  type: string;
  data: Record<string, unknown>;
}

interface Shown {
  thread: Thread;
  comments: { id: string; author: string; body: string; createdAt: string }[];
  events: Event[];
  truncated: boolean;
}

type Who = "owner" | "sync";

interface Call {
  as?: Who;
  /** The application whose tag the token carries; the threads' by default. */
  app?: App;
  /** No token at all. */
  noToken?: boolean;
  method?: string;
  body?: unknown;
  rawBody?: string;
  /** The Origin header; the site's own by default for a POST, none for null. */
  origin?: string | null;
}

async function call(path: string, request: Call = {}): Promise<Response> {
  const as = request.as ?? "sync";
  const app = request.app ?? "threads";
  const headers: Record<string, string> = {};
  if (!request.noToken) {
    const claims = as === "sync" ? harness.access.syncClaims(app) : harness.access.ownerClaims(app);
    headers["Cf-Access-Jwt-Assertion"] = harness.access.token(claims, { app });
  }
  const method = request.method ?? (request.body === undefined && request.rawBody === undefined ? "GET" : "POST");
  if (method === "GET") return harness.fetch(`${THREADS}${path}`, { headers });
  headers["Content-Type"] = "application/json";
  if (request.origin !== null) headers.Origin = request.origin ?? SITE;
  const text = request.rawBody ?? JSON.stringify(request.body ?? {});
  return harness.fetch(`${THREADS}${path}`, { method, headers, body: new TextEncoder().encode(text) });
}

async function reasonOf(response: Response): Promise<string> {
  return ((await response.json()) as { reason: string }).reason;
}

let refs = 0;
/** A thread the sync adds, as `inbox add` sends it, with a fresh ref unless one is given. */
function self(fields: Record<string, unknown> = {}): Record<string, unknown> {
  refs += 1;
  return { ref: `chat:thread-${refs}`, source: "self", title: `Thread ${refs}`, body: `Body ${refs}`, space: "company", status: "received", ...fields };
}

async function added(fields: Record<string, unknown> = {}): Promise<Thread> {
  const response = await call("", { body: self(fields) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { thread: Thread }).thread;
}

/** A visitor's note, as the note flow keeps it, put straight in the table. */
async function visitorNote(): Promise<number> {
  const database = await harness.db();
  await database
    .prepare(
      `INSERT INTO threads (id, number, created_at, source, space, body, status, sender_name, sender_email)
       VALUES (?1, (SELECT COALESCE(MAX(number), 0) + 1 FROM threads), ?2, 'talk', 'stigmer', 'My own words, *as typed*.', 'received', 'Asha', 'asha@example.com')`,
    )
    .bind(crypto.randomUUID(), new Date().toISOString())
    .run();
  return (await database.prepare("SELECT MAX(number) AS n FROM threads").first<{ n: number }>())?.n ?? 0;
}

async function shown(number: number): Promise<Shown> {
  const response = await call(`/${number}`);
  expect(response.status).toBe(200);
  return (await response.json()) as Shown;
}

async function eventCount(): Promise<number> {
  return (await (await harness.db()).prepare("SELECT COUNT(*) AS n FROM events").first<{ n: number }>())?.n ?? 0;
}

describe("an add", () => {
  it("is numbered after the last, starts its history, and answers the same thread when its ref comes again", async () => {
    const first = await added();
    const body = self({ space: "stigmer", status: "discuss" });
    const response = await call("", { body });
    expect(response.status).toBe(201);
    const { thread } = (await response.json()) as { thread: Thread };
    expect(thread).toEqual({
      number: first.number + 1,
      id: expect.any(String),
      createdAt: expect.any(String),
      source: "self",
      space: "stigmer",
      title: body.title,
      body: body.body,
      summary: null,
      senderName: null,
      senderEmail: null,
      status: "discuss",
      kind: "idea",
      dropReason: null,
      replyOpenedAt: null,
      ref: body.ref,
      filedLink: null,
      movedAt: null,
    });
    const again = await call("", { body: { ...body, title: "Another title" } });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { thread: Thread }).thread).toEqual(thread);
    expect((await shown(thread.number)).events).toEqual([
      { id: expect.any(Number), at: thread.createdAt, actor: "sync", type: "created", data: { source: "self", status: "discuss" } },
    ]);
  });

  it("keeps a thing told to him with the teller's name, in any space or none", async () => {
    const thread = await added({ source: "told", name: "Dev", space: null });
    expect([thread.source, thread.senderName, thread.space]).toEqual(["told", "Dev", null]);
  });

  it("gives every thread its own number when many arrive at once", async () => {
    const answers = await Promise.all(Array.from({ length: 20 }, () => call("", { body: self() })));
    expect(answers.map((response) => response.status)).toEqual(Array.from({ length: 20 }, () => 201));
    const numbers = await Promise.all(answers.map(async (response) => ((await response.json()) as { thread: Thread }).thread.number));
    expect(numbers.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it.each([
    ["the inbox's topic key", { topic: "stigmer", space: undefined }, "keys"],
    ["a space that isn't one", { space: "elsewhere" }, "space"],
    ["a closed status", { status: "done" }, "status"],
  ])("with %s is refused with 400, and nothing is kept", async (_, fields, reason) => {
    const body = self(fields);
    if ("space" in fields && fields.space === undefined) delete body.space;
    const response = await call("", { body });
    expect(response.status).toBe(400);
    expect(await reasonOf(response)).toBe(reason);
    expect(await eventCount()).toBe(0);
  });

  it("is the sync's alone: the owner is refused with 403, from his own page too", async () => {
    const response = await call("", { as: "owner", body: self() });
    expect(response.status).toBe(403);
    expect(await reasonOf(response)).toBe("sync-only");
  });
});

describe("a list", () => {
  it("answers one tab newest number first, with every tab's count, and pages by number", async () => {
    const look: Thread[] = [];
    for (let i = 0; i < PAGE + 3; i += 1) look.push(await added());
    await added({ status: "act" });
    await added({ status: "discuss" });

    const first = await call("?tab=look");
    expect(first.status).toBe(200);
    const page = (await first.json()) as { threads: Thread[]; counts: Record<string, number>; next: number | null };
    expect(page.counts).toEqual({ look: PAGE + 3, act: 1, discuss: 1, done: 0 });
    const newest = look.map((thread) => thread.number).reverse();
    expect(page.threads.map((thread) => thread.number)).toEqual(newest.slice(0, PAGE));
    expect(page.next).toBe(newest[PAGE - 1]);

    const rest = (await (await call(`?tab=look&before=${page.next}`)).json()) as { threads: Thread[]; next: number | null };
    expect(rest.threads.map((thread) => thread.number)).toEqual(newest.slice(PAGE));
    expect(rest.next).toBeNull();
  });

  it.each(["", "?tab=all", "?tab=look&tab=act", "?tab=look&before=0", "?tab=look&before=x", "?tab=look&page=2"])("refuses %j with 400", async (query) => {
    const response = await call(query);
    expect(response.status).toBe(400);
    expect(await reasonOf(response)).toBe("query");
  });
});

describe("a thread's call", () => {
  it("answers it with its comments and its history, oldest first", async () => {
    const thread = await added();
    expect((await call(`/${thread.number}`, { body: { action: "act" } })).status).toBe(200);
    expect((await call(`/${thread.number}/comments`, { body: { body: "Meera agreed." } })).status).toBe(201);
    expect((await call(`/${thread.number}/comments`, { as: "owner", body: { body: "Good." } })).status).toBe(201);
    const answer = await shown(thread.number);
    expect(answer.thread.status).toBe("act");
    expect(answer.comments.map((comment) => [comment.author, comment.body])).toEqual([
      ["sync", "Meera agreed."],
      ["owner", "Good."],
    ]);
    expect(answer.events.map((event) => event.type)).toEqual(["created", "moved"]);
    expect(answer.truncated).toBe(false);
  });

  it("stops each list at 500, and says so when there are more", async () => {
    const thread = await added();
    const database = await harness.db();
    await database.batch(
      Array.from({ length: HISTORY + 1 }, (_, i) =>
        database.prepare("INSERT INTO comments (id, thread_id, author, body, created_at) VALUES (?1, ?2, 'sync', 'x', ?3)").bind(crypto.randomUUID(), thread.id, `2026-11-05T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`),
      ),
    );
    const answer = await shown(thread.number);
    expect(answer.comments).toHaveLength(HISTORY);
    expect(answer.events).toHaveLength(1);
    expect(answer.truncated).toBe(true);
  });

  it.each(["/999", "/0", "/042", "/-1", "/abc", "/1.5", "/1234567890"])("for %s answers 404, as a thread that isn't there", async (path) => {
    const response = await call(path);
    expect(response.status).toBe(404);
    expect(await reasonOf(response)).toBe("no-thread");
  });
});

describe("a move by number", () => {
  it("writes its event with the move, from where it was to where it went", async () => {
    const thread = await added({ status: "discuss" });
    const response = await call(`/${thread.number}`, { as: "owner", body: { action: "drop", reason: "Not now" } });
    expect(response.status).toBe(200);
    const { thread: after } = (await response.json()) as { thread: Thread };
    expect([after.status, after.dropReason, after.movedAt !== null]).toEqual(["dropped", "Not now", true]);
    const events = (await shown(thread.number)).events;
    expect(events[1]).toEqual({ id: expect.any(Number), at: after.movedAt, actor: "owner", type: "moved", data: { from: "discuss", to: "dropped", reason: "Not now" } });
  });

  it.each([
    ["act", "act"],
    ["discuss", "discuss"],
    ["received", "received"],
  ])("reopen's event names the status it really went to, from a thread sorted to %s", async (start, back) => {
    const thread = await added({ status: start });
    expect((await call(`/${thread.number}`, { body: { action: "drop", reason: "" } })).status).toBe(200);
    const reopened = await call(`/${thread.number}`, { body: { action: "reopen" } });
    expect(((await reopened.json()) as { thread: Thread }).thread.status).toBe(back);
    const events = (await shown(thread.number)).events;
    expect(events.map((event) => event.data)).toEqual([
      { source: "self", status: start },
      { from: start, to: "dropped" },
      { from: "dropped", to: back },
    ]);
  });

  it("files a thread as the sync, with the link in its event, and reopens a done one back to Filed", async () => {
    const thread = await added();
    const link = "https://github.com/example/notes/issues/7";
    expect((await call(`/${thread.number}`, { body: { action: "file", link } })).status).toBe(200);
    expect((await call(`/${thread.number}`, { body: { action: "done" } })).status).toBe(200);
    const reopened = await call(`/${thread.number}`, { body: { action: "reopen" } });
    expect(((await reopened.json()) as { thread: Thread }).thread).toMatchObject({ status: "filed", filedLink: link, kind: "feedback" });
    expect((await shown(thread.number)).events.slice(1).map((event) => event.data)).toEqual([
      { from: "received", to: "filed", link },
      { from: "filed", to: "done" },
      { from: "done", to: "filed" },
    ]);
  });

  it("changes the space, to the company too, and says so in the history", async () => {
    const thread = await added({ space: "stigmer" });
    const response = await call(`/${thread.number}`, { body: { action: "space", space: "company" } });
    expect(((await response.json()) as { thread: Thread }).thread.space).toBe("company");
    expect((await shown(thread.number)).events[1]).toMatchObject({ type: "space", data: { from: "stigmer", to: "company" } });
  });

  it("refused because the thread isn't where the move starts is 409, and writes no event", async () => {
    const thread = await added();
    const before = await eventCount();
    const response = await call(`/${thread.number}`, { body: { action: "reopen" } });
    expect(response.status).toBe(409);
    expect(await reasonOf(response)).toBe("not-from-here");
    expect(await eventCount()).toBe(before);
    expect((await shown(thread.number)).thread).toEqual(thread);
  });

  it("on a thread that isn't there is 404, and writes no event", async () => {
    const response = await call("/77", { body: { action: "act" } });
    expect(response.status).toBe(404);
    expect(await reasonOf(response)).toBe("no-thread");
    expect(await eventCount()).toBe(0);
  });

  it("keeps each move to its caller: file is the sync's, reply-opened the owner's", async () => {
    const note = await visitorNote();
    const filing = await call(`/${note}`, { as: "owner", body: { action: "file", link: "https://github.com/example/notes/issues/1" } });
    expect([filing.status, await reasonOf(filing)]).toEqual([403, "sync-only"]);
    const opening = await call(`/${note}`, { body: { action: "reply-opened" } });
    expect([opening.status, await reasonOf(opening)]).toEqual([403, "owner-only"]);
    const opened = await call(`/${note}`, { as: "owner", body: { action: "reply-opened" } });
    expect(opened.status).toBe(200);
    expect((await shown(note)).events.map((event) => [event.type, event.actor, event.data])).toEqual([["reply-opened", "owner", {}]]);
  });

  it.each([
    ["the inbox's topic move", { action: "topic", topic: "stigmer" }],
    ["a space that isn't one", { action: "space", space: "elsewhere" }],
    ["an unknown move", { action: "archive" }],
  ])("with %s is refused with 400", async (_, body) => {
    const thread = await added();
    const response = await call(`/${thread.number}`, { body });
    expect([response.status, await reasonOf(response)]).toEqual([400, "change"]);
  });
});

describe("a comment", () => {
  it("is kept as Markdown, trimmed, with its line breaks, and writes no event", async () => {
    const thread = await added();
    const response = await call(`/${thread.number}/comments`, { body: { body: "  **Meera** agreed.\n\n- releases need two people  " } });
    expect(response.status).toBe(201);
    const { comment } = (await response.json()) as { comment: { id: string; author: string; body: string; createdAt: string } };
    expect(comment).toEqual({ id: expect.any(String), author: "sync", body: "**Meera** agreed.\n\n- releases need two people", createdAt: expect.any(String) });
    expect((await shown(thread.number)).events).toHaveLength(1);
  });

  it.each([
    ["an empty body", { body: "  " }],
    ["a body over 32,000", { body: "x".repeat(32_001) }],
    ["another key", { body: "x", author: "owner" }],
    ["a control character", { body: "a\u0000b" }],
  ])("with %s is refused with 400", async (_, body) => {
    const thread = await added();
    const response = await call(`/${thread.number}/comments`, { body });
    expect([response.status, await reasonOf(response)]).toEqual([400, "comment"]);
  });

  it("on a thread that isn't there is 404", async () => {
    const response = await call("/12/comments", { body: { body: "Hello" } });
    expect([response.status, await reasonOf(response)]).toEqual([404, "no-thread"]);
  });
});

describe("a text", () => {
  it("sets the living summary, keeps the one it replaced in the history, clears it when empty, and leaves moved_at alone", async () => {
    const thread = await added();
    expect((await call(`/${thread.number}`, { body: { action: "act" } })).status).toBe(200);
    const movedAt = (await shown(thread.number)).thread.movedAt;

    const first = await call(`/${thread.number}/text`, { body: { field: "summary", text: "Decided: releases need two people." } });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { thread: Thread }).thread).toMatchObject({ summary: "Decided: releases need two people.", movedAt });
    await call(`/${thread.number}/text`, { as: "owner", body: { field: "summary", text: "Open: who owns pricing." } });
    const cleared = await call(`/${thread.number}/text`, { body: { field: "summary", text: "" } });
    expect(((await cleared.json()) as { thread: Thread }).thread.summary).toBeNull();

    const edits = (await shown(thread.number)).events.filter((event) => event.type === "edited");
    expect(edits.map((event) => [event.actor, event.data])).toEqual([
      ["sync", { field: "summary", before: null }],
      ["owner", { field: "summary", before: "Decided: releases need two people." }],
      ["sync", { field: "summary", before: "Open: who owns pricing." }],
    ]);
    expect((await shown(thread.number)).thread.movedAt).toBe(movedAt);
  });

  it("rewrites the main text of a thread the sync wrote, keeping the text it replaced", async () => {
    const thread = await added({ body: "The first draft." });
    const response = await call(`/${thread.number}/text`, { body: { field: "body", text: "## Who owns what\n\nThe second draft." } });
    expect(((await response.json()) as { thread: Thread }).thread.body).toBe("## Who owns what\n\nThe second draft.");
    expect((await shown(thread.number)).events[1]).toMatchObject({ type: "edited", data: { field: "body", before: "The first draft." } });
  });

  it("never rewrites a visitor's own words, and writes no event; their thread's summary may change", async () => {
    const note = await visitorNote();
    const response = await call(`/${note}/text`, { body: { field: "body", text: "Words they never wrote." } });
    expect([response.status, await reasonOf(response)]).toEqual([409, "visitor-words"]);
    expect((await shown(note)).thread.body).toBe("My own words, *as typed*.");
    expect(await eventCount()).toBe(0);
    const summary = await call(`/${note}/text`, { body: { field: "summary", text: "Asha got lost at the install." } });
    expect(summary.status).toBe(200);
  });

  it.each([
    ["an empty main text", { field: "body", text: " " }],
    ["a summary over 4,000", { field: "summary", text: "x".repeat(4001) }],
    ["a field that isn't one", { field: "title", text: "x" }],
    ["a missing text", { field: "summary" }],
    ["a text that isn't one", { field: "summary", text: 4 }],
  ])("with %s is refused with 400", async (_, body) => {
    const thread = await added();
    const response = await call(`/${thread.number}/text`, { body });
    expect([response.status, await reasonOf(response)]).toEqual([400, "text"]);
  });
});

describe("who gets in", () => {
  it("refuses a request with no token with 401", async () => {
    const response = await call("?tab=look", { noToken: true });
    expect([response.status, await reasonOf(response)]).toEqual([401, "sign-in"]);
  });

  it("refuses a token Access signed for the inbox, and the inbox refuses one signed for the threads", async () => {
    const threads = await call("?tab=look", { app: "inbox" });
    expect([threads.status, await reasonOf(threads)]).toEqual([403, "token"]);
    const inbox = await harness.fetch(`${SITE}/inbox/api/items?tab=look`, {
      headers: { "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.ownerClaims("threads"), { app: "threads" }) },
    });
    expect([inbox.status, await reasonOf(inbox)]).toEqual([403, "token"]);
  });

  it("admits the owner and the sync to read", async () => {
    for (const as of ["owner", "sync"] as const) expect((await call("?tab=look", { as })).status).toBe(200);
  });

  it.each(["", "/1", "/1/comments", "/1/text"])("refuses the owner's write to %j from another origin, or none, with 403", async (path) => {
    if (path !== "") await added();
    const body = path.endsWith("comments") ? { body: "x" } : path.endsWith("text") ? { field: "summary", text: "x" } : path === "" ? self() : { action: "act" };
    for (const origin of ["https://elsewhere.example", null]) {
      const response = await call(path, { as: "owner", body, origin });
      expect(response.status).toBe(403);
      expect(await reasonOf(response)).toBe(path === "" ? "sync-only" : "origin");
    }
  });

  it("answers an unknown route 404 and a wrong method 405", async () => {
    expect((await call("/1/history")).status).toBe(404);
    expect((await harness.fetch(`${SITE}/threads/api/elsewhere`, { headers: { "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.syncClaims("threads"), { app: "threads" }) } })).status).toBe(404);
    expect((await call("", { method: "PUT", body: {} })).status).toBe(405);
    expect((await call("/1/comments", { method: "GET" })).status).toBe(405);
  });
});

describe("the inbox's door", () => {
  it("writes its moves into the same history, by the item's id", async () => {
    const thread = await added();
    const response = await harness.fetch(`${SITE}/inbox/api/items/${thread.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SITE, "Cf-Access-Jwt-Assertion": harness.access.token() },
      body: new TextEncoder().encode(JSON.stringify({ action: "topic", topic: "videos" })),
    });
    expect(response.status).toBe(200);
    expect((await shown(thread.number)).events[1]).toMatchObject({ actor: "owner", type: "space", data: { from: "company", to: "videos" } });
  });
});
