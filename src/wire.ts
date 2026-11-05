// What the two private doors, the inbox's calls (src/inbox.ts) and the threads' calls (src/threads.ts), read from
// a request before the store sees it: the size and type checks, and an add or a move as the store's own intent
// (src/store.ts). The doors differ only in the name of the thing a thread is about: the inbox says `topic` and
// takes only the note flow's topics, the threads say `space` and take every space; so the key and its check are
// passed in, and the rules live here once. The owner's own add, from the threads page, has its own shape
// (`readOwnAdd`). Every refusal logs its status and reason only, nothing personal.

import { json } from "./json.ts";
import { isJson } from "./request.ts";
import type { Move, NewThread } from "./store.ts";

/** A move is one small JSON object; anything larger is refused before it is read. */
export const MAX_CHANGE_BYTES = 1024;
/** The longest body an add or a comment carries, in UTF-16 code units of the trimmed text: a moved issue with its comments. */
export const MAX_BODY = 32_000;
/**
 * The largest add, comment or text: 32,000 code units are at most 96,000 bytes of UTF-8 (Telugu takes three
 * bytes a character), and JSON escapes at most double the few characters it escapes, so with the title, ref and
 * name the whole body stays under 128 KiB.
 */
export const MAX_TEXT_BYTES = 128 * 1024;
/** The longest title, in UTF-16 code units of the trimmed text. */
export const MAX_TITLE = 200;
const MAX_NAME = 80;
const MAX_LINK = 200;
/** The longest drop reason, in UTF-16 code units of the trimmed text. */
const MAX_REASON = 120;
/** Where an item came from: a kind, a colon, and an id of printable ASCII. */
const REF_SHAPE = /^[a-z]+:[\x21-\x7e]{1,190}$/;
/** The only place a thread is filed: a GitHub issue's address. */
const ISSUE_SHAPE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** A body may keep its line breaks and tabs; every other control character is refused. */
const BODY_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** The name a door gives what a thread is about, and the check its values pass. */
export interface SpaceKey {
  readonly key: "topic" | "space";
  readonly allowed: (slug: string) => boolean;
}

export function refuse(status: number, reason: string): Response {
  console.log(JSON.stringify({ refused: status, reason }));
  return json(status, { reason });
}

/** The declared length's refusal, if any: none, malformed or over `max`; then a body that doesn't say JSON. */
export function lengthRefusal(request: Request, max: number): Response | null {
  const declared = request.headers.get("Content-Length");
  if (declared === null || !/^\d{1,12}$/.test(declared)) return refuse(411, "length");
  if (Number(declared) > max) return refuse(413, "too-large");
  if (!isJson(request)) return refuse(415, "type");
  return null;
}

/** The request's JSON, or undefined when it isn't JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return JSON.parse(await request.text()) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A one-line text of at most `max` code units once trimmed, or null. */
export function line(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "" || text.length > max || CONTROL.test(text) || !text.isWellFormed()) return null;
  return text;
}

/** A text of at most `max` code units once trimmed, keeping its line breaks; null when it isn't one. Empty is allowed. */
export function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > max || !trimmed.isWellFormed() || BODY_CONTROL.test(trimmed)) return null;
  return trimmed;
}

/**
 * An add from the sync as a new thread, or the reason it is refused: its first field that is wrong, in a fixed
 * order. Something told to Suresh in person (`told`) names the teller; his own (`self`) names no one.
 */
export function readAdd(value: unknown, space: SpaceKey): NewThread | string {
  if (!isRecord(value)) return "item";
  const source = value.source;
  if (source !== "told" && source !== "self") return "source";
  const expected = ["body", "ref", "source", "status", "title", space.key, ...(source === "told" ? ["name"] : [])].sort().join(",");
  if (Object.keys(value).sort().join(",") !== expected) return "keys";

  if (typeof value.ref !== "string" || !REF_SHAPE.test(value.ref)) return "ref";
  const title = line(value.title, MAX_TITLE);
  if (title === null) return "title";
  const body = text(value.body, MAX_BODY);
  if (body === null || body === "") return "body";
  const given = value[space.key];
  let about: string | null = null;
  if (given !== null) {
    if (typeof given !== "string" || !space.allowed(given)) return space.key;
    about = given;
  }
  let name: string | null = null;
  if (source === "told") {
    name = line(value.name, MAX_NAME);
    if (name === null) return "name";
  }
  const status = value.status;
  if (status !== "received" && status !== "act" && status !== "discuss") return "status";
  return { source, space: about, title, body, senderName: name, senderEmail: null, status, originRef: value.ref };
}

/** A change as one of the store's moves, or null for a malformed one. */
export function readMove(value: unknown, space: SpaceKey): Move | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort().join(",");
  switch (value.action) {
    case "act":
    case "discuss":
    case "done":
    case "reopen":
    case "unsort":
    case "reply-opened":
      return keys === "action" ? { action: value.action } : null;
    case "drop": {
      if (keys !== "action,reason" || typeof value.reason !== "string") return null;
      const reason = value.reason.trim();
      if (reason.length > MAX_REASON || CONTROL.test(reason) || !reason.isWellFormed()) return null;
      return { action: "drop", reason: reason === "" ? null : reason };
    }
    case space.key: {
      const slug = value[space.key];
      if (keys !== `action,${space.key}` || typeof slug !== "string" || !space.allowed(slug)) return null;
      return { action: "space", space: slug };
    }
    case "file":
      if (keys !== "action,link" || typeof value.link !== "string") return null;
      if (value.link.length > MAX_LINK || !ISSUE_SHAPE.test(value.link)) return null;
      return { action: "file", link: value.link };
    default:
      return null;
  }
}

/**
 * A thread the owner starts from his page, as a new thread, or the reason it is refused: its first field that is
 * wrong, in a fixed order. It is his own (`self`), filed in a space and in one of the three open tabs, with a
 * title; it names no origin, so starting the same title twice makes two threads, as two clicks of New would. Its
 * main text may be empty: a thread can start as a title, and its text is written later.
 */
export function readOwnAdd(value: unknown, space: SpaceKey): NewThread | string {
  if (!isRecord(value)) return "item";
  if (Object.keys(value).sort().join(",") !== ["body", "status", "title", space.key].sort().join(",")) return "keys";
  const title = line(value.title, MAX_TITLE);
  if (title === null) return "title";
  const body = text(value.body, MAX_BODY);
  if (body === null) return "body";
  const given = value[space.key];
  if (typeof given !== "string" || !space.allowed(given)) return space.key;
  const status = value.status;
  if (status !== "received" && status !== "act" && status !== "discuss") return "status";
  return { source: "self", space: given, title, body, senderName: null, senderEmail: null, status, originRef: null };
}
