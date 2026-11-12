// A public thread's preview card (src/cards.ts, the card queries in src/store.ts, migrations/0022_cards.sql), run as
// production runs it: the Worker's bundle in workerd with a local D1 and R2 and Cloudflare Access played for the
// threads' application (test/harness.ts). What it holds: his page alone lists the public threads' card stamps and
// uploads a card, so the sync and an invited person are refused both before anything is read, and another site is
// refused the upload; an upload names the stamp of what it shows and is a PNG by its own first bytes, with a declared
// length, at most 1 MiB, and anything else is refused leaving nothing; only a public thread of his takes a card, and a
// private, a missing and a site note's thread are refused leaving nothing; each upload is a new id at a new address,
// its row replacing the thread's card and its object replacing the old one in the bucket, so the bucket holds exactly
// the cards the rows name; a card is served to anyone at /api/cards/<id> on the threads' host as `image/png`, public,
// cached for good, never sniffed or run as a page and kept out of search results, only while its thread is public,
// and served again when he makes it public again; any other id answers one 404, and the home page's host knows no card.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SITE, THREADS, startHarness, type Harness } from "./harness.ts";

const MEERA = "meera@example.com";
/** A PNG's first bytes and a little after, which is all the Worker reads of a card. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const OTHER_PNG = new Uint8Array([...PNG, 0x01, 0x02]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const STAMP = "a".repeat(64);
const OTHER_STAMP = "b".repeat(64);

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

/** A JSON call under /threads/api/; a POST comes from the site's own page. */
async function call(path: string, as: Who = "owner", body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(as) };
  if (body === undefined) return harness.fetch(`${THREADS}/threads/api${path}`, { headers });
  return harness.fetch(`${THREADS}/threads/api${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Origin: THREADS },
    body: new TextEncoder().encode(JSON.stringify(body)),
  });
}

async function answer<T>(response: Response, status = 200): Promise<T> {
  const text = await response.text();
  expect([response.status, text]).toEqual([status, expect.any(String)]);
  return JSON.parse(text) as T;
}

async function reasonOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { reason: string }).reason];
}

interface Upload {
  as?: Who;
  type?: string;
  origin?: string | null;
  noLength?: boolean;
  /** The query after `?`, as sent; the stamp's by default. */
  query?: string;
}

/** A card as his page uploads it: the PNG's own bytes, the stamp in the query. */
async function upload(number: number, bytes: Uint8Array = PNG, options: Upload = {}): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(options.as ?? "owner"), "Content-Type": options.type ?? "image/png" };
  if (options.origin !== null) headers.Origin = options.origin ?? THREADS;
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
  return harness.fetch(`${THREADS}/threads/api/threads/${number}/card?${options.query ?? `stamp=${STAMP}`}`, init);
}

async function count(sql: string, ...values: unknown[]): Promise<number> {
  return (await (await harness.db()).prepare(sql).bind(...values).first<{ n: number }>())?.n ?? 0;
}

/** The objects the bucket keeps under cards/. */
async function objects(): Promise<string[]> {
  return (await (await harness.pages()).list({ prefix: "cards/" })).objects.map((object) => object.key).sort();
}

/** A card as anyone fetches it, with no sign-in. */
async function served(id: string, host = THREADS, method = "GET"): Promise<Response> {
  return harness.fetch(`${host}/api/cards/${id}`, { method });
}

let refs = 0;
/** A thread the sync adds, his own unless told otherwise; answers its number. */
async function thread(fields: Record<string, unknown> = {}): Promise<number> {
  refs += 1;
  const body = { ref: `chat:cards-${refs}`, source: "self", title: `Thread ${refs}`, body: `Body ${refs}`, space: "company", status: "act", ...fields };
  return (await answer<{ thread: { number: number } }>(await call("/threads", "sync", body), 201)).thread.number;
}

async function move(number: number, action: string): Promise<void> {
  await answer(await call(`/threads/${number}`, "owner", { action }));
}

async function published(fields: Record<string, unknown> = {}): Promise<number> {
  const n = await thread(fields);
  await move(n, "publish");
  return n;
}

async function kept(number: number, bytes: Uint8Array = PNG, query?: string): Promise<string> {
  return (await answer<{ card: string }>(await upload(number, bytes, query === undefined ? {} : { query }))).card;
}

/** A site note, as the note flow keeps it, made public by hand as no move can: answers its number. */
async function siteNoteMadePublic(): Promise<number> {
  const response = await harness.fetch(`${SITE}/api/talk`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE, "CF-Connecting-IP": "198.51.100.9" },
    body: new TextEncoder().encode(JSON.stringify({ topic: "stigmer", body: "Lost at install.", name: "Asha", email: "asha@example.com", token: "pass" })),
  });
  expect(response.status).toBe(201);
  const database = await harness.db();
  const row = await database.prepare("SELECT number FROM threads WHERE source = 'talk' ORDER BY number DESC").first<{ number: number }>();
  await database.prepare("UPDATE threads SET public_at = '2026-11-05T00:00:00.000Z', share_key = printf('%032x', number) WHERE number = ?1").bind(row?.number ?? 0).run();
  return row?.number ?? 0;
}

describe("his page's cards", () => {
  it("are kept and served, each upload a new address, its old card and object gone", async () => {
    const n = await published();
    const first = await kept(n);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await objects()).toEqual([`cards/${first}.png`]);
    const shown = await served(first);
    expect(shown.status).toBe(200);
    expect(new Uint8Array(await shown.arrayBuffer())).toEqual(PNG);

    const second = await kept(n, OTHER_PNG, `stamp=${OTHER_STAMP}`);
    expect(second).not.toBe(first);
    expect((await served(first)).status).toBe(404);
    expect(new Uint8Array(await (await served(second)).arrayBuffer())).toEqual(OTHER_PNG);
    expect(await objects()).toEqual([`cards/${second}.png`]);
    expect(await count("SELECT COUNT(*) AS n FROM cards")).toBe(1);
    expect(await (await harness.db()).prepare("SELECT stamp, bytes FROM cards").first()).toEqual({ stamp: OTHER_STAMP, bytes: OTHER_PNG.byteLength });
  });

  it("are listed for him alone: every public thread with its card's stamp, or none yet", async () => {
    const carded = await published({ title: "Has a card" });
    const bare = await published({ title: null });
    await thread({ title: "Private" });
    const taken = await published({ title: "Taken back" });
    await move(taken, "unpublish");
    await kept(carded);
    expect(await answer<unknown>(await call("/cards"))).toEqual({
      cards: [
        { number: carded, title: "Has a card", stamp: STAMP },
        { number: bare, title: null, stamp: null },
      ],
    });
    const n = await published();
    await answer(await call(`/threads/${n}/people`, "owner", { add: { email: MEERA, name: "Meera" } }));
    for (const as of [{ email: MEERA }, "sync"] as const) expect(await reasonOf(await call("/cards", as))).toEqual([403, "owner-only"]);
    const post = await harness.fetch(`${THREADS}/threads/api/cards`, { method: "POST", headers: { "Cf-Access-Jwt-Assertion": token("owner"), Origin: THREADS } });
    expect([post.status, post.headers.get("Allow")]).toEqual([405, "GET"]);
  });

  it("are his alone to upload: an invited person and the sync are refused before anything is read, and so is another site", async () => {
    const n = await published();
    await answer(await call(`/threads/${n}/people`, "owner", { add: { email: MEERA, name: "Meera" } }));
    for (const as of [{ email: MEERA }, "sync"] as const) {
      expect(await reasonOf(await upload(n, PNG, { as }))).toEqual([403, "owner-only"]);
      // Refused before the number is read: one no thread has answers the same.
      expect(await reasonOf(await upload(999, PNG, { as }))).toEqual([403, "owner-only"]);
      expect(await reasonOf(await upload(n, new TextEncoder().encode("not an image"), { as, type: "text/plain", query: "nothing" }))).toEqual([403, "owner-only"]);
    }
    expect(await reasonOf(await upload(n, PNG, { origin: null }))).toEqual([403, "origin"]);
    expect(await reasonOf(await upload(n, PNG, { origin: "https://elsewhere.example" }))).toEqual([403, "origin"]);
    const get = await harness.fetch(`${THREADS}/threads/api/threads/${n}/card`, { headers: { "Cf-Access-Jwt-Assertion": token("owner") } });
    expect([get.status, get.headers.get("Allow")]).toEqual([405, "POST"]);
    expect(await objects()).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM cards")).toBe(0);
  });

  it("refuses a missing or malformed stamp, no length, too large, a JPEG and bytes that aren't a PNG, leaving nothing", async () => {
    const n = await published();
    for (const query of ["", "stamp=", `stamp=${"A".repeat(64)}`, `stamp=${"a".repeat(63)}`, `stamp=${STAMP}&stamp=${STAMP}`, `stamp=${STAMP}&title=x`]) {
      expect([query, ...(await reasonOf(await upload(n, PNG, { query })))]).toEqual([query, 400, "stamp"]);
    }
    expect(await reasonOf(await upload(n, PNG, { noLength: true }))).toEqual([411, "length"]);
    const large = new Uint8Array(1024 * 1024 + 1);
    large.set(PNG);
    let tooLarge: string;
    try {
      tooLarge = (await reasonOf(await upload(n, large))).join(" ");
    } catch {
      // The local runtime may close the connection before the rest of a body refused by its length is written.
      tooLarge = "413 too-large";
    }
    expect(tooLarge).toBe("413 too-large");
    expect(await reasonOf(await upload(n, JPEG, { type: "image/jpeg" }))).toEqual([415, "type"]);
    expect(await reasonOf(await upload(n, JPEG))).toEqual([415, "type"]);
    expect(await reasonOf(await upload(n, new TextEncoder().encode("<svg onload=alert(1)>"), { type: "image/svg+xml" }))).toEqual([415, "type"]);
    expect(await objects()).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM cards")).toBe(0);
  });

  it("are kept only for a public thread of his: a private, a missing and a site note's thread are refused, leaving nothing", async () => {
    const priv = await thread();
    expect(await reasonOf(await upload(priv))).toEqual([409, "not-public"]);
    expect(await reasonOf(await upload(999))).toEqual([404, "no-thread"]);
    expect(await reasonOf(await upload(await siteNoteMadePublic()))).toEqual([409, "not-public"]);
    expect(await objects()).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM cards")).toBe(0);
  });

  it("leaves no object behind when the row can't be kept, and keeps the card it had", async () => {
    const n = await published();
    const card = await kept(n);
    const database = await harness.db();
    await database.prepare("ALTER TABLE cards RENAME TO cards_aside").run();
    try {
      expect(await reasonOf(await upload(n, OTHER_PNG))).toEqual([500, "store"]);
    } finally {
      await database.prepare("ALTER TABLE cards_aside RENAME TO cards").run();
    }
    expect(await objects()).toEqual([`cards/${card}.png`]);
    expect((await served(card)).status).toBe(200);
  });
});

describe("serving a card", () => {
  it("answers anyone with the PNG, public and cached for good, never sniffed or run as a page, and kept out of search", async () => {
    const id = await kept(await published());
    const response = await served(id);
    expect(response.status).toBe(200);
    const names = ["Content-Type", "Content-Length", "Cache-Control", "X-Content-Type-Options", "Content-Security-Policy", "X-Robots-Tag"];
    expect(Object.fromEntries(names.map((name) => [name, response.headers.get(name)]))).toEqual({
      "Content-Type": "image/png",
      "Content-Length": String(PNG.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Robots-Tag": "noindex",
    });
    const head = await served(id, THREADS, "HEAD");
    expect([head.status, head.headers.get("Content-Type"), head.headers.get("Content-Length")]).toEqual([200, "image/png", String(PNG.byteLength)]);
  });

  it("is served only while its thread is public, and again once he makes it public again", async () => {
    const n = await published();
    const id = await kept(n);
    const unknown = await (await served("0b6f2c8e-1d1a-4c55-9a0e-6f0f8a1b2c3d")).text();
    await move(n, "unpublish");
    const hidden = await served(id);
    expect([hidden.status, await hidden.text()]).toEqual([404, unknown]);
    // A thread taken back keeps its card, and takes none while it is private.
    expect(await objects()).toEqual([`cards/${id}.png`]);
    expect(await reasonOf(await upload(n, OTHER_PNG))).toEqual([409, "not-public"]);
    expect(await objects()).toEqual([`cards/${id}.png`]);
    await move(n, "publish");
    expect((await served(id)).status).toBe(200);
  });

  it("answers one 404 for any id with no card or that isn't an id, refuses a write, and lives on the threads' host alone", async () => {
    const id = await kept(await published());
    const unknown = await served("0b6f2c8e-1d1a-4c55-9a0e-6f0f8a1b2c3d");
    const malformed = await served("not-an-id");
    expect([unknown.status, malformed.status]).toEqual([404, 404]);
    expect(await unknown.text()).toBe(await malformed.text());
    expect(unknown.headers.get("Cache-Control")).toBe("no-store");
    expect(unknown.headers.get("X-Robots-Tag")).toBe("noindex");
    expect((await harness.fetch(`${THREADS}/api/cards/${id}`, { method: "POST", body: PNG })).status).toBe(405);
    expect(await reasonOf(await served(id, SITE))).toEqual([404, "not-found"]);
  });
});
