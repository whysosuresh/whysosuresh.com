// People, run as production runs them: the Worker's bundle in workerd (test/harness.ts), with a local D1 and
// Cloudflare Access played for the threads' application. What it holds: everyone he deals with becomes one person,
// found by the address a visitor typed (ignoring case), on a site note and on a public thread alike, and a visitor's
// typing never renames anyone; a told thread joins the person the sync names by number (a number nobody has is
// refused and nothing is written), else the one person with that name, else a new person; an invitation lands on a
// sender's person, his typed name winning. Linking a visitor's note to a person changes no name anyone else reads.
// The people calls: the owner and the sync read everyone and one person (their threads with how they are in each,
// what they said, newest first, waiting and dropped notes marked); only the owner changes a person (their name,
// their address once, never one another person holds, and his notes on them), from his own page; an invited person
// is refused every call before anything is read, and signed out nobody gets in. Someone only ever in threads he
// dropped is marked so. A search answers people beside threads for the owner and the sync, never for an invited
// person; a thread names who it is from by number, a comment its writer, a thread's people theirs, for the owner
// and the sync only. A person in a meeting counts it (`met`) with the role `met` on its thread, is in touch once it has
// begun, and is live while it is on a thread he hasn't dropped; a name given to a meeting is someone new.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OWNER, SITE, THREADS, startHarness, type Harness } from "./harness.ts";

const MEERA = "meera@example.com";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});
afterAll(async () => {
  await harness.dispose();
});
beforeEach(async () => {
  await harness.reset();
});

type Who = "owner" | "sync" | { readonly email: string };

function token(as: Who): string {
  if (as === "owner") return harness.access.token(harness.access.ownerClaims());
  if (as === "sync") return harness.access.token(harness.access.syncClaims());
  return harness.access.token(harness.access.memberClaims(as.email));
}

/** A call under /threads/api/, by its path after that. */
async function call(path: string, request: { as?: Who; body?: unknown; origin?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(request.as ?? "owner") };
  if (request.body === undefined) return harness.fetch(`${THREADS}/threads/api${path}`, { headers });
  headers["Content-Type"] = "application/json";
  if (request.origin !== null) headers.Origin = request.origin ?? THREADS;
  return harness.fetch(`${THREADS}/threads/api${path}`, { method: "POST", headers, body: new TextEncoder().encode(JSON.stringify(request.body)) });
}

async function answer<T>(response: Response, status = 200): Promise<T> {
  const text = await response.text();
  expect([response.status, text]).toEqual([status, expect.any(String)]);
  return JSON.parse(text) as T;
}

async function reasonOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { reason: string }).reason];
}

let networks = 0;
/** A fresh network for each visitor's send, so the daily limits never stand in a test's way. */
function network(): string {
  networks += 1;
  return `198.51.100.${networks % 250}`;
}

/** A site note, as the note flow keeps it; answers its number. */
async function siteNote(name: string, email: string, body = "A note."): Promise<number> {
  const response = await harness.fetch(`${SITE}/api/talk`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE, "CF-Connecting-IP": network() },
    body: new TextEncoder().encode(JSON.stringify({ topic: "stigmer", body, name, email, token: "pass" })),
  });
  expect(response.status).toBe(201);
  const row = await (await harness.db()).prepare("SELECT number FROM threads ORDER BY number DESC").first<{ number: number }>();
  return row?.number ?? 0;
}

let refs = 0;
/** A thread the sync adds; answers the whole answer. */
async function add(fields: Record<string, unknown> = {}): Promise<Response> {
  refs += 1;
  return call("/threads", { as: "sync", body: { ref: `chat:people-${refs}`, source: "self", title: `Thread ${refs}`, body: `Body ${refs}`, space: "company", status: "act", ...fields } });
}

async function thread(fields: Record<string, unknown> = {}): Promise<number> {
  return (await answer<{ thread: { number: number } }>(await add(fields), 201)).thread.number;
}

/** A told thread; answers the number of the person it is from. */
async function told(name: string, extra: Record<string, unknown> = {}): Promise<number> {
  const added = await answer<{ thread: { senderNumber: number } }>(await add({ source: "told", name, ...extra }), 201);
  return added.thread.senderNumber;
}

async function published(): Promise<number> {
  const n = await thread();
  await answer(await call(`/threads/${n}`, { body: { action: "publish" } }));
  return n;
}

/** A visitor's note on a public thread, sent to its link. */
async function noteOn(number: number, name: string, email: string, body = "A public note."): Promise<void> {
  const row = await (await harness.db()).prepare("SELECT share_key FROM threads WHERE number = ?1").bind(number).first<{ share_key: string }>();
  const response = await harness.fetch(`${THREADS}/api/threads/${row?.share_key ?? number}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: THREADS, "CF-Connecting-IP": network() },
    body: new TextEncoder().encode(JSON.stringify({ body, name, email, token: "pass" })),
  });
  expect(response.status).toBe(201);
}

async function invite(number: number, email: string, name: string): Promise<{ people: { id: string; number: number; name: string }[] }> {
  return answer(await call(`/threads/${number}/people`, { body: { add: { email, name } } }));
}

interface Person {
  number: number;
  name: string | null;
  email: string | null;
  createdAt: string;
  lastContact: string;
  invited: boolean;
  dropped: boolean;
  counts: Record<string, number>;
  note?: string | null;
}

interface OnePerson {
  person: Person;
  threads: { number: number; roles: string[] }[];
  words: { kind: string; thread: { number: number; title: string | null }; body: string; state: string | null; audience: string | null }[];
  truncated: boolean;
}

async function everyone(as: Who = "owner"): Promise<Person[]> {
  return (await answer<{ people: Person[] }>(await call("/people", { as }))).people;
}

async function person(number: number, as: Who = "owner"): Promise<OnePerson> {
  return answer<OnePerson>(await call(`/people/${number}`, { as }));
}

async function count(sql: string): Promise<number> {
  return (await (await harness.db()).prepare(sql).first<{ n: number }>())?.n ?? 0;
}

describe("who is a person", () => {
  it("is one person per address a visitor typed, whatever its case, on a site note and on a public thread alike", async () => {
    const first = await siteNote("Asha", "Asha@Example.com");
    const second = await siteNote("Asha S.", "asha@example.com");
    const open = await published();
    await noteOn(open, "A.", "ASHA@example.COM");
    const people = await everyone();
    expect(people.map((one) => [one.number, one.name, one.email])).toEqual([[1, "Asha", "asha@example.com"]]);
    expect(people[0]?.counts).toEqual({ sent: 2, told: 0, invited: 0, removed: 0, commented: 0, noted: 1, met: 0 });
    // A visitor's typing never renames anyone, and what they typed stays as typed on their note.
    const shown = await answer<{ thread: { senderName: string; senderEmail: string; senderNumber: number } }>(await call(`/threads/${second}`));
    expect([shown.thread.senderName, shown.thread.senderEmail, shown.thread.senderNumber]).toEqual(["Asha S.", "asha@example.com", 1]);
    expect((await answer<{ thread: { senderNumber: number } }>(await call(`/threads/${first}`))).thread.senderNumber).toBe(1);
  });

  it("makes nobody of a note with no address", async () => {
    await siteNote("Shy", "");
    await noteOn(await published(), "Shy", "");
    expect(await everyone()).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM threads WHERE person_id IS NOT NULL")).toBe(0);
  });

  it("joins a told thread to the person the sync names by number, and refuses a number nobody has, writing nothing", async () => {
    await siteNote("Noor", "noor@example.com");
    expect(await told("Nour", { person: 1 })).toBe(1);
    const threadsBefore = await count("SELECT COUNT(*) AS n FROM threads");
    expect(await reasonOf(await add({ source: "told", name: "Someone", person: 9 }))).toEqual([404, "no-person"]);
    expect(await count("SELECT COUNT(*) AS n FROM threads")).toBe(threadsBefore);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(1);
    for (const bad of [0, -1, 1.5, "1", null]) expect(await reasonOf(await add({ source: "told", name: "Dev", person: bad }))).toEqual([400, "person"]);
    // Only a told thread names a teller.
    expect(await reasonOf(await add({ person: 1 }))).toEqual([400, "keys"]);
  });

  it("joins a told name to the one person who has it, ignoring case and spaces, else makes a new person", async () => {
    const dev = await told("Dev K.");
    expect(await told("  dev k. ")).toBe(dev);
    // He gives Dev an address later; the told name still finds him.
    await answer(await call(`/people/${dev}`, { body: { email: "dev@example.org" } }));
    expect(await told("DEV K.")).toBe(dev);
    // Two people named Lin: a told "Lin" is neither, and becomes a third.
    await siteNote("Lin", "lin@example.net");
    await siteNote("Lin", "lin@example.org");
    const lin = await told("Lin");
    expect(lin).toBe(4);
    expect((await person(lin)).person).toMatchObject({ name: "Lin", email: null });
  });

  it("makes nobody when the sync's add answers a thread already there", async () => {
    await answer(await call("/threads", { as: "sync", body: { ref: "recorder:once", source: "told", name: "Ravi", title: "T", body: "B", space: null, status: "received" } }), 201);
    await answer(await call("/threads", { as: "sync", body: { ref: "recorder:once", source: "told", name: "Someone else", title: "T", body: "B", space: null, status: "received" } }), 200);
    expect((await everyone()).map((one) => one.name)).toEqual(["Ravi"]);
  });

  it("lands an invitation on the person who wrote from the site, his typed name winning, their number kept", async () => {
    await siteNote("asha", "asha@example.com");
    const n = await thread();
    const { people } = await invite(n, "Asha@example.com", "Asha S.");
    expect(people.map((one) => [one.number, one.name])).toEqual([[1, "Asha S."]]);
    expect((await everyone()).map((one) => [one.number, one.name, one.invited])).toEqual([[1, "Asha S.", true]]);
    // A new person invited gets the next number.
    expect((await invite(n, MEERA, "Meera")).people.map((one) => one.number)).toEqual([1, 2]);
  });

  it("changes no name anyone else reads when a visitor types an invited person's address", async () => {
    const n = await published();
    await invite(n, MEERA, "Meera");
    await noteOn(n, "Not Meera", "Meera@example.com");
    const note = (await answer<{ comments: { id: string; name: string; personNumber?: number }[] }>(await call(`/threads/${n}`))).comments[0];
    expect([note?.name, note?.personNumber]).toEqual(["Not Meera", 1]);
    const key = (await (await harness.db()).prepare("SELECT share_key FROM threads WHERE number = ?1").bind(n).first<{ share_key: string }>())?.share_key;
    const read = await answer<{ comments: { name: string }[] }>(await harness.fetch(`${THREADS}/api/threads/${key}`));
    expect(read.comments.map((one) => one.name)).toEqual(["Not Meera"]);
    const theirs = await answer<{ comments: Record<string, unknown>[] }>(await call(`/threads/${n}`, { as: { email: MEERA } }));
    expect(theirs.comments).toEqual([expect.objectContaining({ name: "Not Meera" })]);
    expect(theirs.comments[0]).not.toHaveProperty("personNumber");
    // Meera's own comment still shows her name as it stands.
    await answer(await call(`/threads/${n}/comments`, { as: { email: MEERA }, body: { body: "Mine." } }), 201);
    await answer(await call("/people/1", { body: { name: "Meera R." } }));
    const after = await answer<{ comments: { author: string; name: string }[] }>(await call(`/threads/${n}`, { as: { email: MEERA } }));
    expect(after.comments.map((one) => [one.author, one.name])).toEqual([
      ["visitor", "Not Meera"],
      ["member", "Meera R."],
    ]);
  });
});

describe("the people calls", () => {
  it("answer everyone to the owner and the sync, whoever was last in touch first", async () => {
    await siteNote("Asha", "asha@example.com");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await told("Dev");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await invite(await thread(), MEERA, "Meera");
    for (const as of ["owner", "sync"] as const) {
      const people = await everyone(as);
      expect(people.map((one) => one.name)).toEqual(["Meera", "Dev", "Asha"]);
      expect(people[0]).toEqual({
        number: 3,
        name: "Meera",
        email: MEERA,
        photo: null,
        createdAt: expect.any(String),
        lastContact: expect.any(String),
        invited: true,
        dropped: false,
        counts: { sent: 0, told: 0, invited: 1, removed: 0, commented: 0, noted: 0, met: 0 },
      });
    }
  });

  it("answer one person with every thread they are in and how, and what they said, newest first, waiting and dropped marked", async () => {
    const sent = await siteNote("Meera", MEERA, "From the site.");
    const shared = await published();
    await invite(shared, MEERA, "Meera");
    await answer(await call(`/threads/${shared}/comments`, { as: { email: MEERA }, body: { body: "As invited." } }), 201);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const other = await published();
    await noteOn(other, "M", MEERA, "On the thread.");
    const taken = await thread();
    const { people } = await invite(taken, MEERA, "Meera");
    await answer(await call(`/threads/${taken}/people`, { body: { remove: people[0]?.id } }));
    const tellsOf = await told("Meera", { person: 1 });
    expect(tellsOf).toBe(1);

    const one = await person(1);
    expect(one.person).toMatchObject({ number: 1, name: "Meera", email: MEERA, invited: true, dropped: false, note: null });
    expect(one.person.counts).toEqual({ sent: 1, told: 1, invited: 1, removed: 1, commented: 1, noted: 1, met: 0 });
    const roles = Object.fromEntries(one.threads.map((row) => [row.number, row.roles]));
    expect(roles).toEqual({ [sent]: ["sent"], [shared]: ["invited", "wrote"], [other]: ["wrote"], [taken]: ["removed"], [taken + 1]: ["told"] });
    expect(one.threads[0]).toMatchObject({ number: taken + 1, source: "told", senderNumber: 1, ref: expect.any(String) });
    expect(one.words.map((word) => [word.kind, word.body, word.state])).toEqual([
      ["public-note", "On the thread.", "shown"],
      ["comment", "As invited.", "shown"],
      ["note", "From the site.", null],
    ]);
    expect(one.words[0]?.thread.number).toBe(other);
    expect(one.truncated).toBe(false);
    expect((await person(1, "sync")).person.number).toBe(1);
  });

  it("refuse an invited person on every call before anything is read, and a stranger signed out", async () => {
    await invite(await thread(), MEERA, "Meera");
    for (const path of ["/people", "/people/1", "/people/99"]) {
      expect(await reasonOf(await call(path, { as: { email: MEERA } }))).toEqual([403, "owner-only"]);
    }
    for (const path of ["/people/1", "/people/99"]) {
      expect(await reasonOf(await call(path, { as: { email: MEERA }, body: { note: "Mine." } }))).toEqual([403, "owner-only"]);
    }
    const signedOut = await harness.fetch(`${THREADS}/threads/api/people`);
    expect(signedOut.status).toBe(401);
    expect(await count("SELECT COUNT(*) AS n FROM people WHERE note IS NOT NULL")).toBe(0);
  });

  it("refuse a change from the sync, from another site, and a method or query they don't take", async () => {
    await told("Dev");
    expect(await reasonOf(await call("/people/1", { as: "sync", body: { note: "No." } }))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await call("/people/1", { body: { note: "No." }, origin: "https://example.com" }))).toEqual([403, "origin"]);
    expect(await reasonOf(await call("/people/1", { body: { note: "No." }, origin: null }))).toEqual([403, "origin"]);
    expect((await harness.fetch(`${THREADS}/threads/api/people`, { method: "POST", headers: { "Cf-Access-Jwt-Assertion": token("owner"), Origin: THREADS } })).status).toBe(405);
    expect(await reasonOf(await call("/people?x=1"))).toEqual([400, "query"]);
    expect(await reasonOf(await call("/people/abc"))).toEqual([404, "no-person"]);
    expect(await reasonOf(await call("/people/7"))).toEqual([404, "no-person"]);
    expect(await reasonOf(await call("/people/7", { body: { note: "x" } }))).toEqual([404, "no-person"]);
    expect(await count("SELECT COUNT(*) AS n FROM people WHERE note IS NOT NULL")).toBe(0);
  });

  it("let the owner rename a person, keep his notes on them and clear them", async () => {
    await told("dev");
    expect((await answer<{ person: Person }>(await call("/people/1", { body: { name: "  Dev Kumar " } }))).person.name).toBe("Dev Kumar");
    const noted = await answer<{ person: Person }>(await call("/people/1", { body: { note: "Met at the infra meetup.\n\nPrefers async." } }));
    expect(noted.person.note).toBe("Met at the infra meetup.\n\nPrefers async.");
    expect((await person(1)).person.note).toBe("Met at the infra meetup.\n\nPrefers async.");
    expect((await answer<{ person: Person }>(await call("/people/1", { body: { note: "  " } }))).person.note).toBeNull();
    for (const body of [{ name: "" }, { name: "x".repeat(81) }, { note: 3 }, { name: "A", note: "B" }, {}, { nickname: "D" }]) {
      expect(await reasonOf(await call("/people/1", { body }))).toEqual([400, "person"]);
    }
  });

  it("let the owner give a person an address once, lowercased, never one another person holds or his own", async () => {
    await siteNote("Asha", "asha@example.com");
    const noor = await told("Noor");
    expect(await reasonOf(await call(`/people/${noor}`, { body: { email: "not an address" } }))).toEqual([400, "person"]);
    expect(await reasonOf(await call(`/people/${noor}`, { body: { email: OWNER } }))).toEqual([400, "owner"]);
    const taken = await call(`/people/${noor}`, { body: { email: "ASHA@example.com" } });
    expect([taken.status, await taken.json()]).toEqual([409, { reason: "email-taken", number: 1 }]);
    expect((await answer<{ person: Person }>(await call(`/people/${noor}`, { body: { email: "Noor@Example.com" } }))).person.email).toBe("noor@example.com");
    expect(await reasonOf(await call(`/people/${noor}`, { body: { email: "other@example.com" } }))).toEqual([409, "has-email"]);
    // An invitation to that address lands on him.
    const { people } = await invite(await thread(), "noor@example.com", "Noor");
    expect(people.map((one) => one.number)).toEqual([noor]);
  });

  it("mark someone only ever in threads he dropped, until one of them comes back", async () => {
    const junk = await siteNote("Spam", "spam@example.com");
    await siteNote("Asha", "asha@example.com");
    await answer(await call(`/threads/${junk}`, { body: { action: "drop", reason: "spam" } }));
    expect((await everyone()).map((one) => [one.name, one.dropped])).toEqual([
      ["Asha", false],
      ["Spam", true],
    ]);
    await answer(await call(`/threads/${junk}`, { body: { action: "reopen" } }));
    expect((await everyone()).find((one) => one.name === "Spam")?.dropped).toBe(false);
    // A dropped note on a public thread that stays is dropped too.
    const open = await published();
    await noteOn(open, "Lin", "lin@example.net");
    const note = (await answer<{ comments: { id: string }[] }>(await call(`/threads/${open}`))).comments[0];
    await answer(await call(`/threads/${open}/comments/${note?.id ?? ""}`, { body: { action: "drop" } }));
    expect((await everyone()).find((one) => one.name === "Lin")?.dropped).toBe(true);
  });
});

describe("a person in meetings", () => {
  /** A meeting on a new thread with the person numbered `who` in it; answers the thread's number. */
  async function meetingWith(who: number, when: string, fields: Record<string, unknown> = {}): Promise<number> {
    const n = await thread(fields);
    await answer(await call(`/threads/${n}/meeting`, { as: "sync", body: { when, minutes: null, where: null } }));
    await answer(await call(`/threads/${n}/attendees`, { as: "sync", body: { add: { person: who } } }));
    return n;
  }

  it("counts the meetings they are in, and names the role on each thread", async () => {
    const dev = await told("Dev");
    const [a, b] = [await meetingWith(dev, "2026-11-09"), await meetingWith(dev, "2026-11-10T09:30Z")];
    expect((await everyone()).find((one) => one.number === dev)?.counts.met).toBe(2);
    const one = await person(dev);
    expect(one.person.counts.met).toBe(2);
    expect(one.threads.filter((row) => row.number === a || row.number === b).map((row) => row.roles)).toEqual([["met"], ["met"]]);
    // Taken off one, they are in one, and that thread is no longer theirs.
    await answer(await call(`/threads/${a}/attendees`, { as: "sync", body: { remove: dev } }));
    const after = await person(dev);
    expect([after.person.counts.met, after.threads.some((row) => row.number === a)]).toEqual([1, false]);
  });

  it("are in touch at a meeting once it has begun, never at one still to come", async () => {
    const [dev, lin] = [await told("Dev"), await told("Lin")];
    // Everything else about them is long ago, so only a meeting can be their last contact.
    const long = "2026-01-01T00:00:00.000Z";
    const database = await harness.db();
    await database.batch([database.prepare("UPDATE people SET created_at = ?1").bind(long), database.prepare("UPDATE threads SET created_at = ?1").bind(long)]);
    expect((await person(dev)).person.lastContact).toBe(long);
    const hour = 3600 * 1000;
    const past = new Date(Date.now() - hour).toISOString();
    await meetingWith(dev, past);
    await meetingWith(dev, new Date(Date.now() + 24 * hour).toISOString());
    await meetingWith(dev, "2099-01-01");
    expect((await person(dev)).person.lastContact).toBe(past);
    // A day counts from its start in UTC: today has begun, tomorrow hasn't.
    const today = new Date().toISOString().slice(0, 10);
    await meetingWith(lin, new Date(Date.now() + 24 * hour).toISOString().slice(0, 10));
    expect((await person(lin)).person.lastContact).toBe(long);
    await meetingWith(lin, today);
    expect((await person(lin)).person.lastContact).toBe(today);
  });

  it("are live while a meeting of theirs is on a thread he hasn't dropped", async () => {
    const dev = await told("Dev");
    const [toldThread] = (await person(dev)).threads.map((row) => row.number);
    await answer(await call(`/threads/${toldThread ?? 0}`, { body: { action: "drop", reason: "" } }));
    expect((await everyone()).find((one) => one.number === dev)?.dropped).toBe(true);
    const n = await meetingWith(dev, "2026-11-09");
    expect((await everyone()).find((one) => one.number === dev)?.dropped).toBe(false);
    await answer(await call(`/threads/${n}`, { body: { action: "drop", reason: "" } }));
    expect((await everyone()).find((one) => one.number === dev)?.dropped).toBe(true);
  });

  it("is someone new for a name given to a meeting, with no address, and on no other thread", async () => {
    const n = await thread();
    await answer(await call(`/threads/${n}/meeting`, { as: "sync", body: { when: "2026-11-09", minutes: null, where: null } }));
    const added = await answer<{ thread: { meeting: { attendees: { number: number }[] } } }>(await call(`/threads/${n}/attendees`, { as: "sync", body: { add: { name: "Asha's manager" } } }));
    const number = added.thread.meeting.attendees[0]?.number ?? 0;
    const one = await person(number);
    expect(one.person).toMatchObject({ name: "Asha's manager", email: null, invited: false, dropped: false });
    expect(one.person.counts).toEqual({ sent: 0, told: 0, invited: 0, removed: 0, commented: 0, noted: 0, met: 1 });
    expect(one.threads.map((row) => [row.number, row.roles])).toEqual([[n, ["met"]]]);
  });
});

describe("names that open a person", () => {
  it("answer people beside threads in a search for the owner and the sync, by name or address, and never for an invited person", async () => {
    const n = await thread({ title: "Asha's install" });
    await siteNote("Asha", "asha@example.com");
    await invite(n, MEERA, "Meera");
    for (const as of ["owner", "sync"] as const) {
      const found = await answer<{ threads: unknown[]; people: Person[] }>(await call("/search?q=asha", { as }));
      expect(found.people.map((one) => one.name)).toEqual(["Asha"]);
      expect(found.threads).toHaveLength(1);
      expect((await answer<{ people: Person[] }>(await call("/search?q=MEERA%40", { as }))).people.map((one) => one.name)).toEqual(["Meera"]);
    }
    const theirs = await answer<Record<string, unknown>>(await call("/search?q=asha", { as: { email: MEERA } }));
    expect(Object.keys(theirs)).toEqual(["threads"]);
  });

  it("give the owner and the sync the numbers of a thread's sender and people, and an invited person none", async () => {
    await siteNote("Asha", "asha@example.com");
    const n = await thread();
    await invite(n, MEERA, "Meera");
    const owners = await answer<{ thread: Record<string, unknown>; people: Record<string, unknown>[] }>(await call(`/threads/${n}`));
    expect(owners.thread.senderNumber).toBeNull();
    expect(owners.people.map((one) => one.number)).toEqual([2]);
    const theirs = await answer<{ thread: Record<string, unknown>; people: Record<string, unknown>[] }>(await call(`/threads/${n}`, { as: { email: MEERA } }));
    expect(theirs.thread).not.toHaveProperty("senderNumber");
    expect(theirs.people).toEqual([{ name: "Suresh", owner: true }, { name: "Meera", photo: null }]);
    const listed = await answer<{ threads: Record<string, unknown>[] }>(await call("/threads?tab=look"));
    expect(listed.threads.map((one) => one.senderNumber)).toEqual([1]);
  });
});
