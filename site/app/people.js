// @ts-check
// People, as the threads page says them (site/app/threads.js draws the pages): everyone Suresh deals with is a
// person with a number (the Worker's src/people.ts), and these are the words and addresses their pages use: a
// person's name (their address when they gave no name), their initials, their page's address
// (/threads/people/7-meera, as a thread's is /threads/42-who-owns-what), the line that says how he knows them, the
// words for how they are in a thread, the line under their name about their address, and Everyone split into the
// people still in touch and those only ever in threads he dropped. Plain data and pure functions, so a test can read
// them without a page.

/**
 * @typedef {{ sent: number, told: number, invited: number, removed: number, commented: number, noted: number }} Counts
 * @typedef {{ number: number, name: string | null, email: string | null, invited: boolean, dropped: boolean, counts: Counts }} Known
 */

/** A person's page addresses: everyone, and one person by their number with any name after it. */
export const PEOPLE_PATH = /^\/threads\/people\/?$/;
export const PERSON_PATH = /^\/threads\/people\/([1-9]\d{0,8})(?:-[^/]*)?$/;

/**
 * What a person is called: the name he knows them by, else the address they typed, else their number.
 * @param {{ number: number, name: string | null, email: string | null }} person
 */
export function nameOf(person) {
  return person.name?.trim() || person.email || `Person #${person.number}`;
}

/**
 * Up to two initials, for the round mark beside a name.
 * @param {string} name
 */
export function initials(name) {
  const words = name.replace(/@.*$/, '').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter((word) => word !== '');
  return words.slice(0, 2).map((word) => (word[0] ?? '').toUpperCase()).join('') || '?';
}

/**
 * A person's page address: their number, then their name in lower case, letters and digits joined by dashes.
 * @param {{ number: number, name: string | null, email: string | null }} person
 */
export function personPath(person) {
  const slug = nameOf(person)
    .replace(/@.*$/, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `/threads/people/${person.number}${slug === '' ? '' : `-${slug}`}`;
}

/** @param {number} n @param {string} one @param {string} many */
function count(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * How he knows a person, in a few words: "2 notes from the site · in 1 thread you shared".
 * @param {Counts} counts
 */
export function howLine(counts) {
  const parts = [
    ...(counts.sent > 0 ? [count(counts.sent, 'note from the site', 'notes from the site')] : []),
    ...(counts.told > 0 ? [`told you ${count(counts.told, 'thing', 'things')}`] : []),
    ...(counts.invited > 0 ? [`in ${count(counts.invited, 'thread you shared', 'threads you shared')}`] : []),
    ...(counts.removed > 0 ? [`invitation taken back on ${count(counts.removed, 'thread', 'threads')}`] : []),
    ...(counts.commented > 0 ? [count(counts.commented, 'comment', 'comments')] : []),
    ...(counts.noted > 0 ? [count(counts.noted, 'note on a public thread', 'notes on public threads')] : []),
  ];
  const line = parts.join(' · ');
  return line === '' ? 'Nothing from them yet' : `${line.charAt(0).toUpperCase()}${line.slice(1)}`;
}

/** How a person is in a thread, as the Worker names it, in his words. */
const ROLE_WORDS = {
  sent: 'sent this from the site',
  told: 'told you this',
  invited: 'invited',
  removed: 'invitation taken back',
  wrote: 'wrote here',
};

/**
 * Every way a person is in a thread, as one line: "Sent this from the site · invited".
 * @param {readonly string[]} roles
 */
export function roleLine(roles) {
  const line = roles.map((role) => (role in ROLE_WORDS ? ROLE_WORDS[/** @type {keyof typeof ROLE_WORDS} */ (role)] : role)).join(' · ');
  return line === '' ? '' : `${line.charAt(0).toUpperCase()}${line.slice(1)}`;
}

/**
 * The line under a person's name about their address: none yet, or the address, marked "typed on the site" when no
 * invitation stands behind it and they typed it themselves (nobody checked it is theirs).
 * @param {Known} person
 */
export function addressLine(person) {
  if (person.email === null) return 'No address yet';
  const typed = !person.invited && person.counts.sent + person.counts.noted > 0;
  return typed ? `${person.email} · typed on the site` : person.email;
}

/**
 * Everyone, split as the page shows them: the people still in touch, and those only ever in threads he dropped,
 * which fold away. Order is kept.
 * @template {{ dropped: boolean }} T
 * @param {readonly T[]} people
 * @returns {{ live: T[], dropped: T[] }}
 */
export function folded(people) {
  return { live: people.filter((person) => !person.dropped), dropped: people.filter((person) => person.dropped) };
}

/**
 * The line an address another person holds gets: whose it is.
 * @param {string} email
 * @param {{ number: number, name: string | null, email: string | null } | null} holder
 */
export function takenLine(email, holder) {
  return holder === null ? `${email} already belongs to someone. One address belongs to one person.` : `${email} is ${nameOf(holder)}'s (#${holder.number}). One address belongs to one person.`;
}
