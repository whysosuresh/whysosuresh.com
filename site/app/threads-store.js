// @ts-check
// The threads' data: every call the threads page makes, to the threads' own calls under /threads/api/
// (src/threads.ts), behind Cloudflare Access. A list reads one tab, 50 threads at a time, newest number first; a
// thread's call answers it with its comments and its history; a move, a comment, a text and a new thread each
// answer what they changed; a search answers up to 20 threads for ⌘K. Every call refuses to follow a redirect:
// when the sign-in has run out, Access answers with a redirect to its sign-in page on another origin, which a
// followed fetch would report as a network error. A redirect, a 401 or a 403 is SignedOut; a 404 is Missing (a
// thread that isn't there, or one this browser may not read, which the page shows alike); anything else that
// fails is Failed. The page's writes carry JSON, which a form on another site can't send.

/**
 * @typedef {'look' | 'act' | 'discuss' | 'done'} Tab
 * @typedef {'received' | 'act' | 'discuss' | 'done' | 'dropped' | 'filed'} Status
 * @typedef {{
 *   number: number, id: string, createdAt: string, source: 'talk' | 'told' | 'self' | string, space: string | null,
 *   title: string | null, body: string, summary: string | null, senderName: string | null, senderEmail: string | null,
 *   status: Status, kind: 'feedback' | 'idea' | null, dropReason: string | null, replyOpenedAt: string | null,
 *   ref: string | null, filedLink: string | null, movedAt: string | null, activityAt: string,
 *   main: 'text' | 'page' | 'link', link: { url: string, title: string | null } | null
 * }} Thread
 * @typedef {{ version: number, savedAt: string, actor: string, bytes: number, source: string | null }} PageVersion
 * @typedef {{ version: number, savedAt: string, source: string | null, versions: PageVersion[] }} Page
 * @typedef {{ id: string, author: 'owner' | 'sync' | string, body: string, createdAt: string }} Comment
 * @typedef {{ id: number, at: string, actor: 'owner' | 'sync' | 'visitor' | 'import' | string, type: string, data: Record<string, unknown> }} Event
 * @typedef {{ thread: Thread, page: Page | null, comments: Comment[], events: Event[], truncated: boolean }} Shown
 * @typedef {{ threads: Thread[], counts: Record<Tab, number>, next: number | null, me: string | null }} Listing
 * @typedef {{ action: 'act' | 'discuss' | 'unsort' | 'done' | 'reopen' | 'reply-opened' }
 *   | { action: 'drop', reason: string }
 *   | { action: 'space', space: string }} Action
 * @typedef {'title' | 'summary' | 'body'} Field
 * @typedef {{ title: string, body: string, space: string, status: 'received' | 'act' | 'discuss' }} Start
 */

/** The sign-in has run out, or this browser isn't signed in as the threads' owner. */
export class SignedOut extends Error {}

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
  if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403) throw new SignedOut();
  if (response.status === 404) throw new Missing();
  if (!response.ok) throw new Failed(String(response.status));
  try {
    return await response.json();
  } catch {
    throw new Failed('answer');
  }
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
 * Every thread in a tab, page after page, with the tab counts and the owner's address from the last page.
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
 * Adds his comment to a thread.
 * @param {number} number
 * @param {string} body
 * @returns {Promise<Comment>}
 */
export async function comment(number, body) {
  return /** @type {{ comment: Comment }} */ (await post(`/threads/${number}/comments`, { body })).comment;
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
 * Where a signed-out owner goes to sign in: Access signs him in at the edge, and the call sends him back to `path`.
 * @param {string} path
 */
export function signInAddress(path) {
  return `${API}/sign-in?${new URLSearchParams({ next: path }).toString()}`;
}
