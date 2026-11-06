// The journal's calls (src/journal.ts, src/journal-store.ts), run as production runs them: the Worker's bundle in
// workerd with a local D1 and a local R2 bucket, and Cloudflare Access played for the threads' application
// (test/harness.ts). What it holds: the journal is Suresh's alone, so an invited person is refused every call before
// anything is read, and nobody signed out reads anything; the owner's writes come only from his own page; a save is
// kept byte for byte as a new version on the version it names, and a save built on an older one writes nothing at all
// (no version, no index, no storyline line) and says which version is newest, while two racing saves keep exactly one;
// no version is ever overwritten, and an earlier one reads as it was; the index and the storylines follow each save,
// a week's margin adding no storyline touch; a page must have a title and fit its limit; a key is a real day or week
// or reads as an entry never written; typed answers are his alone, on a day with an entry, all kept and newest last; a
// photo is the sync's alone, a JPEG or PNG by its own first bytes, at most 4 MiB, and a refused one leaves no object;
// a page shows only photos already uploaded; and a photo comes back byte for byte with its own type, `nosniff`, and a
// cache that may keep it, because it never changes.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SITE, startHarness, type Harness } from "./harness.ts";

const JOURNAL = `${SITE}/threads/api/journal`;
const MEMBER = "meera@example.com";

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

type Who = "owner" | "sync" | "member" | "nobody";

function headersFor(as: Who): Record<string, string> {
  if (as === "nobody") return {};
  const claims = as === "owner" ? harness.access.ownerClaims() : as === "sync" ? harness.access.syncClaims() : harness.access.memberClaims(MEMBER);
  return { "Cf-Access-Jwt-Assertion": harness.access.token(claims) };
}

/** A GET under the journal, by its path after /threads/api/journal. */
async function get(path: string, as: Who = "owner"): Promise<Response> {
  return harness.fetch(`${JOURNAL}${path}`, { headers: headersFor(as) });
}

/** A JSON POST under the journal; the owner's comes from his own page unless `origin` says otherwise. */
async function post(path: string, body: unknown, as: Who = "sync", origin: string | null = SITE): Promise<Response> {
  const headers: Record<string, string> = { ...headersFor(as), "Content-Type": "application/json" };
  if (as === "owner" && origin !== null) headers.Origin = origin;
  return harness.fetch(`${JOURNAL}${path}`, { method: "POST", headers, body: new TextEncoder().encode(JSON.stringify(body)) });
}

/** A photo's bytes POSTed as the sync uploads one. */
async function upload(bytes: Uint8Array, type = "image/jpeg", as: Who = "sync"): Promise<Response> {
  const headers: Record<string, string> = { ...headersFor(as), "Content-Type": type };
  if (as === "owner") headers.Origin = SITE;
  return harness.fetch(`${JOURNAL}/photos`, { method: "POST", headers, body: bytes });
}

async function reasonOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { reason: string }).reason];
}

async function count(table: string): Promise<number> {
  return (await (await harness.db()).prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;
}

async function objects(): Promise<string[]> {
  return (await (await harness.pages()).list()).objects.map((object) => object.key);
}

/** A made-up day in the sync's grammar, with its storylines. */
function day(title: string, storylines: string[] = ["**Storyline · The talk:** 12 days to go."], extra = ""): string {
  return `## ${title}\n*Tuesday, 3 March · one story*\n\n**In one line:** A made-up day.\n\n**People:** Ada\n${storylines.join("\n")}\n\n· · ·\n\nIt rained, then it stopped.${extra}\n\n· · ·\n\n**Sitting with:** rain.\n\n**Tomorrow's question:** Did it rain again?\n`;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 2, 3, 4, 5]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

/** An invited person: a thread the sync adds, and the owner's invitation to it. */
async function invite(): Promise<void> {
  const added = await harness.fetch(`${SITE}/threads/api/threads`, {
    method: "POST",
    headers: { ...headersFor("sync"), "Content-Type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify({ ref: "chat:journal-test", source: "self", title: "A thread", body: "Words.", space: null, status: "discuss" })),
  });
  expect(added.status).toBe(201);
  const number = ((await added.json()) as { thread: { number: number } }).thread.number;
  const invited = await harness.fetch(`${SITE}/threads/api/threads/${number}/people`, {
    method: "POST",
    headers: { ...headersFor("owner"), "Content-Type": "application/json", Origin: SITE },
    body: new TextEncoder().encode(JSON.stringify({ add: { email: MEMBER, name: "Meera" } })),
  });
  expect(invited.status).toBe(200);
}

describe("who may call", () => {
  it("refuses an invited person every call with 403 owner-only, before anything is read", async () => {
    await invite();
    expect((await post("/2026-03-03", { text: day("Kept"), base: 0 })).status).toBe(201);
    const calls: [string, () => Promise<Response>][] = [
      ["list", () => get("", "member")],
      ["an entry there", () => get("/2026-03-03", "member")],
      ["an entry never written", () => get("/2026-03-04", "member")],
      ["a key that isn't one", () => get("/nonsense", "member")],
      ["the storylines", () => get("/storylines", "member")],
      ["a photo", () => get("/photos/0b6f2c8e-1d1a-4c55-9a0e-6f0f8a1b2c3d", "member")],
      ["a save", () => post("/2026-03-03", { text: day("Mine"), base: 1 }, "member")],
      ["an answer", () => post("/2026-03-03/answers", { body: "Yes." }, "member")],
      ["an upload", () => upload(JPEG, "image/jpeg", "member")],
    ];
    for (const [what, call] of calls) expect([what, ...(await reasonOf(await call()))]).toEqual([what, 403, "owner-only"]);
    expect(await count("journal_versions")).toBe(1);
    expect(await count("journal_answers")).toBe(0);
    expect(await objects()).toEqual([]);
  });

  it("reads nothing to anyone signed out", async () => {
    expect((await post("/2026-03-03", { text: day("Kept"), base: 0 })).status).toBe(201);
    for (const path of ["", "/2026-03-03", "/storylines"]) {
      const response = await get(path, "nobody");
      expect([path, response.status]).toEqual([path, 401]);
      expect(await response.text()).not.toContain("rain");
    }
  });

  it("takes the owner's writes only from his own page, and the sync's with no origin", async () => {
    expect(await reasonOf(await post("/2026-03-03", { text: day("Mine"), base: 0 }, "owner", null))).toEqual([403, "origin"]);
    expect(await reasonOf(await post("/2026-03-03", { text: day("Mine"), base: 0 }, "owner", "https://example.com"))).toEqual([403, "origin"]);
    expect((await post("/2026-03-03", { text: day("Mine"), base: 0 }, "owner")).status).toBe(201);
    expect((await post("/2026-03-03", { text: day("The sync's"), base: 1 }, "sync", null)).status).toBe(201);
    expect(await reasonOf(await post("/2026-03-03/answers", { body: "Yes." }, "owner", null))).toEqual([403, "origin"]);
  });

  it("keeps answers the owner's and uploads the sync's", async () => {
    expect((await post("/2026-03-03", { text: day("Kept"), base: 0 })).status).toBe(201);
    expect(await reasonOf(await post("/2026-03-03/answers", { body: "Yes." }, "sync"))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await upload(JPEG, "image/jpeg", "owner"))).toEqual([403, "sync-only"]);
    expect(await count("journal_answers")).toBe(0);
    expect(await objects()).toEqual([]);
  });
});

describe("saving", () => {
  it("keeps the text byte for byte as version 1, and indexes it", async () => {
    const text = `${day("A quiet start").replace("It rained", "It  rained")}\n  \t\n`;
    const saved = await post("/2026-03-03", { text, base: 0 });
    expect([saved.status, await saved.json()]).toEqual([201, { key: "2026-03-03", version: 1 }]);
    const read = (await (await get("/2026-03-03", "sync")).json()) as Record<string, unknown>;
    expect(read).toMatchObject({ key: "2026-03-03", kind: "day", version: 1, newest: 1, text, actor: "sync", answers: [] });
    expect(read.versions).toEqual([{ version: 1, savedAt: expect.any(String), actor: "sync", bytes: new TextEncoder().encode(text).byteLength }]);
    const list = (await (await get("")).json()) as { entries: unknown[] };
    expect(list.entries).toEqual([
      { key: "2026-03-03", kind: "day", version: 1, savedAt: expect.any(String), title: "A quiet start", oneLine: "A made-up day.", stories: 1, photos: 0, question: "Did it rain again?" },
    ]);
  });

  it("writes nothing at all for a save built on an older version, and says which is newest", async () => {
    expect((await post("/2026-03-03", { text: day("First"), base: 0 })).status).toBe(201);
    expect((await post("/2026-03-03", { text: day("His fix"), base: 1 }, "owner")).status).toBe(201);
    const before = await (await get("")).text();
    const lines = await (await get("/storylines")).text();
    const stale = await post("/2026-03-03", { text: day("The sync, from version 1", ["**Storyline · Another:** new (new)"]), base: 1 });
    expect([stale.status, await stale.json()]).toEqual([409, { reason: "stale", version: 2 }]);
    expect(await reasonOf(await post("/2026-03-03", { text: day("A new entry?"), base: 0 }))).toEqual([409, "stale"]);
    expect(await reasonOf(await post("/2026-03-04", { text: day("Never there"), base: 3 }))).toEqual([409, "stale"]);
    expect(await count("journal_versions")).toBe(2);
    expect(await (await get("")).text()).toBe(before);
    expect(await (await get("/storylines")).text()).toBe(lines);
    expect(((await (await get("/2026-03-03")).json()) as { text: string }).text).toBe(day("His fix"));
  });

  it("keeps one of two saves racing on the same version, and refuses the other as stale", async () => {
    expect((await post("/2026-03-03", { text: day("First"), base: 0 })).status).toBe(201);
    const answers = await Promise.all([post("/2026-03-03", { text: day("One"), base: 1 }), post("/2026-03-03", { text: day("Two"), base: 1 }, "owner")]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    expect(await count("journal_versions")).toBe(2);
  });

  it("never overwrites a version: an earlier one reads as it was", async () => {
    expect((await post("/2026-03-03", { text: day("First"), base: 0 })).status).toBe(201);
    expect((await post("/2026-03-03", { text: day("Second"), base: 1 }, "owner")).status).toBe(201);
    const first = (await (await get("/2026-03-03?version=1")).json()) as Record<string, unknown>;
    expect(first).toMatchObject({ version: 1, newest: 2, text: day("First"), actor: "sync" });
    expect((first.versions as unknown[]).length).toBe(2);
    expect(await reasonOf(await get("/2026-03-03?version=3"))).toEqual([404, "no-entry"]);
    expect(await reasonOf(await get("/2026-03-03?version=0"))).toEqual([404, "no-entry"]);
    expect(await reasonOf(await get("/2026-03-03?version=1&version=2"))).toEqual([400, "query"]);
    expect(await reasonOf(await get("/2026-03-03?v=1"))).toEqual([400, "query"]);
  });

  it("refuses a page with no title, one too long, and a malformed save, writing nothing", async () => {
    const refused: unknown[] = [
      { text: "Just words, no title.", base: 0 },
      { text: `## Long\n\n${"x".repeat(64_000)}`, base: 0 },
      { text: day("Fine"), base: -1 },
      { text: day("Fine"), base: 1.5 },
      { text: day("Fine"), base: "0" },
      { text: day("Fine") },
      { text: day("Fine"), base: 0, extra: true },
      { text: `## Bell\u0007`, base: 0 },
    ];
    for (const body of refused) expect(await reasonOf(await post("/2026-03-03", body))).toEqual([400, "journal"]);
    expect(await count("journal_versions")).toBe(0);
    expect(await count("journal_entries")).toBe(0);
  });

  it("answers a key that isn't a real day or week as an entry never written", async () => {
    for (const key of ["2026-02-30", "2026-W54", "2026-11-6", "today", "2026-w44"]) {
      expect([key, ...(await reasonOf(await get(`/${key}`)))]).toEqual([key, 404, "no-entry"]);
      expect([key, ...(await reasonOf(await post(`/${key}`, { text: day("X"), base: 0 })))]).toEqual([key, 404, "no-entry"]);
    }
    expect(await reasonOf(await get("/2026-03-03"))).toEqual([404, "no-entry"]);
    expect(await reasonOf(await get("/2026-03-03/versions"))).toEqual([404, "not-found"]);
    expect(await reasonOf(await get("/storylines/the-talk"))).toEqual([404, "not-found"]);
    expect(await reasonOf(await get("?tab=all"))).toEqual([400, "query"]);
    expect(await reasonOf(await get("/storylines?x=1"))).toEqual([400, "query"]);
    expect((await harness.fetch(`${JOURNAL}/2026-03-03`, { method: "PUT", headers: headersFor("owner") })).status).toBe(405);
    expect(await count("journal_versions")).toBe(0);
  });

  it("refuses a page naming more than 100 storylines or 100 photos", async () => {
    const lines = Array.from({ length: 101 }, (_, n) => `**Storyline · Line ${n}:** fine.`);
    expect(await reasonOf(await post("/2026-03-03", { text: day("Many", lines), base: 0 }))).toEqual([400, "journal"]);
    expect((await post("/2026-03-03", { text: day("Enough", lines.slice(0, 100)), base: 0 })).status).toBe(201);
    const photos = Array.from({ length: 101 }, (_, n) => `![p](photo:0b6f2c8e-1d1a-4c55-9a0e-${String(n).padStart(12, "0")})`).join("\n\n");
    expect(await reasonOf(await post("/2026-03-04", { text: day("Photos", [], `\n\n${photos}`), base: 0 }))).toEqual([400, "photo"]);
    expect(await count("journal_versions")).toBe(1);
  });

  it("takes a page escaped as \\uXXXX throughout, at its full length", async () => {
    const text = `## ${"త".repeat(63_000)}\n`;
    const body = new TextEncoder().encode(JSON.stringify({ text, base: 0 }).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`));
    const response = await harness.fetch(`${JOURNAL}/2026-03-03`, { method: "POST", headers: { ...headersFor("sync"), "Content-Type": "application/json" }, body });
    expect(response.status).toBe(201);
  });

  it("refuses a body with no declared length, one too large, and one that isn't JSON", async () => {
    const text = new TextEncoder().encode(JSON.stringify({ text: day("X"), base: 0 }));
    const wrongType = await harness.fetch(`${JOURNAL}/2026-03-03`, { method: "POST", headers: { ...headersFor("sync"), "Content-Type": "text/plain" }, body: text });
    expect(await reasonOf(wrongType)).toEqual([415, "type"]);
    const large = await harness.fetch(`${JOURNAL}/2026-03-03`, { method: "POST", headers: { ...headersFor("sync"), "Content-Type": "application/json" }, body: new Uint8Array(400 * 1024 + 1) });
    expect(await reasonOf(large)).toEqual([413, "too-large"]);
  });
});

describe("the index and the storylines", () => {
  it("follow each save, a week's margin adding no storyline touch, and order the journal newest first", async () => {
    expect((await post("/2026-10-31", { text: day("Saturday", ["**Storyline · The demo:** 9 days to go.", "**Storyline · Rest (new):** asleep by nine."]), base: 0 })).status).toBe(201);
    expect((await post("/2026-11-01", { text: day("Sunday", ["**Storyline · The demo:** 8 days to go.", "**Storyline · The demo:** 8 days to go, rehearsal Monday."]), base: 0 })).status).toBe(201);
    const week = "## Week 44 · Going public\n*Monday 26 October – Sunday 1 November*\n\nThe week.\n\n**Storyline · The demo:** 8 days to go.\n**Storyline · Quiet one:** nothing.\n**The week ahead:** What next?\n";
    const saved = await post("/2026-W44", { text: week, base: 0 });
    expect([saved.status, await saved.json()]).toEqual([201, { key: "2026-W44", version: 1 }]);
    const weekLines = await (await harness.db()).prepare("SELECT COUNT(*) AS n FROM journal_storylines WHERE key = '2026-W44'").first<{ n: number }>();
    expect(weekLines?.n).toBe(0);
    expect((await post("/2026-11-02", { text: day("Monday", []), base: 0 })).status).toBe(201);

    const list = (await (await get("")).json()) as { entries: { key: string; kind: string; question: string | null }[] };
    expect(list.entries.map((entry) => [entry.key, entry.kind, entry.question])).toEqual([
      ["2026-11-02", "day", "Did it rain again?"],
      ["2026-W44", "week", null],
      ["2026-11-01", "day", "Did it rain again?"],
      ["2026-10-31", "day", "Did it rain again?"],
    ]);
    const trails = (await (await get("/storylines", "sync")).json()) as { storylines: unknown[] };
    expect(trails.storylines).toEqual([
      {
        name: "The demo",
        first: "2026-10-31",
        last: "2026-11-01",
        state: "8 days to go, rehearsal Monday.",
        mark: null,
        days: [
          { key: "2026-10-31", state: "9 days to go.", mark: null },
          { key: "2026-11-01", state: "8 days to go, rehearsal Monday.", mark: null },
        ],
      },
      { name: "Rest", first: "2026-10-31", last: "2026-10-31", state: "asleep by nine.", mark: "new", days: [{ key: "2026-10-31", state: "asleep by nine.", mark: "new" }] },
    ]);

    // A day saved again replaces its lines: a storyline it no longer names leaves that day's trail.
    expect((await post("/2026-10-31", { text: day("Saturday, fixed", ["**Storyline · The demo:** 9 days to go (closed)"]), base: 1 }, "owner")).status).toBe(201);
    const after = (await (await get("/storylines")).json()) as { storylines: { name: string; days: { key: string; mark: string | null }[] }[] };
    expect(after.storylines.map((line) => [line.name, line.days.map((touch) => [touch.key, touch.mark])])).toEqual([["The demo", [["2026-10-31", "closed"], ["2026-11-01", null]]]]);
    const fixed = (await (await get("")).json()) as { entries: { key: string; title: string; version: number }[] };
    expect(fixed.entries.find((entry) => entry.key === "2026-10-31")).toMatchObject({ title: "Saturday, fixed", version: 2 });
  });
});

describe("answers", () => {
  it("keeps every answer to a day with an entry, newest last, an empty one taking it back", async () => {
    expect(await reasonOf(await post("/2026-03-03/answers", { body: "Too early." }, "owner"))).toEqual([404, "no-entry"]);
    expect((await post("/2026-03-03", { text: day("Kept"), base: 0 })).status).toBe(201);
    const first = await post("/2026-03-03/answers", { body: "  It did.  " }, "owner");
    expect([first.status, await first.json()]).toEqual([201, { answer: { id: expect.any(Number), body: "It did.", createdAt: expect.any(String) } }]);
    expect((await post("/2026-03-03/answers", { body: "" }, "owner")).status).toBe(201);
    expect((await post("/2026-03-03/answers", { body: "It did, twice." }, "owner")).status).toBe(201);
    const read = (await (await get("/2026-03-03", "sync")).json()) as { answers: { body: string }[] };
    expect(read.answers.map((one) => one.body)).toEqual(["It did.", "", "It did, twice."]);
  });

  it("refuses an answer to a week, one too long, and a malformed one", async () => {
    expect((await post("/2026-W10", { text: "## Week 10 · Steps\n\nWords.\n", base: 0 })).status).toBe(201);
    expect((await post("/2026-03-03", { text: day("Kept"), base: 0 })).status).toBe(201);
    expect(await reasonOf(await post("/2026-W10/answers", { body: "No." }, "owner"))).toEqual([404, "no-entry"]);
    expect(await reasonOf(await post("/2026-03-03/answers", { body: "x".repeat(4001) }, "owner"))).toEqual([400, "answer"]);
    expect(await reasonOf(await post("/2026-03-03/answers", { body: 3 }, "owner"))).toEqual([400, "answer"]);
    expect(await reasonOf(await post("/2026-03-03/answers", { body: "Yes.", key: "x" }, "owner"))).toEqual([400, "answer"]);
    expect(await count("journal_answers")).toBe(0);
  });
});

describe("photos", () => {
  it("keeps a JPEG and a PNG, and serves each back byte for byte as itself, cached because it never changes", async () => {
    for (const [bytes, type, extension] of [[JPEG, "image/jpeg", "jpg"], [PNG, "image/png", "png"]] as const) {
      const response = await upload(bytes, `${type}; charset=binary`);
      const kept = (await response.json()) as { id: string; type: string; bytes: number };
      expect([response.status, kept]).toEqual([201, { id: expect.stringMatching(/^[0-9a-f-]{36}$/), type, bytes: bytes.byteLength }]);
      expect(await objects()).toContain(`journal/${kept.id}.${extension}`);
      const served = await get(`/photos/${kept.id}`);
      expect(served.status).toBe(200);
      expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
      expect(served.headers.get("Content-Type")).toBe(type);
      expect(served.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
      expect(served.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(served.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    }
  });

  it("refuses bytes that aren't the image they claim, another type, no length and too large, leaving no object", async () => {
    expect(await reasonOf(await upload(new TextEncoder().encode("<svg onload=alert(1)>"), "image/jpeg"))).toEqual([415, "type"]);
    expect(await reasonOf(await upload(PNG, "image/jpeg"))).toEqual([415, "type"]);
    expect(await reasonOf(await upload(new Uint8Array([0xff, 0xd8]), "image/jpeg"))).toEqual([415, "type"]);
    expect(await reasonOf(await upload(JPEG, "image/svg+xml"))).toEqual([415, "type"]);
    expect(await reasonOf(await upload(JPEG, "text/html"))).toEqual([415, "type"]);
    const large = new Uint8Array(4 * 1024 * 1024 + 1);
    large.set(JPEG);
    expect(await reasonOf(await upload(large))).toEqual([413, "too-large"]);
    expect(await objects()).toEqual([]);
    expect(await count("journal_photos")).toBe(0);
  });

  it("lets a page show only a photo already uploaded", async () => {
    const id = ((await (await upload(JPEG)).json()) as { id: string }).id;
    const unknown = "0b6f2c8e-1d1a-4c55-9a0e-6f0f8a1b2c3d";
    expect(await reasonOf(await post("/2026-03-03", { text: day("X", [], `\n\n![Rain](photo:${unknown})`), base: 0 }))).toEqual([400, "photo"]);
    const saved = await post("/2026-03-03", { text: day("X", [], `\n\n![Rain](photo:${id})\n\n![Elsewhere](https://example.com/a.jpg)`), base: 0 });
    expect(saved.status).toBe(201);
    const list = (await (await get("")).json()) as { entries: { photos: number }[] };
    expect(list.entries[0]?.photos).toBe(1);
    expect(await reasonOf(await get(`/photos/${unknown}`))).toEqual([404, "no-photo"]);
    expect(await reasonOf(await get("/photos/not-an-id"))).toEqual([404, "no-photo"]);
    expect((await harness.fetch(`${JOURNAL}/photos/${id}`, { method: "POST", headers: headersFor("sync") })).status).toBe(405);
  });
});
