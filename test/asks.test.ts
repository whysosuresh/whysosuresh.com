// Asks, run as production runs them: the Worker's bundle in workerd (test/harness.ts), with a local D1 and R2,
// Turnstile played, and Cloudflare Access played for the private calls. An ask is one of his own threads whose main
// section is a questions page, with a slug that names it at /ask/<slug>; each browser that answers it gets a thread of
// its own, a site note (`source` `talk`) that names the ask. What it holds: the owner and the sync make a draft from a
// page of his own that isn't public, and a taken slug, a thread that isn't his, one with no page and a public one are
// refused; only he opens it, from his own page, and the sync may close it; one browser's key reaches one thread
// however often it answers, and a second key makes a second thread; a draft and a slug nobody has answer the same 404
// bytes on every public call, and a closed ask reads as closed with its page and refuses answers; a reader reads only
// their own browser's answers, never anyone else's, and never the ask's summary, number or id; a name and an email are
// both optional, and an email makes the respondent a person, whose page shows each answer and no empty note; a new
// thread costs a note from the notes' budget and every answer one from the answers'; an answer racing a close is kept
// nowhere; a response thread is never public and is never given a page or a link, and an ask's own thread is never
// published or given a link; the response thread shows the ask's page, to the owner and to the respondent he invites
// back; Asks lists every ask with how many answered; and an open ask's address carries its title and a fixed line in
// its preview, never the summary, while a draft's and a missing slug's get the plain shell.

import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SITE, startHarness, type Harness } from "./harness.ts";

/** Two visitors' keys, as their browsers make them: 32 random bytes as hex. */
const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);
const QUESTIONS = '<!doctype html><p data-thread-question="stood-out">What stood out?</p><p data-thread-question="fit">Where would it fit?</p>';

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
async function call(path: string, request: { as?: Who; body?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(request.as ?? "owner") };
  if (request.body === undefined) return harness.fetch(`${SITE}/threads/api${path}`, { headers });
  headers["Content-Type"] = "application/json";
  headers.Origin = SITE;
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
  const body = { ref: `chat:asks-${refs}`, source: "self", title: `Tuesday demo ${refs}`, body: `Body ${refs}`, space: "stigmer", status: "act", ...fields };
  return (await answer<{ thread: { number: number } }>(await call("/threads", { as: "sync", body }), 201)).thread.number;
}

async function savePage(number: number, html: string, from?: string): Promise<Response> {
  const query = from === undefined ? "" : `?${new URLSearchParams({ from }).toString()}`;
  return harness.fetch(`${SITE}/threads/api/threads/${number}/pages${query}`, {
    method: "POST",
    headers: { "Content-Type": "text/html; charset=utf-8", "Cf-Access-Jwt-Assertion": token("sync") },
    body: new TextEncoder().encode(html),
  });
}

async function askCall(number: number, body: unknown, as: Who = "owner"): Promise<Response> {
  return call(`/threads/${number}/ask`, { as, body });
}

/** A thread of his own with a questions page, made a draft under `slug` by the sync. Answers its number. */
async function draft(slug: string, fields: Record<string, unknown> = {}): Promise<number> {
  const n = await thread(fields);
  expect((await savePage(n, QUESTIONS)).status).toBe(201);
  await answer(await askCall(n, { slug }, "sync"));
  return n;
}

/** A draft he has opened. */
async function opened(slug: string, fields: Record<string, unknown> = {}): Promise<number> {
  const n = await draft(slug, fields);
  await answer(await askCall(n, { action: "open" }));
  return n;
}

async function publicCall(path: string, init: RequestInit = {}): Promise<Response> {
  return harness.fetch(`${SITE}/api/asks/${path}`, init);
}

async function read(slug: string, key: string | null = KEY_A): Promise<{ ask: Record<string, unknown>; page: Record<string, unknown> | null; answers: Record<string, unknown>[] }> {
  return answer(await publicCall(slug, { headers: key === null ? {} : { "X-Visitor-Key": key } }));
}

/** What each daily budget has spent today, summed over every network. */
async function spent(): Promise<Record<string, number>> {
  const database = await harness.db();
  const sum = async (table: string): Promise<number> => (await database.prepare(`SELECT COALESCE(SUM(sends), 0) AS n FROM ${table}`).first<{ n: number }>())?.n ?? -1;
  return { notes: await sum("talk_senders"), answers: await sum("answer_senders"), askThreads: await sum("ask_thread_senders"), askAnswers: await sum("ask_answer_senders") };
}

async function sendAnswer(slug: string, fields: Record<string, unknown> = {}, options: { ip?: string } = {}): Promise<Response> {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": options.ip ?? "203.0.113.7", Origin: SITE };
  const body = { question: "stood-out", body: "The **graph** view.", name: "", email: "", token: "pass", key: KEY_A, ...fields };
  return publicCall(`${slug}/answers`, { method: "POST", headers, body: new TextEncoder().encode(JSON.stringify(body)) });
}

interface Row {
  number: number;
  source: string;
  title: string | null;
  body: string;
  status: string;
  space: string | null;
  main: string;
  senderName: string | null;
  senderEmail: string | null;
  senderNumber: number | null;
  ask: Record<string, unknown> | null;
}

/** The response threads, as the owner's To look at tab lists them. */
async function responses(): Promise<Row[]> {
  const { threads } = await answer<{ threads: Row[] }>(await call("/threads?tab=look"));
  return threads.filter((row) => row.source === "talk");
}

describe("making an ask", () => {
  it("makes a draft of his own page, by the owner or the sync, with its event, and says so on every row", async () => {
    const n = await thread();
    await savePage(n, QUESTIONS);
    const made = await answer<{ thread: Row }>(await askCall(n, { slug: "demo-nov-10" }));
    expect(made.thread.ask).toEqual({ slug: "demo-nov-10", state: "draft" });
    const shown = await answer<{ thread: Row; events: { type: string; data: Record<string, unknown> }[] }>(await call(`/threads/${n}`));
    expect(shown.thread.ask).toEqual({ slug: "demo-nov-10", state: "draft" });
    expect(shown.events.at(-1)).toMatchObject({ type: "ask-drafted", data: { slug: "demo-nov-10" } });
    const other = await thread();
    expect((await answer<{ thread: Row }>(await call(`/threads/${other}`))).thread.ask).toBeNull();
  });

  it("refuses a taken slug, a thread that isn't his, one with no page, one already an ask, and a malformed slug", async () => {
    await draft("taken");
    const n = await thread();
    await savePage(n, QUESTIONS);
    expect(await reasonOf(await askCall(n, { slug: "taken" }))).toEqual([409, "slug-taken"]);
    for (const slug of ["Upper", "-lead", "trail-", "a".repeat(41), "sp ace", ""]) expect([slug, ...(await reasonOf(await askCall(n, { slug })))]).toEqual([slug, 400, "ask"]);
    expect(await reasonOf(await askCall(await thread(), { slug: "no-page" }))).toEqual([409, "no-page"]);
    const told = await thread({ source: "told", name: "Dev" });
    await savePage(told, QUESTIONS);
    expect(await reasonOf(await askCall(told, { slug: "told" }))).toEqual([409, "not-his-words"]);
    await answer(await askCall(n, { slug: "mine" }));
    expect(await reasonOf(await askCall(n, { slug: "again" }))).toEqual([409, "an-ask"]);
    expect(await reasonOf(await askCall(999, { slug: "nobody" }))).toEqual([404, "no-thread"]);
  });

  it("refuses a public thread, and never publishes an ask's own thread or gives it a link", async () => {
    const pub = await thread();
    await savePage(pub, QUESTIONS);
    await answer(await call(`/threads/${pub}`, { body: { action: "publish" } }));
    expect(await reasonOf(await askCall(pub, { slug: "public" }))).toEqual([409, "public"]);
    const n = await draft("never-public");
    expect(await reasonOf(await call(`/threads/${n}`, { body: { action: "publish" } }))).toEqual([409, "an-ask"]);
    expect(await reasonOf(await call(`/threads/${n}/link`, { body: { url: "https://claude.ai/artifact/abc", title: "Elsewhere" } }))).toEqual([409, "an-ask"]);
    expect((await answer<{ thread: Row }>(await call(`/threads/${n}`))).thread.main).toBe("page");
  });

  it("is opened by the owner alone, from his own page; the sync may close it, and nobody else may touch it", async () => {
    const n = await draft("only-he-opens");
    expect(await reasonOf(await askCall(n, { action: "open" }, "sync"))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await askCall(n, { action: "open" }, { email: "meera@example.com" }))).toEqual([403, "caller"]);
    const opens = await answer<{ thread: Row }>(await askCall(n, { action: "open" }));
    expect(opens.thread.ask).toEqual({ slug: "only-he-opens", state: "open" });
    expect(await reasonOf(await askCall(n, { action: "open" }))).toEqual([409, "not-from-here"]);
    expect((await answer<{ thread: Row }>(await askCall(n, { action: "close" }, "sync"))).thread.ask).toEqual({ slug: "only-he-opens", state: "closed" });
    expect(await reasonOf(await askCall(n, { action: "close" }))).toEqual([409, "not-from-here"]);
    expect((await answer<{ thread: Row }>(await askCall(n, { action: "open" }))).thread.ask).toEqual({ slug: "only-he-opens", state: "open" });
    expect(await reasonOf(await askCall(await thread(), { action: "close" }))).toEqual([409, "not-an-ask"]);
    const shown = await answer<{ events: { type: string; actor: string }[] }>(await call(`/threads/${n}`));
    expect(shown.events.filter((event) => event.type.startsWith("ask-")).map((event) => [event.type, event.actor])).toEqual([
      ["ask-drafted", "sync"],
      ["ask-opened", "owner"],
      ["ask-closed", "sync"],
      ["ask-opened", "owner"],
    ]);
    const crossSite = await harness.fetch(`${SITE}/threads/api/threads/${n}/ask`, {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": token("owner"), "Content-Type": "application/json", Origin: "https://elsewhere.example" },
      body: JSON.stringify({ action: "close" }),
    });
    expect(await reasonOf(crossSite)).toEqual([403, "origin"]);
  });
});

describe("a slug that isn't an open or closed ask", () => {
  it("answers the same 404 bytes on the read, the page and the answers, for a draft and a slug nobody has", async () => {
    await draft("still-a-draft");
    const bodies = new Set<string>();
    for (const slug of ["still-a-draft", "nobody-has-this"]) {
      for (const response of [await publicCall(slug), await publicCall(`${slug}/pages/1`), await sendAnswer(slug)]) {
        expect([slug, response.status, response.headers.get("x-robots-tag")]).toEqual([slug, 404, "noindex"]);
        bodies.add(await response.text());
      }
    }
    expect([...bodies]).toEqual([JSON.stringify({ reason: "no-ask" })]);
    expect(await responses()).toEqual([]);
  });
});

describe("an open ask, as anyone reads it", () => {
  it("says its slug, title, state and page, and never its summary, number or id", async () => {
    const n = await opened("demo", { title: "Tuesday demo" });
    await answer(await call(`/threads/${n}/text`, { body: { field: "summary", text: "Private: Asha seemed lukewarm." } }));
    const response = await publicCall("demo", { headers: { "X-Visitor-Key": KEY_A } });
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      ask: { slug: "demo", title: "Tuesday demo", state: "open" },
      page: { version: 1, savedAt: expect.any(String), versions: [{ version: 1, savedAt: expect.any(String) }] },
      answers: [],
    });
    expect(text).not.toContain("lukewarm");
    expect(text).not.toContain(`"number"`);
    const frame = await publicCall("demo/pages/1");
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(frame.headers.get("x-robots-tag")).toBe("noindex");
    expect(await frame.text()).toContain("What stood out?");
    expect((await publicCall("demo/pages/2")).status).toBe(404);
  });
});

describe("answering an ask", () => {
  it("makes one thread for a browser's key, which every later answer from it reaches", async () => {
    const n = await opened("one-per-key", { title: "Tuesday demo" });
    expect(await answer(await sendAnswer("one-per-key"), 201)).toEqual({});
    expect((await sendAnswer("one-per-key", { question: "fit", body: "In our CI." })).status).toBe(201);
    expect((await sendAnswer("one-per-key", { body: "The graph view, and the speed." })).status).toBe(201);
    const [response, ...rest] = await responses();
    expect(rest).toEqual([]);
    expect(response).toMatchObject({ title: "Tuesday demo", body: "", status: "received", space: "stigmer", main: "page", ask: { number: n, slug: "one-per-key", title: "Tuesday demo" } });
    const shown = await answer<{ comments: { author: string; question: string; body: string; audience: string; state: string }[]; events: { type: string; actor: string }[]; page: { version: number } | null }>(
      await call(`/threads/${response?.number}`),
    );
    expect(shown.comments.map((comment) => [comment.author, comment.question, comment.body, comment.audience, comment.state])).toEqual([
      ["visitor", "stood-out", "The **graph** view.", "thread", "shown"],
      ["visitor", "fit", "In our CI.", "thread", "shown"],
      ["visitor", "stood-out", "The graph view, and the speed.", "thread", "shown"],
    ]);
    expect(shown.events.map((event) => [event.type, event.actor])).toEqual([["created", "visitor"]]);
    expect(shown.page?.version).toBe(1);
    const theirs = await read("one-per-key");
    expect(theirs.answers).toEqual([
      { question: "fit", body: "In our CI.", at: expect.any(String) },
      { question: "stood-out", body: "The graph view, and the speed.", at: expect.any(String) },
    ]);
  });

  it("makes a second thread for a second key", async () => {
    await opened("two-keys");
    expect((await sendAnswer("two-keys")).status).toBe(201);
    expect((await sendAnswer("two-keys", { key: KEY_B, body: "Nothing, honestly." })).status).toBe(201);
    expect((await responses()).length).toBe(2);
  });

  it("never lets a reader see another person's answers", async () => {
    await opened("private-answers");
    expect((await sendAnswer("private-answers", { body: "Mine, A." })).status).toBe(201);
    expect((await read("private-answers", KEY_B)).answers).toEqual([]);
    expect((await read("private-answers", null)).answers).toEqual([]);
    expect((await sendAnswer("private-answers", { key: KEY_B, body: "Mine, B." })).status).toBe(201);
    expect((await read("private-answers", KEY_B)).answers.map((one) => one.body)).toEqual(["Mine, B."]);
    expect((await read("private-answers", KEY_A)).answers.map((one) => one.body)).toEqual(["Mine, A."]);
  });

  it("takes no name and no email, and with an email makes the respondent a person, named once", async () => {
    await opened("optional-name");
    expect((await sendAnswer("optional-name")).status).toBe(201);
    expect((await sendAnswer("optional-name", { key: KEY_B, name: "Asha", email: "Asha@Example.com" })).status).toBe(201);
    expect((await sendAnswer("optional-name", { key: KEY_B, name: "Someone else", email: "other@example.com", question: "fit" })).status).toBe(201);
    const rows = await responses();
    const anonymous = rows.find((row) => row.senderName === null);
    const ravi = rows.find((row) => row.senderName === "Asha");
    expect(anonymous).toMatchObject({ senderEmail: null, senderNumber: null });
    expect(ravi).toMatchObject({ senderEmail: "Asha@Example.com", senderNumber: expect.any(Number) });
    const people = await answer<{ people: { email: string | null; name: string | null }[] }>(await call("/people"));
    expect(people.people.map((person) => [person.name, person.email])).toEqual([["Asha", "asha@example.com"]]);
  });

  it("refuses an answer that isn't one: a malformed email, key, question or body", async () => {
    await opened("malformed");
    for (const fields of [{ email: "not-an-address" }, { key: "short" }, { question: "Bad Id" }, { body: "  " }, { name: "x".repeat(81) }]) {
      const response = await sendAnswer("malformed", fields);
      expect([fields, response.status]).toEqual([fields, 400]);
    }
    expect((await sendAnswer("malformed", { extra: "no" })).status).toBe(400);
    expect(await responses()).toEqual([]);
  });

  it("checks the bot before it reads the ask", async () => {
    expect(await reasonOf(await sendAnswer("nobody-has-this", { token: "fail" }))).toEqual([403, "bot-check"]);
  });

  it("costs a thread from the asks' threads budget only when it makes one, and every answer one from the asks' answers, never a note's or a page's", async () => {
    await opened("budgets");
    expect((await sendAnswer("budgets")).status).toBe(201);
    expect(await spent()).toEqual({ notes: 0, answers: 0, askThreads: 1, askAnswers: 1 });
    expect((await sendAnswer("budgets", { question: "fit" })).status).toBe(201);
    expect(await spent()).toEqual({ notes: 0, answers: 0, askThreads: 1, askAnswers: 2 });
    expect((await sendAnswer("budgets", { key: KEY_B })).status).toBe(201);
    expect(await spent()).toEqual({ notes: 0, answers: 0, askThreads: 2, askAnswers: 3 });
  });

  it("leaves the asks' budgets to asks: a public page's answer never spends them", async () => {
    const n = await thread();
    expect((await savePage(n, QUESTIONS)).status).toBe(201);
    await answer(await call(`/threads/${n}`, { body: { action: "publish" } }));
    const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", Origin: SITE };
    const body = { question: "fit", body: "In CI.", name: "Sam", token: "pass", key: KEY_A };
    expect((await harness.fetch(`${SITE}/api/threads/${n}/answers`, { method: "POST", headers, body: JSON.stringify(body) })).status).toBe(201);
    expect(await spent()).toEqual({ notes: 0, answers: 1, askThreads: 0, askAnswers: 0 });
  });

  it("refuses a new thread at the threads' limit without spending an answer", async () => {
    await opened("thread-limit");
    expect((await sendAnswer("thread-limit")).status).toBe(201);
    const database = await harness.db();
    await database.prepare("UPDATE ask_thread_senders SET sends = 100").run();
    expect(await reasonOf(await sendAnswer("thread-limit", { key: KEY_B }))).toEqual([429, "limit"]);
    expect(await spent()).toEqual({ notes: 0, answers: 0, askThreads: 100, askAnswers: 1 });
  });

  it("stops a network at 400 answers a day, and at 100 new threads, with 429", async () => {
    await opened("limits");
    const database = await harness.db();
    await sendAnswer("limits");
    // Every count today is one sender's: this network's.
    await database.prepare("UPDATE ask_answer_senders SET sends = 400").run();
    expect(await reasonOf(await sendAnswer("limits", { question: "fit" }))).toEqual([429, "limit"]);
    await database.prepare("UPDATE ask_answer_senders SET sends = 1").run();
    await database.prepare("UPDATE ask_thread_senders SET sends = 100").run();
    expect(await reasonOf(await sendAnswer("limits", { key: KEY_B }))).toEqual([429, "limit"]);
    expect((await sendAnswer("limits", { question: "fit" })).status).toBe(201);
  });
});

describe("an origin the asks keep", () => {
  it("is refused to the sync's add, and a thread under it that no ask made never receives an answer", async () => {
    const ask = await opened("own-origin");
    const { thread: shown } = await answer<{ thread: { id: string } }>(await call(`/threads/${ask}`));
    const ref = `ask:${shown.id}:${createHash("sha256").update(KEY_A).digest("hex")}`;
    const add = { ref, source: "self", title: "Planted", body: "Planted.", space: "stigmer", status: "act" };
    expect(await reasonOf(await call("/threads", { as: "sync", body: add }))).toEqual([400, "ref"]);
    const database = await harness.db();
    await database
      .prepare("INSERT INTO threads (id, number, created_at, source, body, status, origin_ref) VALUES ('planted', 900, '2026-11-01T00:00:00.000Z', 'self', 'Planted.', 'act', ?1)")
      .bind(ref)
      .run();
    expect((await sendAnswer("own-origin")).status).not.toBe(201);
    expect((await read("own-origin")).answers).toEqual([]);
    expect(await database.prepare("SELECT COUNT(*) AS n FROM comments").first<{ n: number }>()).toEqual({ n: 0 });
    expect(await responses()).toEqual([]);
  });
});

describe("a closed ask", () => {
  it("reads as closed with its page, and refuses answers with 409", async () => {
    const n = await opened("closed-one");
    expect((await sendAnswer("closed-one")).status).toBe(201);
    await answer(await askCall(n, { action: "close" }));
    const theirs = await read("closed-one");
    expect(theirs.ask).toMatchObject({ state: "closed" });
    expect(theirs.page).toMatchObject({ version: 1 });
    expect(theirs.answers.map((one) => one.body)).toEqual(["The **graph** view."]);
    expect((await publicCall("closed-one/pages/1")).status).toBe(200);
    expect(await reasonOf(await sendAnswer("closed-one", { question: "fit" }))).toEqual([409, "closed"]);
    expect(await reasonOf(await sendAnswer("closed-one", { key: KEY_B }))).toEqual([409, "closed"]);
    expect((await responses()).length).toBe(1);
  });

  it("keeps nowhere an answer that races the close", async () => {
    await opened("race");
    const database = await harness.db();
    // The ask closes between the door reading it and the store keeping the answer: when the answers' budget counts.
    await database.prepare("CREATE TRIGGER close_race AFTER INSERT ON ask_answer_senders BEGIN UPDATE threads SET ask_state = 'closed' WHERE ask_slug = 'race'; END").run();
    try {
      expect(await reasonOf(await sendAnswer("race", { email: "late@example.com", name: "Late" }))).toEqual([409, "closed"]);
    } finally {
      await database.prepare("DROP TRIGGER close_race").run();
    }
    expect(await responses()).toEqual([]);
    expect(await database.prepare("SELECT COUNT(*) AS n FROM comments").first<{ n: number }>()).toEqual({ n: 0 });
    expect(await database.prepare("SELECT COUNT(*) AS n FROM people").first<{ n: number }>()).toEqual({ n: 0 });
  });
});

describe("a response thread", () => {
  it("is never made public, and is never given a page or a link", async () => {
    await opened("guarded");
    expect((await sendAnswer("guarded")).status).toBe(201);
    const [response] = await responses();
    const n = response?.number ?? 0;
    expect(await reasonOf(await call(`/threads/${n}`, { body: { action: "publish" } }))).toEqual([409, "not-his-words"]);
    expect(await reasonOf(await savePage(n, "<!doctype html><p>Mine</p>"))).toEqual([409, "asked"]);
    expect((await (await harness.pages()).list()).objects.length).toBe(1);
    expect(await reasonOf(await call(`/threads/${n}/link`, { body: { url: "https://claude.ai/artifact/abc", title: "Elsewhere" } }))).toEqual([409, "asked"]);
    expect(await reasonOf(await call(`/threads/${n}/text`, { body: { field: "body", text: "Rewritten" } }))).toEqual([409, "visitor-words"]);
  });

  it("shows the ask's newest page to the respondent he invites back", async () => {
    const ask = await opened("invited-back");
    expect((await sendAnswer("invited-back", { name: "Sam", email: "sam@example.com" })).status).toBe(201);
    const [response] = await responses();
    const n = response?.number ?? 0;
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: "sam@example.com", name: "Sam" } } }));
    await savePage(ask, QUESTIONS.replace("What stood out?", "What stood out, now?"));
    const sam = { email: "sam@example.com" };
    const shown = await answer<{ thread: Row; page: { version: number } | null; comments: { body: string }[] }>(await call(`/threads/${n}`, { as: sam }));
    expect(shown.page?.version).toBe(2);
    expect(shown.thread.ask).toEqual({ slug: "invited-back", title: shown.thread.title });
    expect(shown.comments.map((comment) => comment.body)).toEqual(["The **graph** view."]);
    const frame = await call(`/threads/${n}/pages/2`, { as: sam });
    expect(frame.status).toBe(200);
    expect(await frame.text()).toContain("What stood out, now?");
    expect((await call(`/threads/${ask}/pages/2`, { as: sam })).status).toBe(404);
  });

  it("never tells the respondent he invites back the claude.ai address the ask's page came from", async () => {
    const ask = await draft("no-source");
    expect((await savePage(ask, QUESTIONS, "https://claude.ai/artifact/questions")).status).toBe(201);
    await answer(await askCall(ask, { action: "open" }));
    expect((await sendAnswer("no-source", { name: "Sam", email: "sam@example.com" })).status).toBe(201);
    const [response] = await responses();
    const n = response?.number ?? 0;
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: "sam@example.com", name: "Sam" } } }));
    const theirs = await call(`/threads/${n}`, { as: { email: "sam@example.com" } });
    const text = await theirs.text();
    expect(theirs.status).toBe(200);
    expect(text).not.toContain("claude.ai");
    const page = (JSON.parse(text) as { page: { version: number; versions: Record<string, unknown>[] } & Record<string, unknown> }).page;
    expect(page.version).toBe(2);
    expect("source" in page || page.versions.some((version) => "source" in version)).toBe(false);
    const his = await answer<{ page: { source: string | null } }>(await call(`/threads/${n}`));
    expect(his.page.source).toBe("https://claude.ai/artifact/questions");
  });

  it("is listed under its ask's thread as who answered, for the owner", async () => {
    const ask = await opened("answered-by");
    expect((await sendAnswer("answered-by", { name: "Asha" })).status).toBe(201);
    expect((await sendAnswer("answered-by", { key: KEY_B })).status).toBe(201);
    const numbers = (await responses()).map((row) => row.number).sort((a, b) => a - b);
    await answer(await call(`/threads/${numbers[1]}/comments`, { body: { body: "Thanks!" } }), 201);
    const shown = await answer<{ answeredBy: { number: number; name: string | null; at: string; waiting: boolean }[] }>(await call(`/threads/${ask}`));
    expect(shown.answeredBy).toEqual([
      { number: numbers[0], name: "Asha", at: expect.any(String), waiting: true },
      { number: numbers[1], name: null, at: expect.any(String), waiting: false },
    ]);
  });
});

describe("Mark read", () => {
  /** The response threads' numbers, and whether each waits on him, as the owner's list says. */
  async function waiting(): Promise<Record<number, boolean>> {
    const { threads } = await answer<{ threads: (Row & { waiting: boolean })[] }>(await call("/threads?tab=look"));
    return Object.fromEntries(threads.filter((row) => row.source === "talk").map((row) => [row.number, row.waiting]));
  }

  it("ends the wait on every response thread that waits on him, with one event each, and touches no other", async () => {
    const ask = await opened("mark-read");
    expect((await sendAnswer("mark-read")).status).toBe(201);
    expect((await sendAnswer("mark-read", { key: KEY_B })).status).toBe(201);
    const [first, second] = Object.keys(await waiting()).map(Number).sort((a, b) => a - b);
    await answer(await call(`/threads/${second}/comments`, { body: { body: "Thanks!" } }), 201);
    const other = await opened("other-ask");
    expect((await sendAnswer("other-ask")).status).toBe(201);
    const before = await waiting();
    expect(Object.values(before).filter(Boolean).length).toBe(2);
    const activity = async (n: number | undefined): Promise<string> => (await answer<{ thread: { activityAt: string } }>(await call(`/threads/${n}`))).thread.activityAt;
    const [firstBefore, secondBefore] = [await activity(first), await activity(second)];
    expect(await answer(await askCall(ask, { action: "read" }))).toEqual({ marked: 1 });
    expect([await activity(first), await activity(second)]).toEqual([firstBefore, secondBefore]);
    const after = await waiting();
    expect([after[first ?? 0], after[second ?? 0]]).toEqual([false, false]);
    expect(Object.values(after).filter(Boolean).length).toBe(1);
    const events = async (n: number | undefined): Promise<string[]> =>
      (await answer<{ events: { type: string; actor: string }[] }>(await call(`/threads/${n}`))).events.map((event) => `${event.type}:${event.actor}`);
    expect(await events(first)).toEqual(["created:visitor", "ask-read:owner"]);
    expect(await events(second)).toEqual(["created:visitor"]);
    expect(await answer(await askCall(ask, { action: "read" }))).toEqual({ marked: 0 });
    expect((await answer<{ events: { type: string }[] }>(await call(`/threads/${other}`))).events.map((event) => event.type)).not.toContain("ask-read");
  });

  it("is never shown to the respondent he invites back, who may not mark anything read", async () => {
    const ask = await opened("mark-read-member");
    expect((await sendAnswer("mark-read-member", { name: "Sam", email: "sam@example.com" })).status).toBe(201);
    const [response] = await responses();
    const n = response?.number ?? 0;
    // Inviting is his act on the thread, so it ends the wait itself: Mark read comes first.
    expect(await answer(await askCall(ask, { action: "read" }))).toEqual({ marked: 1 });
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: "sam@example.com", name: "Sam" } } }));
    const sam = { email: "sam@example.com" };
    const theirs = await answer<{ events: { type: string }[] }>(await call(`/threads/${n}`, { as: sam }));
    expect(theirs.events.map((event) => event.type)).not.toContain("ask-read");
    for (const body of [{ action: "read" }, { action: "close" }, { slug: "theirs" }]) expect([body, ...(await reasonOf(await askCall(n, body, sam)))]).toEqual([body, 403, "owner-only"]);
  });

  it("is the owner's alone, from his own page, and only on an ask's own thread", async () => {
    const ask = await opened("mark-read-refused");
    expect((await sendAnswer("mark-read-refused")).status).toBe(201);
    expect(await reasonOf(await askCall(ask, { action: "read" }, "sync"))).toEqual([403, "owner-only"]);
    const [response] = await responses();
    expect(await reasonOf(await askCall(response?.number ?? 0, { action: "read" }))).toEqual([409, "not-an-ask"]);
    expect(await reasonOf(await askCall(await thread(), { action: "read" }))).toEqual([409, "not-an-ask"]);
    expect(await reasonOf(await askCall(999, { action: "read" }))).toEqual([404, "no-thread"]);
    const crossSite = await harness.fetch(`${SITE}/threads/api/threads/${ask}/ask`, {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": token("owner"), "Content-Type": "application/json", Origin: "https://elsewhere.example" },
      body: JSON.stringify({ action: "read" }),
    });
    expect(await reasonOf(crossSite)).toEqual([403, "origin"]);
    expect(await responses()).toHaveLength(1);
  });
});

describe("a respondent's person page", () => {
  it("shows each answer given with an email as an answer, and no empty note", async () => {
    await opened("person-page", { title: "Tuesday demo" });
    expect((await sendAnswer("person-page", { name: "Asha", email: "asha@example.com", body: "The graph." })).status).toBe(201);
    expect((await sendAnswer("person-page", { key: KEY_A, question: "fit", body: "CI." })).status).toBe(201);
    const [response] = await responses();
    const person = await answer<{ words: { kind: string; body: string; thread: { number: number; title: string | null } }[] }>(await call(`/people/${response?.senderNumber}`));
    expect(person.words.map((words) => [words.kind, words.body, words.thread.title])).toEqual([
      ["answer", "CI.", "Tuesday demo"],
      ["answer", "The graph.", "Tuesday demo"],
    ]);
  });
});

describe("Asks", () => {
  it("lists every ask, drafts first, with how many answered and when last, for the owner and the sync alone", async () => {
    const open = await opened("listed-open", { title: "Open one" });
    const drafted = await draft("listed-draft", { title: "Draft one" });
    expect((await sendAnswer("listed-open")).status).toBe(201);
    expect((await sendAnswer("listed-open", { key: KEY_B })).status).toBe(201);
    const listed = await answer<{ asks: Record<string, unknown>[] }>(await call("/asks", { as: "sync" }));
    expect(listed.asks).toEqual([
      { number: drafted, title: "Draft one", slug: "listed-draft", state: "draft", answered: 0, lastAnsweredAt: null, topic: null },
      { number: open, title: "Open one", slug: "listed-open", state: "open", answered: 2, lastAnsweredAt: expect.any(String), topic: null },
    ]);
    await answer(await call(`/threads/${open}/people`, { body: { add: { email: "meera@example.com", name: "Meera" } } }));
    expect(await reasonOf(await call("/asks", { as: { email: "meera@example.com" } }))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await askCall(open, { action: "close" }, { email: "meera@example.com" }))).toEqual([403, "owner-only"]);
  });
});

describe("an ask's address", () => {
  async function page(path: string): Promise<Response> {
    return harness.fetch(`${SITE}${path}`);
  }

  it("carries an open ask's title and a fixed line, never its summary, with no ETag", async () => {
    const n = await opened("previewed", { title: `Tuesday "demo" <b>` });
    await answer(await call(`/threads/${n}/text`, { body: { field: "summary", text: "Private: Asha seemed lukewarm." } }));
    const response = await page("/ask/previewed");
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeNull();
    const html = await response.text();
    expect(html).toContain('<meta property="og:title" content="Tuesday &quot;demo&quot; &lt;b&gt; · whysosuresh.com">');
    expect(html).toContain('<meta property="og:description" content="A few questions from Suresh">');
    expect(html).toContain(`<meta property="og:url" content="${SITE}/ask/previewed">`);
    expect(html).not.toContain("lukewarm");
    expect(html).not.toContain(`#${n}`);
  });

  it("is the plain shell for a draft and a slug nobody has, and for Asks", async () => {
    await draft("drafted-preview");
    const shell = await (await page("/threads/")).text();
    for (const path of ["/ask/drafted-preview", "/ask/nobody-has-this", "/asks"]) expect([path, await (await page(path)).text()]).toEqual([path, shell]);
  });
});
