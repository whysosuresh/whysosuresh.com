// What the threads' calls (src/threads.ts) read from a request before the store sees it: the size and type
// checks, and an add or a move as the store's own intent (src/store.ts). What a thread is about is its `space`,
// any of site/spaces.js. The sync's add and the owner's own add, from the threads page, have their own shapes
// (`readAdd`, `readOwnAdd`). A meeting and its people have theirs too (`readMeeting`, `readAttendee`). Every refusal
// logs its status and reason only, nothing personal.

import { isSpace } from "../site/spaces.js";
import { json } from "./json.ts";
import { isJson } from "./request.ts";
import type { Attendee, Meeting, Move, NewThread } from "./store.ts";

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

/**
 * Words quoted from a page, or the text either side of them, at most `max` UTF-16 code units: kept exactly as
 * selected, untrimmed, with their line breaks and tabs; every other control character is refused.
 */
export function quoted(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max || !value.isWellFormed() || BODY_CONTROL.test(value)) return null;
  return value;
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

  // `ask:` is the origin the store keeps a browser's answers to an ask under; no item the sync adds may take it.
  if (typeof value.ref !== "string" || !REF_SHAPE.test(value.ref) || value.ref.startsWith("ask:")) return "ref";
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

/** A meeting's day: the same day for every reader, its time not set yet. */
const DAY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
/**
 * A meeting's moment: a day, a time to the minute (seconds and milliseconds allowed), and always its zone, `Z` or an
 * offset, because a time with none would be read in whatever zone the reader's machine is in.
 */
const INSTANT_SHAPE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;
/** The years a meeting may be in: wide enough for anything real, narrow enough that a slip of the keyboard is refused. */
const FIRST_YEAR = 2000;
const LAST_YEAR = 2100;
/** The widest offset from UTC any zone keeps (Kiribati's +14:00). */
const MAX_OFFSET_HOURS = 14;
/** A meeting's length in minutes: at least five, at most a day. */
const MIN_MINUTES = 5;
const MAX_MINUTES = 1440;
/** The longest where, in UTF-16 code units of the trimmed text. */
export const MAX_WHERE = 200;

/**
 * A day as `YYYY-MM-DD` when it is one on the calendar, in the years a meeting may be in; null otherwise. Date
 * itself would take 30 February as 2 March without a word, so the day must come back from Date unchanged.
 */
function calendarDay(value: string): string | null {
  const day = DAY_SHAPE.exec(value);
  if (day === null) return null;
  const year = Number(day[1]);
  if (year < FIRST_YEAR || year > LAST_YEAR) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * A meeting's when as the store keeps it: a day as given, or a moment as its instant in UTC
 * (`YYYY-MM-DDTHH:MM:SS.sssZ`); null for anything else. The shape is checked before Date reads it, because Date
 * reads a wrong shape silently: a time with no zone in the machine's own zone, and a day that isn't one as another.
 */
function meetingWhen(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (DAY_SHAPE.test(value)) return calendarDay(value);
  const moment = INSTANT_SHAPE.exec(value);
  if (moment === null) return null;
  const [, day = "", hours = "", minutes = "", seconds = "0", offsetHours = "0", offsetMinutes = "0"] = moment;
  if (calendarDay(day) === null || Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return null;
  if (Number(offsetHours) > MAX_OFFSET_HOURS || Number(offsetMinutes) > 59) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  return year < FIRST_YEAR || year > LAST_YEAR ? null : parsed.toISOString();
}

/**
 * A meeting as the call asks for it, every key present: `{"when", "minutes", "where"}`, the when a day or a moment
 * with its zone, the length null or a whole number of minutes from 5 to 1440, the where null or one line of at most
 * 200 code units. `when` null clears the meeting, and then the other two must be null too. Null for anything else.
 */
export function readMeeting(value: unknown): { readonly meeting: Meeting | null } | null {
  const fields = exactly(value, ["minutes", "when", "where"]);
  if (fields === null) return null;
  if (fields.when === null) return fields.minutes === null && fields.where === null ? { meeting: null } : null;
  const when = meetingWhen(fields.when);
  if (when === null) return null;
  const minutes = fields.minutes;
  if (minutes !== null && (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES)) return null;
  const where = fields.where === null ? null : line(fields.where, MAX_WHERE);
  if (fields.where !== null && where === null) return null;
  return { meeting: { when, minutes, where } };
}

/**
 * A change to a meeting's people as the call asks for it: `{"add": {"person": <number>}}` for someone the caller
 * knows, `{"add": {"name": <text>}}` for someone new, or `{"remove": <number>}`; null for anything else.
 */
export function readAttendee(value: unknown): { readonly add: Attendee } | { readonly remove: number } | null {
  const adding = exactly(value, ["add"]);
  if (adding !== null) {
    const known = exactly(adding.add, ["person"]);
    if (known !== null) return isPersonNumber(known.person) ? { add: { person: known.person } } : null;
    const named = exactly(adding.add, ["name"]);
    const name = named === null ? null : line(named.name, MAX_PERSON_NAME);
    return name === null ? null : { add: { name } };
  }
  const removing = exactly(value, ["remove"]);
  return removing !== null && isPersonNumber(removing.remove) ? { remove: removing.remove } : null;
}
