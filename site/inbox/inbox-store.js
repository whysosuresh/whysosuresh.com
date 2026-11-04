// @ts-check
// The inbox's data: the two calls the page makes to the inbox's own routes under /inbox/api/ (src/inbox.ts),
// behind Cloudflare Access. `list` reads one tab, 50 notes at a time; `change` makes one move on one note.
// Every call refuses to follow a redirect: when the sign-in has run out, Access answers with a redirect to its
// sign-in page on another origin, which a followed fetch would report as a network error. A redirect, a 401
// or a 403 is SignedOut, which the page answers with "Your sign-in ended"; anything else that fails is Failed.

/**
 * @typedef {'look' | 'act' | 'discuss' | 'done'} Tab
 * @typedef {'received' | 'act' | 'discuss' | 'done' | 'dropped'} Status
 * @typedef {{
 *   id: string, receivedAt: string, source: string, topic: string | null, body: string,
 *   name: string | null, email: string | null, status: Status, kind: 'feedback' | 'idea' | null,
 *   dropReason: string | null, replyOpenedAt: string | null
 * }} Item
 * @typedef {{ items: Item[], counts: Record<Tab, number>, next: string | null, me: string | null }} Page
 * @typedef {{ action: 'act' | 'discuss' | 'unsort' | 'done' | 'reopen' | 'reply-opened' }
 *   | { action: 'drop', reason: string }
 *   | { action: 'topic', topic: string }} Action
 */

/** The sign-in has run out, or this browser isn't signed in as the inbox's owner. */
export class SignedOut extends Error {}

/** The call failed for any other reason: the network, or the server refusing the move. */
export class Failed extends Error {}

/**
 * @param {string} path
 * @param {RequestInit} init
 * @returns {Promise<unknown>}
 */
async function call(path, init) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(path, { ...init, redirect: 'manual', credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new Failed('network');
  }
  if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403) throw new SignedOut();
  if (!response.ok) throw new Failed(String(response.status));
  try {
    return await response.json();
  } catch {
    throw new Failed('answer');
  }
}

/**
 * One tab's notes, newest first, after the cursor `before` when it is given.
 * @param {Tab} tab
 * @param {string | null} before
 * @returns {Promise<Page>}
 */
export async function list(tab, before) {
  const query = new URLSearchParams({ tab });
  if (before !== null) query.set('before', before);
  return /** @type {Page} */ (await call(`/inbox/api/items?${query.toString()}`, { method: 'GET' }));
}

/**
 * Makes one move on one note, and returns the note as it now is.
 * @param {string} id
 * @param {Action} action
 * @returns {Promise<Item>}
 */
export async function change(id, action) {
  const answer = /** @type {{ item: Item }} */ (
    await call(`/inbox/api/items/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    })
  );
  return answer.item;
}
