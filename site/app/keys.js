// @ts-check
// The threads page's keys, as one map: it names what each key does for the page's key handler
// (site/app/threads.js) and draws the keyboard sheet (`?`), so the two never disagree. The one-key moves are the
// inbox's, kept as they were, plus 1 and 2 for the list's two tabs (Pending, Done), M (comment), W (edit), N (new),
// S (share), B (the meeting: book it, move it, change who is in it) and ⌘K (find). A person the owner invited
// reads and comments, so their page answers only the keys on their own sheet (`MEMBER_SHEET`, `MEMBER_COMMANDS`).
// A key pressed while typing in a field, or inside a page shown in a thread, never reaches here. Plain data and
// pure functions, so a test can read them without a page.

/**
 * @typedef {'next' | 'prev' | 'open' | 'back' | 'tab-pending' | 'tab-done' | 'find' | 'act'
 *   | 'discuss' | 'drop' | 'done' | 'reopen' | 'space' | 'undo' | 'comment' | 'edit' | 'reply' | 'new' | 'share' | 'meeting' | 'keys'} Command
 * @typedef {{ keys: string, label: string }} KeyRow
 */

/** The keyboard sheet: three groups, each key as the sheet shows it and what it does. */
/** @type {readonly { title: string, rows: readonly KeyRow[] }[]} */
export const SHEET = Object.freeze([
  {
    title: 'Move around',
    rows: [
      { keys: 'J', label: 'Next thread' },
      { keys: 'K', label: 'Previous thread' },
      { keys: '↵', label: 'Open the thread' },
      { keys: 'Esc', label: 'Back to the list' },
      { keys: '1 – 2', label: 'Pending, Done' },
      { keys: '⌘K', label: 'Find a thread, or do anything' },
    ],
  },
  {
    title: 'Sort',
    rows: [
      { keys: 'A', label: 'Act on it' },
      { keys: 'T', label: 'Talk it through' },
      { keys: 'D', label: 'Drop, then 1 – 4 for why' },
      { keys: 'E', label: 'Done' },
      { keys: 'U', label: 'Reopen' },
      { keys: 'C', label: 'Change the space, then 1 – 5' },
      { keys: 'Z', label: 'Undo the last move' },
    ],
  },
  {
    title: 'Write',
    rows: [
      { keys: 'M', label: 'Comment' },
      { keys: 'W', label: 'Edit title, summary and text' },
      { keys: 'R', label: 'Reply by email to a note' },
      { keys: 'N', label: 'New thread' },
      { keys: 'S', label: 'Share the thread' },
      { keys: 'B', label: 'Make it a meeting, or change it' },
      { keys: '⌘↵', label: 'Save, or send the comment' },
      { keys: '?', label: 'These keys' },
    ],
  },
]);

/** @type {Readonly<Record<string, Command>>} */
const PLAIN = Object.freeze({
  j: 'next',
  arrowdown: 'next',
  k: 'prev',
  arrowup: 'prev',
  enter: 'open',
  escape: 'back',
  1: 'tab-pending',
  2: 'tab-done',
  a: 'act',
  t: 'discuss',
  d: 'drop',
  e: 'done',
  u: 'reopen',
  c: 'space',
  z: 'undo',
  m: 'comment',
  w: 'edit',
  r: 'reply',
  n: 'new',
  s: 'share',
  b: 'meeting',
  '?': 'keys',
});

/** An invited person's keyboard sheet: moving among their threads, finding, and commenting. */
/** @type {readonly { title: string, rows: readonly KeyRow[] }[]} */
export const MEMBER_SHEET = Object.freeze([
  {
    title: 'Move around',
    rows: [
      { keys: 'J', label: 'Next thread' },
      { keys: 'K', label: 'Previous thread' },
      { keys: '↵', label: 'Open the thread' },
      { keys: 'Esc', label: 'Back to your threads' },
      { keys: '⌘K', label: 'Find in your threads' },
    ],
  },
  {
    title: 'Write',
    rows: [
      { keys: 'M', label: 'Comment' },
      { keys: '⌘↵', label: 'Send the comment' },
      { keys: '?', label: 'These keys' },
    ],
  },
]);

/** The commands an invited person's page answers; every other key does nothing there. */
/** @type {ReadonlySet<Command>} */
export const MEMBER_COMMANDS = new Set(/** @type {Command[]} */ (['next', 'prev', 'open', 'back', 'find', 'comment', 'keys']));

/**
 * What a key press asks for, or null for a key that does nothing here. ⌘K (Ctrl+K elsewhere) is find; every
 * other key counts only without ⌘, Ctrl or Alt, so the browser's own shortcuts stay its own.
 * @param {{ key: string, metaKey: boolean, ctrlKey: boolean, altKey: boolean }} press
 * @returns {Command | null}
 */
export function commandFor(press) {
  const key = press.key.toLowerCase();
  if (press.metaKey || press.ctrlKey) return key === 'k' && !press.altKey ? 'find' : null;
  if (press.altKey) return null;
  return PLAIN[press.key === '?' ? '?' : key] ?? null;
}
