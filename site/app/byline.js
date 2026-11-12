// @ts-check
// How the threads page names who wrote something (site/app/threads.js draws it): what the recorder sync writes is
// Suresh's own, written down by Claude, so it reads under his name, "You" on his own page as his own words do and
// "Suresh" to a person he invited, with a quiet "via Claude" beside it; the wire still says `sync` (src/store.ts).
// And the words of his photo sheet, where he sets the photo every avatar of his shows (src/photos.ts). Plain data and
// pure functions, so a test can read them without a page (test/byline-words.test.ts).

/** The quiet words beside what the sync wrote for him. */
export const VIA = 'via Claude';

/**
 * His name as a writer, for him and the sync alike: "You" on his own page, "Suresh" to a person he invited; null for
 * anyone else, whose own name stands.
 * @param {string} actor the wire's author or actor: `owner`, `sync`, `member`, `visitor` or `import`
 * @param {boolean} member whether a person he invited reads it
 * @returns {string | null}
 */
export function writerName(actor, member) {
  if (actor !== 'owner' && actor !== 'sync') return null;
  return member ? 'Suresh' : 'You';
}

/** Whether Claude wrote it down for him, so it says so. @param {string} actor */
export function viaClaude(actor) {
  return actor === 'sync';
}

/**
 * The line under a thread of his own: who started it, or that he said it and Claude wrote it down.
 * @param {string | undefined} actor the actor of the thread's first event
 * @param {boolean} member whether a person he invited reads it
 */
export function startedLine(actor, member) {
  const name = member ? 'Suresh' : 'You';
  return actor === 'owner' ? `${name} started this` : `${name} said this; Claude wrote it down`;
}

/** His photo sheet's words. */
export const PHOTO_SHEET = {
  title: 'Your photo',
  shows: 'Shows beside everything you write, and everything Claude writes for you, to everyone who reads it.',
  rule: "A JPEG or PNG, up to 4 MB. It's cropped to a circle.",
  remove: 'Remove',
  cancel: 'Cancel',
  /** @param {boolean} has whether he has a photo now */
  choose: (has) => (has ? 'Choose another…' : 'Choose a photo…'),
};

/** The toast once his photo is saved or taken down. @param {boolean} has whether he has a photo now */
export function photoSaved(has) {
  return has ? 'Your photo is saved' : 'Your photo is removed';
}

/** Why a photo wasn't kept, in plain words, by the Worker's reason. @param {string} reason */
export function photoProblem(reason) {
  if (reason === 'type') return "That isn't a JPEG or PNG.";
  if (reason === 'too-large') return 'That photo is over 4 MB.';
  return "Your photo didn't save. Try again.";
}
