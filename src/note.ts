// The checks everything a visitor writes Suresh passes, in one place, for the site's three public writes: the note
// flow's send (src/talk.ts), a new thread about one of his topics; a note on a public thread; and an answer to a
// question of a public thread's page (both src/public.ts), each shown at once. All come from the site's own page as
// JSON with exactly the string keys their door names, and share one order of refusals, each the cheapest that
// applies: no bot-check secret (503), another origin (403), no or too large a declared length (411, 413), a body that
// isn't JSON (415; a browser form can't send JSON, so this also closes cross-site form posts), a malformed note or
// answer (400), a failed bot check (403), and the daily limits (429, whose `limit` reason the page shows), which every
// note counts against one budget and every answer against another (src/quota.ts). Bots are refused before the
// limits, so they can't spend real visitors' allowance. Nothing personal is ever logged: a refusal's line holds its
// status and reason only.

import { networkOf, take, type Budget } from "./quota.ts";
import { verifyToken } from "./turnstile.ts";
import { isJson, sameOrigin } from "./request.ts";
import { refuse } from "./wire.ts";
import type { Bindings } from "./bindings.ts";

/** The longest note or visitor's answer, in UTF-16 code units of the trimmed text; the page counts the same way. */
export const MAX_NOTE = 4000;
/**
 * The largest request: a note's 4,000 code units are at most 12,000 bytes of UTF-8, and JSON escapes at
 * most double the few characters it escapes, so with the token (2,048), name, email and topic the whole
 * body stays well under 16 KiB.
 */
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_NAME = 80;
const MAX_EMAIL = 200;
const MAX_TOKEN = 2048;
/** The id a page marks a question with, as the bridge and the threads' calls hold it (frame/bridge.js). */
const QUESTION_SHAPE = /^[a-z0-9-]{1,40}$/;
/** A visitor's key: 32 random bytes their browser made once, as hex. */
export const VISITOR_KEY_SHAPE = /^[0-9a-f]{64}$/;
/** The browser's own check for `type="email"` (the HTML standard's valid e-mail address), so both agree. */
const EMAIL_SHAPE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** A note may keep its line breaks and tabs; every other control character is refused. */
const BODY_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** A note as the checks read it: the words, the name and email (null when not given), and the bot check's token. */
export interface Note {
  readonly body: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly token: string;
}

/**
 * The request's fields, exactly `keys` and each a string, after the checks that come before reading a body: the
 * secret, the origin, the declared length and the type. A refusal is answered as it stands.
 */
export async function readFields(request: Request, env: Bindings, keys: readonly string[]): Promise<{ secret: string; fields: Record<string, string> } | Response> {
  const secret = env.TURNSTILE_SECRET ?? "";
  if (secret === "") return refuse(503, "not-configured");
  if (!sameOrigin(request)) return refuse(403, "origin");

  const declared = request.headers.get("Content-Length");
  if (declared === null || !/^\d{1,12}$/.test(declared)) return refuse(411, "length");
  if (Number(declared) > MAX_REQUEST_BYTES) return refuse(413, "too-large");
  if (!isJson(request)) return refuse(415, "type");

  let fields: Record<string, string> | null;
  try {
    fields = strings(JSON.parse(await request.text()), keys);
  } catch {
    fields = null;
  }
  return fields === null ? refuse(400, "form") : { secret, fields };
}

/** Exactly `keys`, each a string, or null for anything else: another shape, a missing, extra or non-string key. */
function strings(value: unknown, keys: readonly string[]): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const given = Object.keys(record);
  if (given.length !== keys.length || !keys.every((key) => given.includes(key))) return null;
  const read: Record<string, string> = {};
  for (const key of keys) {
    const field = record[key];
    if (typeof field !== "string") return null;
    read[key] = field;
  }
  return read;
}

/** The note in the fields, or the refusal of its first field that is wrong: the words (`body`), then the rest (`form`). */
export function readNote(fields: Record<string, string>): Note | Response {
  const body = (fields.body ?? "").trim();
  if (body.length === 0 || body.length > MAX_NOTE || !body.isWellFormed() || BODY_CONTROL.test(body)) return refuse(400, "body");

  const name = (fields.name ?? "").trim();
  const email = (fields.email ?? "").trim();
  const token = (fields.token ?? "").trim();
  if (name.length > MAX_NAME || CONTROL.test(name) || !name.isWellFormed()) return refuse(400, "form");
  if (email.length > MAX_EMAIL || (email !== "" && !EMAIL_SHAPE.test(email))) return refuse(400, "form");
  if (token === "" || token.length > MAX_TOKEN) return refuse(400, "form");
  return { body, name: name === "" ? null : name, email: email === "" ? null : email, token };
}

/** A visitor's answer as the checks read it: the question it answers, the words, the name and key, and the token. */
export interface Answer {
  readonly question: string;
  readonly body: string;
  readonly name: string;
  readonly key: string;
  readonly token: string;
}

/**
 * The answer in the fields, or the refusal of its first field that is wrong: the words (`body`, as a note's), then
 * the rest (`form`): a question id, a name (which an answer must have, because it is shown with it), the key and the
 * token.
 */
export function readAnswer(fields: Record<string, string>): Answer | Response {
  const body = (fields.body ?? "").trim();
  if (body.length === 0 || body.length > MAX_NOTE || !body.isWellFormed() || BODY_CONTROL.test(body)) return refuse(400, "body");

  const question = fields.question ?? "";
  const name = (fields.name ?? "").trim();
  const key = fields.key ?? "";
  const token = (fields.token ?? "").trim();
  if (!QUESTION_SHAPE.test(question)) return refuse(400, "form");
  if (name === "" || name.length > MAX_NAME || CONTROL.test(name) || !name.isWellFormed()) return refuse(400, "form");
  if (!VISITOR_KEY_SHAPE.test(key)) return refuse(400, "form");
  if (token === "" || token.length > MAX_TOKEN) return refuse(400, "form");
  return { question, body, name, key, token };
}

/** The sender's network once the bot check passes, or the refusal: no address (400), a failed check (403). */
export async function checkBot(request: Request, secret: string, token: string): Promise<{ network: string } | Response> {
  const address = request.headers.get("CF-Connecting-IP") ?? "";
  const network = networkOf(address);
  if (network === null) return refuse(400, "address");
  const { hostname } = new URL(request.url);
  if (!(await verifyToken(secret, token, { remoteIp: address, hostname }))) return refuse(403, "bot-check");
  return { network };
}

/** Counts one note or answer against its budget's daily limits, or answers 429 `limit` when they are reached. */
export async function takeLimit(env: Bindings, network: string, budget: Budget): Promise<Response | null> {
  return (await take(env.DB, network, budget)) ? null : refuse(429, "limit");
}
