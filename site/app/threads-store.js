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

/**
 * @typedef {'look' | 'act' | 'discuss' | 'done'} Tab
 * @typedef {'received' | 'act' | 'discuss' | 'done' | 'dropped' | 'filed'} Status
 * @typedef {{
 *   number: number, id: string, createdAt: string, source: 'talk' | 'told' | 'self' | string, space: string | null,
 *   title: string | null, body: string, summary: string | null, senderName: string | null, senderEmail: string | null,
 *   status: Status, kind: 'feedback' | 'idea' | null, dropReason: string | null, replyOpenedAt: string | null,
 *   ref: string | null, filedLink: string | null, movedAt: string | null, activityAt: string,
 *   main: 'text' | 'page' | 'link', link: { url: string, title: string | null } | null,
 *   shared?: number, waiting?: boolean
 * }} Thread
 * @typedef {{ version: number, savedAt: string, actor: string, bytes: number, source: string | null }} PageVersion
 * @typedef {{ version: number, savedAt: string, source: string | null, versions: PageVersion[] }} Page
 * @typedef {{ id: string, author: 'owner' | 'sync' | 'member' | string, name: string | null, audience: 'thread' | 'owner' | string, body: string, createdAt: string }} Comment
 * @typedef {{ id?: string, name: string | null, email?: string, addedAt?: string, owner?: boolean }} Person
 * @typedef {{ people: Person[], invitedCount: number }} People
 * @typedef {{ caller: 'owner' | 'sync' | 'member', email: string | null }} Me
 * @typedef {{ id: number, at: string, actor: 'owner' | 'sync' | 'visitor' | 'import' | string, type: string, data: Record<string, unknown> }} Event
 * @typedef {{ thread: Thread, page: Page | null, people: Person[], comments: Comment[], events: Event[], truncated: boolean }} Shown
 * @typedef {{ threads: Thread[], counts: Record<Tab, number>, next: number | null }} Listing
 * @typedef {{ action: 'act' | 'discuss' | 'unsort' | 'done' | 'reopen' | 'reply-opened' }
 *   | { action: 'drop', reason: string }
 *   | { action: 'space', space: string }} Action
 * @typedef {'title' | 'summary' | 'body'} Field
 * @typedef {{ title: string, body: string, space: string, status: 'received' | 'act' | 'discuss' }} Start
 */

/** The sign-in has run out, or this browser isn't signed in. */
export class SignedOut extends Error {}

/** Signed in, but nothing is shared with this address now: never invited, or removed from every thread. */
export class NotShared extends Error {}

/** No thread has that number, or this browser may not read it. */
export class Missing extends Error {}

/** The call failed for any other reason: the network, or the server refusing the change. */
export class Failed extends Error {}

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
  if (!response.ok) throw new Failed(reason ?? String(response.status));
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
 * Adds a comment to a thread: for everyone in it, or (`owner`, the owner's alone) for him only.
 * @param {number} number
 * @param {string} body
 * @param {'thread' | 'owner'} audience
 * @returns {Promise<Comment>}
 */
export async function comment(number, body, audience) {
  return /** @type {{ comment: Comment }} */ (await post(`/threads/${number}/comments`, audience === 'owner' ? { body, audience } : { body })).comment;
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
 * Up to 20 threads for a search: the one with that number, or those whose title, summary or text hold the words.
 * @param {string} words
 * @returns {Promise<Thread[]>}
 */
export async function search(words) {
  return /** @type {{ threads: Thread[] }} */ (await call(`/search?${new URLSearchParams({ q: words }).toString()}`, { method: 'GET' })).threads;
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
