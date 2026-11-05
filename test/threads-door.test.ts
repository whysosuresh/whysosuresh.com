// The threads' door (src/threads.ts, src/access.ts) held to the rules the inbox's door held before it retired,
// run as production runs it: the Worker's bundle in workerd (test/harness.ts), with a local D1 and Cloudflare
// Access played (its keys, and tokens signed with them). What it holds: the owner and the sync get in, an address
// with no invitation is refused (test/members.test.ts holds invited people), and every other token is refused,
// whatever check it fails; the keys are fetched once, again for a rotated key, and not
// again for a made-up key within the minute, and the door fails closed when they or the owner's address are
// missing; the Worker reaches nothing but Access's keys; every move the store allows leaves the row exactly as it
// should, every one it refuses leaves it as it was, and every move stamps when; filing is the sync's and marking
// his mail opened the owner's; and every add the sync sends is kept, or refused by its first wrong field. The
// helpers stage and read the threads' table under short names; test/threads.test.ts holds the calls' answers.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_TEAM_DOMAIN, INBOX_SYNC_CLIENT_ID, OWNER, SITE, startHarness, type Claims, type Harness, type TokenOptions } from "./harness.ts";

/** The most a list answers, stated here as the contract rather than imported from the Worker. */
const PAGE = 50;

interface Row {
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
}

interface ListAnswer {
  threads: { id: string; number: number; status: string }[];
  counts: Record<string, number>;
  next: number | null;
  me: string | null;
}

let harness: Harness;
let serial = 0;
/** Each staged thread's number, by its id: the door names a thread by its number. */
const numbers = new Map<string, number>();

/** A UUID-shaped id that sorts by `n`, so ties on the received time still order predictably. */
function idFor(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** Each short name, as the threads' table calls it. */
const COLUMN: Record<keyof Row, string> = {
  id: "id",
  received_at: "created_at",
  source: "source",
  topic: "space",
  body: "body",
  name: "sender_name",
  email: "sender_email",
  status: "status",
  kind: "kind",
  drop_reason: "drop_reason",
  reply_opened_at: "reply_opened_at",
  title: "title",
  ref: "origin_ref",
  filed_link: "filed_link",
};
/** The threads' columns, read back under the short names. */
const AS_ITEM = (Object.keys(COLUMN) as (keyof Row)[]).map((name) => `${COLUMN[name]} AS ${name}`).join(", ");

/** Puts one thread in the table as the note flow (or a later move) would have left it, numbered after the last. */
async function seed(fields: Partial<Row> = {}, target: Harness = harness): Promise<Row> {
  serial += 1;
  const row: Row = {
    id: idFor(serial),
    received_at: new Date(Date.UTC(2026, 10, 4, 9, 0, serial)).toISOString(),
    source: "talk",
    topic: "stigmer",
    body: `Note ${serial}`,
    name: "Asha",
    email: "asha@example.com",
    status: "received",
    kind: null,
    drop_reason: null,
    reply_opened_at: null,
    title: null,
    ref: null,
    filed_link: null,
    ...fields,
  };
  const names = Object.keys(row) as (keyof Row)[];
  await (await target.db())
    .prepare(
      `INSERT INTO threads (number, ${names.map((name) => COLUMN[name]).join(", ")})
       VALUES ((SELECT COALESCE(MAX(number), 0) + 1 FROM threads), ${names.map((_, i) => `?${i + 1}`).join(", ")})`,
    )
    .bind(...names.map((name) => row[name]))
    .run();
  const kept = await (await target.db()).prepare("SELECT number FROM threads WHERE id = ?1").bind(row.id).first<{ number: number }>();
  numbers.set(row.id, kept?.number ?? 0);
  return row;
}

/** The row as a move left it, its `moved_at` stamp aside (stampOf reads that), so a move compares by what it changed. */
async function rowOf(id: string, target: Harness = harness): Promise<Row | null> {
  return (await target.db()).prepare(`SELECT ${AS_ITEM} FROM threads WHERE id = ?1`).bind(id).first<Row>();
}

async function stampOf(id: string): Promise<string | null> {
  return (await (await harness.db()).prepare("SELECT moved_at FROM threads WHERE id = ?1").bind(id).first<{ moved_at: string | null }>())?.moved_at ?? null;
}

interface Ask {
  token?: string | null;
  claims?: Claims;
  options?: TokenOptions;
}

function assertion(ask: Ask, target: Harness): Record<string, string> {
  if (ask.token === null) return {};
  return { "Cf-Access-Jwt-Assertion": ask.token ?? target.access.token(ask.claims, ask.options ?? {}) };
}

async function getList(query: string, ask: Ask = {}, target: Harness = harness): Promise<Response> {
  return target.fetch(`${SITE}/threads/api/threads${query}`, { headers: assertion(ask, target) });
}

interface Post extends Ask {
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
  contentType?: string;
}

/** A move on the thread with that id, by its number; an id never staged names a path that is no thread's. */
async function post(id: string, request: Post = {}, target: Harness = harness): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": request.contentType ?? "application/json", ...assertion(request, target) };
  if (request.origin !== null) headers.Origin = request.origin ?? SITE;
  const text = request.rawBody ?? JSON.stringify(request.body ?? {});
  return target.fetch(`${SITE}/threads/api/threads/${numbers.get(id) ?? id}`, { method: "POST", headers, body: new TextEncoder().encode(text) });
}

async function reasonOf(response: Response): Promise<string> {
  return ((await response.json()) as { reason: string }).reason;
}

beforeAll(async () => {
  harness = await startHarness();
});
afterAll(async () => {
  await harness.dispose();
});
beforeEach(async () => {
  await harness.reset();
  numbers.clear();
});

describe("a list", () => {
  it("answers each tab with its own threads, newest number first, every tab's count, and the owner's address", async () => {
    const look = [await seed(), await seed()];
    const act = await seed({ status: "act", kind: "feedback" });
    const discuss = await seed({ status: "discuss", kind: "idea" });
    const done = await seed({ status: "done", kind: "feedback" });
    const dropped = await seed({ status: "dropped", drop_reason: "junk" });
    const filed = await seed({ status: "filed", kind: "feedback", filed_link: "https://github.com/example/notes/issues/1" });

    const expected: Record<string, string[]> = {
      look: [look[1]?.id ?? "", look[0]?.id ?? ""],
      act: [act.id],
      discuss: [discuss.id],
      done: [filed.id, dropped.id, done.id],
    };
    for (const [tab, ids] of Object.entries(expected)) {
      const response = await getList(`?tab=${tab}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const answer = (await response.json()) as ListAnswer;
      expect(answer.threads.map((thread) => thread.id)).toEqual(ids);
      expect(answer.counts).toEqual({ look: 2, act: 1, discuss: 1, done: 3 });
      expect(answer.next).toBeNull();
      expect(answer.me).toBe(OWNER);
    }
  });

  it("answers the sync with no address", async () => {
    await seed();
    const response = await getList("?tab=look", { claims: harness.access.syncClaims() });
    expect(response.status).toBe(200);
    const answer = (await response.json()) as ListAnswer;
    expect(answer.threads).toHaveLength(1);
    expect(answer.me).toBeNull();
  });
});

describe("who gets in", () => {
  it("refuses a request with no token with 401, before anything else, even an unknown route", async () => {
    for (const path of ["/threads/api/threads?tab=look", "/threads/api/other"]) {
      const response = await harness.fetch(`${SITE}${path}`);
      expect(response.status).toBe(401);
      expect(await reasonOf(response)).toBe("sign-in");
    }
  });

  const refused: [string, Ask][] = [
    ["a spoiled signature", { options: { badSignature: true } }],
    ["a key the team doesn't serve", { options: { foreignKey: true } }],
    ["a made-up key id", { options: { kid: "made-up" } }],
    ["another algorithm", { options: { alg: "HS256" } }],
    ["another application", { claims: { aud: ["0".repeat(64)] } }],
    ["another team", { claims: { iss: "https://elsewhere.cloudflareaccess.com" } }],
    ["an expired token", { claims: { exp: Math.floor(Date.now() / 1000) - 120 } }],
    ["a token not valid yet", { claims: { nbf: Math.floor(Date.now() / 1000) + 600 } }],
    ["a token with no expiry", { claims: { exp: undefined } }],
    ["a token of another type", { claims: { type: "org" } }],
    ["a token that isn't one", { token: "not.a.token" }],
    ["an oversized token, however well signed", { claims: { padding: "x".repeat(9000) } }],
  ];
  it.each(refused)("refuses %s with 403", async (_, ask) => {
    const response = await getList("?tab=look", ask);
    expect(response.status).toBe(403);
    expect(await reasonOf(response)).toBe("token");
  });

  it.each([
    ["another email", { email: "someone@example.com" }],
    ["an email that only contains the owner's", { email: `x${OWNER}` }],
    ["an unknown service token", { email: undefined, sub: "", common_name: "0123456789abcdef.access" }],
    ["the sync's client id beside an email", { email: "someone@example.com", common_name: INBOX_SYNC_CLIENT_ID }],
    ["the sync's client id with an empty email", { email: "", common_name: INBOX_SYNC_CLIENT_ID }],
    ["a token naming no one", { email: undefined }],
  ])("refuses a good signature for %s with 403", async (_, claims) => {
    const response = await getList("?tab=look", { claims });
    expect(response.status).toBe(403);
    expect(await reasonOf(response)).toBe("caller");
  });

  it("admits the owner's address in any case", async () => {
    expect((await getList("?tab=look", { claims: { email: OWNER.toUpperCase() } })).status).toBe(200);
  });

  it("lets the sync move a note with no origin, as a script sends, but not mark the owner's mail opened", async () => {
    const row = await seed();
    const sync = harness.access.syncClaims();
    expect((await getList("?tab=look", { claims: sync })).status).toBe(200);
    expect((await post(row.id, { claims: sync, origin: null, body: { action: "act" } })).status).toBe(200);
    expect(await rowOf(row.id)).toEqual({ ...row, status: "act", kind: "feedback" });
    const refused = await post(row.id, { claims: sync, origin: null, body: { action: "reply-opened" } });
    expect(refused.status).toBe(403);
    expect(await reasonOf(refused)).toBe("owner-only");
    expect(await rowOf(row.id)).toEqual({ ...row, status: "act", kind: "feedback" });
  });

  it("reaches nothing but the team's keys", async () => {
    const fresh = await startHarness();
    try {
      await getList("?tab=look", {}, fresh);
      await post(idFor(999_999), { body: { action: "act" } }, fresh);
      expect([...fresh.outboundHosts]).toEqual([ACCESS_TEAM_DOMAIN]);
    } finally {
      await fresh.dispose();
    }
  });
});

describe("the keys, in a fresh Worker", () => {
  it("are fetched once for two requests at the same time, and kept", async () => {
    const fresh = await startHarness();
    try {
      const both = await Promise.all([getList("?tab=look", {}, fresh), getList("?tab=act", {}, fresh)]);
      expect(both.map((response) => response.status)).toEqual([200, 200]);
      expect((await getList("?tab=done", {}, fresh)).status).toBe(200);
      expect(fresh.access.fetches).toBe(1);
    } finally {
      await fresh.dispose();
    }
  });

  it("are fetched again for a rotated key, and not again for a made-up key within the minute", async () => {
    const fresh = await startHarness();
    try {
      expect((await getList("?tab=look", {}, fresh)).status).toBe(200);
      fresh.access.rotate();
      expect((await getList("?tab=look", {}, fresh)).status).toBe(200);
      expect(fresh.access.fetches).toBe(2);
      expect((await getList("?tab=look", { options: { kid: "made-up" } }, fresh)).status).toBe(403);
      expect((await getList("?tab=look", { options: { kid: "made-up-too" } }, fresh)).status).toBe(403);
      expect(fresh.access.fetches).toBe(2);
    } finally {
      await fresh.dispose();
    }
  });

  it("answer 503 when they can't be read, and nothing changes", async () => {
    const fresh = await startHarness();
    try {
      fresh.access.setDown(true);
      const row = await seed({}, fresh);
      const response = await post(row.id, { body: { action: "act" } }, fresh);
      expect(response.status).toBe(503);
      expect(await reasonOf(response)).toBe("keys");
      expect(await rowOf(row.id, fresh)).toEqual(row);
      fresh.access.setDown(false);
      expect((await getList("?tab=look", {}, fresh)).status).toBe(200);
    } finally {
      await fresh.dispose();
    }
  });

  it("answer the owner 503 when the Worker has no owner address, so it fails closed", async () => {
    const fresh = await startHarness({ owner: "" });
    try {
      const response = await getList("?tab=look", {}, fresh);
      expect(response.status).toBe(503);
      expect(await reasonOf(response)).toBe("not-configured");
      expect(fresh.access.fetches).toBe(0);
    } finally {
      await fresh.dispose();
    }
  });
});

describe("a move", () => {
  const now = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  it.each([
    ["act", "received", null, { status: "act", kind: "feedback" }],
    ["discuss", "received", null, { status: "discuss", kind: "idea" }],
    ["discuss", "act", "feedback", { status: "discuss", kind: "idea" }],
    ["act", "discuss", "idea", { status: "act", kind: "feedback" }],
    ["done", "act", "feedback", { status: "done", kind: "feedback" }],
    ["done", "discuss", "idea", { status: "done", kind: "idea" }],
    ["reopen", "done", "feedback", { status: "act", kind: "feedback" }],
    ["reopen", "done", "idea", { status: "discuss", kind: "idea" }],
    ["unsort", "act", "feedback", { status: "received", kind: null }],
    ["unsort", "discuss", "idea", { status: "received", kind: null }],
  ])("%s from %s (kind %s) leaves the row as %j", async (action, status, kind, after) => {
    const row = await seed({ status, kind });
    const response = await post(row.id, { body: { action } });
    expect(response.status).toBe(200);
    const expected = { ...row, ...after };
    expect(await rowOf(row.id)).toEqual(expected);
    const answer = (await response.json()) as { thread: { id: string; status: string; kind: string | null } };
    expect(answer.thread).toMatchObject({ id: row.id, status: expected.status, kind: expected.kind });
  });

  it.each(["received", "act", "discuss"])("drop from %s keeps the reason, trimmed, and an empty reason as none", async (status) => {
    const row = await seed({ status, kind: status === "act" ? "feedback" : null });
    expect((await post(row.id, { body: { action: "drop", reason: "  a test  " } })).status).toBe(200);
    expect(await rowOf(row.id)).toEqual({ ...row, status: "dropped", drop_reason: "a test" });
    const other = await seed({ status });
    expect((await post(other.id, { body: { action: "drop", reason: "" } })).status).toBe(200);
    expect(await rowOf(other.id)).toEqual({ ...other, status: "dropped", drop_reason: null });
  });

  it.each([
    [null, "received"],
    ["feedback", "act"],
    ["idea", "discuss"],
  ])("reopen from Dropped (kind %s) goes back to %s without its reason, which undoes the drop", async (kind, status) => {
    const row = await seed({ status: "dropped", kind, drop_reason: "junk" });
    expect((await post(row.id, { body: { action: "reopen" } })).status).toBe(200);
    expect(await rowOf(row.id)).toEqual({ ...row, status, drop_reason: null });
  });

  it.each([
    ["act", "received"],
    ["discuss", "received"],
    ["done", "act"],
    ["drop", "discuss"],
    ["reopen", "done"],
    ["reopen", "dropped"],
    ["space", "dropped"],
  ])("each move the page can undo comes back exactly: %s from %s", async (action, status) => {
    const kinds: Record<string, string | null> = { received: null, act: "feedback", discuss: "idea", done: "feedback", dropped: "idea" };
    const row = await seed({ status, kind: kinds[status] ?? null, drop_reason: status === "dropped" ? "junk" : null });
    const there = action === "drop" ? { action, reason: "" } : action === "space" ? { action, space: "videos" } : { action };
    expect((await post(row.id, { body: there })).status).toBe(200);
    const back =
      action === "act" || action === "discuss" ? { action: "unsort" }
      : action === "done" || action === "drop" ? { action: "reopen" }
      : action === "reopen" ? (status === "dropped" ? { action: "drop", reason: "junk" } : { action: "done" })
      : { action: "space", space: row.topic };
    expect((await post(row.id, { body: back })).status).toBe(200);
    expect(await rowOf(row.id)).toEqual(row);
  });

  it.each(["received", "act", "done", "dropped"])("space changes the space from %s and nothing else", async (status) => {
    const row = await seed({ status, topic: null });
    expect((await post(row.id, { body: { action: "space", space: "capsjump" } })).status).toBe(200);
    expect(await rowOf(row.id)).toEqual({ ...row, topic: "capsjump" });
  });

  it("reply-opened records when, for a note with an email", async () => {
    const row = await seed({ status: "discuss", kind: "idea" });
    expect((await post(row.id, { body: { action: "reply-opened" } })).status).toBe(200);
    const after = await rowOf(row.id);
    expect(after?.reply_opened_at).toMatch(now);
    expect({ ...after, reply_opened_at: null }).toEqual(row);
  });

  it.each([
    ["act", "done"],
    ["discuss", "dropped"],
    ["done", "received"],
    ["done", "done"],
    ["drop", "done"],
    ["drop", "dropped"],
    ["reopen", "received"],
    ["reopen", "act"],
    ["unsort", "received"],
    ["unsort", "done"],
    ["unsort", "dropped"],
  ])("%s from %s is refused with 409, and the row stays as it was", async (action, status) => {
    const row = await seed({ status, kind: status === "received" ? null : "feedback" });
    const body = action === "drop" ? { action, reason: "" } : { action };
    const response = await post(row.id, { body });
    expect(response.status).toBe(409);
    expect(await reasonOf(response)).toBe("not-from-here");
    expect(await rowOf(row.id)).toEqual(row);
  });

  it("reply-opened is refused with 409 for a note with no email", async () => {
    const row = await seed({ email: null });
    expect((await post(row.id, { body: { action: "reply-opened" } })).status).toBe(409);
    expect(await rowOf(row.id)).toEqual(row);
  });

  it("on a thread that doesn't exist, or a number that can't be one, is 404", async () => {
    expect((await post(idFor(999_999), { body: { action: "act" } })).status).toBe(404);
    expect((await post("not-an-id", { body: { action: "act" } })).status).toBe(404);
  });

  it.each([
    ["no action", {}],
    ["an unknown action", { action: "archive" }],
    ["an extra key", { action: "act", kind: "idea" }],
    ["a drop with no reason key", { action: "drop" }],
    ["a reason that isn't text", { action: "drop", reason: 7 }],
    ["a reason over 120 characters", { action: "drop", reason: "x".repeat(121) }],
    ["a reason with a control character", { action: "drop", reason: "junk\u0007" }],
    ["a reason with a line break", { action: "drop", reason: "junk\nmore" }],
    ["an unknown space", { action: "space", space: "Stigmer" }],
    ["a missing space", { action: "space" }],
    ["an array", ["act"]],
    ["a string", "act"],
  ])("with %s is refused with 400, and nothing changes", async (_, body) => {
    const row = await seed();
    const response = await post(row.id, { body });
    expect(response.status).toBe(400);
    expect(await reasonOf(response)).toBe("change");
    expect(await rowOf(row.id)).toEqual(row);
  });

  it("from another origin, or with no origin, is refused with 403", async () => {
    const row = await seed();
    expect((await post(row.id, { body: { action: "act" }, origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await post(row.id, { body: { action: "act" }, origin: null })).status).toBe(403);
    expect(await rowOf(row.id)).toEqual(row);
  });

  it("that isn't JSON is refused with 415, and a body that isn't valid JSON with 400", async () => {
    const row = await seed();
    expect((await post(row.id, { rawBody: "action=act", contentType: "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await post(row.id, { rawBody: "{" })).status).toBe(400);
    expect(await rowOf(row.id)).toEqual(row);
  });

  it("larger than a change can be is refused with 413", async () => {
    const row = await seed();
    const response = await post(row.id, { rawBody: JSON.stringify({ action: "drop", reason: "x".repeat(2000) }) });
    expect(response.status).toBe(413);
  });
});

describe("a move by the sync", () => {
  const sync = (): Claims => harness.access.syncClaims();
  const link = "https://github.com/example/notes/issues/42";

  it.each(["received", "act", "discuss"])("file from %s makes it Filed, with its link, as something to act on", async (status) => {
    const row = await seed({ status, kind: status === "discuss" ? "idea" : status === "act" ? "feedback" : null });
    const response = await post(row.id, { claims: sync(), origin: null, body: { action: "file", link } });
    expect(response.status).toBe(200);
    expect(await rowOf(row.id)).toEqual({ ...row, status: "filed", filed_link: link, kind: "feedback" });
    const answer = (await response.json()) as { thread: { status: string; filedLink: string } };
    expect(answer.thread).toMatchObject({ status: "filed", filedLink: link });
  });

  it("done closes a filed note, reopen puts it back as Filed, and space still changes it", async () => {
    const row = await seed({ status: "filed", kind: "feedback", filed_link: link });
    expect((await post(row.id, { body: { action: "done" } })).status).toBe(200);
    expect(await rowOf(row.id)).toEqual({ ...row, status: "done" });
    expect((await post(row.id, { body: { action: "reopen" } })).status).toBe(200);
    expect(await rowOf(row.id)).toEqual(row);
    expect((await post(row.id, { claims: sync(), origin: null, body: { action: "space", space: "videos" } })).status).toBe(200);
    expect(await rowOf(row.id)).toEqual({ ...row, topic: "videos" });
  });

  it.each(["done", "dropped", "filed"])("file from %s is refused with 409", async (status) => {
    const row = await seed({ status, kind: "feedback", filed_link: status === "filed" ? link : null });
    const response = await post(row.id, { claims: sync(), origin: null, body: { action: "file", link } });
    expect(response.status).toBe(409);
    expect(await rowOf(row.id)).toEqual(row);
  });

  it.each(["act", "discuss", "unsort", "drop"])("%s from Filed is refused with 409", async (action) => {
    const row = await seed({ status: "filed", kind: "feedback", filed_link: link });
    const body = action === "drop" ? { action, reason: "" } : { action };
    expect((await post(row.id, { claims: sync(), origin: null, body })).status).toBe(409);
    expect(await rowOf(row.id)).toEqual(row);
  });

  it("file is the sync's alone: the owner is refused with 403", async () => {
    const row = await seed();
    const response = await post(row.id, { body: { action: "file", link } });
    expect(response.status).toBe(403);
    expect(await reasonOf(response)).toBe("sync-only");
    expect(await rowOf(row.id)).toEqual(row);
  });

  it.each([
    ["no link", { action: "file" }],
    ["a link that isn't text", { action: "file", link: 42 }],
    ["a link to another site", { action: "file", link: "https://example.com/example/notes/issues/1" }],
    ["a link to a pull request", { action: "file", link: "https://github.com/example/notes/pull/1" }],
    ["a link over http", { action: "file", link: "http://github.com/example/notes/issues/1" }],
    ["a link with more after it", { action: "file", link: `${link}#issuecomment-1` }],
    ["an extra key", { action: "file", link, reason: "x" }],
  ])("file with %s is refused with 400", async (_, body) => {
    const row = await seed();
    const response = await post(row.id, { claims: sync(), origin: null, body });
    expect(response.status).toBe(400);
    expect(await reasonOf(response)).toBe("change");
    expect(await rowOf(row.id)).toEqual(row);
  });
});

describe("the stamp", () => {
  const stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  it.each([
    ["act", "received", {}],
    ["unsort", "act", {}],
    ["done", "act", {}],
    ["drop", "discuss", { reason: "" }],
    ["reopen", "dropped", {}],
    ["space", "act", { space: "videos" }],
    ["reply-opened", "act", {}],
  ])("%s from %s stamps when it moved", async (action, status, extra) => {
    const row = await seed({ status, kind: status === "received" ? null : "feedback" });
    expect(await stampOf(row.id)).toBeNull();
    expect((await post(row.id, { body: { action, ...extra } })).status).toBe(200);
    expect(await stampOf(row.id)).toMatch(stamp);
  });

  it("is left alone by a refused move", async () => {
    const row = await seed({ status: "done", kind: "feedback" });
    expect((await post(row.id, { body: { action: "act" } })).status).toBe(409);
    expect(await stampOf(row.id)).toBeNull();
  });
});

describe("an add", () => {
  const sync = (): Claims => harness.access.syncClaims();
  const self = { ref: "chat:2026-11-04-a-plugin", source: "self", title: "A plugin for coding agents", body: "Install once, every agent gets it.", space: "stigmer", status: "discuss" };
  const told = { ref: "recorder:260104_0001:2", source: "told", title: "Try these thumbnail sites", body: "He said they cost less.", space: "videos", name: "Dev", status: "received" };

  async function addItem(body: unknown, ask: Post = {}): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": ask.contentType ?? "application/json", ...assertion({ claims: sync(), ...ask }, harness) };
    const text = ask.rawBody ?? JSON.stringify(body);
    if (ask.origin !== undefined && ask.origin !== null) headers.Origin = ask.origin;
    return harness.fetch(`${SITE}/threads/api/threads`, { method: "POST", headers, body: new TextEncoder().encode(text) });
  }

  async function byRef(ref: string): Promise<(Row & { moved_at: string | null })[]> {
    return (await (await harness.db()).prepare(`SELECT ${AS_ITEM}, moved_at FROM threads WHERE origin_ref = ?1`).bind(ref).all<Row & { moved_at: string | null }>()).results;
  }

  it("keeps his own item, sorted where he put it, with its title and where it came from", async () => {
    const response = await addItem(self);
    expect(response.status).toBe(201);
    const { thread: item } = (await response.json()) as { thread: { id: string; createdAt: string } };
    expect(await byRef(self.ref)).toEqual([
      {
        id: item.id,
        received_at: item.createdAt,
        source: "self",
        topic: "stigmer",
        body: self.body,
        name: null,
        email: null,
        status: "discuss",
        kind: "idea",
        drop_reason: null,
        reply_opened_at: null,
        title: self.title,
        ref: self.ref,
        filed_link: null,
        moved_at: null,
      },
    ]);
    const look = (await (await getList("?tab=discuss", { claims: sync() })).json()) as ListAnswer;
    expect(look.threads.map((one) => one.id)).toEqual([item.id]);
  });

  it("keeps a thing told to him with the teller's name, and no space when it has none", async () => {
    expect((await addItem({ ...told, space: null })).status).toBe(201);
    expect(await byRef(told.ref)).toMatchObject([{ source: "told", name: "Dev", topic: null, status: "received", kind: null, email: null }]);
    expect((await addItem({ ...told, ref: "recorder:260104_0001:3", status: "act" })).status).toBe(201);
    expect(await byRef("recorder:260104_0001:3")).toMatchObject([{ status: "act", kind: "feedback" }]);
  });

  it("answers the item already there, unchanged, when the same ref comes again", async () => {
    const first = (await (await addItem(self)).json()) as { thread: { id: string } };
    const again = await addItem({ ...self, title: "Something else", status: "act" });
    expect(again.status).toBe(200);
    const second = (await again.json()) as { thread: { id: string; title: string; status: string } };
    expect(second.thread).toMatchObject({ id: first.thread.id, title: self.title, status: "discuss" });
    expect(await byRef(self.ref)).toHaveLength(1);
  });

  it("trims the title and body, and keeps the body's line breaks and a long Telugu body whole", async () => {
    const body = `${"తెలుగు ".repeat(4500).trim()}\n\nమరో పేరా`;
    expect(body.length).toBeLessThanOrEqual(32_000);
    expect((await addItem({ ...self, title: "  Spaced  ", body: `  ${body}  ` })).status).toBe(201);
    expect(await byRef(self.ref)).toMatchObject([{ title: "Spaced", body }]);
  });

  it("in the sync's shape is the sync's alone: the owner's, from his own page, is refused as not his shape", async () => {
    const response = await addItem(self, { claims: harness.access.ownerClaims(), origin: SITE });
    expect(response.status).toBe(400);
    expect(await reasonOf(response)).toBe("keys");
    expect(await byRef(self.ref)).toEqual([]);
  });

  it.each([
    ["an array", ["self"], "item"],
    ["no source", { ...self, source: undefined }, "source"],
    ["a source of the site's", { ...self, source: "talk" }, "source"],
    ["an extra key", { ...self, email: "a@example.com" }, "keys"],
    ["a missing key", { ...self, space: undefined }, "keys"],
    ["a name on his own item", { ...self, name: "Suresh" }, "keys"],
    ["a told item with no name", { ...told, name: undefined }, "keys"],
    ["a ref with no kind", { ...self, ref: "42" }, "ref"],
    ["a ref with a space", { ...self, ref: "chat:an idea" }, "ref"],
    ["a ref over 200", { ...self, ref: `chat:${"x".repeat(191)}` }, "ref"],
    ["an empty title", { ...self, title: "  " }, "title"],
    ["a title on two lines", { ...self, title: "one\ntwo" }, "title"],
    ["a title over 200", { ...self, title: "x".repeat(201) }, "title"],
    ["an empty body", { ...self, body: " \n " }, "body"],
    ["a body over 32,000", { ...self, body: "x".repeat(32_001) }, "body"],
    ["a body with a control character", { ...self, body: "a\u0007b" }, "body"],
    ["a body that isn't text", { ...self, body: 7 }, "body"],
    ["an unknown space", { ...self, space: "elsewhere" }, "space"],
    ["an empty name", { ...told, name: " " }, "name"],
    ["a name over 80", { ...told, name: "x".repeat(81) }, "name"],
    ["a closed status", { ...self, status: "done" }, "status"],
    ["the Filed status", { ...self, status: "filed" }, "status"],
  ])("with %s is refused with 400, and nothing is kept", async (_, body, reason) => {
    const response = await addItem(body);
    expect(response.status).toBe(400);
    expect(await reasonOf(response)).toBe(reason);
    const all = await (await harness.db()).prepare("SELECT COUNT(*) AS n FROM threads").first<{ n: number }>();
    expect(all?.n).toBe(0);
  });

  it("that isn't JSON is refused with 415, invalid JSON with 400, and over 128 KiB with 413 before it is read", async () => {
    expect((await addItem(null, { rawBody: "ref=x", contentType: "application/x-www-form-urlencoded" })).status).toBe(415);
    const broken = await addItem(null, { rawBody: "{" });
    expect(broken.status).toBe(400);
    expect(await reasonOf(broken)).toBe("item");
    const large = await addItem(null, { rawBody: JSON.stringify({ ...self, body: "x".repeat(128 * 1024) }) });
    expect(large.status).toBe(413);
  });
});
