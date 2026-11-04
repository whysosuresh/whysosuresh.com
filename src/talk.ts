// The note flow's send, the site's one public write: a typed note about one of Suresh's topics, with an
// optional name and email, from the site's own page, as JSON with exactly five string keys. Each refusal is
// the cheapest that applies, in order: no bot-check secret (503), another origin (403), no or too large a
// declared length (411, 413), a body that isn't JSON (415; a browser form can't send JSON, so this also
// closes cross-site form posts), a malformed note (400), a failed bot check (403), and the daily limits
// (429, whose `limit` reason the page shows as its own screen). Bots are refused before the limits, so they
// can't spend real visitors' allowance. Nothing personal is ever logged: a refusal's line holds its status
// and reason only.

import { isTopic } from "../site/talk-topics.js";
import { networkOf, takeSend } from "./quota.ts";
import { keep, type Note } from "./store.ts";
import { verifyToken } from "./turnstile.ts";
import { json } from "./json.ts";

/** The Worker's bindings (wrangler.jsonc), and the bot check's secret, which the deploy sets. */
export type Bindings = Env & { readonly TURNSTILE_SECRET?: string };

/** The longest note, in UTF-16 code units of the trimmed text; the page counts the same way. */
const MAX_BODY = 4000;
/**
 * The largest request: a note's 4,000 code units are at most 12,000 bytes of UTF-8, and JSON escapes at
 * most double the few characters it escapes, so with the token (2,048), name, email and topic the whole
 * body stays well under 16 KiB.
 */
const MAX_REQUEST_BYTES = 16 * 1024;
const KEYS = ["topic", "body", "name", "email", "token"];
const MAX_NAME = 80;
const MAX_EMAIL = 200;
const MAX_TOKEN = 2048;
/** The browser's own check for `type="email"` (the HTML standard's valid e-mail address), so both agree. */
const EMAIL_SHAPE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** A note may keep its line breaks and tabs; every other control character is refused. */
const BODY_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

function refuse(status: number, reason: string): Response {
  console.log(JSON.stringify({ refused: status, reason }));
  return json(status, { reason });
}

/** Whether the request comes from the site's own page: its Origin is this request's own origin. */
function sameOrigin(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null && site !== "same-origin") return false;
  return request.headers.get("Origin") === new URL(request.url).origin;
}

/** Whether the declared media type is JSON; parameters such as `charset` are allowed. */
function isJson(request: Request): boolean {
  const type = request.headers.get("Content-Type") ?? "";
  return type.split(";")[0]?.trim().toLowerCase() === "application/json";
}

/** The five keys as strings, or null for anything else: another shape, a missing, extra or non-string key. */
function readKeys(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== KEYS.length || !KEYS.every((key) => keys.includes(key))) return null;
  const strings: Record<string, string> = {};
  for (const key of KEYS) {
    const field = record[key];
    if (typeof field !== "string") return null;
    strings[key] = field;
  }
  return strings;
}

export async function handleTalk(request: Request, env: Bindings): Promise<Response> {
  const secret = env.TURNSTILE_SECRET ?? "";
  if (secret === "") return refuse(503, "not-configured");
  if (!sameOrigin(request)) return refuse(403, "origin");

  const declared = request.headers.get("Content-Length");
  if (declared === null || !/^\d{1,12}$/.test(declared)) return refuse(411, "length");
  if (Number(declared) > MAX_REQUEST_BYTES) return refuse(413, "too-large");
  if (!isJson(request)) return refuse(415, "type");

  let fields: Record<string, string> | null;
  try {
    fields = readKeys(JSON.parse(await request.text()));
  } catch {
    fields = null;
  }
  if (fields === null) return refuse(400, "form");

  const topic = fields.topic ?? "";
  if (!isTopic(topic)) return refuse(400, "topic");

  const body = (fields.body ?? "").trim();
  if (body.length === 0 || body.length > MAX_BODY || !body.isWellFormed() || BODY_CONTROL.test(body)) {
    return refuse(400, "body");
  }

  const name = (fields.name ?? "").trim();
  const email = (fields.email ?? "").trim();
  const token = (fields.token ?? "").trim();
  if (name.length > MAX_NAME || CONTROL.test(name) || !name.isWellFormed()) return refuse(400, "form");
  if (email.length > MAX_EMAIL || (email !== "" && !EMAIL_SHAPE.test(email))) return refuse(400, "form");
  if (token === "" || token.length > MAX_TOKEN) return refuse(400, "form");

  const address = request.headers.get("CF-Connecting-IP") ?? "";
  const network = networkOf(address);
  if (network === null) return refuse(400, "address");
  const { hostname } = new URL(request.url);
  if (!(await verifyToken(secret, token, { remoteIp: address, hostname }))) return refuse(403, "bot-check");

  if (!(await takeSend(env.DB, network))) return refuse(429, "limit");

  const note: Note = { topic, body, name, email };
  let id: string;
  try {
    id = await keep(env.DB, note);
  } catch {
    return refuse(500, "store");
  }
  return json(201, { id });
}
