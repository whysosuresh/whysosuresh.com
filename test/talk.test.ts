// The note flow's send, run as production runs it: the Worker's bundle in workerd (test/harness.ts), with a
// local D1 and a played Turnstile. What it holds: a good note is kept as one new thread with its `created`
// event, for every topic, and answers only its id;
// the note's bounds (4,000 code units, Telugu at the byte bound, no blank note, no control character, no
// lone surrogate); the wire's shape (JSON only, exactly five string keys, 16 KiB); the bot check; both daily
// limits, under concurrency and for IPv6 networks; the refusals for no length, no secret, another origin
// and other routes; that no address is kept and old days are dropped; and that the Worker reaches nothing
// but Turnstile.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SITE, TEST_SECRET, TURNSTILE_HOST, startHarness, type Harness } from "./harness.ts";

/** The server's limits, stated here as the contract rather than imported from the Worker. */
const MAX_BODY = 4000;
const MAX_REQUEST_BYTES = 16 * 1024;

/** The topics a note may name, stated here as the contract rather than imported from the site. */
const TOPICS = ["stigmer", "videos", "capsjump", "other"];

const NOTE = { topic: "stigmer", body: "I got lost at the install.", name: "Asha", email: "asha@example.com", token: "pass" };

interface Send {
  ip?: string;
  /** Keys to change in the note; a key set to undefined is left out. */
  note?: Record<string, unknown>;
  contentType?: string;
  origin?: string | null;
  fetchSite?: string;
  /** Sends the body as a stream, so no Content-Length is declared. */
  noLength?: boolean;
  /** Sends these bytes as the body instead of the note. */
  rawBody?: Uint8Array;
}

let harness: Harness;

function noteBytes(options: Send): Uint8Array {
  return options.rawBody ?? new TextEncoder().encode(JSON.stringify({ ...NOTE, ...options.note }));
}

async function send(options: Send = {}, target: Harness = harness, url = `${SITE}/api/talk`): Promise<Response> {
  const bytes = noteBytes(options);
  const headers: Record<string, string> = {
    "Content-Type": options.contentType ?? "application/json",
    "CF-Connecting-IP": options.ip ?? "203.0.113.7",
  };
  if (options.origin !== null) headers.Origin = options.origin ?? new URL(url).origin;
  if (options.fetchSite) headers["Sec-Fetch-Site"] = options.fetchSite;
  const init: RequestInit & { duplex?: string } = { method: "POST", headers };
  if (options.noLength) {
    init.body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    init.duplex = "half";
  } else {
    init.body = bytes;
  }
  return target.fetch(url, init);
}

async function rows(table: string, target: Harness = harness): Promise<Record<string, unknown>[]> {
  return (await (await target.db()).prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>()).results;
}

beforeAll(async () => {
  harness = await startHarness();
});
afterAll(async () => {
  await harness.dispose();
});
beforeEach(async () => {
  await harness.reset();
});

describe("a good note", () => {
  it("is kept as one new thread that says what was sent, with the event that says who brought it", async () => {
    const before = new Date().toISOString();
    const response = await send();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const answer = (await response.json()) as { id: string };
    expect(Object.keys(answer)).toEqual(["id"]);
    const { id } = answer;
    const [row, ...others] = await rows("threads");
    expect(others).toEqual([]);
    expect(row).toEqual({
      id,
      number: 1,
      created_at: expect.any(String),
      source: "talk",
      space: "stigmer",
      title: null,
      body: "I got lost at the install.",
      summary: null,
      status: "received",
      kind: null,
      sender_name: "Asha",
      sender_email: "asha@example.com",
      drop_reason: null,
      reply_opened_at: null,
      origin_ref: null,
      filed_link: null,
      moved_at: null,
      activity_at: row?.created_at,
      main: "text",
      link_url: null,
      link_title: null,
      public_at: null,
      feed_at: null,
      person_id: expect.any(String),
      meeting_when: null,
      meeting_minutes: null,
      meeting_where: null,
      ask_slug: null,
      ask_state: null,
      ask_thread_id: null,
    });
    expect(String(row?.created_at) >= before).toBe(true);
    // The address is a person now, named as typed, and the note is from them.
    expect((await rows("people")).map(({ id, number, email, name, note }) => ({ id, number, email, name, note }))).toEqual([
      { id: row?.person_id, number: 1, email: "asha@example.com", name: "Asha", note: null },
    ]);
    expect(await rows("events")).toEqual([
      { id: 1, thread_id: id, at: row?.created_at, actor: "visitor", type: "created", data: JSON.stringify({ source: "talk", status: "received" }) },
    ]);
  });

  it.each(TOPICS)("is taken about %s", async (topic) => {
    expect((await send({ note: { topic } })).status).toBe(201);
    expect((await rows("threads")).map((row) => row.space)).toEqual([topic]);
  });

  it("keeps an empty name and email as nothing, and trims both", async () => {
    expect((await send({ note: { name: "  ", email: "" } })).status).toBe(201);
    expect((await send({ note: { name: " సురేష్ ", email: " a@b " }, ip: "203.0.113.8" })).status).toBe(201);
    const stored = (await rows("threads")).map((row) => [row.sender_name, row.sender_email]);
    expect(stored).toEqual(expect.arrayContaining([[null, null], ["సురేష్", "a@b"]]));
  });

  it("trims the note and keeps its line breaks and tabs", async () => {
    expect((await send({ note: { body: "  First line\n\n\tthen this  \n" } })).status).toBe(201);
    expect((await rows("threads")).map((row) => row.body)).toEqual(["First line\n\n\tthen this"]);
  });

  it("takes a JSON type with a charset", async () => {
    expect((await send({ contentType: "application/json; charset=utf-8" })).status).toBe(201);
  });
});

describe("the note's bounds", () => {
  it("takes 4,000 code units and refuses 4,001", async () => {
    expect((await send({ note: { body: "a".repeat(MAX_BODY) } })).status).toBe(201);
    const over = await send({ note: { body: "a".repeat(MAX_BODY + 1) } });
    expect(over.status).toBe(400);
    expect(await over.json()).toEqual({ reason: "body" });
  });

  it("takes 4,000 code units of Telugu, 12,000 bytes, inside the request's bound", async () => {
    // "తెలుగు" is six code units, each three bytes of UTF-8; "తెలు" is the first four.
    const body = `${"తెలుగు".repeat(666)}తెలు`;
    expect(body.length).toBe(MAX_BODY);
    expect(new TextEncoder().encode(body).length).toBe(3 * MAX_BODY);
    expect((await send({ note: { body, token: "p".repeat(2048) } })).status).not.toBe(413);
    expect((await send({ note: { body } })).status).toBe(201);
    expect((await rows("threads")).map((row) => row.body)).toEqual([body]);
  });

  it.each([
    ["an empty note", ""],
    ["a note of only spaces and line breaks", "  \n\t \n"],
    ["a bell character", "hello\u0007"],
    ["a carriage return", "one\rtwo"],
    ["a null character", "one\u0000two"],
    ["a lone surrogate", "broken \ud800 text"],
  ])("refuses %s", async (_label, body) => {
    const response = await send({ note: { body } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ reason: "body" });
    expect(await rows("threads")).toEqual([]);
  });

  it.each(["nope", "", "Stigmer", "stigmer "])("refuses the topic %j", async (topic) => {
    const response = await send({ note: { topic } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ reason: "topic" });
  });
});

describe("the wire", () => {
  it.each([
    ["a missing key", { token: undefined }],
    ["an extra key", { audio: "x" }],
    ["a number for a name", { name: 5 }],
    ["null for the note", { body: null }],
    ["a name over 80 characters", { name: "a".repeat(81) }],
    ["a name with a control character", { name: "Asha\u0007" }],
    ["an email that isn't one", { email: "not an email" }],
    ["an email over 200 characters", { email: `${"a".repeat(195)}@b.com` }],
    ["no token", { token: "" }],
    ["a token over 2,048 characters", { token: "p".repeat(2049) }],
  ])("refuses %s", async (_label, note) => {
    const response = await send({ note });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ reason: "form" });
  });

  it.each([
    ["text that isn't JSON", "not json"],
    ["a JSON list", "[]"],
    ["a JSON string", '"a note"'],
    ["JSON null", "null"],
  ])("refuses %s", async (_label, text) => {
    expect((await send({ rawBody: new TextEncoder().encode(text) })).status).toBe(400);
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""])(
    "refuses the type %j before any bot check, even with a good note",
    async (contentType) => {
      const response = await send({ contentType });
      expect(response.status).toBe(415);
      expect(harness.outboundHosts.size).toBe(0);
    },
  );

  it("refuses a recording sent as a form, as the old page sent it", async () => {
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: "audio/webm" }), "recording");
    for (const [key, value] of Object.entries({ seconds: "12", name: "Asha", email: "", token: "pass" })) form.append(key, value);
    const encoded = new Response(form);
    const rawBody = new Uint8Array(await encoded.arrayBuffer());
    const response = await send({ rawBody, contentType: encoded.headers.get("content-type") ?? "" });
    expect(response.status).toBe(415);
    expect(await rows("threads")).toEqual([]);
    expect(harness.outboundHosts.size).toBe(0);
  });

  it("refuses a body over 16 KiB", async () => {
    const response = await send({ note: { body: "a".repeat(MAX_REQUEST_BYTES) } });
    expect(response.status).toBe(413);
  });

  it("refuses a request whose declared length is over the bound before reading its body", async () => {
    // 1 KB of the declared length is sent and the rest never comes, so only a Worker that answers without
    // reading the body can answer at all.
    let hold: () => void = () => undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024));
        hold = () => controller.close();
      },
    });
    const init: RequestInit & { duplex: string } = {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(MAX_REQUEST_BYTES + 1), Origin: SITE, "CF-Connecting-IP": "203.0.113.7" },
      body,
      duplex: "half",
    };
    const response = await harness.fetch(`${SITE}/api/talk`, init);
    hold();
    expect(response.status).toBe(413);
    expect(await rows("threads")).toEqual([]);
  });
});

describe("the bot check", () => {
  it.each(["fail", "wrong-host", "wrong-action", "unreachable"])("refuses a %s token, storing nothing", async (token) => {
    const response = await send({ note: { token } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: "bot-check" });
    expect(await rows("threads")).toEqual([]);
  });

  it("is refused before it counts towards the limits", async () => {
    for (let i = 0; i < 25; i += 1) await send({ note: { token: "fail" } });
    expect((await send()).status).toBe(201);
  });
});

describe("the daily limits", () => {
  it("refuses the 21st send from one address, while another address still sends", async () => {
    for (let i = 0; i < 20; i += 1) expect((await send({ ip: "198.51.100.1" })).status).toBe(201);
    const refused = await send({ ip: "198.51.100.1" });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ reason: "limit" });
    expect((await send({ ip: "198.51.100.2" })).status).toBe(201);
  });

  it("refuses the 61st send of the day from any address", async () => {
    for (const ip of ["192.0.2.1", "192.0.2.2", "192.0.2.3"]) {
      for (let i = 0; i < 20; i += 1) expect((await send({ ip })).status).toBe(201);
    }
    expect((await send({ ip: "192.0.2.4" })).status).toBe(429);
    expect(await rows("threads")).toHaveLength(60);
  });

  it("lets exactly 20 of 25 concurrent sends from one address through", async () => {
    const statuses = (await Promise.all(Array.from({ length: 25 }, () => send({ ip: "198.51.100.9" })))).map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(20);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it("counts two IPv6 addresses in one /64 as one network, and two /64s apart", async () => {
    for (let i = 0; i < 10; i += 1) expect((await send({ ip: "2001:db8:1:2::a" })).status).toBe(201);
    for (let i = 0; i < 10; i += 1) expect((await send({ ip: "2001:0db8:0001:0002:ffff:1:2:3" })).status).toBe(201);
    expect((await send({ ip: "2001:db8:1:2:abcd::1" })).status).toBe(429);
    expect((await send({ ip: "2001:db8:1:3::a" })).status).toBe(201);
  });

  // Cloudflare always sets the address, and Miniflare fills in an empty one, so a malformed one stands in.
  it.each(["not-an-address", "300.1.1.1", "2001:db8::1::2"])("refuses a request from %j, which isn't an address", async (ip) => {
    expect((await send({ ip })).status).toBe(400);
  });
});

describe("privacy", () => {
  it("keeps no sending address in any table", async () => {
    await send({ ip: "203.0.113.77" });
    await send({ ip: "2001:db8:aa:bb::1" });
    const database = await harness.db();
    const tables = (
      await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all<{ name: string }>()
    ).results.map((t) => t.name);
    expect(tables.sort()).toEqual(["answer_senders", "ask_answer_senders", "ask_thread_senders", "attendees", "comments", "events", "journal_answers", "journal_entries", "journal_photos", "journal_storylines", "journal_versions", "members", "now_lines", "outside_items", "owner_photos", "pages", "people", "photos", "talk_days", "talk_senders", "threads"]);
    const everything = JSON.stringify(await Promise.all(tables.map((table) => rows(table))));
    for (const needle of ["203.0.113.77", "2001:db8:aa:bb", "2001:0db8:00aa:00bb"]) expect(everything).not.toContain(needle);
  });

  it("drops an earlier day's salt and counts at today's first send", async () => {
    const database = await harness.db();
    await database.batch([
      database.prepare("INSERT INTO talk_days (day, salt) VALUES ('2026-01-01', randomblob(32))"),
      database.prepare("INSERT INTO talk_senders (day, sender, sends) VALUES ('2026-01-01', 'old', 20)"),
    ]);
    expect((await send()).status).toBe(201);
    expect((await rows("talk_days")).map((r) => r.day)).toEqual([new Date().toISOString().slice(0, 10)]);
    expect((await rows("talk_senders")).map((r) => r.sender)).not.toContain("old");
  });
});

describe("refusals before reading", () => {
  it("refuses a request without a declared length", async () => {
    expect((await send({ noLength: true })).status).toBe(411);
  });

  it.each([
    ["no Origin", { origin: null }],
    ["another site's Origin", { origin: "https://elsewhere.example" }],
    ["the site's Origin over http", { origin: "http://whysosuresh.com" }],
    ["a cross-site fetch", { fetchSite: "cross-site" }],
    ["a same-site fetch from another subdomain", { fetchSite: "same-site" }],
  ])("refuses %s", async (_label, options) => {
    const response = await send(options);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: "origin" });
  });

  it("takes a same-origin fetch that says so", async () => {
    expect((await send({ fetchSite: "same-origin" })).status).toBe(201);
  });
});

describe("with no bot-check secret", () => {
  let bare: Harness;
  beforeAll(async () => {
    bare = await startHarness({ secret: "" });
  });
  afterAll(async () => {
    await bare.dispose();
  });

  it("refuses every send with 503 and stores nothing", async () => {
    const response = await send({}, bare);
    expect(response.status).toBe(503);
    expect(await rows("threads", bare)).toEqual([]);
    expect(bare.outboundHosts.size).toBe(0);
  });
});

describe("with Cloudflare's test secret, as `npm run dev` runs", () => {
  let local: Harness;
  beforeAll(async () => {
    local = await startHarness({ secret: TEST_SECRET });
  });
  afterAll(async () => {
    await local.dispose();
  });

  it("stores a send from localhost, though the test verdict names example.com and no action", async () => {
    const response = await send({ note: { token: "XXXX.DUMMY.TOKEN.XXXX" }, ip: "127.0.0.1" }, local, "http://localhost:8787/api/talk");
    expect(response.status).toBe(201);
  });
});

describe("routes", () => {
  it("answers GET /api/talk with 405 and the allowed method", async () => {
    const response = await harness.fetch(`${SITE}/api/talk`);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("answers an unknown /api/ path with a JSON 404", async () => {
    const response = await harness.fetch(`${SITE}/api/elsewhere`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 500 and keeps nothing when the row can't be written", async () => {
    const database = await harness.db();
    await database.prepare("ALTER TABLE threads RENAME TO threads_away").run();
    try {
      const response = await send();
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ reason: "store" });
    } finally {
      await database.prepare("ALTER TABLE threads_away RENAME TO threads").run();
    }
    expect(await rows("threads")).toEqual([]);
  });
});

describe("the outside world", () => {
  it("is reached only at Turnstile", async () => {
    await send();
    await send({ note: { token: "fail" } });
    expect([...harness.outboundHosts]).toEqual([TURNSTILE_HOST]);
  });
});
