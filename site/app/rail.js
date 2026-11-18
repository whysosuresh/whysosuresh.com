// @ts-check
// The threads page's menu down the left (site/app/threads.js draws it), as one shape for everyone signed in: the
// rooms they use in groups, then sections that fold, then who they are. His rooms are Today, Threads and Distribution,
// the three he opens every day, then Meetings, Asks, People and Journal; his sections are the five spaces and his pinned
// collections, with All collections at the end. A person he invited gets Shared with you, their meetings while they
// have one, then the collections he shared with them and their open threads, each with a mark for where it stands and
// no number. A grey number says how many; a pill says someone waits on him, which only Distribution's does. A section
// with nothing in it isn't drawn, and a folded one still shows the row the reader is on, so they never lose their
// place. Which sections a browser folded is kept in it (`readFolded` reads what was kept). The phone's More sheet and
// the keyboard sheet's note read one list of the rooms under More (`MORE_ROOMS`), so the two can't disagree. Plain data
// and pure functions, with no page and no clock, so a test reads them without a page.

import { ASKS_PATH } from './asks.js';
import { COLLECTIONS_PATH } from './collections.js';
import { DISTRIBUTION_PATH } from './distribution.js';
import { JOURNAL_PATH } from './journal.js';
import { OPEN, STATUS_NAMES, listPath } from './standing.js';
import { SPACES } from '../spaces.js';

/**
 * @typedef {import('./standing.js').Open} Open
 * @typedef {import('./standing.js').Status} Status
 * @typedef {import('./standing.js').Tab} Tab
 * @typedef {'today' | 'list' | 'distribution' | 'meetings' | 'asks' | 'people' | 'journal' | 'collections'} Room
 * @typedef {{ kind: 'room', id: Room } | { kind: 'space', id: string } | { kind: 'collection', id: number } | { kind: 'thread', id: number }} Goes
 * @typedef {Goes & { href: string, icon: string | null, label: string, count: number | null,
 *   badge: { count: number, words: string } | null, mark: { status: Open, words: string } | null, current: boolean }} Row
 * @typedef {{ id: string, label: string, folded: boolean, rows: Row[] }} Section
 * @typedef {{ name: string, role: string, detail: string, initial: string }} Foot
 * @typedef {{ groups: Row[][], sections: Section[], foot: Foot }} Rail
 * @typedef {{ view: string, number: number | null, space: string | null }} Here
 *   Where the reader is: the view (the journal's every view is `journal`, a person's page `person`), the number of
 *   the thread or collection shown, and the space the Threads room is filtered to.
 * @typedef {{ number: number, name: string, threads: number, href: string }} Kept
 * @typedef {{ number: number, status: Status, title: string, href: string }} Theirs
 * @typedef {{ here: Here, tab: Tab, only: Open | null, today: number, waiting: number, meetings: number, asks: number,
 *   people: number, collections: number, spaces: Readonly<Record<string, number>>, pinned: readonly Kept[],
 *   folded: readonly string[] }} OwnerInput
 * @typedef {{ here: Here, name: string | null, email: string, shared: number, meetings: number,
 *   collections: readonly Kept[], threads: readonly Theirs[], folded: readonly string[] }} MemberInput
 * @typedef {{ go: Room, href: string, icon: string, label: string }} MoreRoom
 */

/** The door everyone signed in enters by: Today for him, what is shared with them for a person he invited. */
export const TODAY_PATH = '/';
/** The Threads room, its first tab with no filter. */
export const THREADS_PATH = '/threads/';
/** The Meetings room: his meetings, or an invited person's own. */
export const MEETINGS_PATH = '/meetings';
/** The People room. */
export const PEOPLE_ROOM = '/people';

/** Where this browser keeps the ids of the sections it folded, as a JSON list. */
export const FOLDED_KEY = 'threads:rail-folded';

/** The sections, by the id a fold is kept under, and what each is called. */
export const SECTIONS = Object.freeze({ spaces: 'Spaces', collections: 'Collections', threads: 'Open threads' });

/** The words the menu says that aren't a room's name. */
export const RAIL_WORDS = Object.freeze({
  shared: 'Shared with you',
  allCollections: 'All collections',
  owner: 'Owner',
  ownerDetail: 'Owner of whysosuresh.com',
  guest: 'Guest of Suresh',
  guestAfterAddress: 'guest of Suresh',
  account: 'Account',
  photo: 'Your photo',
  keys: 'Keyboard shortcuts',
  newThread: 'New thread',
});

/** The rooms under More on his phone, in the menu's order, after the bar's Today and Threads. */
/** @type {readonly MoreRoom[]} */
export const MORE_ROOMS = Object.freeze([
  { go: 'distribution', href: DISTRIBUTION_PATH, icon: 'trend', label: 'Distribution' },
  { go: 'meetings', href: MEETINGS_PATH, icon: 'cal', label: 'Meetings' },
  { go: 'asks', href: ASKS_PATH, icon: 'ask', label: 'Asks' },
  { go: 'people', href: PEOPLE_ROOM, icon: 'person', label: 'People' },
  { go: 'journal', href: JOURNAL_PATH, icon: 'book', label: 'Journal' },
  { go: 'collections', href: COLLECTIONS_PATH, icon: 'stack', label: 'Collections' },
]);

/** What the keyboard sheet says a phone holds instead of keys, for him or for a person he invited. @param {boolean} member */
export function phoneNote(member) {
  if (member) return 'Phones have no keys: the bar along the bottom holds your threads, your meetings and Find.';
  return `Phones have no keys: every move is a button on the thread, and the bar along the bottom holds Today, Threads, Find, New and More (${MORE_ROOMS.map((room) => room.label).join(', ')}).`;
}

/** How Distribution's pill says who waits. @param {number} count */
export function waitingWords(count) {
  return `${count} waiting on you`;
}

/** @param {Room} id @param {string} href @param {string | null} icon @param {string} label @param {boolean} current @param {number | null} [count] @returns {Row} */
function room(id, href, icon, label, current, count = null) {
  return { kind: 'room', id, href, icon, label, count, badge: null, mark: null, current };
}

/**
 * A section as it is drawn: none when it has no rows; folded, only the row the reader is on, if any.
 * @param {keyof typeof SECTIONS} id @param {Row[]} rows @param {readonly string[]} folded @returns {Section[]}
 */
function section(id, rows, folded) {
  if (rows.length === 0) return [];
  const isFolded = folded.includes(id);
  return [{ id, label: SECTIONS[id], folded: isFolded, rows: isFolded ? rows.filter((row) => row.current) : rows }];
}

/**
 * His menu: Today, Threads and Distribution (its waiting count a pill), then Meetings, Asks, People and Journal; the
 * five spaces; his pinned collections and All collections, which is where he is in a collection he hasn't pinned too.
 * @param {OwnerInput} input
 * @returns {Rail}
 */
export function ownerRail(input) {
  const { here } = input;
  const view = here.view;
  const daily = [
    room('today', TODAY_PATH, 'sun', 'Today', view === 'today', input.today),
    room('list', THREADS_PATH, 'list', 'Threads', view === 'list' && here.space === null),
    { ...room('distribution', DISTRIBUTION_PATH, 'trend', 'Distribution', view === 'distribution'), badge: input.waiting > 0 ? { count: input.waiting, words: waitingWords(input.waiting) } : null },
  ];
  const visited = [
    room('meetings', MEETINGS_PATH, 'cal', 'Meetings', view === 'meetings', input.meetings),
    room('asks', ASKS_PATH, 'ask', 'Asks', view === 'asks', input.asks),
    room('people', PEOPLE_ROOM, 'person', 'People', view === 'people' || view === 'person', input.people),
    room('journal', JOURNAL_PATH, 'book', 'Journal', view === 'journal'),
  ];
  /** @type {Row[]} */
  const spaces = SPACES.map((space) => ({
    kind: 'space',
    id: space.slug,
    href: listPath(input.tab, input.only, space.slug),
    icon: null,
    label: space.label,
    count: input.spaces[space.slug] ?? 0,
    badge: null,
    mark: null,
    current: view === 'list' && here.space === space.slug,
  }));
  const pinnedHere = view === 'collection' && input.pinned.some((one) => one.number === here.number);
  /** @type {Row[]} */
  const kept = [
    ...input.pinned.map((one) => keptRow(one, here)),
    room('collections', COLLECTIONS_PATH, null, RAIL_WORDS.allCollections, view === 'collections' || (view === 'collection' && !pinnedHere), input.collections),
  ];
  return {
    groups: [daily, visited],
    sections: [...section('spaces', spaces, input.folded), ...section('collections', kept, input.folded)],
    foot: { name: 'Suresh', role: RAIL_WORDS.owner, detail: RAIL_WORDS.ownerDetail, initial: 'S' },
  };
}

/**
 * An invited person's menu: Shared with you, their meetings while they have one (or are on that page), then the
 * collections he shared with them and their open threads, each with its mark; named as he named them, or by their
 * address when he gave no name.
 * @param {MemberInput} input
 * @returns {Rail}
 */
export function memberRail(input) {
  const { here } = input;
  const view = here.view;
  const rooms = [room('today', TODAY_PATH, 'inbox', RAIL_WORDS.shared, view === 'today', input.shared)];
  if (input.meetings > 0 || view === 'meetings') rooms.push(room('meetings', MEETINGS_PATH, 'cal', 'Meetings', view === 'meetings', input.meetings));
  const open = /** @type {readonly Status[]} */ (OPEN);
  /** @type {Row[]} */
  const threads = input.threads
    .filter((thread) => open.includes(thread.status))
    .map((thread) => {
      const status = /** @type {Open} */ (thread.status);
      return {
        kind: 'thread',
        id: thread.number,
        href: thread.href,
        icon: null,
        label: thread.title,
        count: null,
        badge: null,
        mark: { status, words: STATUS_NAMES[status] },
        current: view === 'thread' && here.number === thread.number,
      };
    });
  const name = input.name?.trim() || null;
  const shown = name ?? input.email;
  return {
    groups: [rooms],
    sections: [...section('collections', input.collections.map((one) => keptRow(one, here)), input.folded), ...section('threads', threads, input.folded)],
    foot: {
      name: shown,
      role: RAIL_WORDS.guest,
      detail: name === null ? RAIL_WORDS.guest : `${input.email} · ${RAIL_WORDS.guestAfterAddress}`,
      initial: (shown.trim().charAt(0) || '?').toUpperCase(),
    },
  };
}

/** A collection's row. @param {Kept} one @param {Here} here @returns {Row} */
function keptRow(one, here) {
  return {
    kind: 'collection',
    id: one.number,
    href: one.href,
    icon: 'stack',
    label: one.name,
    count: one.threads,
    badge: null,
    mark: null,
    current: here.view === 'collection' && here.number === one.number,
  };
}

/**
 * The sections a browser folded, from what it kept: a JSON list of section ids, anything else read as none folded,
 * so a value from an older page or another hand never hides a section for good.
 * @param {string | null} kept
 * @returns {string[]}
 */
export function readFolded(kept) {
  if (kept === null) return [];
  /** @type {unknown} */
  let read;
  try {
    read = JSON.parse(kept);
  } catch {
    return [];
  }
  if (!Array.isArray(read)) return [];
  return [...new Set(read.filter((id) => typeof id === 'string' && Object.hasOwn(SECTIONS, id)))];
}

/** The folded sections once `id` is folded or opened again. @param {readonly string[]} folded @param {string} id */
export function toggled(folded, id) {
  return folded.includes(id) ? folded.filter((one) => one !== id) : [...folded, id];
}
