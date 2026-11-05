// @ts-check
// Every visitor note's sender: the bot check and the upload. talk.js sends a note about a topic (send(), to
// /api/talk); the threads page sends a note on a public thread (sendTo(), to /api/threads/<n>/notes, which waits
// for his OK). Both share one budget on the server and one sender here. prepare() starts loading Cloudflare's
// Turnstile when a note opens, so nobody who only looks loads it and it is ready long before Send. Each send gets a
// fresh token from the invisible widget and posts the note as JSON. The widget runs only at Send, because a token
// lasts 5 minutes and writing a note can outlast one.

/**
 * @typedef {{ topic: string, body: string, name: string, email: string }} Note
 * @typedef {{
 *   render(container: HTMLElement, options: Record<string, unknown>): string,
 *   execute(widget: string): void,
 *   reset(widget: string): void,
 * }} Turnstile
 * @typedef {{ resolve(token: string): void, reject(error: Error): void }} Waiting
 * @typedef {{ id: string, waiting: Waiting | null }} Widget
 */

/** The production widget's public key; it works only on whysosuresh.com. */
const SITE_KEY = '0x4AAAAAAFy5WgjeTVHRB3R9';

/** Cloudflare's public test key for an invisible widget that always passes, for runs on this machine. */
const TEST_SITE_KEY = '1x00000000000000000000BB';

/** Turnstile's script, from the one address Cloudflare supports: never proxied, never copied. */
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** How long Send waits for a token before calling the send failed. */
const TOKEN_TIMEOUT_MS = 30000;

/**
 * @param {string} message
 * @param {string} reason
 */
function failure(message, reason) {
  return Object.assign(new Error(message), { reason });
}

function siteKey() {
  return ['localhost', '127.0.0.1'].includes(location.hostname) ? TEST_SITE_KEY : SITE_KEY;
}

/** @type {Promise<Turnstile> | null} */
let turnstileLoading = null;

/** Loads Turnstile's script once; a failed load is tried again at the next call. */
function loadTurnstile() {
  turnstileLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.addEventListener('load', () => {
      const turnstile = /** @type {{ turnstile?: Turnstile }} */ (/** @type {unknown} */ (window)).turnstile;
      if (turnstile) resolve(turnstile);
      else reject(new Error('Turnstile loaded without its API'));
    });
    script.addEventListener('error', () => {
      script.remove();
      turnstileLoading = null;
      reject(new Error("Turnstile's script did not load"));
    });
    document.head.append(script);
  });
  return turnstileLoading;
}

/** @type {Widget | null} */
let widget = null;

/**
 * A fresh token from the invisible widget, which is rendered once and run on each call.
 * @returns {Promise<string>}
 */
async function token() {
  const turnstile = await loadTurnstile();
  if (!widget) {
    const box = document.createElement('div');
    document.body.append(box);
    /** @type {Widget} */
    const state = { id: '', waiting: null };
    state.id = turnstile.render(box, {
      sitekey: siteKey(),
      action: 'talk',
      execution: 'execute',
      callback: (/** @type {string} */ value) => state.waiting?.resolve(value),
      'error-callback': () => {
        state.waiting?.reject(new Error('The bot check failed.'));
        return true;
      },
      'timeout-callback': () => state.waiting?.reject(new Error('The bot check timed out.')),
    });
    widget = state;
  }
  const current = widget;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The bot check took too long.')), TOKEN_TIMEOUT_MS);
    current.waiting = {
      resolve: (value) => {
        clearTimeout(timer);
        current.waiting = null;
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        current.waiting = null;
        reject(error);
      },
    };
    turnstile.execute(current.id);
  });
}

/** Clears the widget's last token, so the next send asks for a new one. */
function resetWidget() {
  const turnstile = /** @type {{ turnstile?: Turnstile }} */ (/** @type {unknown} */ (window)).turnstile;
  if (widget && turnstile) turnstile.reset(widget.id);
}

/** Starts loading the bot check while the visitor writes; Send loads it again if this load fails. */
export function prepare() {
  loadTurnstile().catch(() => {
    // Send tries again, and fails there if it still can't.
  });
}

/**
 * Sends a note's fields, with a fresh bot-check token, to one of the site's note addresses. Fails with reason
 * `limit` when today's limit is reached, `gone` when the address answers that there is nothing there (a thread no
 * longer public), and `failed` for anything else, which keeps the note on screen to send again.
 * @param {string} address
 * @param {Record<string, string>} fields
 * @returns {Promise<void>}
 */
export async function sendTo(address, fields) {
  /** @type {Response} */
  let response;
  try {
    const body = JSON.stringify({ ...fields, token: await token() });
    response = await fetch(address, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  } catch (err) {
    throw failure(err instanceof Error ? err.message : "That didn't send.", 'failed');
  } finally {
    resetWidget();
  }
  if (response.status === 429) throw failure("Today's limit is reached.", 'limit');
  if (response.status === 404) throw failure('There is nothing to send this to now.', 'gone');
  if (response.status !== 201) throw failure("That didn't send.", 'failed');
}

/**
 * Sends a note to Suresh about one of his topics.
 * @param {Note} note
 * @returns {Promise<void>}
 */
export async function send(note) {
  await sendTo('/api/talk', { topic: note.topic, body: note.body, name: note.name, email: note.email });
}
