// The threads' calls under /threads/api/, run as production runs them: the Worker's bundle in workerd
// (test/harness.ts), with a local D1 and Cloudflare Access played for the threads' own application. What it
// holds: a list answers one tab newest number first, 50 at a time, with the number to go on from and every tab's
// count; an add is numbered after the last, once per ref, and numbers stay unique under adds at the same time; the
// owner starts a thread of his own from his page; a thread's call answers it with its comments and its history,
// oldest first; every move by number writes its event in the same transaction, a refused one writes nothing, and
// `reopen`'s event names the status it really went to; a comment and a text (a title, a summary or a main text),
// each from either caller, an edit keeping the text it replaced and leaving `moved_at` alone, and a visitor's own
// words never rewritten; every write stamps the thread's last activity; a search answers a number or words; the
// sign-in sends the owner back only to a threads page; the owner's writes only from his own page, the sync alone
// filing, the owner alone marking his mail opened; a comment's place (a reply under a root that isn't a reply, an
// answer or a visitor's note, in its parent's audience; an answer to a page's question; words of a version the thread
// has, their context kept as selected), never the sync's, each comment saying whose it is. The checks of who gets in (every token Access might be handed,
// the keys) and each move's exact row are test/threads-door.test.ts's.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { THREADS as HEY, startHarness, type Harness } from "./harness.ts";

/** The most a list answers, and the most comments or events a thread's call answers: the contract, stated here. */
const PAGE = 50;
const HISTORY = 500;
const THREADS = `${HEY}/threads/api/threads`;

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
  activityAt: string;
  main: string;
  link: { url: string; title: string | null } | null;
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
  const headers: Record<string, string> = {};
  if (!request.noToken) {
    const claims = as === "sync" ? harness.access.syncClaims() : harness.access.ownerClaims();
    headers["Cf-Access-Jwt-Assertion"] = harness.access.token(claims);
  }
  const method = request.method ?? (request.body === undefined && request.rawBody === undefined ? "GET" : "POST");
  if (method === "GET") return harness.fetch(`${THREADS}${path}`, { headers });
  headers["Content-Type"] = "application/json";
  if (request.origin !== null) headers.Origin = request.origin ?? HEY;
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
      senderNumber: null,
      senderEmail: null,
      status: "discuss",
      kind: "idea",
      dropReason: null,
      replyOpenedAt: null,
      ref: body.ref,
      filedLink: null,
      movedAt: null,
      activityAt: thread.createdAt,
      main: "text",
      link: null,
      publicAt: null,
      feedAt: null,
      meeting: null,
      ask: null,
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
    ["a topic key instead of a space", { topic: "stigmer", space: undefined }, "keys"],
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

  it("from the owner's page starts a thread of his own, with a title, a space and an open tab, and no origin", async () => {
    await added();
    const response = await call("", { as: "owner", body: { title: "  Pricing for small teams ", body: "", space: "stigmer", status: "act" } });
    expect(response.status).toBe(201);
    const { thread } = (await response.json()) as { thread: Thread };
    expect(thread).toMatchObject({ number: 2, source: "self", title: "Pricing for small teams", body: "", space: "stigmer", status: "act", kind: "feedback", ref: null, senderName: null });
    expect((await shown(thread.number)).events).toEqual([
      { id: expect.any(Number), at: thread.createdAt, actor: "owner", type: "created", data: { source: "self", status: "act" } },
    ]);
    const again = await call("", { as: "owner", body: { title: "Pricing for small teams", body: "", space: "stigmer", status: "act" } });
    expect(((await again.json()) as { thread: Thread }).thread.number).toBe(3);
  });

  it.each([
    ["the sync's shape", { ref: "chat:x", source: "self", title: "x", body: "x", space: "company", status: "received" }, "keys"],
    ["no title", { title: " ", body: "", space: "company", status: "received" }, "title"],
    ["a title of two lines", { title: "one\ntwo", body: "", space: "company", status: "received" }, "title"],
    ["no space", { title: "x", body: "", space: null, status: "received" }, "space"],
    ["a closed status", { title: "x", body: "", space: "company", status: "done" }, "status"],
  ])("from the owner with %s is refused with 400, and nothing is kept", async (_, body, reason) => {
    const response = await call("", { as: "owner", body });
    expect([response.status, await reasonOf(response)]).toEqual([400, reason]);
    expect(await eventCount()).toBe(0);
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
    expect(page.counts).toEqual({ pending: PAGE + 5, look: PAGE + 3, act: 1, discuss: 1, done: 0 });
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
    ["a topic move instead of a space move", { action: "topic", topic: "stigmer" }],
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
    expect(comment).toEqual({
      id: expect.any(String),
      author: "sync",
      name: null,
      audience: "thread",
      state: "shown",
      body: "**Meera** agreed.\n\n- releases need two people",
      createdAt: expect.any(String),
      parent: null,
      question: null,
      quote: null,
      mine: true,
    });
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

describe("a comment's place", () => {
  interface Placed {
    id: string;
    author: string;
    audience: string;
    body: string;
    parent: string | null;
    question: string | null;
    quote: { text: string; prefix: string; suffix: string; version: number } | null;
    mine: boolean;
  }

  async function placed(number: number, body: Record<string, unknown>, as: Who = "owner"): Promise<Placed> {
    const response = await call(`/${number}/comments`, { as, body });
    expect([response.status, response.status === 201 ? "" : await reasonOf(response)]).toEqual([201, ""]);
    return ((await response.json()) as { comment: Placed }).comment;
  }

  /** A page saved into the thread by the sync, as `inbox page` saves it. */
  async function withPage(number: number): Promise<void> {
    const response = await harness.fetch(`${THREADS}/${number}/pages`, {
      method: "POST",
      headers: { "Content-Type": "text/html; charset=utf-8", "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.syncClaims()) },
      body: new TextEncoder().encode("<!doctype html><title>Plan</title><p>Who opens the meeting?</p>"),
    });
    expect(response.status).toBe(201);
  }

  async function comments(): Promise<number> {
    return (await (await harness.db()).prepare("SELECT COUNT(*) AS n FROM comments").first<{ n: number }>())?.n ?? 0;
  }

  it("is a reply under a general comment, in its parent's audience, and the thread lists it with its parent", async () => {
    const thread = await added();
    const root = await placed(thread.number, { body: "Shall we move it?" });
    const secret = await placed(thread.number, { body: "Only me.", audience: "owner" });
    const reply = await placed(thread.number, { body: "  Yes, to Friday.  ", parent: root.id });
    expect(reply).toMatchObject({ author: "owner", audience: "thread", body: "Yes, to Friday.", parent: root.id, question: null, quote: null, mine: true });
    expect(await placed(thread.number, { body: "Noted.", parent: secret.id })).toMatchObject({ audience: "owner", parent: secret.id });
    const listed = (await shown(thread.number)).comments as unknown as Placed[];
    expect(listed.map((one) => [one.body, one.parent])).toEqual([
      ["Shall we move it?", null],
      ["Only me.", null],
      ["Yes, to Friday.", root.id],
      ["Noted.", secret.id],
    ]);
  });

  it("is an answer to a page's question, for everyone in the thread", async () => {
    const thread = await added();
    const answer = await placed(thread.number, { body: "Fine as is.", question: "order-2" });
    expect(answer).toMatchObject({ audience: "thread", question: "order-2", parent: null, quote: null });
    // Changing an answer is a new answer, so the history keeps both.
    await placed(thread.number, { body: "Swap them.", question: "order-2" });
    expect((await shown(thread.number)).comments.map((one) => one.body)).toEqual(["Fine as is.", "Swap them."]);
  });

  it("is a comment on words of a version the thread has, with its context kept exactly as selected", async () => {
    const thread = await added();
    await withPage(thread.number);
    const said = await placed(thread.number, { body: "Why him?", quote: "Who opens", prefix: "Plan ", suffix: " the meeting?", version: 1 });
    expect(said).toMatchObject({ audience: "thread", parent: null, question: null, quote: { text: "Who opens", prefix: "Plan ", suffix: " the meeting?", version: 1 } });
    expect(await placed(thread.number, { body: "Because.", parent: said.id })).toMatchObject({ parent: said.id, quote: null });
  });

  it("on a version the thread doesn't have is 404 no-version, and writes nothing", async () => {
    const thread = await added();
    const before = await comments();
    const response = await call(`/${thread.number}/comments`, { as: "owner", body: { body: "x", quote: "Who", prefix: "", suffix: "", version: 1 } });
    expect([response.status, await reasonOf(response)]).toEqual([404, "no-version"]);
    await withPage(thread.number);
    const later = await call(`/${thread.number}/comments`, { as: "owner", body: { body: "x", quote: "Who", prefix: "", suffix: "", version: 2 } });
    expect([later.status, await reasonOf(later)]).toEqual([404, "no-version"]);
    expect(await comments()).toBe(before);
  });

  it("refuses a reply to a reply, to an answer and to a visitor's note with 409 no-replies-here, writing nothing", async () => {
    const thread = await added();
    const root = await placed(thread.number, { body: "Root." });
    const reply = await placed(thread.number, { body: "Re.", parent: root.id });
    const answer = await placed(thread.number, { body: "Yes.", question: "q1" });
    const note = crypto.randomUUID();
    const database = await harness.db();
    await database
      .prepare("INSERT INTO comments (id, thread_id, author, body, created_at, audience, state, sender_name) VALUES (?3, ?1, 'visitor', 'Hi.', ?2, 'public', 'shown', 'Asha')")
      .bind(thread.id, new Date().toISOString(), note)
      .run();
    const before = await comments();
    for (const parent of [reply.id, answer.id, note]) {
      const response = await call(`/${thread.number}/comments`, { as: "owner", body: { body: "x", parent } });
      expect([parent, response.status, await reasonOf(response)]).toEqual([parent, 409, "no-replies-here"]);
    }
    expect(await comments()).toBe(before);
  });

  it("refuses a reply to a comment that isn't in the thread with 404 no-parent", async () => {
    const [one, other] = [await added(), await added()];
    const elsewhere = await placed(other.number, { body: "Elsewhere." });
    for (const parent of [elsewhere.id, crypto.randomUUID(), "not-an-id"]) {
      const response = await call(`/${one.number}/comments`, { as: "owner", body: { body: "x", parent } });
      expect([response.status, await reasonOf(response)]).toEqual([404, "no-parent"]);
    }
    const missing = await call("/999/comments", { as: "owner", body: { body: "x", parent: elsewhere.id } });
    expect([missing.status, await reasonOf(missing)]).toEqual([404, "no-thread"]);
  });

  it.each([
    ["a question of capitals", { body: "x", question: "Order" }],
    ["a question over 40", { body: "x", question: "q".repeat(41) }],
    ["an empty question", { body: "x", question: "" }],
    ["a parent that isn't a string", { body: "x", parent: 7 }],
    ["a reply with an audience", { body: "x", parent: "00000000-0000-4000-8000-000000000000", audience: "owner" }],
    ["an answer with a parent", { body: "x", question: "q1", parent: "00000000-0000-4000-8000-000000000000" }],
    ["a blank quote", { body: "x", quote: "   ", prefix: "", suffix: "", version: 1 }],
    ["a quote over 500", { body: "x", quote: "w".repeat(501), prefix: "", suffix: "", version: 1 }],
    ["a prefix over 64", { body: "x", quote: "w", prefix: "p".repeat(65), suffix: "", version: 1 }],
    ["a suffix with a control character", { body: "x", quote: "w", prefix: "", suffix: "a\u0000", version: 1 }],
    ["a version of 0", { body: "x", quote: "w", prefix: "", suffix: "", version: 0 }],
    ["a version as text", { body: "x", quote: "w", prefix: "", suffix: "", version: "1" }],
    ["a quote with no context", { body: "x", quote: "w", version: 1 }],
    ["a quote on a question", { body: "x", quote: "w", prefix: "", suffix: "", version: 1, question: "q1" }],
    ["an empty body", { body: " ", question: "q1" }],
  ])("with %s is refused with 400", async (_, body) => {
    const thread = await added();
    const response = await call(`/${thread.number}/comments`, { as: "owner", body });
    expect([response.status, await reasonOf(response)]).toEqual([400, "comment"]);
  });

  it("is never the sync's: answers and words come from a page, and a reply from a person", async () => {
    const thread = await added();
    await withPage(thread.number);
    const root = await placed(thread.number, { body: "Root." });
    const before = await comments();
    for (const body of [
      { body: "x", parent: root.id },
      { body: "x", question: "q1" },
      { body: "x", quote: "Who", prefix: "", suffix: "", version: 1 },
    ]) {
      const response = await call(`/${thread.number}/comments`, { as: "sync", body });
      expect([response.status, await reasonOf(response)]).toEqual([403, "not-for-sync"]);
    }
    expect(await comments()).toBe(before);
  });

  it("says whose each comment is: the owner's are his, the sync's the sync's", async () => {
    const thread = await added();
    await placed(thread.number, { body: "His." });
    await placed(thread.number, { body: "Claude's." }, "sync");
    const his = (await (await call(`/${thread.number}`, { as: "owner" })).json()) as { comments: Placed[] };
    expect(his.comments.map((one) => [one.body, one.mine])).toEqual([
      ["His.", true],
      ["Claude's.", false],
    ]);
    expect((await shown(thread.number)).comments.map((one) => (one as unknown as Placed).mine)).toEqual([false, true]);
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

  it("renames a thread, a visitor's note too, keeping the title it replaced", async () => {
    const thread = await added({ title: "First name" });
    const response = await call(`/${thread.number}/text`, { as: "owner", body: { field: "title", text: "  Who owns what " } });
    expect(((await response.json()) as { thread: Thread }).thread.title).toBe("Who owns what");
    expect((await shown(thread.number)).events[1]).toMatchObject({ actor: "owner", type: "edited", data: { field: "title", before: "First name" } });
    const note = await visitorNote();
    const named = await call(`/${note}/text`, { as: "owner", body: { field: "title", text: "Lost at the install" } });
    expect(((await named.json()) as { thread: Thread }).thread).toMatchObject({ title: "Lost at the install", body: "My own words, *as typed*." });
  });

  it.each([
    ["an empty main text", { field: "body", text: " " }],
    ["a summary over 4,000", { field: "summary", text: "x".repeat(4001) }],
    ["an empty title", { field: "title", text: " " }],
    ["a title of two lines", { field: "title", text: "one\ntwo" }],
    ["a title over 200", { field: "title", text: "x".repeat(201) }],
    ["a field that isn't one", { field: "name", text: "x" }],
    ["a missing text", { field: "summary" }],
    ["a text that isn't one", { field: "summary", text: 4 }],
  ])("with %s is refused with 400", async (_, body) => {
    const thread = await added();
    const response = await call(`/${thread.number}/text`, { body });
    expect([response.status, await reasonOf(response)]).toEqual([400, "text"]);
  });
});

describe("the last activity", () => {
  it("is the arrival, then moves with every move, edit and comment, and never with a read", async () => {
    const thread = await added();
    expect(thread.activityAt).toBe(thread.createdAt);
    let last = thread.activityAt;
    const writes: [string, unknown][] = [
      [`/${thread.number}`, { action: "act" }],
      [`/${thread.number}/text`, { field: "summary", text: "Next: call Meera." }],
      [`/${thread.number}/comments`, { body: "Called her." }],
    ];
    for (const [path, body] of writes) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect((await call(path, { body })).status).toBeLessThan(300);
      const now = (await shown(thread.number)).thread.activityAt;
      expect(now > last).toBe(true);
      last = now;
    }
    await call("?tab=act");
    expect((await shown(thread.number)).thread.activityAt).toBe(last);
  });
});

describe("a search", () => {
  async function found(words: string, as: Who = "owner"): Promise<number[]> {
    const response = await harness.fetch(`${HEY}/threads/api/search?${new URLSearchParams({ q: words }).toString()}`, {
      headers: { "Cf-Access-Jwt-Assertion": harness.access.token(as === "owner" ? harness.access.ownerClaims() : harness.access.syncClaims()) },
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { threads: Thread[] }).threads.map((thread) => thread.number);
  }

  it("answers the thread with that number, as 42 or #42", async () => {
    for (let i = 0; i < 3; i += 1) await added();
    expect(await found("2")).toEqual([2]);
    expect(await found("#3", "sync")).toEqual([3]);
    expect(await found("#9")).toEqual([]);
  });

  it("answers the threads whose title, summary or text hold the words, ignoring case, most recently active first", async () => {
    const title = await added({ title: "Pricing for small teams" });
    const body = await added({ body: "We talked about PRICING again." });
    const summary = await added();
    await call(`/${summary.number}/text`, { body: { field: "summary", text: "Open: pricing." } });
    await added({ title: "Something else" });
    expect(await found("pricing")).toEqual([summary.number, body.number, title.number]);
  });

  it("takes % and _ as themselves", async () => {
    await added({ title: "100% done" });
    await added({ title: "1000 done" });
    expect(await found("100%")).toEqual([1]);
    expect(await found("_")).toEqual([]);
  });

  it("answers at most 20", async () => {
    for (let i = 0; i < 22; i += 1) await added({ title: `Same words ${i}` });
    expect(await found("same words")).toHaveLength(20);
  });

  it.each(["", "q=", "q=a&q=b", "q=x&tab=look", `q=${"x".repeat(101)}`])("refuses %j with 400", async (query) => {
    const response = await harness.fetch(`${HEY}/threads/api/search?${query}`, {
      headers: { "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.ownerClaims()) },
    });
    expect([response.status, await reasonOf(response)]).toEqual([400, "query"]);
  });
});

describe("the sign-in", () => {
  async function signIn(next: string | null): Promise<Response> {
    const query = next === null ? "" : `?${new URLSearchParams({ next }).toString()}`;
    return harness.fetch(`${HEY}/threads/api/sign-in${query}`, {
      redirect: "manual",
      headers: { "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.ownerClaims()) },
    });
  }

  it.each(["/", "/meetings", "/threads/", "/threads/42", "/threads/42-who-owns-what", "/people", "/people/7", "/people/7-meera", "/journal", "/journal/2026-11-06", "/journal/2026-W44", "/journal/storylines", "/journal/storylines/the-demo"])("sends the owner on to %s", async (next) => {
    const response = await signIn(next);
    expect([response.status, response.headers.get("location")]).toEqual([303, next]);
  });

  it.each([null, "https://elsewhere.example/", "//elsewhere.example/threads/", "/inbox/", "/threads/42/../../x", "/threads/042", "/threads/42-Who", "/threads/people", "/threads/people/7", "/people/07", "/peoplex", "/people/", "/meetings/", "/meetingsx", "/me/", "/me/x", "/mex", "/me?x", "/journal/", "/journalx", "/journal/today", "/journal/storylines/The-Demo", "/journal/2026-11-06/edit", "/me", "//", "/?x"])(
    "sends %j to Today, /, never anywhere else",
    async (next) => {
      const response = await signIn(next);
      expect([response.status, response.headers.get("location")]).toEqual([303, "/"]);
    },
  );

  it("is behind the threads' sign-in like every call: no token is 401", async () => {
    const response = await harness.fetch(`${HEY}/threads/api/sign-in?next=/threads/`, { redirect: "manual" });
    expect(response.status).toBe(401);
  });
});

describe("who gets in", () => {
  it("refuses a request with no token with 401", async () => {
    const response = await call("?tab=look", { noToken: true });
    expect([response.status, await reasonOf(response)]).toEqual([401, "sign-in"]);
  });

  it("admits the owner and the sync to read", async () => {
    for (const as of ["owner", "sync"] as const) expect((await call("?tab=look", { as })).status).toBe(200);
  });

  it.each(["", "/1", "/1/comments", "/1/text"])("refuses the owner's write to %j from another origin, or none, with 403", async (path) => {
    if (path !== "") await added();
    const body = path.endsWith("comments")
      ? { body: "x" }
      : path.endsWith("text")
        ? { field: "summary", text: "x" }
        : path === ""
          ? { title: "x", body: "", space: "company", status: "received" }
          : { action: "act" };
    for (const origin of ["https://elsewhere.example", null]) {
      const response = await call(path, { as: "owner", body, origin });
      expect([response.status, await reasonOf(response)]).toEqual([403, "origin"]);
    }
    expect(await eventCount()).toBe(path === "" ? 0 : 1);
  });

  it("answers an unknown route 404 and a wrong method 405", async () => {
    expect((await call("/1/history")).status).toBe(404);
    expect((await harness.fetch(`${HEY}/threads/api/elsewhere`, { headers: { "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.syncClaims()) } })).status).toBe(404);
    expect((await call("", { method: "PUT", body: {} })).status).toBe(405);
    expect((await call("/1/comments", { method: "GET" })).status).toBe(405);
  });
});
