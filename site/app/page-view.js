// @ts-check
// How a thread's page is shown (site/app/threads.js draws it): a link to a thread whose main section is a page opens
// the page full screen, so whoever he sends it to reads the message first, with the thread one click away; a thread
// opened inside the app opens in the thread view. Which one a history entry shows is the entry's own: the app writes
// `{ page: 'thread' }` into every entry it makes, and `{ page: 'full' }` when he chooses full screen in place, which a
// reload keeps and a copied address never carries, so the address bar always holds the one link that opens full
// screen. An entry with no choice is an arrival (a link pasted, an invitation, the home page), and opens full screen
// for a page thread, or for any thread at an old `?full` address. `back` marks an entry Thread made on top of the
// page, so Full screen goes back to it rather than growing the history. Plain data and pure functions, so a test can
// read them without a page (test/page-view.test.ts).

/**
 * What a history entry says about the page: full screen or the thread view, and whether Thread made it on top of the
 * page (`back`), so leaving it goes back.
 * @typedef {{ page: 'full' | 'thread', back?: true }} PageState
 */

/**
 * A history entry's state as the site wrote it, or null for anything else (an arrival's null, another page's state).
 * @param {unknown} state
 * @returns {PageState | null}
 */
export function readPageState(state) {
  if (typeof state !== 'object' || state === null || !('page' in state)) return null;
  const page = state.page;
  if (page !== 'full' && page !== 'thread') return null;
  return 'back' in state && state.back === true ? { page, back: true } : { page };
}

/**
 * Whether the page fills the window: the entry's own choice when it made one, else when the address asks for it
 * (`?full`, the old full-screen link) or the thread's main section is a page.
 * @param {{ full: boolean, state: PageState | null, main: string | undefined }} at
 */
export function pageFull({ full, state, main }) {
  if (state !== null) return state.page === 'full';
  return full || main === 'page';
}

/**
 * The button that leaves a visitor's full-screen page for its thread, with the notes a stranger reads there counted
 * in the home page's own word (src/home.ts), and just "Thread" at none.
 * @param {number} notes
 */
export function threadLabel(notes) {
  return notes === 0 ? 'Thread' : `Thread · ${notes} ${notes === 1 ? 'note' : 'notes'}`;
}
