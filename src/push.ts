// His reminders on his own devices: the calls his page makes to turn a device on and off and to send it a test,
// and the devices they keep (migrations/0028_push_devices.sql). The message itself is src/web-push.ts's.
//
//   GET    /threads/api/push/key                                  owner: the site's public key, for the browser to subscribe with
//   POST   /threads/api/push       {"endpoint", "keys": {"p256dh", "auth"}}   owner, from his own page: this device on
//   DELETE /threads/api/push       {"endpoint"}                   owner, from his own page: this device off
//   POST   /threads/api/push/test  {"endpoint"}                   owner, from his own page: a test message to this device
//
// Pushes go only to his devices. The sync and an invited person are refused every call with 403 `owner-only` before
// anything is read, and his writes come only from his own page (403 `origin`). Without the VAPID key (the Worker
// secret PUSH_VAPID_KEY) every call answers 503 `push-key`. A device is kept once by its endpoint, at most
// `MAX_DEVICES`, only on a push service's own address (400 `device` otherwise), and turning one on again replaces its
// keys and keeps when it was first turned on (`since`). The endpoint and keys are never answered and never logged: a
// test logs its push service's status alone. A test to a device the push service says is gone (404, 410) forgets it
// and answers 410 `gone`; any other failure answers 502 `push-failed` with the status (0 when it wasn't reached).

import type { Caller } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { json } from "./json.ts";
import { sameOrigin } from "./request.ts";
import { exactly, lengthRefusal, readJson, refuse } from "./wire.ts";
import { TEST_PUSH } from "../site/app/reminders.js";
import { importVapidKey, isDeviceKeys, isPushEndpoint, send, type Device, type VapidKey } from "./web-push.ts";

/** The most devices kept: his phone, his Macs' browsers, and room to spare. */
export const MAX_DEVICES = 10;
/** A device and its keys fit in a few hundred bytes; an endpoint is at most 1 KiB. */
const MAX_DEVICE_BYTES = 2048;

/** A device as the table keeps it. */
export interface DeviceRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
  last_ok_at: string | null;
}

/** The key, imported once per isolate for the secret it was imported from. */
let imported: { readonly secret: string; readonly key: Promise<VapidKey | null> } | null = null;

/** The VAPID key from the Worker's secret, or null when it is missing or isn't one. */
export async function vapidKey(env: Bindings): Promise<VapidKey | null> {
  const secret = env.PUSH_VAPID_KEY ?? "";
  if (secret.trim() === "") return null;
  if (imported === null || imported.secret !== secret) imported = { secret, key: importVapidKey(secret) };
  return imported.key;
}

/** Every device he turned on, oldest first. */
export async function devices(db: D1Database): Promise<DeviceRow[]> {
  return (await db.prepare("SELECT id, endpoint, p256dh, auth, created_at, last_ok_at FROM push_devices ORDER BY created_at, id").all<DeviceRow>()).results;
}

/** Forgets a device, as its push service said it is gone. */
export async function forget(db: D1Database, endpoint: string): Promise<boolean> {
  return (await db.prepare("DELETE FROM push_devices WHERE endpoint = ?1 RETURNING id").bind(endpoint).all()).results.length > 0;
}

/** Notes that a push service took a message for a device. */
export async function tookIt(db: D1Database, endpoint: string, at: string): Promise<void> {
  await db.prepare("UPDATE push_devices SET last_ok_at = ?1 WHERE endpoint = ?2").bind(at, endpoint).run();
}

/** The message a push carries: a title and its lines, as the service worker (site/sw.js) shows them. */
export function message(title: string, lines: readonly string[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ title, lines }));
}

/** An endpoint as the call names it, or null when it isn't a push service's. */
function endpointOf(value: unknown): string | null {
  return typeof value === "string" && isPushEndpoint(value) ? value : null;
}

/** A device as the browser's subscription hands it over (`PushSubscription.toJSON()`, its expiry left out), or null. */
function readDevice(value: unknown): Device | null {
  const fields = exactly(value, ["endpoint", "keys"]) ?? exactly(value, ["endpoint", "expirationTime", "keys"]);
  if (fields === null) return null;
  const endpoint = endpointOf(fields.endpoint);
  const keys = exactly(fields.keys, ["auth", "p256dh"]);
  if (endpoint === null || keys === null || typeof keys.p256dh !== "string" || typeof keys.auth !== "string" || !isDeviceKeys(keys.p256dh, keys.auth)) return null;
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

/** Keeps a device, or replaces its keys; answers when it was first turned on, or `too-many`. */
async function keep(db: D1Database, device: Device): Promise<string | "too-many"> {
  const known = await db.prepare("SELECT created_at FROM push_devices WHERE endpoint = ?1").bind(device.endpoint).first<{ created_at: string }>();
  if (known === null) {
    const count = (await db.prepare("SELECT COUNT(*) AS n FROM push_devices").first<{ n: number }>())?.n ?? 0;
    if (count >= MAX_DEVICES) return "too-many";
  }
  const row = await db
    .prepare(
      `INSERT INTO push_devices (id, endpoint, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth RETURNING created_at`,
    )
    .bind(crypto.randomUUID(), device.endpoint, device.p256dh, device.auth, new Date().toISOString())
    .first<{ created_at: string }>();
  return row?.created_at ?? new Date().toISOString();
}

/** Sends the test to the device he names, which must be one he turned on. */
async function test(request: Request, env: Bindings, key: VapidKey): Promise<Response> {
  const fields = exactly(await readJson(request), ["endpoint"]);
  const endpoint = endpointOf(fields?.endpoint);
  if (endpoint === null) return refuse(400, "device");
  const row = await env.DB.prepare("SELECT id, endpoint, p256dh, auth, created_at, last_ok_at FROM push_devices WHERE endpoint = ?1").bind(endpoint).first<DeviceRow>();
  if (row === null) return refuse(404, "no-device");
  const status = await send(key, row, message(TEST_PUSH.title, TEST_PUSH.lines), Date.now());
  console.log(JSON.stringify({ push: "test", status }));
  if (status >= 200 && status < 300) {
    await tookIt(env.DB, endpoint, new Date().toISOString());
    return json(200, { sent: true });
  }
  if (status === 404 || status === 410) {
    await forget(env.DB, endpoint);
    return refuse(410, "gone");
  }
  return json(502, { reason: "push-failed", status });
}

/** Answers every call under /threads/api/push. */
export async function handlePush(request: Request, url: URL, env: Bindings, who: Caller): Promise<Response> {
  const path = url.pathname;
  const allowed = path === "/threads/api/push/key" ? "GET" : path === "/threads/api/push/test" ? "POST" : path === "/threads/api/push" ? "POST, DELETE" : null;
  if (allowed === null) return json(404, { reason: "not-found" });
  if (!allowed.split(", ").includes(request.method)) return json(405, { reason: "method" }, { Allow: allowed });
  // Pushes go only to his devices: the sync and an invited person are refused before anything is read.
  if (who.caller !== "owner") return refuse(403, "owner-only");
  if (request.method !== "GET" && !sameOrigin(request)) return refuse(403, "origin");
  const key = await vapidKey(env);
  if (key === null) return refuse(503, "push-key");
  if (request.method === "GET") return json(200, { key: key.publicKey });
  const length = lengthRefusal(request, MAX_DEVICE_BYTES);
  if (length !== null) return length;
  if (path === "/threads/api/push/test") return test(request, env, key);
  const given = await readJson(request);
  if (request.method === "DELETE") {
    const endpoint = endpointOf(exactly(given, ["endpoint"])?.endpoint);
    if (endpoint === null) return refuse(400, "device");
    return json(200, { removed: await forget(env.DB, endpoint) });
  }
  const device = readDevice(given);
  if (device === null) return refuse(400, "device");
  const since = await keep(env.DB, device);
  if (since === "too-many") return refuse(409, "too-many");
  return json(200, { device: { since } });
}
