// The avatars' photos (src/photos.ts, src/photos-store.ts, migrations/0020_photos.sql), run as production runs them:
// the Worker's bundle in workerd with a local D1 and R2, Cloudflare Access played for the threads' application, and
// Gravatar played by the hash it is asked for (test/harness.ts). What it holds: Suresh's own photo is his alone to
// set, replace and remove, from his own page, and an invited person or the sync is refused before anything is read;
// a photo is a JPEG or PNG by its own first bytes, at most 4 MiB, with a declared length, as the journal's are, and a
// refused or failed one leaves no object; a photo is served to anyone at /api/photos/<id> on the threads' host, public
// and cached for good, and one he replaced or removed is never served again; the hourly run looks up a Gravatar once
// for each person he invited, at most twenty a run, by the SHA-256 of their address and never the address itself,
// keeps one it finds, marks one that has none, and tries again next hour when Gravatar fails; a
// run with nobody due asks Gravatar nothing; a sweep that fails fails the run, while the home page's sources are still
// fetched. On the wire, his photo is `ownerPhoto` (who is calling, and a public thread's read), and a person's
// `photo` reaches a comment only when an invited person wrote it, never a visitor's note, even under an invited
// person's address, because anyone may type an address there.

import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SITE, THREADS, THUMB, startHarness, type Harness } from "./harness.ts";

const MEERA = "meera@example.com";
const DEV = "dev@example.org";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness({ triggers: true });
});
afterAll(async () => {
  await harness.dispose();
});
beforeEach(async () => {
  await harness.reset();
});

/** Who a call is from: the owner, the sync, or a person signed in by that address. */
type Who = "owner" | "sync" | { readonly email: string };

function token(as: Who): string {
  if (as === "owner") return harness.access.token(harness.access.ownerClaims());
  if (as === "sync") return harness.access.token(harness.access.syncClaims());
  return harness.access.token(harness.access.memberClaims(as.email));
}

/** A JSON call under /threads/api/; a POST comes from the site's own page unless `origin` says otherwise. */
async function call(path: string, as: Who = "owner", body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(as) };
  if (body === undefined) return harness.fetch(`${THREADS}/threads/api${path}`, { headers });
  return harness.fetch(`${THREADS}/threads/api${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Origin: THREADS },
    body: new TextEncoder().encode(JSON.stringify(body)),
  });
}

interface Send {
  as?: Who;
  type?: string;
  origin?: string | null;
  noLength?: boolean;
}

/** His photo, set as the page sends it: the image's own bytes. */
async function setPhoto(bytes: Uint8Array, options: Send = {}): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(options.as ?? "owner"), "Content-Type": options.type ?? "image/jpeg" };
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
  return harness.fetch(`${THREADS}/threads/api/photo`, init);
}

async function removePhoto(options: Send = {}): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(options.as ?? "owner") };
  if (options.origin !== null) headers.Origin = options.origin ?? THREADS;
  return harness.fetch(`${THREADS}/threads/api/photo`, { method: "DELETE", headers });
}

async function answer<T>(response: Response, status = 200): Promise<T> {
  const text = await response.text();
  expect([response.status, text]).toEqual([status, expect.any(String)]);
  return JSON.parse(text) as T;
}

async function reasonOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { reason: string }).reason];
}

/**
 * A body refused by its declared length before it is read: the Worker answers 413 at once, and the local runtime may
 * close the connection before the rest of a large body is written, which the client sees as the write failing.
 */
async function refusedUnread(sent: Promise<Response>): Promise<string> {
  try {
    const [status, reason] = await reasonOf(await sent);
    return `${status} ${reason}`;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? (error.cause as Error & { code?: string }).code : undefined;
    if (cause === "ECONNRESET" || cause === "EPIPE") return "413 too-large";
    throw error;
  }
}

async function count(sql: string, ...values: unknown[]): Promise<number> {
  return (await (await harness.db()).prepare(sql).bind(...values).first<{ n: number }>())?.n ?? 0;
}

/** The objects the bucket keeps under photos/. */
async function objects(): Promise<string[]> {
  return (await (await harness.pages()).list({ prefix: "photos/" })).objects.map((object) => object.key).sort();
}

/** A photo as anyone fetches it, with no sign-in. */
async function served(id: string, host = THREADS): Promise<Response> {
  return harness.fetch(`${host}/api/photos/${id}`);
}

interface Me {
  caller: string;
  email: string | null;
  ownerPhoto: string | null;
  photo?: string | null;
}

async function me(as: Who = "owner"): Promise<Me> {
  return answer<Me>(await call("/me", as));
}

let refs = 0;
/** A thread of his own the sync adds; answers its number. */
async function thread(): Promise<number> {
  refs += 1;
  const body = { ref: `chat:photos-${refs}`, source: "self", title: `Thread ${refs}`, body: `Body ${refs}`, space: "company", status: "act" };
  return (await answer<{ thread: { number: number } }>(await call("/threads", "sync", body), 201)).thread.number;
}

async function invite(number: number, email: string, name: string): Promise<void> {
  await answer(await call(`/threads/${number}/people`, "owner", { add: { email, name } }));
}

/** The SHA-256 of an address as Gravatar is asked for it: trimmed and lowercased first. */
function hashOf(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** Gives a person a photo as the hourly run would have, for the wire's tests. */
async function givePhoto(email: string): Promise<string> {
  const database = await harness.db();
  const id = crypto.randomUUID();
  await (await harness.pages()).put(`photos/${id}.jpg`, JPEG, { httpMetadata: { contentType: "image/jpeg" } });
  await database.batch([
    database.prepare("INSERT INTO photos (id, object_key, type, bytes, created_at) VALUES (?1, ?2, 'image/jpeg', ?3, '2026-11-01T00:00:00.000Z')").bind(id, `photos/${id}.jpg`, JPEG.byteLength),
    database.prepare("UPDATE people SET photo_id = ?1, photo_checked_at = '2026-11-01T00:00:00.000Z' WHERE email = ?2").bind(id, email),
  ]);
  return id;
}

describe("his photo", () => {
  it("is set, replaced and removed by him, and one he took down is never served again", async () => {
    expect((await me()).ownerPhoto).toBeNull();
    const first = (await answer<{ photo: string }>(await setPhoto(JPEG))).photo;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect((await me()).ownerPhoto).toBe(first);
    expect(await objects()).toEqual([`photos/${first}.jpg`]);
    const shown = await served(first);
    expect(shown.status).toBe(200);
    expect(new Uint8Array(await shown.arrayBuffer())).toEqual(JPEG);

    const second = (await answer<{ photo: string }>(await setPhoto(PNG, { type: "image/png" }))).photo;
    expect(second).not.toBe(first);
    expect((await me()).ownerPhoto).toBe(second);
    expect((await served(first)).status).toBe(404);
    expect((await served(second)).headers.get("Content-Type")).toBe("image/png");
    expect(await objects()).toEqual([`photos/${second}.png`]);
    expect(await count("SELECT COUNT(*) AS n FROM photos")).toBe(1);

    expect(await answer<{ photo: string | null }>(await removePhoto())).toEqual({ photo: null });
    expect((await me()).ownerPhoto).toBeNull();
    expect((await served(second)).status).toBe(404);
    expect(await objects()).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM photos")).toBe(0);
    // His choices are kept as a history, the newest being his photo: none of its rows is ever changed.
    expect(await count("SELECT COUNT(*) AS n FROM owner_photos")).toBe(3);
    expect(await count("SELECT COUNT(*) AS n FROM owner_photos WHERE photo_id IS NULL")).toBe(1);
  });

  it("is his alone: an invited person and the sync are refused before anything is read, and so is another site", async () => {
    const n = await thread();
    await invite(n, MEERA, "Meera");
    for (const as of [{ email: MEERA }, "sync"] as const) {
      expect(await reasonOf(await setPhoto(JPEG, { as }))).toEqual([403, "owner-only"]);
      expect(await reasonOf(await setPhoto(new TextEncoder().encode("not an image"), { as, type: "text/plain" }))).toEqual([403, "owner-only"]);
      expect(await reasonOf(await removePhoto({ as }))).toEqual([403, "owner-only"]);
    }
    expect(await reasonOf(await setPhoto(JPEG, { origin: null }))).toEqual([403, "origin"]);
    expect(await reasonOf(await setPhoto(JPEG, { origin: "https://elsewhere.example" }))).toEqual([403, "origin"]);
    expect(await reasonOf(await removePhoto({ origin: null }))).toEqual([403, "origin"]);
    const get = await harness.fetch(`${THREADS}/threads/api/photo`, { headers: { "Cf-Access-Jwt-Assertion": token("owner") } });
    expect([get.status, get.headers.get("Allow")]).toEqual([405, "POST, DELETE"]);
    expect((await harness.fetch(`${THREADS}/threads/api/photo`, { method: "POST", body: JPEG })).status).not.toBe(200);
    expect(await objects()).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM owner_photos")).toBe(0);
  });

  it("refuses what the journal refuses: no length, too large, and bytes that aren't the image they claim, leaving nothing", async () => {
    expect(await reasonOf(await setPhoto(JPEG, { noLength: true }))).toEqual([411, "length"]);
    const large = new Uint8Array(4 * 1024 * 1024 + 1);
    large.set(JPEG);
    expect(await refusedUnread(setPhoto(large))).toBe("413 too-large");
    expect(await reasonOf(await setPhoto(new TextEncoder().encode("<svg onload=alert(1)>")))).toEqual([415, "type"]);
    expect(await reasonOf(await setPhoto(PNG, { type: "image/jpeg" }))).toEqual([415, "type"]);
    expect(await reasonOf(await setPhoto(JPEG, { type: "image/gif" }))).toEqual([415, "type"]);
    expect(await objects()).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM photos")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM owner_photos")).toBe(0);
  });

  it("leaves no object behind when its rows can't be kept, and keeps the photo he had", async () => {
    const kept = (await answer<{ photo: string }>(await setPhoto(JPEG))).photo;
    const database = await harness.db();
    await database.prepare("ALTER TABLE owner_photos RENAME TO owner_photos_aside").run();
    try {
      expect((await setPhoto(PNG, { type: "image/png" })).status).toBe(500);
    } finally {
      await database.prepare("ALTER TABLE owner_photos_aside RENAME TO owner_photos").run();
    }
    expect(await objects()).toEqual([`photos/${kept}.jpg`]);
    expect((await me()).ownerPhoto).toBe(kept);
    expect((await served(kept)).status).toBe(200);
  });
});

describe("serving a photo", () => {
  it("answers anyone with the image, public and cached for good, never sniffed or run as a page", async () => {
    const id = (await answer<{ photo: string }>(await setPhoto(JPEG))).photo;
    const response = await served(id);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(["Content-Type", "Content-Length", "Cache-Control", "X-Content-Type-Options", "Content-Security-Policy"].map((name) => [name, response.headers.get(name)]))).toEqual({
      "Content-Type": "image/jpeg",
      "Content-Length": String(JPEG.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    const head = await harness.fetch(`${THREADS}/api/photos/${id}`, { method: "HEAD" });
    expect([head.status, head.headers.get("Content-Length")]).toEqual([200, String(JPEG.byteLength)]);
  });

  it("answers one 404 for any id with no photo, refuses a write, and lives on the threads' host alone", async () => {
    const id = (await answer<{ photo: string }>(await setPhoto(JPEG))).photo;
    const unknown = await served("0b6f2c8e-1d1a-4c55-9a0e-6f0f8a1b2c3d");
    const malformed = await served("not-an-id");
    expect([unknown.status, malformed.status]).toEqual([404, 404]);
    expect(await unknown.text()).toBe(await malformed.text());
    expect(unknown.headers.get("Cache-Control")).toBe("no-store");
    expect((await harness.fetch(`${THREADS}/api/photos/${id}`, { method: "POST", body: JPEG })).status).toBe(405);
    expect(await reasonOf(await served(id, SITE))).toEqual([404, "not-found"]);
  });
});

describe("Gravatar, once for each person he invited", () => {
  it("keeps a photo it finds, marks a person who has none, and tries again next hour when Gravatar fails", async () => {
    const n = await thread();
    await invite(n, MEERA, "Meera");
    await invite(n, DEV, "Dev");
    await invite(n, "kiran@example.net", "Kiran");
    harness.outside.gravatars.set(hashOf(MEERA), { body: THUMB });
    harness.outside.gravatars.set(hashOf("kiran@example.net"), { status: 500 });
    expect(await harness.scheduled()).toBe("ok");

    const database = await harness.db();
    const people = (await database.prepare("SELECT email, photo_id, photo_checked_at FROM people ORDER BY email").all<{ email: string; photo_id: string | null; photo_checked_at: string | null }>()).results;
    expect(people.map((person) => [person.email, person.photo_id !== null, person.photo_checked_at !== null])).toEqual([
      [DEV, false, true],
      ["kiran@example.net", false, false],
      [MEERA, true, true],
    ]);
    const photo = people.find((person) => person.email === MEERA)?.photo_id ?? "";
    const response = await served(photo);
    expect([response.status, response.headers.get("Content-Type")]).toEqual([200, "image/jpeg"]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(THUMB);

    harness.outside.gravatars.set(hashOf("kiran@example.net"), {});
    harness.outside.asked.length = 0;
    expect(await harness.scheduled()).toBe("ok");
    expect(harness.outside.asked.filter((asked) => asked.startsWith("gravatar:"))).toEqual([`gravatar:${hashOf("kiran@example.net")}`]);
    expect(await count("SELECT COUNT(*) AS n FROM people WHERE photo_checked_at IS NULL")).toBe(0);
    harness.outside.asked.length = 0;
    expect(await harness.scheduled()).toBe("ok");
    expect(harness.outside.asked.filter((asked) => asked.startsWith("gravatar:"))).toEqual([]);
  });

  it("asks by the SHA-256 of the address, trimmed and lowercased, never the address itself", async () => {
    const n = await thread();
    await invite(n, " Meera@Example.com ", "Meera");
    harness.outside.gravatars.set(hashOf(MEERA), { body: THUMB });
    expect(await harness.scheduled()).toBe("ok");
    expect(harness.outside.gravatarUrls).toEqual([`https://gravatar.com/avatar/${hashOf(MEERA)}?d=404&s=96`]);
    expect(await count("SELECT COUNT(*) AS n FROM people WHERE photo_id IS NOT NULL")).toBe(1);
  });

  it("checks only people he invited, and at most twenty a run, oldest first", async () => {
    const database = await harness.db();
    // A visitor's typed address and someone told about in person are never looked up.
    await database.prepare("INSERT INTO people (id, number, email, name, created_at) VALUES ('visitor', 900, 'typed@example.com', 'Typed', '2026-01-01T00:00:00.000Z')").run();
    await database.prepare("INSERT INTO people (id, number, email, name, created_at) VALUES ('told', 901, NULL, 'Told', '2026-01-01T00:00:00.000Z')").run();
    const n = await thread();
    for (let at = 0; at < 22; at += 1) await invite(n, `person${String(at).padStart(2, "0")}@example.com`, `Person ${at}`);
    expect(await harness.scheduled()).toBe("ok");
    const asked = harness.outside.asked.filter((one) => one.startsWith("gravatar:"));
    expect(asked).toHaveLength(20);
    expect(asked).not.toContain(`gravatar:${hashOf("typed@example.com")}`);
    expect(asked[0]).toBe(`gravatar:${hashOf("person00@example.com")}`);
    expect(await count("SELECT COUNT(*) AS n FROM people WHERE photo_checked_at IS NOT NULL")).toBe(20);
    harness.outside.asked.length = 0;
    expect(await harness.scheduled()).toBe("ok");
    expect(harness.outside.asked.filter((one) => one.startsWith("gravatar:"))).toEqual([`gravatar:${hashOf("person20@example.com")}`, `gravatar:${hashOf("person21@example.com")}`]);
  });

  it("keeps a person invited and then removed in the sweep, and refuses an answer that isn't an image", async () => {
    const n = await thread();
    await invite(n, MEERA, "Meera");
    const people = await answer<{ people: { id: string }[] }>(await call(`/threads/${n}/people`));
    await answer(await call(`/threads/${n}/people`, "owner", { remove: people.people[0]?.id }));
    harness.outside.gravatars.set(hashOf(MEERA), { body: "<svg onload=alert(1)>" });
    expect(await harness.scheduled()).toBe("ok");
    expect(harness.outside.asked).toContain(`gravatar:${hashOf(MEERA)}`);
    expect(await count("SELECT COUNT(*) AS n FROM people WHERE photo_id IS NULL AND photo_checked_at IS NOT NULL")).toBe(1);
    expect(await objects()).toEqual([]);
  });

  it("asks Gravatar nothing when nobody is due", async () => {
    expect(await harness.scheduled()).toBe("ok");
    expect(harness.outboundHosts.has("gravatar.com")).toBe(false);
  });

  it("fails the run when it fails, while the home page's sources are still fetched", async () => {
    const n = await thread();
    await invite(n, MEERA, "Meera");
    harness.outside.gravatars.set(hashOf(MEERA), { body: THUMB });
    const database = await harness.db();
    await database.prepare("ALTER TABLE photos RENAME TO photos_aside").run();
    try {
      expect(await harness.scheduled()).not.toBe("ok");
    } finally {
      await database.prepare("ALTER TABLE photos_aside RENAME TO photos").run();
    }
    expect(await count("SELECT COUNT(*) AS n FROM outside_items")).toBeGreaterThan(0);
    expect(await objects()).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM people WHERE photo_checked_at IS NULL")).toBe(1);
  });
});

describe("the wire", () => {
  interface Said {
    author: string;
    name: string | null;
    photo?: string | null;
  }

  it("says his photo to everyone signed in, and an invited person's own to them", async () => {
    const n = await thread();
    await invite(n, MEERA, "Meera");
    const mine = (await answer<{ photo: string }>(await setPhoto(JPEG))).photo;
    const hers = await givePhoto(MEERA);
    expect(await me()).toEqual({ caller: "owner", email: "owner@example.com", ownerPhoto: mine });
    expect(await me({ email: MEERA })).toEqual({ caller: "member", email: MEERA, ownerPhoto: mine, photo: hers });
    expect((await me("sync")).ownerPhoto).toBe(mine);
  });

  it("puts a photo on an invited person's comment alone, never a visitor's note under their address", async () => {
    const n = await thread();
    await invite(n, MEERA, "Meera");
    const hers = await givePhoto(MEERA);
    await answer(await call(`/threads/${n}/comments`, "owner", { body: "Mine." }), 201);
    await answer(await call(`/threads/${n}/comments`, "sync", { body: "Written down." }), 201);
    await answer(await call(`/threads/${n}/comments`, { email: MEERA }, { body: "Hers." }), 201);
    for (const as of ["owner", "sync", { email: MEERA }] as const) {
      const shown = await answer<{ comments: Said[]; people: Record<string, unknown>[] }>(await call(`/threads/${n}`, as));
      const byAuthor = Object.fromEntries(shown.comments.map((said) => [said.author, said]));
      expect(byAuthor.member?.photo).toBe(hers);
      expect(byAuthor.owner && "photo" in byAuthor.owner).toBe(false);
      expect(byAuthor.sync && "photo" in byAuthor.sync).toBe(false);
      if (as !== "owner" && as !== "sync") expect(JSON.stringify(shown)).not.toContain("example.com\"");
    }
    const people = await answer<{ people: { email: string; photo: string | null }[] }>(await call(`/threads/${n}/people`));
    expect(people.people.map((person) => [person.email, person.photo])).toEqual([[MEERA, hers]]);
    const everyone = await answer<{ people: { email: string; photo: string | null }[] }>(await call("/people"));
    expect(everyone.people.find((person) => person.email === MEERA)?.photo).toBe(hers);
  });

  it("reads his photo on a public thread, an invited person's on their comment, and none on a visitor's note", async () => {
    const n = await thread();
    await answer(await call(`/threads/${n}`, "owner", { action: "publish" }));
    await invite(n, MEERA, "Meera");
    const mine = (await answer<{ photo: string }>(await setPhoto(JPEG))).photo;
    const hers = await givePhoto(MEERA);
    await answer(await call(`/threads/${n}/comments`, "owner", { body: "For anyone.", audience: "public" }), 201);
    await answer(await call(`/threads/${n}/comments`, { email: MEERA }, { body: "Me too.", audience: "public" }), 201);
    const note = await harness.fetch(`${THREADS}/api/threads/${n}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: THREADS, "CF-Connecting-IP": "203.0.113.7" },
      body: new TextEncoder().encode(JSON.stringify({ body: "A note.", name: "Not Meera", email: MEERA, token: "pass" })),
    });
    expect(note.status).toBe(201);
    const read = await answer<{ ownerPhoto: string | null; comments: Said[] }>(await harness.fetch(`${THREADS}/api/threads/${n}`));
    expect(read.ownerPhoto).toBe(mine);
    expect(read.comments.map((said) => [said.author, said.photo ?? null])).toEqual([
      ["owner", null],
      ["member", hers],
      ["visitor", null],
    ]);
    const shown = await answer<{ comments: Said[] }>(await call(`/threads/${n}`));
    expect(shown.comments.find((said) => said.author === "visitor")?.photo ?? null).toBeNull();
  });
});
