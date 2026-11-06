// @ts-check
// Where a thread stands, as one map that the threads page (site/app/threads.js), the Worker (src/store.ts) and the
// inbox's command line (tools/inbox/run.ts) all read, so a list never means two things. A thread's status is one of
// six; the server answers a list by name (`LISTS`): every open thread (pending), each open status alone (look, act,
// discuss, which the recorder sync still reads) and every closed one (done). The page shows two tabs, Pending and
// Done; Pending carries a line of counts (2 new · 5 to do · 3 to discuss) that filters it to one open status, and
// each row a tag saying where it stands. An address keeps its meaning across that change: an old /threads/?tab=discuss
// opens Pending showing To discuss only. Pending is newest number first; Done is most recently closed first, by when
// the thread last moved (or arrived, when it never moved). Plain data and pure functions, with no page and no clock,
// so a test reads them without a page and the Worker type-checks them with no browser library.

/**
 * @typedef {'received' | 'act' | 'discuss' | 'done' | 'dropped' | 'filed'} Status
 * @typedef {'received' | 'act' | 'discuss'} Open
 * @typedef {'pending' | 'done'} Tab
 * @typedef {keyof typeof LISTS} List
 * @typedef {{ number: number, status: Status, createdAt: string, movedAt: string | null }} Placed
 * @typedef {{ status: Status, words: string }} Tag
 */

/** Every list the server answers, and the statuses each holds. */
export const LISTS = Object.freeze({
  pending: /** @type {readonly Status[]} */ (Object.freeze(['received', 'act', 'discuss'])),
  look: /** @type {readonly Status[]} */ (Object.freeze(['received'])),
  act: /** @type {readonly Status[]} */ (Object.freeze(['act'])),
  discuss: /** @type {readonly Status[]} */ (Object.freeze(['discuss'])),
  done: /** @type {readonly Status[]} */ (Object.freeze(['done', 'dropped', 'filed'])),
});

/** The open statuses, in the order sorting goes: new, then to do, then to discuss. */
/** @type {readonly Open[]} */
export const OPEN = Object.freeze(['received', 'act', 'discuss']);

/** The tabs the page shows. */
/** @type {readonly Tab[]} */
export const TABS = Object.freeze(['pending', 'done']);

/** @type {Readonly<Record<Tab, string>>} */
export const TAB_NAMES = Object.freeze({ pending: 'Pending', done: 'Done' });

/** What the page calls each status, everywhere it names one. */
/** @type {Readonly<Record<Status, string>>} */
export const STATUS_NAMES = Object.freeze({ received: 'New', act: 'To do', discuss: 'To discuss', done: 'Done', dropped: 'Dropped', filed: 'Filed' });

/** Each open status as the counts line says it after its number. */
/** @type {Readonly<Record<Open, string>>} */
const COUNT_NAMES = Object.freeze({ received: 'new', act: 'to do', discuss: 'to discuss' });

/** The old tabs an address may still name, and the open status each showed. */
/** @type {Readonly<Record<string, Open>>} */
const OLD_TABS = Object.freeze({ look: 'received', act: 'act', discuss: 'discuss' });

/** @param {string} value @returns {value is List} */
export function isList(value) {
  return Object.hasOwn(LISTS, value);
}

/** @param {string} value @returns {value is Tab} */
function isTab(value) {
  return /** @type {readonly string[]} */ (TABS).includes(value);
}

/** @param {string} value @returns {value is Open} */
function isOpenStatus(value) {
  return /** @type {readonly string[]} */ (OPEN).includes(value);
}

/** The tab a status sits in. @param {Status} status @returns {Tab} */
export function tabOf(status) {
  return /** @type {readonly Status[]} */ (OPEN).includes(status) ? 'pending' : 'done';
}

/**
 * Whether a thread of `status` is listed on `tab` with the counts line's filter `only`, which narrows Pending alone.
 * @param {Tab} tab
 * @param {Open | null} only
 * @param {Status} status
 */
export function shows(tab, only, status) {
  if (tabOf(status) !== tab) return false;
  return tab !== 'pending' || only === null || status === only;
}

/**
 * The tab and filter an address asks for. An old tab (look, act, discuss) opens Pending filtered to what it showed;
 * a filter rides only on Pending; anything else is Pending, unfiltered.
 * @param {URLSearchParams} query
 * @returns {{ tab: Tab, only: Open | null }}
 */
export function routeTab(query) {
  const tab = query.get('tab') ?? '';
  const old = Object.hasOwn(OLD_TABS, tab) ? OLD_TABS[tab] : undefined;
  if (old !== undefined) return { tab: 'pending', only: old };
  if (tab === 'done') return { tab: 'done', only: null };
  const only = query.get('only') ?? '';
  return { tab: 'pending', only: isOpenStatus(only) ? only : null };
}

/**
 * The list's address: /threads/ for Pending unfiltered in every space, else its tab, filter and space as a query.
 * @param {Tab} tab
 * @param {Open | null} only
 * @param {string | null} space
 */
export function listPath(tab, only, space) {
  const query = new URLSearchParams();
  if (tab !== 'pending') query.set('tab', tab);
  else if (only !== null) query.set('only', only);
  if (space !== null) query.set('space', space);
  const said = query.toString();
  return said === '' ? '/threads/' : `/threads/?${said}`;
}

/**
 * A tab's threads in its order, as a new array: Pending newest number first; Done most recently closed first, by
 * when it last moved or else when it arrived, the newer number first on a tie.
 * @template {Placed} T
 * @param {Tab} tab
 * @param {readonly T[]} threads
 * @returns {T[]}
 */
export function ordered(tab, threads) {
  if (tab === 'pending') return [...threads].sort((a, b) => b.number - a.number);
  return [...threads].sort((a, b) => (b.movedAt ?? b.createdAt).localeCompare(a.movedAt ?? a.createdAt) || b.number - a.number);
}

/**
 * How many threads stand in each open status; closed ones count nowhere.
 * @param {readonly { status: Status }[]} threads
 * @returns {Record<Open, number>}
 */
export function breakdown(threads) {
  /** @type {Record<Open, number>} */
  const counts = { received: 0, act: 0, discuss: 0 };
  for (const thread of threads) if (isOpenStatus(thread.status)) counts[thread.status] += 1;
  return counts;
}

/**
 * The counts line's parts in sorting's order: "2 new", "5 to do", "3 to discuss".
 * @param {Readonly<Record<Open, number>>} counts
 * @returns {{ status: Open, words: string }[]}
 */
export function countWords(counts) {
  return OPEN.map((status) => ({ status, words: `${counts[status]} ${COUNT_NAMES[status]}` }));
}

/**
 * A row's tag: where the thread stands, a dropped one with its reason, or null for a status the list around it
 * already says (`quiet`), such as Today's New section or plain Done on the Done tab.
 * @param {{ status: Status, dropReason: string | null }} thread
 * @param {readonly Status[]} [quiet]
 * @returns {Tag | null}
 */
export function tagOf(thread, quiet = []) {
  if (quiet.includes(thread.status)) return null;
  const words = thread.status === 'dropped' && thread.dropReason ? `${STATUS_NAMES.dropped}: ${thread.dropReason}` : STATUS_NAMES[thread.status];
  return { status: thread.status, words };
}
