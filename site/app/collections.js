// @ts-check
// Collections, as the threads page says them (site/app/threads.js draws the room and each collection): his named sets
// of the threads worth keeping, each in his own order (the Worker's src/collections.ts). These are the words and
// addresses their pages use: the room's address and a collection's (/collections/3-every-screen, its number then its
// name, as a thread's and a person's are), how many threads one holds, its rule, the room's "Show 25 more", the place a
// key move takes a thread to, the line that walks a collection from one of its threads ("3 of 6"), the L picker's
// order, a history line for keeping a thread or taking it out, and what deleting one says. Plain data and pure
// functions, so a test can read them without a page.

/**
 * @typedef {{ number: number, name: string, description: string | null, rule: string | null, pinned: boolean, changedAt: string, threads: number }} Known
 * @typedef {{ number: number, name: string }} Named
 */

/** The room's address, and a collection's by its number with any name after it. */
export const COLLECTIONS_PATH = '/collections';
export const COLLECTION_PATH = /^\/collections\/([1-9]\d{0,8})(?:-[^/]*)?$/;

/** How many collections the room asks for at a time, and how many threads a collection's page. */
export const COLLECTIONS_PAGE = 25;
export const KEPT_PAGE = 50;

/** Past this many threads a collection's page offers its own search and its Open / Done filter. */
export const KEPT_SEARCH_FROM = 20;

/** How many of the most recently changed collections the L picker offers before anything is typed. */
export const RECENT_PICKS = 6;

/** The longest name and rule, and the longest description, as the Worker takes them. */
export const MAX_NAME = 80;
export const MAX_DESCRIPTION = 280;

/**
 * A collection's page address: its number, then its name in lower case, letters and digits joined by dashes.
 * @param {{ number: number, name: string }} collection
 */
export function collectionPath(collection) {
  const slug = collection.name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${COLLECTIONS_PATH}/${collection.number}${slug === '' ? '' : `-${slug}`}`;
}

/** "No threads yet", "1 thread", "6 threads". @param {number} n */
export function threadsLine(n) {
  if (n === 0) return 'No threads yet';
  return `${n} ${n === 1 ? 'thread' : 'threads'}`;
}

/**
 * A row's line under a collection's name: how many threads, and its rule when it has one.
 * @param {Known} collection
 */
export function collectionLine(collection) {
  const count = threadsLine(collection.threads);
  return collection.rule ? `${count} · new “${collection.rule}” threads join on their own` : count;
}

/**
 * What the side panel says of a rule.
 * @param {string | null} rule
 */
export function ruleLine(rule) {
  return rule ? `New threads titled “${rule} …” join at the end.` : 'No rule. Threads join when you add them.';
}

/**
 * The "Show more" button's words: as many as the next page brings, and how many are left.
 * @param {number} shown how many show now
 * @param {number} count how many there are
 * @param {number} page how many a page brings
 */
export function moreLabel(shown, count, page) {
  const left = Math.max(0, count - shown);
  return left === 0 ? '' : `Show ${Math.min(page, left)} more · ${left} left`;
}

/**
 * The place a key move takes a thread to, from 1, or null when it stays: ⌥↑ and ⌥↓ one place, ⌥⇧↑ and ⌥⇧↓ the top
 * and the bottom.
 * @param {number} place its place now, from 1
 * @param {number} count how many threads the collection holds
 * @param {'up' | 'down'} way
 * @param {boolean} far to the end rather than one place
 */
export function movedTo(place, count, way, far) {
  const to = far ? (way === 'up' ? 1 : count) : way === 'up' ? place - 1 : place + 1;
  return to < 1 || to > count || to === place ? null : to;
}

/**
 * The bar above a thread opened from a collection: "3 of 6 in Every screen".
 * @param {number} at its place in the walk, from 0
 * @param {number} count
 * @param {string} name
 */
export function walkLine(at, count, name) {
  return `${at + 1} of ${count} in ${name}`;
}

/**
 * The L picker's collections, in order: before anything is typed, the thread's own collections, then the most recently
 * changed others up to `RECENT_PICKS`; once words are typed, the collections the search answered, its own first.
 * @param {readonly Named[]} kept the collections the thread is in
 * @param {readonly Named[]} recent the most recently changed collections, newest first
 * @param {readonly Named[] | null} found the search's answer for the words typed, or null before any
 * @returns {{ number: number, name: string, kept: boolean }[]}
 */
export function pickList(kept, recent, found) {
  const keptNumbers = new Set(kept.map((one) => one.number));
  if (found !== null) {
    const ordered = [...found.filter((one) => keptNumbers.has(one.number)), ...found.filter((one) => !keptNumbers.has(one.number))];
    return ordered.map((one) => ({ number: one.number, name: one.name, kept: keptNumbers.has(one.number) }));
  }
  const others = recent.filter((one) => !keptNumbers.has(one.number)).slice(0, RECENT_PICKS);
  return [...kept.map((one) => ({ number: one.number, name: one.name, kept: true })), ...others.map((one) => ({ number: one.number, name: one.name, kept: false }))];
}

/**
 * Whether the words typed in the L picker would make a new collection: words, and no collection already by that name,
 * ignoring case as the Worker does.
 * @param {string} words
 * @param {readonly Named[]} known
 */
export function makesNew(words, known) {
  const name = words.trim();
  if (name === '' || name.length > MAX_NAME) return false;
  return !known.some((one) => one.name.toLowerCase() === name.toLowerCase());
}

/**
 * A history line for a thread kept in a collection or taken out, as his history shows it: the collection's name as it
 * was then, and whether its rule kept it.
 * @param {'kept' | 'unkept'} type
 * @param {Record<string, unknown>} data
 */
export function keptWords(type, data) {
  const name = typeof data.name === 'string' ? data.name : 'a collection';
  if (type === 'unkept') return `took this out of ${name}`;
  return typeof data.rule === 'string' ? `kept this in ${name}, by its rule` : `kept this in ${name}`;
}

/**
 * The toast after the L picker keeps a thread or takes it out.
 * @param {number} number the thread's
 * @param {string} name the collection's
 * @param {boolean} kept
 */
export function keptToast(number, name, kept) {
  return kept ? `#${number} kept in ${name}.` : `#${number} taken out of ${name}.`;
}

/**
 * What the delete confirmation says: the collection goes, its threads stay.
 * @param {string} name
 * @param {number} count
 */
export function deleteLine(name, count) {
  const threads = count === 0 ? 'It holds no threads.' : `Its ${threadsLine(count).toLowerCase()} stay as they are, only no longer grouped here.`;
  return `Delete ${name} for good? ${threads} This can't be undone.`;
}

/**
 * Why a name wasn't kept, in words for the page.
 * @param {string} reason the Worker's
 */
export function nameProblem(reason) {
  if (reason === 'name-taken') return 'Another collection has that name.';
  return 'That name can’t be used. One line, at most 80 characters.';
}
