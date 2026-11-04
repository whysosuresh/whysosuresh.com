// Who is calling the inbox. Cloudflare Access stands in front of whysosuresh.com/inbox and signs every request
// it lets through (the `Cf-Access-Jwt-Assertion` header, RS256, with the team's keys). This module checks that
// signature itself, with the runtime's WebCrypto and no library, and then admits exactly two callers: the
// owner, by the email the sign-in proved, and the recorder sync, by its service token's client id. Anything
// Access didn't sign for this application, or signed for someone else, is refused, so a request that slipped
// past the edge's path match (a changed case, an encoded slash) still meets this check.
//
// The keys are fetched from the team's certs address and kept in the isolate. A token naming a key the
// isolate doesn't hold fetches them again, which is how Cloudflare's key rotation arrives, but at most once a
// minute, so a stream of made-up key ids can't turn the Worker into a fetcher. A failed fetch keeps nothing,
// so the next request tries again. The checks follow Cloudflare's
// "Validate JWTs" page (developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/
// authorization-cookie/validating-json/) and its application-token page for the claims.

/** The settings the check reads: wrangler.jsonc's vars, and the owner's address from the deploy. */
export interface AccessSettings {
  /** The team's sign-in host, `<team>.cloudflareaccess.com`: the issuer and where the keys live. */
  readonly ACCESS_TEAM_DOMAIN: string;
  /** The inbox application's audience tag, which Access signs into every token for it. */
  readonly ACCESS_AUD: string;
  /** The recorder sync's service token, by its client id. */
  readonly INBOX_SYNC_CLIENT_ID: string;
  /** The one email address admitted as the owner. */
  readonly INBOX_OWNER_EMAIL?: string;
}

/** A caller the inbox admits. */
export type Caller = { readonly caller: "owner"; readonly email: string } | { readonly caller: "sync" };

/** Why a request is refused: its status and a reason short enough to log. */
export interface Refusal {
  readonly status: 401 | 403 | 503;
  readonly reason: string;
}

/** The header Access adds to every request it lets through. */
const ASSERTION = "Cf-Access-Jwt-Assertion";
/** Clock skew allowed on `exp` and `nbf`, in seconds. */
const LEEWAY_S = 30;
/** The shortest gap between two fetches of the keys made for an unknown key id. */
const REFETCH_MS = 60_000;
const FETCH_TIMEOUT_MS = 5000;
/** Far above any token Access issues (a few hundred bytes of claims), so nothing large is parsed. */
const MAX_TOKEN = 8192;
const ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

interface KeyCache {
  readonly team: string;
  keys: Map<string, CryptoKey>;
  /** When the keys were last fetched for a key id the cache lacked, in milliseconds; 0 before any such fetch. */
  refetchedAt: number;
  /** A fetch under way, which every request waiting on it shares. */
  inFlight: Promise<void> | null;
}

let cache: KeyCache | null = null;

class KeysUnavailable extends Error {}

function cacheFor(team: string): KeyCache {
  if (cache === null || cache.team !== team) cache = { team, keys: new Map(), refetchedAt: 0, inFlight: null };
  return cache;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fetches the team's keys and replaces the cache with them; throws KeysUnavailable when it can't. */
async function fetchKeys(store: KeyCache): Promise<void> {
  let body: unknown;
  try {
    const response = await fetch(`https://${store.team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new KeysUnavailable("certs status");
    body = await response.json();
  } catch {
    throw new KeysUnavailable("certs unreachable");
  }
  const listed = isRecord(body) && Array.isArray(body.keys) ? body.keys : [];
  const keys = new Map<string, CryptoKey>();
  for (const entry of listed) {
    if (!isRecord(entry) || entry.kty !== "RSA" || typeof entry.kid !== "string") continue;
    if (typeof entry.n !== "string" || typeof entry.e !== "string") continue;
    try {
      const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: entry.n, e: entry.e, alg: "RS256", ext: true }, ALGORITHM, false, ["verify"]);
      keys.set(entry.kid, key);
    } catch {
      // A key this runtime can't import is left out; a token signed with it is refused as unknown.
    }
  }
  if (keys.size === 0) throw new KeysUnavailable("no usable keys");
  store.keys = keys;
}

/**
 * The key a token names. The keys are fetched when the cache is empty, and again when it lacks this one, but
 * that second kind of fetch at most once a minute, whoever asks for it.
 */
async function keyFor(team: string, kid: string): Promise<CryptoKey | null> {
  const store = cacheFor(team);
  const known = store.keys.get(kid);
  if (known !== undefined) return known;
  if (store.inFlight === null) {
    if (store.keys.size > 0) {
      if (Date.now() - store.refetchedAt < REFETCH_MS) return null;
      store.refetchedAt = Date.now();
    }
    store.inFlight = fetchKeys(store).finally(() => {
      store.inFlight = null;
    });
  }
  await store.inFlight;
  return store.keys.get(kid) ?? null;
}

function base64UrlBytes(part: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(part)) return null;
  try {
    const binary = atob(part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function base64UrlJson(part: string): Record<string, unknown> | null {
  const bytes = base64UrlBytes(part);
  if (bytes === null) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** The token's claims when its signature, issuer, audience, times and type all hold; null otherwise. */
async function verifiedClaims(token: string, settings: AccessSettings): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart = "", payloadPart = "", signaturePart = ""] = parts;
  const header = base64UrlJson(headerPart);
  const claims = base64UrlJson(payloadPart);
  const signature = base64UrlBytes(signaturePart);
  if (header === null || claims === null || signature === null) return null;
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const key = await keyFor(settings.ACCESS_TEAM_DOMAIN, header.kid);
  if (key === null) return null;
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  if (!(await crypto.subtle.verify(ALGORITHM, key, signature, signed))) return null;

  if (claims.iss !== `https://${settings.ACCESS_TEAM_DOMAIN}`) return null;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(settings.ACCESS_AUD)) return null;
  const now = Date.now() / 1000;
  if (typeof claims.exp !== "number" || claims.exp + LEEWAY_S < now) return null;
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf - LEEWAY_S > now)) return null;
  if (claims.type !== "app") return null;
  return claims;
}

/**
 * Who the request is from, or why it is refused: 401 with no token, 403 for a token that fails any check or
 * names anyone but the two callers, 503 when the owner's address isn't configured or the keys can't be read.
 */
export async function identify(request: Request, settings: AccessSettings): Promise<Caller | Refusal> {
  const owner = (settings.INBOX_OWNER_EMAIL ?? "").trim().toLowerCase();
  if (owner === "") return { status: 503, reason: "not-configured" };
  const token = request.headers.get(ASSERTION) ?? "";
  if (token === "") return { status: 401, reason: "sign-in" };
  if (token.length > MAX_TOKEN) return { status: 403, reason: "token" };

  let claims: Record<string, unknown> | null;
  try {
    claims = await verifiedClaims(token, settings);
  } catch (error) {
    if (error instanceof KeysUnavailable) return { status: 503, reason: "keys" };
    throw error;
  }
  if (claims === null) return { status: 403, reason: "token" };

  const email = typeof claims.email === "string" ? claims.email : "";
  if (email !== "") {
    return email.toLowerCase() === owner ? { caller: "owner", email } : { status: 403, reason: "caller" };
  }
  if (claims.email === undefined && claims.common_name === settings.INBOX_SYNC_CLIENT_ID && settings.INBOX_SYNC_CLIENT_ID !== "") {
    return { caller: "sync" };
  }
  return { status: 403, reason: "caller" };
}
