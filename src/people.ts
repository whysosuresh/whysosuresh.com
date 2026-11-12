// The people calls under /threads/api/people, behind the threads' Access application and the door's own check of
// who is calling (src/threads.ts routes here once the caller is named): everyone Suresh deals with, each a person
// with a number (src/store.ts, migrations/0012_people.sql): people he invited, visitors who wrote to him from the
// site or on a public thread with an address, and people who told him something in person.
//
//   GET  /threads/api/people              owner and sync: everyone, whoever was last in touch first
//   GET  /threads/api/people/<n>          owner and sync: one person, their threads and what they said
//   POST /threads/api/people/<n>          {"name"} | {"email"} | {"note"}   owner
//
// A person's page holds what other people said to him, so only he and the sync read it, and only he changes it,
// from his own page: an invited person is refused 403 `owner-only` on every call, and the sync on a change, before
// anything is read, so the refusal says nothing about a number. A number nobody has answers 404 `no-person`.
//
// Everyone is answered whoever was last in touch first, each with their photo (`photo`, a Gravatar the hourly run
// copied once they were invited, src/photos.ts), how he knows them (the counts) and whether
// anything of theirs is live (`dropped` when it isn't: only ever in threads he dropped). A person's call adds his
// own notes on them, every thread they are in with how (`roles`: `sent` a site note, `told` him, `invited`, their
// invitation `removed`, `wrote` a comment or note there, `met` in its meeting), shaped as the threads' calls shape a
// thread, its meeting included, and what they said, newest first: their site notes, their comments as an invited
// person, and their notes on public threads with whether each is waiting or dropped. Up to 200 of each; `truncated`
// says there are more. The counts include the meetings they are in (`met`).
//
// A change is one field: their name; their address, given once while they have none (lowercased, never his own,
// 409 `has-email` once they have one, 409 `email-taken` with the number of the person who holds it), because it is
// what an invited person signs in with; or his notes on them, Markdown, which an empty text clears. Nothing about a
// person has a history: a person isn't a thread, and his notes are his own words. Nothing personal is logged.

import type { Caller } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { json, type JsonValue } from "./json.ts";
import { sameOrigin } from "./request.ts";
import { editPerson, findPerson, listPeople, threadsOfPerson, wordsOfPerson, type PeopleRow, type PersonChange, type PersonThreadRow, type ThreadRow, type WordsRow } from "./store.ts";
import { MAX_BODY, MAX_PERSON_NAME, MAX_TEXT_BYTES, exactly, lengthRefusal, line, readEmail, readJson, refuse, text } from "./wire.ts";

/** The most people the list answers; `truncated` says there are more. */
const EVERYONE = 1000;
/** The most threads, and the most words, one person's call answers. */
const SHOWN = 200;
/** A person's number as a path names it: no sign, no leading zero, at most nine digits. */
const NUMBER_SHAPE = /^[1-9]\d{0,8}$/;

/** How the door shapes a thread for its reader (src/threads.ts), so a person's threads read as every list's do. */
export type ThreadView = (row: ThreadRow) => { readonly [key: string]: JsonValue };

/** A person as the owner and the sync read them. */
export function personView(row: PeopleRow): { readonly [key: string]: JsonValue } {
  return {
    number: row.number,
    name: row.name,
    email: row.email,
    photo: row.photo_id,
    createdAt: row.created_at,
    lastContact: row.last_contact,
    invited: row.invited > 0,
    dropped: row.live === 0,
    counts: { sent: row.sent, told: row.told, invited: row.invited, removed: row.removed, commented: row.commented, noted: row.noted, met: row.met },
  };
}

/** How a person is in a thread, in a fixed order. */
function rolesOf(row: PersonThreadRow): string[] {
  const roles: string[] = [];
  if (row.mine === 1) roles.push(row.source === "told" ? "told" : "sent");
  if (row.membership !== null) roles.push(row.membership);
  if (row.wrote > 0) roles.push("wrote");
  if (row.attends === 1) roles.push("met");
  return roles;
}

function wordsView(row: WordsRow): { readonly [key: string]: JsonValue } {
  return { kind: row.kind, thread: { number: row.number, title: row.title }, body: row.body, at: row.at, state: row.state, audience: row.audience };
}

async function everyone(env: Bindings): Promise<Response> {
  const people = await listPeople(env.DB, EVERYONE + 1);
  return json(200, { people: people.slice(0, EVERYONE).map(personView), truncated: people.length > EVERYONE });
}

async function one(number: number, env: Bindings, shape: ThreadView): Promise<Response> {
  const person = await findPerson(env.DB, number);
  if (person === null) return refuse(404, "no-person");
  const [threads, words] = await Promise.all([threadsOfPerson(env.DB, person.id, SHOWN + 1), wordsOfPerson(env.DB, person.id, SHOWN + 1)]);
  return json(200, {
    person: { ...personView(person), note: person.note },
    threads: threads.slice(0, SHOWN).map((row) => ({ ...shape(row), roles: rolesOf(row) })),
    words: words.slice(0, SHOWN).map(wordsView),
    truncated: threads.length > SHOWN || words.length > SHOWN,
  });
}

/** The change a request asks for, or the reason it is refused. */
function readChange(value: unknown, env: Bindings): PersonChange | "person" | "owner" {
  const name = exactly(value, ["name"]);
  if (name !== null) {
    const given = line(name.name, MAX_PERSON_NAME);
    return given === null ? "person" : { name: given };
  }
  const email = exactly(value, ["email"]);
  if (email !== null) {
    const given = readEmail(email.email, env);
    return typeof given === "string" ? given : { email: given.email };
  }
  const note = exactly(value, ["note"]);
  if (note === null) return "person";
  const given = text(note.note, MAX_BODY);
  if (given === null) return "person";
  return { note: given === "" ? null : given };
}

async function change(request: Request, number: number, env: Bindings): Promise<Response> {
  const length = lengthRefusal(request, MAX_TEXT_BYTES);
  if (length !== null) return length;
  const asked = readChange(await readJson(request), env);
  if (typeof asked === "string") return refuse(400, asked);
  const changed = await editPerson(env.DB, number, asked);
  if (changed === "no-person") return refuse(404, "no-person");
  if (changed === "has-email") return refuse(409, "has-email");
  if ("taken" in changed) {
    console.log(JSON.stringify({ refused: 409, reason: "email-taken" }));
    return json(409, { reason: "email-taken", number: changed.taken });
  }
  return json(200, { person: { ...personView(changed), note: changed.note } });
}

/**
 * Answers every request under /threads/api/people for a caller the door has named; `shape` is how the door shapes
 * a thread for them. Every refusal of a caller comes before anything is read.
 */
export async function handlePeople(request: Request, url: URL, env: Bindings, caller: Caller, shape: ThreadView): Promise<Response> {
  const route = /^\/threads\/api\/people(?:\/([^/]+))?$/.exec(url.pathname);
  if (route === null) return json(404, { reason: "not-found" });
  const given = route[1];
  const allowed = given === undefined ? "GET" : "GET, POST";
  if (request.method !== "GET" && !(given !== undefined && request.method === "POST")) return json(405, { reason: "method" }, { Allow: allowed });
  if (caller.caller === "member") return refuse(403, "owner-only");
  if (request.method === "POST") {
    if (caller.caller !== "owner") return refuse(403, "owner-only");
    if (!sameOrigin(request)) return refuse(403, "origin");
  }
  if (url.search !== "") return refuse(400, "query");
  if (given === undefined) return everyone(env);
  if (!NUMBER_SHAPE.test(given)) return refuse(404, "no-person");
  return request.method === "GET" ? one(Number(given), env, shape) : change(request, Number(given), env);
}
