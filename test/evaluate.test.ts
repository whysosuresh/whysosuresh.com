// The site's answer to Cloudflare Access's question at sign-in (src/evaluate.ts), run as production runs it: the
// Worker's bundle in workerd (test/harness.ts), with Access played (its keys, and the token it posts, after
// Cloudflare's example) and the Worker's own evaluation key. What it holds: yes only for an address with an
// invitation that stands, in any case, and no for a stranger, a person removed and the owner (whose own policy
// lets him in first); every answer is a JWT the evaluation key signed, naming it, with the nonce Access sent and a
// minute to live, for a token with no issuer, as Access sends it; a token Access didn't sign, an expired one and an
// application token are refused; a question that isn't one is refused by its shape and size; the keys address serves the key's public
// half only, named by its RFC 7638 thumbprint, at both spellings; and without a usable key, or Access's keys, both
// answer 503, which Access counts as no.

import { createHash, createVerify } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_TEAM_DOMAIN, EVALUATION_PUBLIC_KEY, THREADS, startHarness, type Claims, type Harness, type TokenOptions } from "./harness.ts";

const EVALUATE = `${THREADS}/api/access/evaluate`;
const KEYS = `${THREADS}/api/access/keys`;
const MEERA = "meera@example.com";

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

/** Asks the evaluation door as Access does: `{"token": …}`, the token signed by the played team. */
async function ask(claims: Claims, options: TokenOptions = {}, target: Harness = harness): Promise<Response> {
  return target.fetch(EVALUATE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify({ token: target.access.token(claims, options) })),
  });
}

/** The answer's JWT, checked against the evaluation key's public half: its header and its claims. */
async function verdict(response: Response): Promise<{ header: Record<string, unknown>; claims: Record<string, unknown> }> {
  expect(response.status).toBe(200);
  const { token } = (await response.json()) as { token: string };
  const [head = "", body = "", signature = ""] = token.split(".");
  const valid = createVerify("RSA-SHA256").update(`${head}.${body}`).verify(EVALUATION_PUBLIC_KEY, Buffer.from(signature, "base64url"));
  expect(valid).toBe(true);
  return {
    header: JSON.parse(Buffer.from(head, "base64url").toString("utf8")) as Record<string, unknown>,
    claims: JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>,
  };
}

/** Invites an address to a new thread, as the owner's page does. */
async function invited(email: string): Promise<{ number: number; personId: string }> {
  const owner = harness.access.token(harness.access.ownerClaims());
  const made = await harness.fetch(`${THREADS}/threads/api/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.syncClaims()) },
    body: new TextEncoder().encode(JSON.stringify({ ref: `chat:${crypto.randomUUID()}`, source: "self", title: "Shared", body: "x", space: "company", status: "act" })),
  });
  const number = ((await made.json()) as { thread: { number: number } }).thread.number;
  const people = await harness.fetch(`${THREADS}/threads/api/threads/${number}/people`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": owner, Origin: THREADS },
    body: new TextEncoder().encode(JSON.stringify({ add: { email, name: "Meera" } })),
  });
  expect(people.status).toBe(200);
  return { number, personId: ((await people.json()) as { people: { id: string }[] }).people[0]?.id ?? "" };
}

/** The served public key's RFC 7638 thumbprint, computed here rather than trusted from the Worker. */
function thumbprint(): string {
  const jwk = EVALUATION_PUBLIC_KEY.export({ format: "jwk" });
  return createHash("sha256").update(JSON.stringify({ e: jwk.e, kty: "RSA", n: jwk.n })).digest("base64url");
}

describe("the answer", () => {
  it("is yes for an invited address, in any case, signed by the evaluation key with the nonce and a minute to live", async () => {
    await invited(MEERA);
    const { header, claims } = await verdict(await ask(harness.access.evaluationClaims("Meera@Example.COM", "n-123")));
    expect(header).toEqual({ alg: "RS256", kid: thumbprint(), typ: "JWT" });
    expect(claims).toEqual({ success: true, iat: expect.any(Number), exp: expect.any(Number), nonce: "n-123" });
    expect((claims.exp as number) - (claims.iat as number)).toBe(60);
    expect(Math.abs((claims.iat as number) - Date.now() / 1000)).toBeLessThan(30);
  });

  it("is no for an address with no invitation, for a person removed, and for the owner", async () => {
    expect((await verdict(await ask(harness.access.evaluationClaims("stranger@example.net")))).claims.success).toBe(false);
    const { number, personId } = await invited(MEERA);
    await harness.fetch(`${THREADS}/threads/api/threads/${number}/people`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.ownerClaims()), Origin: THREADS },
      body: new TextEncoder().encode(JSON.stringify({ remove: personId })),
    });
    expect((await verdict(await ask(harness.access.evaluationClaims(MEERA)))).claims).toMatchObject({ success: false, nonce: "nonce-from-access" });
    expect((await verdict(await ask(harness.access.evaluationClaims("owner@example.com")))).claims.success).toBe(false);
  });

  it("reaches nothing but the team's keys", async () => {
    await invited(MEERA);
    await verdict(await ask(harness.access.evaluationClaims(MEERA)));
    // The keys may already be held from an earlier test, so the team's host may not appear; nothing else may.
    expect([...harness.outboundHosts].filter((host) => host !== ACCESS_TEAM_DOMAIN)).toEqual([]);
  });
});

describe("a token that isn't Access's question", () => {
  it.each([
    ["signed with a key Access doesn't serve", {}, { foreignKey: true }],
    ["with a spoiled signature", {}, { badSignature: true }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 3600 }, {}],
    ["not yet valid", { nbf: Math.floor(Date.now() / 1000) + 3600 }, {}],
    ["with no nonce", { nonce: undefined }, {}],
    ["with no identity", { identity: undefined }, {}],
    ["with an identity that names no address", { identity: { name: "Meera" } }, {}],
  ] as const)("is refused with 403 when %s", async (_, change, options) => {
    await invited(MEERA);
    const response = await ask({ ...harness.access.evaluationClaims(MEERA), ...change }, options);
    expect([response.status, await response.json()]).toEqual([403, { reason: "token" }]);
  });

  it("is refused with 403 when it is an application token, even the owner's", async () => {
    await invited(MEERA);
    for (const claims of [harness.access.ownerClaims(), harness.access.memberClaims(MEERA)]) {
      const response = await ask(claims);
      expect(response.status).toBe(403);
    }
  });

  it.each([
    ["not JSON", "token"],
    ["JSON with no token", JSON.stringify({ jwt: "x" })],
    ["a token that isn't a string", JSON.stringify({ token: 42 })],
  ])("is refused with 400 when the body is %s", async (_, body) => {
    const response = await harness.fetch(EVALUATE, { method: "POST", headers: { "Content-Type": "application/json" }, body: new TextEncoder().encode(body) });
    expect([response.status, await response.json()]).toEqual([400, { reason: "token" }]);
  });

  it("is refused with 413 past 8 KiB, by its declared length or as read", async () => {
    const big = new TextEncoder().encode(JSON.stringify({ token: "a".repeat(9000) }));
    expect((await harness.fetch(EVALUATE, { method: "POST", headers: { "Content-Type": "application/json" }, body: big })).status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    const streamed = await harness.fetch(EVALUATE, { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    expect(streamed.status).toBe(413);
  });

  it("answers any method but POST with 405", async () => {
    const response = await harness.fetch(EVALUATE);
    expect([response.status, response.headers.get("Allow")]).toEqual([405, "POST"]);
  });
});

describe("the keys address", () => {
  it("serves the evaluation key's public half only, by its thumbprint, at both spellings", async () => {
    const jwk = EVALUATION_PUBLIC_KEY.export({ format: "jwk" });
    for (const address of [KEYS, `${KEYS}/`]) {
      const response = await harness.fetch(address);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ keys: [{ kty: "RSA", n: jwk.n, e: jwk.e, kid: thumbprint(), alg: "RS256", use: "sig" }] });
    }
    expect((await harness.fetch(KEYS, { method: "POST" })).status).toBe(405);
  });
});

describe("without what it needs", () => {
  it.each([
    ["no evaluation key", ""],
    ["a key that isn't an RSA private key", JSON.stringify({ kty: "RSA", n: "AQAB", e: "AQAB" })],
    ["a key that isn't JSON", "-----BEGIN PRIVATE KEY-----"],
  ])("answers 503 at both addresses with %s", async (_, evaluationKey) => {
    const bare = await startHarness({ evaluationKey });
    try {
      const asked = await ask(bare.access.evaluationClaims(MEERA), {}, bare);
      expect([asked.status, await asked.json()]).toEqual([503, { reason: "not-configured" }]);
      const keys = await bare.fetch(KEYS);
      expect([keys.status, await keys.json()]).toEqual([503, { reason: "not-configured" }]);
    } finally {
      await bare.dispose();
    }
  });

  it("answers 503 when Access's keys can't be read", async () => {
    const fresh = await startHarness();
    try {
      fresh.access.setDown(true);
      const asked = await ask(fresh.access.evaluationClaims(MEERA), {}, fresh);
      expect([asked.status, await asked.json()]).toEqual([503, { reason: "keys" }]);
    } finally {
      await fresh.dispose();
    }
  });
});
