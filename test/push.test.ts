// His reminders' pushes, run as production runs them: the Worker's bundle in workerd (test/harness.ts), with a local
// D1, Cloudflare Access played and the push services played, each message they take kept. What it holds: the site's
// public key is the VAPID key's own half; a device is turned on from his own page with a browser's subscription, kept
// once by its endpoint (turning it on again replaces its keys and keeps when it was first on), at most ten, and only
// on a push service's own HTTPS address with a real P-256 key and a 16-byte secret; Send a test reaches only a device
// he turned on, as one message that its own key decrypts to the test's words, signed with an ES256 token for that
// push service's origin, naming the site and good for 12 hours, the key's half beside it, to live 12 hours at normal
// urgency; a push service that says the device is gone forgets it, and any other failure keeps it and says the status;
// turning a device off forgets it. Every call is his alone: the sync and an invited person are refused before anything
// is read, his writes come only from his own page, nobody gets in signed out, and without the key every call answers
// 503. No answer ever carries an endpoint or a key.

import { createECDH, randomBytes, verify, webcrypto } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_PUSH } from "../site/app/reminders.js";
import { PUSH_PUBLIC_KEY, THREADS, startHarness, type Harness, type Pushed } from "./harness.ts";

const MEERA = "meera@example.com";
const FCM = "https://fcm.googleapis.com/fcm/send/";
const APPLE = "https://web.push.apple.com/";

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

function token(as: Who, target: Harness): string {
  if (as === "owner") return target.access.token(target.access.ownerClaims());
  if (as === "sync") return target.access.token(target.access.syncClaims());
  return target.access.token(target.access.memberClaims(as.email));
}

/** A call under /threads/api/push, from the site's own page unless `origin` says otherwise. */
async function call(path: string, request: { as?: Who; method?: string; body?: unknown; origin?: string | null; target?: Harness } = {}): Promise<Response> {
  const target = request.target ?? harness;
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(request.as ?? "owner", target) };
  const method = request.method ?? (request.body === undefined ? "GET" : "POST");
  if (request.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && request.origin !== null) headers.Origin = request.origin ?? THREADS;
  const init: RequestInit = { method, headers };
  if (request.body !== undefined) init.body = new TextEncoder().encode(JSON.stringify(request.body));
  return target.fetch(`${THREADS}/threads/api/push${path}`, init);
}

async function answer<T>(response: Response, status = 200): Promise<T> {
  const text = await response.text();
  expect([response.status, text]).toEqual([status, expect.any(String)]);
  return JSON.parse(text) as T;
}

async function reasonOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { reason: string }).reason];
}

async function count(sql: string, ...values: unknown[]): Promise<number> {
  return (await (await harness.db()).prepare(sql).bind(...values).first<{ n: number }>())?.n ?? 0;
}

/** A browser's subscription, as `PushSubscription.toJSON()` gives it, with the private key only the device holds. */
function device(endpoint = `${FCM}${randomBytes(8).toString("hex")}`) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    subscription: { endpoint, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
    privateKey: ecdh.getPrivateKey(),
    publicKey: ecdh.getPublicKey(),
    auth,
  };
}

const subtle = webcrypto.subtle;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bits: number): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bits));
}

/** Reads a pushed message as the device does (RFC 8291, `aes128gcm`), from the bytes alone and its own keys. */
async function decrypt(body: Uint8Array, held: ReturnType<typeof device>): Promise<unknown> {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idLength = body[20] ?? 0;
  const asPublic = body.slice(21, 21 + idLength);
  const sealed = body.slice(21 + idLength);
  expect([recordSize >= sealed.length, idLength]).toEqual([true, 65]);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(held.privateKey);
  const shared = new Uint8Array(ecdh.computeSecret(asPublic));
  const info = new Uint8Array([...new TextEncoder().encode("WebPush: info\0"), ...held.publicKey, ...asPublic]);
  const ikm = await hkdf(new Uint8Array(held.auth), shared, info, 256);
  const cek = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"), 96);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, sealed));
  // The last record ends with its delimiter, 0x02, and no padding.
  expect(plain.at(-1)).toBe(0x02);
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

/** The site's public key, as the VAPID key's own half: the uncompressed point. */
function sitePublicKey(): string {
  const jwk = PUSH_PUBLIC_KEY.export({ format: "jwk" });
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x ?? "", "base64url"), Buffer.from(jwk.y ?? "", "base64url")]).toString("base64url");
}

/** A push's VAPID token, checked against the site's key; answers its claims. */
function vapidClaims(pushed: Pushed): Record<string, unknown> {
  const header = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(pushed.headers.authorization ?? "");
  expect(header).not.toBeNull();
  const [, head = "", claims = "", signature = "", k = ""] = header ?? [];
  expect(k).toBe(sitePublicKey());
  expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
  const signed = verify("sha256", Buffer.from(`${head}.${claims}`), { key: PUSH_PUBLIC_KEY, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
  expect(signed).toBe(true);
  return JSON.parse(Buffer.from(claims, "base64url").toString()) as Record<string, unknown>;
}

describe("the site's key", () => {
  it("is the VAPID key's own public half", async () => {
    expect(await answer<{ key: string }>(await call("/key"))).toEqual({ key: sitePublicKey() });
  });
});

describe("a device", () => {
  it("is turned on once by its endpoint, keeps when it was first on, and has its keys replaced", async () => {
    const one = device();
    const first = await answer<{ device: { since: string } }>(await call("", { body: one.subscription }));
    const again = device(one.subscription.endpoint);
    const second = await answer<{ device: { since: string } }>(await call("", { body: again.subscription }));
    expect(second.device.since).toBe(first.device.since);
    expect(await count("SELECT COUNT(*) AS n FROM push_devices")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM push_devices WHERE p256dh = ?1", again.subscription.keys.p256dh)).toBe(1);
    // A subscription with no expiry key is taken too, and nothing about it is answered back.
    const plain = device(`${APPLE}${randomBytes(8).toString("hex")}`);
    const { endpoint, keys } = plain.subscription;
    const text = await (await call("", { body: { endpoint, keys } })).text();
    expect(text.includes(endpoint) || text.includes(keys.p256dh) || text.includes(keys.auth)).toBe(false);
  });

  it("is only a push service's own HTTPS address with a real key and secret", async () => {
    const good = device().subscription;
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://evil.example/fcm/send/x",
      "https://fcm.googleapis.com.evil.example/x",
      "https://web.push.apple.com:8443/x",
      "https://user@web.push.apple.com/x",
      "https://web.push.apple.com/x#y",
      `https://fcm.googleapis.com/${"x".repeat(1100)}`,
      "fcm.googleapis.com/x",
    ]) {
      expect([endpoint.slice(0, 40), await reasonOf(await call("", { body: { ...good, endpoint } }))]).toEqual([endpoint.slice(0, 40), [400, "device"]]);
    }
    for (const keys of [
      { p256dh: good.keys.p256dh.slice(0, 40), auth: good.keys.auth },
      { p256dh: good.keys.p256dh, auth: randomBytes(15).toString("base64url") },
      { p256dh: good.keys.p256dh, auth: "not base64!" },
      { p256dh: good.keys.p256dh },
      { ...good.keys, extra: 1 },
    ]) {
      expect(await reasonOf(await call("", { body: { ...good, keys } }))).toEqual([400, "device"]);
    }
    expect(await reasonOf(await call("", { body: { endpoint: good.endpoint } }))).toEqual([400, "device"]);
    expect(await count("SELECT COUNT(*) AS n FROM push_devices")).toBe(0);
  });

  it("is kept at most ten, and an eleventh is refused", async () => {
    for (let i = 0; i < 10; i++) await answer(await call("", { body: device().subscription }));
    expect(await reasonOf(await call("", { body: device().subscription }))).toEqual([409, "too-many"]);
    expect(await count("SELECT COUNT(*) AS n FROM push_devices")).toBe(10);
  });

  it("is turned off by its endpoint", async () => {
    const one = device();
    await answer(await call("", { body: one.subscription }));
    expect(await answer(await call("", { method: "DELETE", body: { endpoint: one.subscription.endpoint } }))).toEqual({ removed: true });
    expect(await answer(await call("", { method: "DELETE", body: { endpoint: one.subscription.endpoint } }))).toEqual({ removed: false });
    expect(await reasonOf(await call("", { method: "DELETE", body: { endpoint: "https://evil.example/x" } }))).toEqual([400, "device"]);
  });
});

describe("a test", () => {
  it("reaches the device as one message its own key reads, signed for its push service", async () => {
    const one = device();
    const other = device();
    await answer(await call("", { body: one.subscription }));
    await answer(await call("", { body: other.subscription }));
    const before = Date.now();
    expect(await answer(await call("/test", { body: { endpoint: one.subscription.endpoint } }))).toEqual({ sent: true });
    expect(harness.pushes.sent.map((pushed) => pushed.endpoint)).toEqual([one.subscription.endpoint]);
    const [pushed] = harness.pushes.sent;
    if (!pushed) throw new Error("nothing pushed");
    expect(pushed.headers).toMatchObject({ "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "43200", urgency: "normal" });
    expect(await decrypt(pushed.body, one)).toEqual({ title: TEST_PUSH.title, lines: [...TEST_PUSH.lines] });
    const claims = vapidClaims(pushed);
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", sub: "https://hey.whysosuresh.com", exp: expect.any(Number) });
    const exp = Number(claims.exp) * 1000;
    expect(exp > before + 11.9 * 3600_000 && exp <= Date.now() + 12 * 3600_000).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM push_devices WHERE last_ok_at IS NOT NULL AND endpoint = ?1", one.subscription.endpoint)).toBe(1);
  });

  it("goes only to a device he turned on", async () => {
    expect(await reasonOf(await call("/test", { body: { endpoint: device().subscription.endpoint } }))).toEqual([404, "no-device"]);
    expect(await reasonOf(await call("/test", { body: { endpoint: "https://evil.example/x" } }))).toEqual([400, "device"]);
    expect(harness.pushes.sent).toEqual([]);
  });

  it("forgets a device its push service says is gone, and keeps one that failed for any other reason", async () => {
    const gone = device(`${APPLE}${randomBytes(8).toString("hex")}`);
    const down = device();
    await answer(await call("", { body: gone.subscription }));
    await answer(await call("", { body: down.subscription }));
    harness.pushes.answers.set(gone.subscription.endpoint, 410);
    harness.pushes.answers.set(down.subscription.endpoint, 500);
    expect(await reasonOf(await call("/test", { body: { endpoint: gone.subscription.endpoint } }))).toEqual([410, "gone"]);
    expect(await answer(await call("/test", { body: { endpoint: down.subscription.endpoint } }), 502)).toEqual({ reason: "push-failed", status: 500 });
    expect(await count("SELECT COUNT(*) AS n FROM push_devices")).toBe(1);
    expect(vapidClaims(harness.pushes.sent[0] as Pushed).aud).toBe("https://web.push.apple.com");
  });
});

describe("who may", () => {
  it("refuses the sync and an invited person every call before anything is read", async () => {
    const one = device();
    await answer(await call("", { body: one.subscription }));
    // Meera is invited to a thread, so the door admits her and the push calls are what refuse her.
    const made = await harness.fetch(`${THREADS}/threads/api/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": token("sync", harness) },
      body: new TextEncoder().encode(JSON.stringify({ ref: "chat:push-1", source: "self", title: "Shared", body: "x", space: "company", status: "act" })),
    });
    const number = (await answer<{ thread: { number: number } }>(made, 201)).thread.number;
    await answer(
      await harness.fetch(`${THREADS}/threads/api/threads/${number}/people`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: THREADS, "Cf-Access-Jwt-Assertion": token("owner", harness) },
        body: new TextEncoder().encode(JSON.stringify({ add: { email: MEERA, name: "Meera" } })),
      }),
    );
    for (const as of ["sync", { email: MEERA }] as const) {
      expect(await reasonOf(await call("/key", { as }))).toEqual([403, "owner-only"]);
      expect(await reasonOf(await call("", { as, body: device().subscription }))).toEqual([403, "owner-only"]);
      expect(await reasonOf(await call("", { as, method: "DELETE", body: { endpoint: one.subscription.endpoint } }))).toEqual([403, "owner-only"]);
      expect(await reasonOf(await call("/test", { as, body: { endpoint: one.subscription.endpoint } }))).toEqual([403, "owner-only"]);
    }
    expect([await count("SELECT COUNT(*) AS n FROM push_devices"), harness.pushes.sent.length]).toEqual([1, 0]);
  });

  it("takes his writes only from his own page, and nobody signed out", async () => {
    const one = device();
    expect(await reasonOf(await call("", { body: one.subscription, origin: "https://example.com" }))).toEqual([403, "origin"]);
    expect(await reasonOf(await call("", { body: one.subscription, origin: null }))).toEqual([403, "origin"]);
    expect(await reasonOf(await call("/test", { body: { endpoint: one.subscription.endpoint }, origin: "https://example.com" }))).toEqual([403, "origin"]);
    for (const path of ["/key", "", "/test"]) {
      const response = await harness.fetch(`${THREADS}/threads/api/push${path}`, path === "/key" ? {} : { method: "POST", headers: { "Content-Type": "application/json", Origin: THREADS }, body: "{}" });
      expect(response.status).toBe(401);
    }
  });

  it("answers each address its own methods, and nothing else under it", async () => {
    for (const [path, method, allow] of [
      ["/key", "POST", "GET"],
      ["", "GET", "POST, DELETE"],
      ["/test", "GET", "POST"],
    ] as const) {
      const response = await call(path, method === "GET" ? {} : { method, body: {} });
      expect([path, response.status, response.headers.get("Allow")]).toEqual([path, 405, allow]);
    }
    expect((await call("/devices")).status).toBe(404);
  });

  it("answers 503 to every call without the key", async () => {
    const keyless = await startHarness({ pushKey: "" });
    try {
      const one = device();
      expect(await reasonOf(await call("/key", { target: keyless }))).toEqual([503, "push-key"]);
      expect(await reasonOf(await call("", { body: one.subscription, target: keyless }))).toEqual([503, "push-key"]);
      expect(await reasonOf(await call("/test", { body: { endpoint: one.subscription.endpoint }, target: keyless }))).toEqual([503, "push-key"]);
    } finally {
      await keyless.dispose();
    }
  });
});
