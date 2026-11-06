// @ts-check
// The threads' data: every call the threads page makes, to the threads' own calls under /threads/api/
// (src/threads.ts), behind Cloudflare Access. A list reads one tab, 50 threads at a time, newest number first; a
// thread's call answers it with its comments, its history and its people; a move, a comment, a text and a new
// thread each answer what they changed; a search answers up to 20 threads for ⌘K. `me` says who is calling: the
// owner, or a person he invited, whose list is the threads they are in (`listMine`). The owner's people calls read,
// invite and remove the people on a thread. Every call refuses to follow a redirect: when the sign-in has run out,
// Access answers with a redirect to its sign-in page on another origin, which a followed fetch would report as a
// network error. A redirect, a 401 or a 403 with no reason of the Worker's is SignedOut; a 403 `caller` is
// NotShared (signed in, but no thread is shared with this address now); a 404 is Missing (a thread that isn't
// there, or one this browser may not read, which the page shows alike); anything else that fails is Failed, with
// the Worker's reason when it gave one. The page's writes carry JSON, which a form on another site can't send.
//
// A thread Suresh made public is also read with no sign-in, from the public call outside Access (`showPublic`,
// /api/threads/<n>, src/public.ts): what the thread says and the comments written as Public that are shown, in the
// private answer's own field names, so one renderer draws both. Its page loads from the public address too. A visitor
// who answers the page's questions sends their browser's key with the read (`X-Visitor-Key`), so the call says which
// answers are theirs and opens other people's under a question they answered. His ruling on a visitor's note or answer
// (`judge`: drop it, or show it again) is a private call of his own.
//
// Everyone he deals with is a person with a number (src/people.ts): `listPeople` reads everyone, `showPerson` one
// person with their threads and what they said, and `editPerson` changes their name, their address once, or his notes
// on them; an address another person holds is refused as Failed `email-taken`, whose `detail` names that person's
// number. A search answers the people whose name or address holds the words beside the threads, for him alone.
//
// Any thread can be one meeting (`meeting` on every thread: its when, length, where and people): `meet` sets or
// clears it, and `attendee` adds someone by number, or someone new by name, or takes one off; each answers the thread.
//
// One of his own threads whose main section is a page can be an ask, a questions page anyone answers by one link,
// /ask/<slug>, each browser that answers getting a thread of its own (`ask` on every thread says which it is).
// `listAsks` reads every ask for Asks, `askAction` opens, closes or marks an ask's answers read. A visitor reads an ask
// with no sign-in from its public call outside Access (`showAsk`, /api/asks/<slug>, src/asks.ts), sending their
// browser's key so it answers their own answers and nobody else's, and its page loads from that address too. Both
// public reads go through one fetch (`readPublic`).
//
// His journal (src/journal.ts) is read and written under /threads/api/journal: `listJournal` reads every entry's
// newest version, `readJournal` one entry's text with its versions and a day's typed answers, `journalStorylines`
// every storyline's trail. `saveJournal` saves his hand edit on the version it was opened at; a save the sync has
// since overtaken is refused as Failed `stale`, whose `detail` names the newest version, and nothing is written.
// `answerJournal` keeps a typed answer to a day's question. A photo loads from its own address (`journalPhoto`).
//
// His home page shows the threads he posts there (`feedAt` on every thread, set by the `post` move and cleared by
// `unpost` or `unpublish`) under his Now line, one line he sets from Today: `readNow` and `saveNow` (/threads/api/now,
// src/home.ts), his alone; an empty line takes it off the home page.

/**
 * @typedef {'look' | 'act' | 'discuss' | 'done'} Tab
 * @typedef {'received' | 'act' | 'discuss' | 'done' | 'dropped' | 'filed'} Status
 * @typedef {{
 *   number: number, id: string, createdAt: string, source: 'talk' | 'told' | 'self' | string, space: string | null,
 *   title: string | null, body: string, summary: string | null, senderName: string | null, senderEmail: string | null,
 *   status: Status, kind: 'feedback' | 'idea' | null, dropReason: string | null, replyOpenedAt: string | null,
 *   ref: string | null, filedLink: string | null, movedAt: string | null, activityAt: string,
 *   main: 'text' | 'page' | 'link', link: { url: string, title: string | null } | null, publicAt: string | null,
 *   feedAt?: string | null, senderNumber?: number | null, shared?: number, waiting?: boolean,
 *   meeting?: import('./meetings.js').Meeting | null, ask?: AskMark | null
 * }} Thread
 * @typedef {'draft' | 'open' | 'closed'} AskState
 * @typedef {{ slug: string, state: AskState } | { number?: number, slug: string, title: string | null }} AskMark
 *   What a thread says about asks: on an ask's own thread its slug and state; on a response thread the ask it answers
 *   (its number for the owner alone).
 * @typedef {{ number: number, name: string | null, at: string, waiting: boolean }} Answerer
 * @typedef {{ number: number, title: string | null, slug: string, state: AskState, answered: number, lastAnsweredAt: string | null, topic: string | null }} Ask
 * @typedef {{ ask: { slug: string, title: string | null, state: AskState }, page: PublicPage | null, answers: { question: string, body: string, at: string }[] }} AskShown
 * @typedef {{ version: number, savedAt: string, actor: string, bytes: number, source: string | null }} PageVersion
 * @typedef {{ version: number, savedAt: string, source: string | null, versions: PageVersion[] }} Page
 * @typedef {'thread' | 'owner' | 'public'} Audience
 * @typedef {{
 *   id: string, author: 'owner' | 'sync' | 'member' | 'visitor' | string, name: string | null, audience: Audience | string,
 *   state: 'shown' | 'dropped' | string, body: string, createdAt: string, senderEmail?: string | null,
 *   personNumber?: number, parent?: string | null, question?: string | null, quote?: Quote | null, mine?: boolean,
 *   visitor?: string
 * }} Comment
 * @typedef {{ text: string, prefix: string, suffix: string, version: number }} Quote
 * @typedef {{ parent: string } | { question: string } | { quote: string, prefix: string, suffix: string, version: number }} Place
 * @typedef {{
 *   number: number, title: string | null, summary: string | null, space: string | null, main: 'text' | 'page' | 'link',
 *   body: string | null, link: { url: string, title: string | null } | null, createdAt: string
 * }} PublicThread
 * @typedef {{ version: number, savedAt: string, versions: { version: number, savedAt: string }[] }} PublicPage
 * @typedef {{ author: 'owner' | 'member' | 'visitor' | string, name: string | null, body: string, createdAt: string, question?: string | null, mine?: boolean }} PublicComment
 * @typedef {{ thread: PublicThread, page: PublicPage | null, comments: PublicComment[], truncated: boolean }} PublicShown
 * @typedef {'show' | 'drop'} Judgement
 * @typedef {{ id?: string, number?: number, name: string | null, email?: string, addedAt?: string, owner?: boolean }} Person
 * @typedef {{ sent: number, told: number, invited: number, removed: number, commented: number, noted: number, met?: number }} Counts
 * @typedef {{
 *   number: number, name: string | null, email: string | null, createdAt: string, lastContact: string,
 *   invited: boolean, dropped: boolean, counts: Counts, note?: string | null
 * }} Someone
 * @typedef {Thread & { roles: string[] }} TheirThread
 * @typedef {{
 *   kind: 'note' | 'comment' | 'public-note' | 'answer', thread: { number: number, title: string | null }, body: string, at: string,
 *   state: string | null, audience: string | null
 * }} Said
 * @typedef {{ person: Someone, threads: TheirThread[], words: Said[], truncated: boolean }} PersonShown
 * @typedef {{ name: string } | { email: string } | { note: string }} PersonChange
 * @typedef {{ threads: Thread[], people: Someone[] }} Found
 * @typedef {{ people: Person[], invitedCount: number }} People
 * @typedef {{ caller: 'owner' | 'sync' | 'member', email: string | null }} Me
 * @typedef {{ id: number, at: string, actor: 'owner' | 'sync' | 'visitor' | 'import' | string, type: string, data: Record<string, unknown> }} Event
 * @typedef {{ thread: Thread, page: Page | null, people: Person[], comments: Comment[], events: Event[], truncated: boolean, answeredBy?: Answerer[] }} Shown
 * @typedef {{ threads: Thread[], counts: Record<Tab, number>, next: number | null }} Listing
 * @typedef {{ action: 'act' | 'discuss' | 'unsort' | 'done' | 'reopen' | 'reply-opened' | 'publish' | 'unpublish' | 'post' | 'unpost' }
 *   | { action: 'drop', reason: string }
 *   | { action: 'space', space: string }} Action
 * @typedef {'title' | 'summary' | 'body'} Field
 * @typedef {{ title: string, body: string, space: string, status: 'received' | 'act' | 'discuss' }} Start
 * @typedef {{ key: string, kind: 'day' | 'week', version: number, savedAt: string, title: string, oneLine: string | null,
 *   stories: number, photos: number, question: string | null }} JournalEntry
 * @typedef {{ id: number, body: string, createdAt: string }} JournalAnswer
 * @typedef {{ key: string, kind: 'day' | 'week', version: number, newest: number, text: string, savedAt: string, actor: string,
 *   versions: { version: number, savedAt: string, actor: string, bytes: number }[], answers: JournalAnswer[] }} JournalRead
 * @typedef {{ key: string, state: string, mark: 'new' | 'closed' | null }} JournalTouch
 * @typedef {{ name: string, first: string, last: string, state: string, mark: 'new' | 'closed' | null, days: JournalTouch[] }} JournalTrail
 * @typedef {{ text: string, setAt: string }} NowLine the line under his greeting on the home page, and when he set it
 */

/** The sign-in has run out, or this browser isn't signed in. */
export class SignedOut extends Error {}

/** Signed in, but nothing is shared with this address now: never invited, or removed from every thread. */
export class NotShared extends Error {}

/** No thread has that number, or this browser may not read it. */
export class Missing extends Error {}

/** The call failed for any other reason: the network, or the server refusing the change. */
export class Failed extends Error {
  /**
   * @param {string} reason
   * @param {unknown} [detail] the Worker's whole answer, when it gave one
   */
  constructor(reason, detail) {
    super(reason);
    this.detail = detail;
  }
}

const API = '/threads/api';

/**
 * @param {string} path
 * @param {RequestInit} init
 * @returns {Promise<unknown>}
 */
async function call(path, init) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(`${API}${path}`, { ...init, redirect: 'manual', credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new Failed('network');
  }
  if (response.type === 'opaqueredirect' || response.status === 401) throw new SignedOut();
  /** @type {unknown} */
  let answer;
  try {
    answer = await response.json();
  } catch {
    if (response.status === 403) throw new SignedOut();
    throw new Failed(response.ok ? 'answer' : String(response.status));
  }
  const reason = typeof answer === 'object' && answer !== null && 'reason' in answer && typeof answer.reason === 'string' ? answer.reason : null;
  if (response.status === 403 && reason === 'caller') throw new NotShared();
  if (response.status === 403 && (reason === null || reason === 'token' || reason === 'sign-in')) throw new SignedOut();
  if (response.status === 404) throw new Missing();
  if (!response.ok) throw new Failed(reason ?? String(response.status), answer);
  return answer;
}

/**
 * @param {string} path
 * @param {unknown} body
 */
function post(path, body) {
  return call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/**
 * One tab's threads, newest number first, below the number `before` when it is given.
 * @param {Tab} tab
 * @param {number | null} before
 * @returns {Promise<Listing>}
 */
export async function list(tab, before) {
  const query = new URLSearchParams({ tab });
  if (before !== null) query.set('before', String(before));
  return /** @type {Listing} */ (await call(`/threads?${query.toString()}`, { method: 'GET' }));
}

/**
 * Who is calling: the owner, or a person he invited, with the address they signed in with.
 * @returns {Promise<Me>}
 */
export async function me() {
  return /** @type {Me} */ (await call('/me', { method: 'GET' }));
}

/**
 * An invited person's threads: every one they are in, most recently active first.
 * @returns {Promise<Thread[]>}
 */
export async function listMine() {
  return /** @type {{ threads: Thread[] }} */ (await call('/threads', { method: 'GET' })).threads;
}

/**
 * Every thread in a tab, page after page, with the tab counts from the last page.
 * @param {Tab} tab
 * @returns {Promise<Listing>}
 */
export async function listAll(tab) {
  let page = await list(tab, null);
  const threads = [...page.threads];
  while (page.next !== null) {
    page = await list(tab, page.next);
    threads.push(...page.threads);
  }
  return { ...page, threads, next: null };
}

/**
 * A thread with its comments and history, oldest first.
 * @param {number} number
 * @returns {Promise<Shown>}
 */
export async function show(number) {
  return /** @type {Shown} */ (await call(`/threads/${number}`, { method: 'GET' }));
}

/**
 * Starts a thread of his own, and answers it as kept.
 * @param {Start} start
 * @returns {Promise<Thread>}
 */
export async function start(start) {
  return /** @type {{ thread: Thread }} */ (await post('/threads', start)).thread;
}

/**
 * Makes one move on one thread, and answers the thread as it now is.
 * @param {number} number
 * @param {Action} action
 * @returns {Promise<Thread>}
 */
export async function move(number, action) {
  return /** @type {{ thread: Thread }} */ (await post(`/threads/${number}`, action)).thread;
}

/**
 * Adds a comment to a thread: for everyone in it, for him only (`owner`, the owner's alone), or on a public thread
 * for anyone (`public`); or one that sits somewhere (`Place`): under another comment, in its audience, as an answer to
 * the page's question, or on words of a version of the page, each for everyone in the thread.
 * @param {number} number
 * @param {string} body
 * @param {Audience | Place} place
 * @returns {Promise<Comment>}
 */
export async function comment(number, body, place) {
  const sent = typeof place === 'string' ? (place === 'thread' ? { body } : { body, audience: place }) : { body, ...place };
  return /** @type {{ comment: Comment }} */ (await post(`/threads/${number}/comments`, sent)).comment;
}

/**
 * His ruling on a visitor's note or answer: dropped, or shown again; answers it as it now is.
 * @param {number} number
 * @param {string} note
 * @param {Judgement} action
 * @returns {Promise<Comment>}
 */
export async function judge(number, note, action) {
  return /** @type {{ comment: Comment }} */ (await post(`/threads/${number}/comments/${encodeURIComponent(note)}`, { action })).comment;
}

/**
 * One of the public calls outside Access, read with no sign-in and no cookie: Missing for a 404, which is what every
 * public call answers for anything it won't say. `key` is the visitor's browser's key, when it has one.
 * @param {string} path
 * @param {string | null} key
 * @returns {Promise<unknown>}
 */
async function readPublic(path, key) {
  /** @type {Response} */
  let response;
  try {
    /** @type {Record<string, string>} */
    const headers = key === null ? {} : { 'X-Visitor-Key': key };
    response = await fetch(path, { redirect: 'manual', credentials: 'omit', cache: 'no-store', headers });
  } catch {
    throw new Failed('network');
  }
  if (response.status === 404) throw new Missing();
  if (!response.ok) throw new Failed(String(response.status));
  try {
    return /** @type {unknown} */ (await response.json());
  } catch {
    throw new Failed('answer');
  }
}

/**
 * A public thread, as anyone reads it with no sign-in: Missing for any number that isn't one. `key` is the visitor's
 * browser's key, when it has one, which the call reads to say which answers are theirs.
 * @param {number} number
 * @param {string | null} key
 * @returns {Promise<PublicShown>}
 */
export async function showPublic(number, key) {
  return /** @type {PublicShown} */ (await readPublic(`/api/threads/${number}`, key));
}

/**
 * An ask, as anyone reads it with no sign-in: its title, state and page, and this browser's own answers (by `key`);
 * Missing for a draft and a slug no ask has.
 * @param {string} slug
 * @param {string} key
 * @returns {Promise<AskShown>}
 */
export async function showAsk(slug, key) {
  return /** @type {AskShown} */ (await readPublic(`/api/asks/${encodeURIComponent(slug)}`, key));
}

/**
 * The address an ask's page frame loads one version from, outside Access, sealed as every page is.
 * @param {string} slug
 * @param {number} version
 */
export function askPageAddress(slug, version) {
  return `/api/asks/${encodeURIComponent(slug)}/pages/${version}`;
}

/**
 * Every ask, drafts first, with how many answered and when last, and the Send a note topic that opens it.
 * @returns {Promise<Ask[]>}
 */
export async function listAsks() {
  return /** @type {{ asks: Ask[] }} */ (await call('/asks', { method: 'GET' })).asks;
}

/**
 * Opens an ask (a draft, or one closed), or closes one, and answers its thread as it now is.
 * @param {number} number
 * @param {'open' | 'close'} action
 * @returns {Promise<Thread>}
 */
export async function askAction(number, action) {
  return /** @type {{ thread: Thread }} */ (await post(`/threads/${number}/ask`, { action })).thread;
}

/**
 * Marks an ask's answers read: each response thread that waits on him stops waiting. Answers how many it marked.
 * @param {number} number
 * @returns {Promise<number>}
 */
export async function markAskRead(number) {
  return /** @type {{ marked: number }} */ (await post(`/threads/${number}/ask`, { action: 'read' })).marked;
}

/**
 * The address a public thread's page frame loads one version from, outside Access, sealed as the private one is.
 * @param {number} number
 * @param {number} version
 */
export function publicPageAddress(number, version) {
  return `/api/threads/${number}/pages/${version}`;
}

/**
 * The people a thread is shared with, and how many people have access to any of his threads.
 * @param {number} number
 * @returns {Promise<People>}
 */
export async function people(number) {
  return /** @type {People} */ (await call(`/threads/${number}/people`, { method: 'GET' }));
}

/**
 * Invites a person to a thread by their address and name, and answers its people as they now stand.
 * @param {number} number
 * @param {string} email
 * @param {string} name
 * @returns {Promise<People>}
 */
export async function invite(number, email, name) {
  return /** @type {People} */ (await post(`/threads/${number}/people`, { add: { email, name } }));
}

/**
 * Takes back a person's invitation to a thread, and answers its people as they now stand.
 * @param {number} number
 * @param {string} person
 * @returns {Promise<People>}
 */
export async function uninvite(number, person) {
  return /** @type {People} */ (await post(`/threads/${number}/people`, { remove: person }));
}

/**
 * Sets a thread's meeting (a day, or a moment with its offset, with a length and a where), or clears it with `when`
 * null, which takes its people off too; answers the thread as it now is.
 * @param {number} number
 * @param {{ when: string | null, minutes: number | null, where: string | null }} meeting
 * @returns {Promise<Thread>}
 */
export async function meet(number, meeting) {
  return /** @type {{ thread: Thread }} */ (await post(`/threads/${number}/meeting`, meeting)).thread;
}

/**
 * Changes a meeting's people: someone known by their number, someone new by a name, or one taken off by number;
 * answers the thread as it now is.
 * @param {number} number
 * @param {{ add: { person: number } | { name: string } } | { remove: number }} change
 * @returns {Promise<Thread>}
 */
export async function attendee(number, change) {
  return /** @type {{ thread: Thread }} */ (await post(`/threads/${number}/attendees`, change)).thread;
}

/**
 * Replaces a thread's title, summary (empty clears it) or main text, and answers the thread as it now is.
 * @param {number} number
 * @param {Field} field
 * @param {string} text
 * @returns {Promise<Thread>}
 */
export async function edit(number, field, text) {
  return /** @type {{ thread: Thread }} */ (await post(`/threads/${number}/text`, { field, text })).thread;
}

/**
 * Up to 20 threads for a search (the one with that number, or those whose title, summary or text hold the words), and
 * for him up to 20 people whose name or address holds them; an invited person's answer has no people.
 * @param {string} words
 * @returns {Promise<Found>}
 */
export async function search(words) {
  const found = /** @type {{ threads: Thread[], people?: Someone[] }} */ (await call(`/search?${new URLSearchParams({ q: words }).toString()}`, { method: 'GET' }));
  return { threads: found.threads, people: found.people ?? [] };
}

/**
 * Everyone he deals with, whoever was last in touch first.
 * @returns {Promise<Someone[]>}
 */
export async function listPeople() {
  return /** @type {{ people: Someone[] }} */ (await call('/people', { method: 'GET' })).people;
}

/**
 * One person by their number, with every thread they are in and what they said, newest first.
 * @param {number} number
 * @returns {Promise<PersonShown>}
 */
export async function showPerson(number) {
  return /** @type {PersonShown} */ (await call(`/people/${number}`, { method: 'GET' }));
}

/**
 * Changes a person: their name, their address while they have none, or his notes on them (empty clears them).
 * @param {number} number
 * @param {PersonChange} change
 * @returns {Promise<Someone>}
 */
export async function editPerson(number, change) {
  return /** @type {{ person: Someone }} */ (await post(`/people/${number}`, change)).person;
}

/**
 * The address a page's frame loads one version from: the thread's own call, sealed by its answer's headers.
 * @param {number} number
 * @param {number} version
 */
export function pageAddress(number, version) {
  return `${API}/threads/${number}/pages/${version}`;
}

/**
 * Where a signed-out reader goes to sign in: Access signs them in at the edge, and the call sends them back to `path`.
 * @param {string} path
 */
export function signInAddress(path) {
  return `${API}/sign-in?${new URLSearchParams({ next: path }).toString()}`;
}

/** Every journal entry's newest version, newest first. @returns {Promise<JournalEntry[]>} */
export async function listJournal() {
  return /** @type {{ entries: JournalEntry[] }} */ (await call('/journal', { method: 'GET' })).entries;
}

/** One journal entry: its newest text, every version, and a day's typed answers. @param {string} key @returns {Promise<JournalRead>} */
export async function readJournal(key) {
  return /** @type {JournalRead} */ (await call(`/journal/${key}`, { method: 'GET' }));
}

/**
 * His hand edit of an entry, saved on the version it was opened at; Failed `stale` when the sync saved since.
 * @param {string} key @param {string} text @param {number} base
 * @returns {Promise<number>} the version it was saved as
 */
export async function saveJournal(key, text, base) {
  return /** @type {{ version: number }} */ (await post(`/journal/${key}`, { text, base })).version;
}

/** A typed answer to a day's question; an empty one takes it back. @param {string} key @param {string} body @returns {Promise<JournalAnswer>} */
export async function answerJournal(key, body) {
  return /** @type {{ answer: JournalAnswer }} */ (await post(`/journal/${key}/answers`, { body })).answer;
}

/** Every storyline's trail across the days. @returns {Promise<JournalTrail[]>} */
export async function journalStorylines() {
  return /** @type {{ storylines: JournalTrail[] }} */ (await call('/journal/storylines', { method: 'GET' })).storylines;
}

/** The address a journal photo loads from, behind the same sign-in as every call. @param {string} id */
export function journalPhoto(id) {
  return `${API}/journal/photos/${id}`;
}

/** The Now line on his home page, or null when there is none. @returns {Promise<NowLine | null>} */
export async function readNow() {
  return /** @type {{ now: NowLine | null }} */ (await call('/now', { method: 'GET' })).now;
}

/** Sets the Now line; an empty one takes it off the home page. @param {string} text @returns {Promise<NowLine | null>} */
export async function saveNow(text) {
  return /** @type {{ now: NowLine | null }} */ (await post('/now', { text })).now;
}
