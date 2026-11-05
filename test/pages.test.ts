// A thread's page and link, through the threads' calls (src/threads.ts, src/page.ts), run as production runs them:
// the Worker's bundle in workerd with a local D1 and a local R2 bucket (test/harness.ts). What it holds: the sync
// saves a page as a new version, the object first and then its row and event, every version kept and named by a
// fresh key; the page becomes the thread's main section; a page with no doctype gets claude.ai's skeleton; a page
// is at most 16 MiB, refused before it is read; a body that isn't UTF-8 or isn't HTML is refused, and a refused or
// unkept save leaves no object; the owner can't save one; a version is served with exactly the frame's headers and
// the height script addressed to the site, revalidated by its ETag; a link is a claude.ai address only, and
// clearing it goes back to the page or the text; and the owner's link write only from his own page.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SITE, startHarness, type Harness } from "./harness.ts";

const THREADS = `${SITE}/threads/api/threads`;
const MIB = 1024 * 1024;

/** The frame's CSP, as src/page.ts must send it: claude.ai's page contract and no wider, framed only by the site. */
const FRAME_CSP =
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com; worker-src blob:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";

/** The head claude.ai publishes every page with, as its Artifact tool's read returns it. */
const SKELETON =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n';

const PAGE = "<!doctype html><html><head><title>Pricing</title></head><body><h1>Three ways to charge</h1></body></html>";

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

type Who = "owner" | "sync";

function token(as: Who): string {
  return harness.access.token(as === "sync" ? harness.access.syncClaims("threads") : harness.access.ownerClaims("threads"), { app: "threads" });
}

async function thread(): Promise<number> {
  const response = await harness.fetch(THREADS, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": token("sync") },
    body: new TextEncoder().encode(JSON.stringify({ ref: `chat:${crypto.randomUUID()}`, source: "self", title: "Hosted cloud pricing", body: "The pricing page.", space: "company", status: "discuss" })),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { thread: { number: number } }).thread.number;
}

async function save(number: number, html: string | Uint8Array, options: { as?: Who; from?: string; type?: string; query?: string } = {}): Promise<Response> {
  const query = options.query ?? (options.from === undefined ? "" : `?${new URLSearchParams({ from: options.from }).toString()}`);
  const headers: Record<string, string> = { "Content-Type": options.type ?? "text/html; charset=utf-8", "Cf-Access-Jwt-Assertion": token(options.as ?? "sync") };
  if (options.as === "owner") headers.Origin = SITE;
  return harness.fetch(`${THREADS}/${number}/pages${query}`, { method: "POST", headers, body: typeof html === "string" ? new TextEncoder().encode(html) : html });
}

async function read(path: string, as: Who = "owner", headers: Record<string, string> = {}): Promise<Response> {
  return harness.fetch(`${THREADS}${path}`, { headers: { "Cf-Access-Jwt-Assertion": token(as), ...headers } });
}

interface ShownPage {
  thread: { main: string; link: { url: string; title: string | null } | null; activityAt: string };
  page: { version: number; savedAt: string; source: string | null; versions: { version: number; savedAt: string; actor: string; bytes: number; source: string | null }[] } | null;
  events: { actor: string; type: string; data: Record<string, unknown> }[];
}

async function shown(number: number): Promise<ShownPage> {
  const response = await read(`/${number}`);
  expect(response.status).toBe(200);
  return (await response.json()) as ShownPage;
}

async function objects(): Promise<string[]> {
  return (await (await harness.pages()).list()).objects.map((object) => object.key);
}

async function reasonOf(response: Response): Promise<string> {
  return ((await response.json()) as { reason: string }).reason;
}

async function link(number: number, body: unknown, as: Who = "owner", origin: string | null = SITE): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": token(as) };
  if (origin !== null) headers.Origin = origin;
  return harness.fetch(`${THREADS}/${number}/link`, { method: "POST", headers, body: new TextEncoder().encode(JSON.stringify(body)) });
}

describe("saving a page", () => {
  it("keeps the document as a new version, makes it the thread's main section, and says so in the history", async () => {
    const number = await thread();
    const response = await save(number, PAGE, { from: "https://claude.ai/artifact/Tx8ebejhpqgkrEmKje9ZGV" });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { version: number }).version).toBe(1);

    const [key, ...others] = await objects();
    expect(others).toEqual([]);
    expect(key).toMatch(/^pages\/[0-9a-f-]{36}\.html$/);
    const object = await (await harness.pages()).get(key ?? "");
    expect(await object?.text()).toBe(PAGE);
    expect(object?.httpMetadata?.contentType).toBe("text/html; charset=utf-8");

    const view = await shown(number);
    expect(view.thread.main).toBe("page");
    expect(view.page).toEqual({
      version: 1,
      savedAt: expect.any(String),
      source: "https://claude.ai/artifact/Tx8ebejhpqgkrEmKje9ZGV",
      versions: [{ version: 1, savedAt: expect.any(String), actor: "sync", bytes: PAGE.length, source: "https://claude.ai/artifact/Tx8ebejhpqgkrEmKje9ZGV" }],
    });
    expect(view.events.at(-1)).toEqual(expect.objectContaining({ actor: "sync", type: "page-saved", data: { version: 1, bytes: PAGE.length } }));
    expect(view.thread.activityAt).toBe(view.page?.savedAt);
  });

  it("keeps every version, each its own object, numbered in order even when saved at once", async () => {
    const number = await thread();
    const answers = await Promise.all(Array.from({ length: 5 }, (_, i) => save(number, `${PAGE}<!-- ${i} -->`)));
    const statuses = answers.map((answer) => answer.status);
    const kept = statuses.filter((status) => status === 201).length;
    // D1 runs one batch at a time, so all five are kept; a save that lost a race would be 409 and keep nothing.
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
    expect((await shown(number)).page?.versions.map((version) => version.version)).toEqual(Array.from({ length: kept }, (_, i) => i + 1));
    expect(await objects()).toHaveLength(kept);
    expect(kept).toBe(5);
  });

  it("puts claude.ai's skeleton in front of a document with no doctype, and leaves one that has its own", async () => {
    const number = await thread();
    expect((await save(number, "<h1>Just a fragment</h1>")).status).toBe(201);
    expect((await save(number, "  <!DOCTYPE html><p>Own head</p>")).status).toBe(201);
    const bucket = await harness.pages();
    const texts = await Promise.all((await objects()).map(async (key) => (await bucket.get(key))?.text()));
    expect(texts.sort()).toEqual(["  <!DOCTYPE html><p>Own head</p>", `${SKELETON}<h1>Just a fragment</h1>`].sort());
  });

  it("takes a page up to 16 MiB, and refuses a larger one before reading it, keeping nothing", async () => {
    const number = await thread();
    const head = "<!doctype html><p>";
    const exact = new Uint8Array(16 * MIB).fill(0x61);
    exact.set(new TextEncoder().encode(head));
    expect((await save(number, exact)).status).toBe(201);
    const over = new Uint8Array(16 * MIB + 1).fill(0x61);
    over.set(new TextEncoder().encode(head));
    const refused = await save(number, over);
    expect([refused.status, await reasonOf(refused)]).toEqual([413, "too-large"]);
    expect(await objects()).toHaveLength(1);
  });

  it.each([
    ["a body that isn't UTF-8", new Uint8Array([0x3c, 0x70, 0x3e, 0xff, 0xfe]), {}, 400, "encoding"],
    ["an empty page", "  ", {}, 400, "page"],
    ["a body that isn't HTML", PAGE, { type: "application/json" }, 415, "type"],
    ["a source that isn't on claude.ai", PAGE, { from: "https://example.com/artifact/x" }, 400, "from"],
    ["a source that only looks like claude.ai", PAGE, { from: "https://claude.ai.example.com/x" }, 400, "from"],
    ["another key in the address", PAGE, { query: "?from=https%3A%2F%2Fclaude.ai%2Fx&v=2" }, 400, "query"],
  ] as const)("refuses %s, keeping nothing", async (_, html, options, status, reason) => {
    const number = await thread();
    const response = await save(number, html, options);
    expect([response.status, await reasonOf(response)]).toEqual([status, reason]);
    expect(await objects()).toEqual([]);
  });

  it("is the sync's alone: the owner is refused, and nothing is kept", async () => {
    const number = await thread();
    const response = await save(number, PAGE, { as: "owner" });
    expect([response.status, await reasonOf(response)]).toEqual([403, "sync-only"]);
    expect(await objects()).toEqual([]);
  });

  it("into a thread that isn't there is 404, and the object it wrote is deleted again", async () => {
    const response = await save(999, PAGE);
    expect([response.status, await reasonOf(response)]).toEqual([404, "no-thread"]);
    expect(await objects()).toEqual([]);
  });
});

describe("reading a page", () => {
  it("answers the stored document with exactly the frame's headers and the height script addressed to the site", async () => {
    const number = await thread();
    await save(number, PAGE);
    const response = await read(`/${number}/pages/1`);
    expect(response.status).toBe(200);
    const headers = Object.fromEntries(response.headers);
    expect(headers).toMatchObject({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": FRAME_CSP,
      "cache-control": "private, no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "cross-origin-resource-policy": "same-origin",
    });
    expect(headers.etag).toMatch(/^"[^"]+-h1"$/);
    const text = await response.text();
    expect(text.startsWith(PAGE)).toBe(true);
    const script = text.slice(PAGE.length);
    expect(script).toContain(`const o=${JSON.stringify(SITE)}`);
    expect(script).toContain("parent.postMessage({whysosureshPageHeight:n},o)");
    expect(script).not.toContain('"*"');
    expect((await read(`/${number}/pages/1`, "sync")).status).toBe(200);
  });

  it("answers 304 to a browser that holds this version, and the whole page to one holding another tag", async () => {
    const number = await thread();
    await save(number, PAGE);
    const first = await read(`/${number}/pages/1`);
    const tag = first.headers.get("etag") ?? "";
    await first.arrayBuffer();
    const again = await read(`/${number}/pages/1`, "owner", { "If-None-Match": tag });
    expect(again.status).toBe(304);
    expect(again.headers.get("content-security-policy")).toBe(FRAME_CSP);
    expect(again.headers.get("etag")).toBe(tag);
    const older = await read(`/${number}/pages/1`, "owner", { "If-None-Match": tag.replace("-h1", "-h0") });
    expect(older.status).toBe(200);
    await older.arrayBuffer();
  });

  it.each(["/1/pages/2", "/1/pages/0", "/1/pages/01", "/1/pages/x", "/9/pages/1"])("answers %s as a thread that isn't there", async (path) => {
    const number = await thread();
    await save(number, PAGE);
    const response = await read(path);
    expect([response.status, await reasonOf(response)]).toEqual([404, "no-thread"]);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("needs a sign-in like every call, and only reads", async () => {
    const number = await thread();
    await save(number, PAGE);
    expect((await harness.fetch(`${THREADS}/${number}/pages/1`)).status).toBe(401);
    const put = await harness.fetch(`${THREADS}/${number}/pages/1`, { method: "POST", headers: { "Cf-Access-Jwt-Assertion": token("sync") } });
    expect(put.status).toBe(405);
  });
});

describe("a link", () => {
  it("is set to a claude.ai address with a title, becomes the main section, and its history keeps the one it replaced", async () => {
    const number = await thread();
    const first = await link(number, { url: "https://claude.ai/artifact/Ux3", title: "Launch talk slides" });
    expect(first.status).toBe(200);
    expect(((await first.json()) as ShownPage).thread).toMatchObject({ main: "link", link: { url: "https://claude.ai/artifact/Ux3", title: "Launch talk slides" } });
    await link(number, { url: "https://claude.ai/artifact/Ux4", title: "" }, "sync", null);
    const view = await shown(number);
    expect(view.thread.link).toEqual({ url: "https://claude.ai/artifact/Ux4", title: null });
    expect(view.events.filter((event) => event.type === "link-set").map((event) => [event.actor, event.data])).toEqual([
      ["owner", { url: "https://claude.ai/artifact/Ux3", title: "Launch talk slides", before: null }],
      ["sync", { url: "https://claude.ai/artifact/Ux4", title: null, before: "https://claude.ai/artifact/Ux3" }],
    ]);
  });

  it("when cleared goes back to the page when there is one, else to the text", async () => {
    const withPage = await thread();
    await save(withPage, PAGE);
    await link(withPage, { url: "https://claude.ai/artifact/Ux3", title: "Slides" });
    const cleared = await link(withPage, { url: "", title: "" });
    expect(((await cleared.json()) as ShownPage).thread).toMatchObject({ main: "page", link: null });
    const plain = await thread();
    await link(plain, { url: "https://claude.ai/artifact/Ux3", title: "Slides" });
    expect(((await (await link(plain, { url: "", title: "x" })).json()) as ShownPage).thread).toMatchObject({ main: "text", link: null });
    expect((await shown(plain)).events.at(-1)).toMatchObject({ type: "link-set", data: { url: null, title: null, before: "https://claude.ai/artifact/Ux3" } });
  });

  it("makes a page saved after it the main section again", async () => {
    const number = await thread();
    await link(number, { url: "https://claude.ai/artifact/Ux3", title: "Slides" });
    await save(number, PAGE);
    expect((await shown(number)).thread).toMatchObject({ main: "page", link: { url: "https://claude.ai/artifact/Ux3" } });
  });

  it.each([
    ["another site", { url: "https://example.com/artifact/x", title: "x" }],
    ["claude.ai without https", { url: "http://claude.ai/artifact/x", title: "x" }],
    ["a host that only starts like claude.ai", { url: "https://claude.ai.example.com/x", title: "x" }],
    ["a space in the address", { url: "https://claude.ai/a b", title: "x" }],
    ["a title of two lines", { url: "https://claude.ai/x", title: "one\ntwo" }],
    ["a title over 200", { url: "https://claude.ai/x", title: "x".repeat(201) }],
    ["no title key", { url: "https://claude.ai/x" }],
    ["an address that isn't text", { url: 4, title: "x" }],
  ])("refuses %s with 400, and writes nothing", async (_, body) => {
    const number = await thread();
    const response = await link(number, body);
    expect([response.status, await reasonOf(response)]).toEqual([400, "link"]);
    expect((await shown(number)).thread.main).toBe("text");
  });

  it("from the owner on another origin, or none, is refused with 403", async () => {
    const number = await thread();
    for (const origin of ["https://elsewhere.example", null]) {
      const response = await link(number, { url: "https://claude.ai/x", title: "x" }, "owner", origin);
      expect([response.status, await reasonOf(response)]).toEqual([403, "origin"]);
    }
  });

  it("on a thread that isn't there is 404", async () => {
    expect((await link(999, { url: "https://claude.ai/x", title: "x" })).status).toBe(404);
  });
});

describe("a list", () => {
  it("names each thread's main section, so a row can mark a page or a link", async () => {
    const page = await thread();
    await save(page, PAGE);
    const linked = await thread();
    await link(linked, { url: "https://claude.ai/x", title: "x" });
    await thread();
    const response = await read("?tab=discuss");
    const threads = ((await response.json()) as { threads: { number: number; main: string }[] }).threads;
    expect(threads.map((one) => one.main)).toEqual(["text", "link", "page"]);
  });
});
