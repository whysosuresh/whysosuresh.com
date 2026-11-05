// @ts-check
// The threads page's keys, as one map: it names what each key does for the page's key handler
// (site/app/threads.js) and draws the keyboard sheet (`?`), so the two never disagree. The one-key moves are the
// inbox's, kept as they were, plus M (comment), W (edit), N (new) and ⌘K (find). A key pressed while typing in
// a field, or inside a page shown in a thread, never reaches here. Plain data and one pure function, so a test
// can read it without a page.

/**
 * @typedef {'next' | 'prev' | 'open' | 'back' | 'tab-look' | 'tab-act' | 'tab-discuss' | 'tab-done' | 'find' | 'act'
 *   | 'discuss' | 'drop' | 'done' | 'reopen' | 'space' | 'undo' | 'comment' | 'edit' | 'reply' | 'new' | 'keys'} Command
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
      { keys: '1 – 4', label: 'To look at, To act on, To discuss, Done' },
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
  1: 'tab-look',
  2: 'tab-act',
  3: 'tab-discuss',
  4: 'tab-done',
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
  '?': 'keys',
});

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
