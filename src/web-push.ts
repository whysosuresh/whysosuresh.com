// Web push, as the Worker sends it to Suresh's own devices: one message, encrypted for the device it goes to and
// signed as coming from this site, with nothing but the runtime's own crypto (no dependency, AGENTS.md).
//
// The message is encrypted as RFC 8291 says, in the `aes128gcm` content coding of RFC 8188: a fresh P-256 key pair
// per message, its shared secret with the device's key (`p256dh`) mixed with the device's `auth` secret by HKDF into
// the key and nonce of one AES-128-GCM record, whose header carries a random salt, the record size and the message's
// public key. Only the device can read it: the push service in between carries bytes. The request is signed as RFC
// 8292 (VAPID) says: an ES256 JWT for the push service's origin, valid 12 hours, naming the site as its contact
// (`sub`, never an email address), with the key's public half beside it, so a push service takes messages for a
// subscription only from the key it was made with. The key is the Worker secret PUSH_VAPID_KEY, a P-256 private key
// as a JWK; its public half (the uncompressed point, as browsers want it) is derived from it here, as
// src/evaluate.ts derives its own, so there is no second copy to drift.
//
// A device is only ever one of the push services browsers use, by its endpoint's host (`PUSH_HOSTS`), always HTTPS,
// so the Worker never posts to an address someone typed. A message lives at most 12 hours in the push service
// (`TTL`), at normal urgency. Nothing here logs: the caller logs counts and statuses only, never an endpoint, a key
// or a title.

/** The push services browsers use: Apple's (Safari and the iPhone's home screen), Google's, Mozilla's and Microsoft's. */
const PUSH_HOSTS = ["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com"];
const WINDOWS_PUSH = /^[a-z0-9-]+\.notify\.windows\.com$/;
/** The longest endpoint kept: every push service's is well under it. */
const MAX_ENDPOINT = 1024;
/** How long a message waits in the push service for a device that is off, in seconds. */
export const TTL_S = 12 * 3600;
/** How long a VAPID token is good for, in seconds; push services accept at most a day. */
const VAPID_LIFETIME_S = 12 * 3600;
/** How long the Worker waits for a push service. */
const TIMEOUT_MS = 10_000;
/** The one record's size; a message is a few hundred bytes, so one record always holds it. */
const RECORD_SIZE = 4096;
/** Who the site is, as a push service may contact it: the threads' own address. */
export const VAPID_SUBJECT = "https://hey.whysosuresh.com";

/** A device as the browser handed it over: where to push, and its two keys, as base64url. */
export interface Device {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/** The VAPID key: the private key that signs, and its public half as browsers and push services want it. */
export interface VapidKey {
  readonly privateKey: CryptoKey;
  /** The uncompressed P-256 point (65 bytes, 0x04 first), base64url. */
  readonly publicKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Bytes from base64url (padding optional); null for anything that isn't. */
export function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) return null;
  const plain = value.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(plain.padEnd(Math.ceil(plain.length / 4) * 4, "="));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Whether an endpoint is one of the push services' own, over HTTPS, with no user, port or fragment. */
export function isPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.hash !== "") return false;
  return PUSH_HOSTS.includes(url.hostname) || WINDOWS_PUSH.test(url.hostname);
}

/** A device's keys as a browser gives them: a P-256 point (65 bytes, 0x04 first) and a 16-byte secret. */
export function isDeviceKeys(p256dh: string, auth: string): boolean {
  const point = fromBase64Url(p256dh);
  const secret = fromBase64Url(auth);
  return point !== null && point.length === 65 && point[0] === 0x04 && secret !== null && secret.length === 16;
}

/** The VAPID key from the Worker's secret, or null when it is missing or isn't a P-256 private key. */
export async function importVapidKey(secret: string): Promise<VapidKey | null> {
  let jwk: unknown;
  try {
    jwk = JSON.parse(secret);
  } catch {
    return null;
  }
  if (!isRecord(jwk) || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string" || typeof jwk.d !== "string") return null;
  const x = fromBase64Url(jwk.x);
  const y = fromBase64Url(jwk.y);
  if (x === null || y === null || x.length !== 32 || y.length !== 32) return null;
  try {
    const privateKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, ext: false }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    return { privateKey, publicKey: base64Url(concat(new Uint8Array([0x04]), x, y)) };
  } catch {
    return null;
  }
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

/** The `Authorization` header for one push service: a VAPID token for its origin, and the key's public half. */
export async function vapidAuthorization(key: VapidKey, endpoint: string, now: number): Promise<string> {
  const head = base64Url(text(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64Url(text(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + VAPID_LIFETIME_S, sub: VAPID_SUBJECT })));
  // WebCrypto's ECDSA signature is r and s side by side, which is what a JWS carries.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, text(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${base64Url(signature)}, k=${key.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bits: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bits));
}

/**
 * A message encrypted for one device (RFC 8291, `aes128gcm`): the salt, the record size, the message's own public
 * key, then one record of the message and its delimiter, sealed. `salt` and `ephemeral` are given only by a test.
 */
export async function encrypt(device: Device, message: Uint8Array, fixed?: { salt: Uint8Array; ephemeral: CryptoKeyPair }): Promise<Uint8Array> {
  const uaPublic = fromBase64Url(device.p256dh);
  const authSecret = fromBase64Url(device.auth);
  if (uaPublic === null || authSecret === null) throw new Error("device keys");
  const ephemeral = fixed?.ephemeral ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer);
  const deviceKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // WebCrypto names the other side's key `public`; workerd's generated types spell it `$public` (a C++ keyword escaped
  // in its bindings), so the standard shape is cast to them. test/push.test.ts decrypts what this makes.
  const ecdh = { name: "ECDH", public: deviceKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, ephemeral.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(text("WebPush: info\0"), uaPublic, asPublic), 256);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 96);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record, the last, so its delimiter is 0x02 and it carries no padding.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(message, new Uint8Array([0x02]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

/**
 * Sends one message to one device and answers the push service's status, or 0 when it couldn't be reached in time.
 * 201 is taken; 404 and 410 mean the device has gone for good (its subscription ended), and the caller forgets it.
 */
export async function send(key: VapidKey, device: Device, message: Uint8Array, now: number): Promise<number> {
  const body = await encrypt(device, message);
  try {
    const response = await fetch(device.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(key, device.endpoint, now),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(TTL_S),
        Urgency: "normal",
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return 0;
  }
}
