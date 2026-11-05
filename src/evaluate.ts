// Cloudflare Access's question at sign-in, answered by the site: may this email address sign in to the threads?
// The threads' Access application has a third policy, after the owner's and the sync's, whose one rule is an
// external evaluation (infrastructure/planton/planton.ai/Infra.prod.CloudflareZeroTrustAccessPolicy.
// whysosuresh-com-threads-members.yaml): Access posts `{"token": <JWT>}` here, signed with the team's own keys and
// naming the address that asked for a code (`identity.email`) and a `nonce`; the answer is `{"token": <JWT>}`,
// signed RS256 with the site's own evaluation key, carrying `success`, `iat`, `exp` and the same nonce. Access
// counts anything else as no. The shapes follow Cloudflare's external evaluation page
// (developers.cloudflare.com/cloudflare-one/access-controls/policies/external-evaluation/) and its example Worker
// (github.com/cloudflare/workers-access-external-auth-example, `index.js` at 615d6f65).
//
//   POST /api/access/evaluate   {"token": <Access's JWT>}   answers {"token": <the site's JWT>}
//   GET  /api/access/keys       the evaluation key's public half, as {"keys": [<JWK>]}; `/api/access/keys/` too
//
// Yes means the address has an invitation that stands, to any thread: `isInvited` in src/store.ts, the same
// question the threads' door asks of every invited caller (src/threads.ts), so the edge and the Worker can't
// disagree about who is invited. The owner is let in by his own policy before this one is asked, and the sync
// never signs in by email. The token is checked by src/access.ts's own signature and time checks, and nothing
// else about where it came from: as Access sent it on 2026-11-05 it carries `aud`, `exp`, `iat`, `identity`,
// `nonce` and `request_url`, and no `iss` (an application token's issuer check refused the first live sign-in),
// and the page names neither its audience nor its issuer. A token only the team's keys can sign, naming an address
// and a nonce, answers one yes-or-no about that address. An application token sent here has no `identity` or
// `nonce`, so it is refused. A signed token missing either, or out of its times, logs the check it failed and its
// claims' names (never a value), so a sign-in that fails because Access's shape changes says how on the first
// try. Every answer logs only whether it said yes.
//
// The evaluation key is the Worker secret THREADS_EVALUATION_KEY, an RSA private key as a JWK, handed over by the
// deploy from the GitHub environment `production`; its public half is derived from it here, with every private
// part left out, and named by its RFC 7638 thumbprint, so there is no second copy to drift. Without it, both
// addresses answer 503, which Access counts as no.

import { KeysUnavailable, MAX_TOKEN, signedClaims, timely } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { json } from "./json.ts";
import { isInvited } from "./store.ts";
import { refuse } from "./wire.ts";

/** The largest question read: the token, far above any Access issues, and its JSON wrapping. */
const MAX_REQUEST = 8192;
/** How long a yes or no stays good, in seconds, as the example answers. */
const ANSWER_LIFETIME_S = 60;
const ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
/** The private parts of an RSA JWK, which the public half never carries. */
const PRIVATE_PARTS = ["d", "p", "q", "dp", "dq", "qi"] as const;

/** The evaluation key: the private key that signs each answer, and the public half the keys address serves. */
interface EvaluationKey {
  readonly privateKey: CryptoKey;
  readonly publicJwk: { readonly kty: "RSA"; readonly n: string; readonly e: string; readonly kid: string; readonly alg: "RS256"; readonly use: "sig" };
}

/** The key, imported once per isolate for the secret it was imported from. */
let imported: { readonly secret: string; readonly key: Promise<EvaluationKey | null> } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlText(text: string): string {
  return base64Url(new TextEncoder().encode(text));
}

/** The key's RFC 7638 thumbprint: SHA-256 of its required members in order, with no spaces. */
async function thumbprint(n: string, e: string): Promise<string> {
  const canonical = JSON.stringify({ e, kty: "RSA", n });
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))));
}

async function importKey(secret: string): Promise<EvaluationKey | null> {
  let jwk: unknown;
  try {
    jwk = JSON.parse(secret);
  } catch {
    return null;
  }
  if (!isRecord(jwk) || jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") return null;
  if (!PRIVATE_PARTS.every((part) => typeof jwk[part] === "string")) return null;
  const parts = Object.fromEntries(PRIVATE_PARTS.map((part) => [part, jwk[part] as string]));
  try {
    const privateKey = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, ...parts, alg: "RS256", ext: false }, ALGORITHM, false, ["sign"]);
    return { privateKey, publicJwk: { kty: "RSA", n: jwk.n, e: jwk.e, kid: await thumbprint(jwk.n, jwk.e), alg: "RS256", use: "sig" } };
  } catch {
    return null;
  }
}

/** The evaluation key from the Worker's secret, or null when it is missing or isn't an RSA private key. */
async function evaluationKey(env: Bindings): Promise<EvaluationKey | null> {
  const secret = env.THREADS_EVALUATION_KEY ?? "";
  if (secret.trim() === "") return null;
  if (imported === null || imported.secret !== secret) imported = { secret, key: importKey(secret) };
  return imported.key;
}

/** A JWT of `claims`, signed RS256 with the evaluation key and naming it. */
async function sign(key: EvaluationKey, claims: Record<string, string | number | boolean>): Promise<string> {
  const head = `${base64UrlText(JSON.stringify({ alg: "RS256", kid: key.publicJwk.kid, typ: "JWT" }))}.${base64UrlText(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign(ALGORITHM, key.privateKey, new TextEncoder().encode(head));
  return `${head}.${base64Url(new Uint8Array(signature))}`;
}

/** The request's body as text when it is at most `max` bytes, by its declared length and as read; null when larger. */
async function cappedText(request: Request, max: number): Promise<string | null> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d{1,12}$/.test(declared) || Number(declared) > max)) return null;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The address and nonce a signed token names, or the first thing about it that doesn't hold. */
function question(claims: Record<string, unknown>): { email: string; nonce: string } | { failed: string } {
  if (!timely(claims)) return { failed: "times" };
  const email = isRecord(claims.identity) ? claims.identity.email : undefined;
  if (typeof email !== "string" || email === "") return { failed: "identity" };
  if (typeof claims.nonce !== "string" || claims.nonce === "") return { failed: "nonce" };
  return { email: email.toLowerCase(), nonce: claims.nonce };
}

/** Answers Access's question at sign-in: yes for an address with an invitation that stands, no for any other. */
export async function handleEvaluate(request: Request, env: Bindings): Promise<Response> {
  const key = await evaluationKey(env);
  if (key === null) return refuse(503, "not-configured");
  const body = await cappedText(request, MAX_REQUEST);
  if (body === null) return refuse(413, "too-large");
  let given: unknown;
  try {
    given = JSON.parse(body);
  } catch {
    return refuse(400, "token");
  }
  const token = isRecord(given) ? given.token : undefined;
  if (typeof token !== "string" || token === "" || token.length > MAX_TOKEN) return refuse(400, "token");

  let claims: Record<string, unknown> | null;
  try {
    claims = await signedClaims(token, env.ACCESS_TEAM_DOMAIN);
  } catch (error) {
    if (error instanceof KeysUnavailable) return refuse(503, "keys");
    throw error;
  }
  if (claims === null) return refuse(403, "token");
  const asked = question(claims);
  if ("failed" in asked) {
    // Names only, never a value: what the token carried, and what it was missing or failed.
    const identity = isRecord(claims.identity) ? Object.keys(claims.identity).sort() : null;
    console.log(JSON.stringify({ refused: 403, reason: "evaluation", failed: asked.failed, claims: Object.keys(claims).sort(), identity }));
    return json(403, { reason: "token" });
  }

  const yes = await isInvited(env.DB, asked.email);
  const now = Math.floor(Date.now() / 1000);
  console.log(JSON.stringify({ evaluated: yes }));
  return json(200, { token: await sign(key, { success: yes, iat: now, exp: now + ANSWER_LIFETIME_S, nonce: asked.nonce }) });
}

/** The evaluation key's public half, the only key Access will accept an answer signed with. */
export async function handleKeys(env: Bindings): Promise<Response> {
  const key = await evaluationKey(env);
  if (key === null) return refuse(503, "not-configured");
  return json(200, { keys: [key.publicJwk] });
}
