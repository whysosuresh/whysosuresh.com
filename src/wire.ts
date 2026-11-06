// What the threads' calls (src/threads.ts) read from a request before the store sees it: the size and type
// checks, and an add or a move as the store's own intent (src/store.ts). What a thread is about is its `space`,
// any of site/spaces.js. The sync's add and the owner's own add, from the threads page, have their own shapes
// (`readAdd`, `readOwnAdd`). Every refusal logs its status and reason only, nothing personal.

import { isSpace } from "../site/spaces.js";
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

/** A person's number as an add names it: a positive whole number of at most nine digits. */
function isPersonNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 999_999_999;
}

/**
 * An add from the sync as a new thread, or the reason it is refused: its first field that is wrong, in a fixed
 * order. Something told to Suresh in person (`told`) names the teller, as he said the name, and may name the person
 * they are by number (`person`), which the sync proposes and he agrees to; his own (`self`) names no one.
 */
export function readAdd(value: unknown): NewThread | string {
  if (!isRecord(value)) return "item";
  const source = value.source;
  if (source !== "told" && source !== "self") return "source";
  const keys = ["body", "ref", "source", "space", "status", "title", ...(source === "told" ? ["name"] : [])];
  const expected = keys.sort().join(",");
  const withPerson = [...keys, "person"].sort().join(",");
  const given = Object.keys(value).sort().join(",");
  if (given !== expected && (source !== "told" || given !== withPerson)) return "keys";

  if (typeof value.ref !== "string" || !REF_SHAPE.test(value.ref)) return "ref";
  const title = line(value.title, MAX_TITLE);
  if (title === null) return "title";
  const body = text(value.body, MAX_BODY);
  if (body === null || body === "") return "body";
  const space = value.space;
  let about: string | null = null;
  if (space !== null) {
    if (typeof space !== "string" || !isSpace(space)) return "space";
    about = space;
  }
  let name: string | null = null;
  if (source === "told") {
    name = line(value.name, MAX_NAME);
    if (name === null) return "name";
  }
  const status = value.status;
  if (status !== "received" && status !== "act" && status !== "discuss") return "status";
  const person = value.person;
  if (person !== undefined && !isPersonNumber(person)) return "person";
  return { source, space: about, title, body, senderName: name, senderEmail: null, status, originRef: value.ref, person: person ?? null };
}

/** The longest name the owner gives a person, in UTF-16 code units of the trimmed text. */
export const MAX_PERSON_NAME = 80;
/** The longest email address. */
const MAX_EMAIL = 254;
/**
 * An email address as the owner gives a person one (an invitation, or a person's page): one `@`, a domain of two or
 * more dot-separated parts with none empty (so no trailing dot, which a dictated address often carries and which no
 * sign-in could ever match), and none of the characters that would split or quote it in a mail draft's recipients.
 */
const EMAIL_SHAPE = /^[^\s@,;:<>()"\[\]\\]+@(?:[^\s@,;:<>()"\[\]\\.]+\.)+[^\s@,;:<>()"\[\]\\.]+$/;

/**
 * An address the owner gives a person, lowercased, as the store keeps it; `person` for one that isn't an address,
 * and `owner` for his own, which no person may hold.
 */
export function readEmail(value: unknown, env: { readonly INBOX_OWNER_EMAIL?: string | undefined }): { readonly email: string } | "person" | "owner" {
  const address = line(value, MAX_EMAIL);
  if (address === null || !EMAIL_SHAPE.test(address)) return "person";
  const email = address.toLowerCase();
  return email === (env.INBOX_OWNER_EMAIL ?? "").trim().toLowerCase() ? "owner" : { email };
}

/** Exactly the given keys, as a record; null for anything else. */
export function exactly(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",") ? value : null;
}

/** A change as one of the store's moves, or null for a malformed one. */
export function readMove(value: unknown): Move | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort().join(",");
  switch (value.action) {
    case "act":
    case "discuss":
    case "done":
    case "reopen":
    case "unsort":
    case "reply-opened":
    case "publish":
    case "unpublish":
      return keys === "action" ? { action: value.action } : null;
    case "drop": {
      if (keys !== "action,reason" || typeof value.reason !== "string") return null;
      const reason = value.reason.trim();
      if (reason.length > MAX_REASON || CONTROL.test(reason) || !reason.isWellFormed()) return null;
      return { action: "drop", reason: reason === "" ? null : reason };
    }
    case "space": {
      const slug = value.space;
      if (keys !== "action,space" || typeof slug !== "string" || !isSpace(slug)) return null;
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
export function readOwnAdd(value: unknown): NewThread | string {
  if (!isRecord(value)) return "item";
  if (Object.keys(value).sort().join(",") !== "body,space,status,title") return "keys";
  const title = line(value.title, MAX_TITLE);
  if (title === null) return "title";
  const body = text(value.body, MAX_BODY);
  if (body === null) return "body";
  const given = value.space;
  if (typeof given !== "string" || !isSpace(given)) return "space";
  const status = value.status;
  if (status !== "received" && status !== "act" && status !== "discuss") return "status";
  return { source: "self", space: given, title, body, senderName: null, senderEmail: null, status, originRef: null, person: null };
}
