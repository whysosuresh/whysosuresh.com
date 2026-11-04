// @ts-check
// What a note to Suresh can be about: the one list the note flow draws and the Worker checks a send
// against, so a new topic is one edit here. Each topic has the questions shown above the box, about a
// moment or a decision, never about colours or logos. Also how a page address opens the flow: #talk
// opens the topic picker, #talk/<topic> opens that topic's note. Plain data and pure functions with no
// page and no side effect, because the Worker imports this file too.

/**
 * @typedef {{
 *   slug: string,
 *   label: string,
 *   hint: string,
 *   questions: readonly string[],
 *   offersCall?: boolean,
 * }} Topic
 * @typedef {{ open: false } | { open: true, topic: string | null }} HashLink
 */

/** The topics, in the order the picker shows them. A slug is part of a page address and a stored row. */
/** @type {readonly Topic[]} */
export const TOPICS = Object.freeze([
  {
    slug: 'stigmer',
    label: 'Stigmer',
    hint: 'The product, the site, the docs or a demo',
    questions: [
      'Where did you get lost: the site, the docs, the install, or a demo?',
      'Would you put it in your product? What would stop you?',
      "What did you expect to find that wasn't there?",
    ],
  },
  {
    slug: 'videos',
    label: 'My videos',
    hint: 'The Feed Said So and the channel',
    questions: [
      'Which video, and where did you stop watching?',
      'A take you disagreed with, and why?',
      'A story from your feed I should cover?',
    ],
  },
  {
    slug: 'capsjump',
    label: 'CapsJump',
    hint: 'The Mac app',
    questions: [
      'What did you try to set up, and where did it fight you?',
      "What do you reach for Caps Lock to do that it can't yet?",
      'What would make you stop using it?',
    ],
  },
  {
    slug: 'other',
    label: 'Something else',
    hint: 'Anything at all',
    questions: [
      "What's on your mind, and what made you think of it?",
      "Is there something you'd like me to do about it?",
    ],
    offersCall: true,
  },
]);

/**
 * @param {string} slug
 * @returns {boolean}
 */
export function isTopic(slug) {
  return TOPICS.some((topic) => topic.slug === slug);
}

/**
 * Reads a page address's hash: #talk and #talk/<anything unknown> open the picker, #talk/<topic>
 * opens that topic, and every other hash leaves the flow closed.
 * @param {string} hash
 * @returns {HashLink}
 */
export function topicFromHash(hash) {
  if (hash === '#talk') return { open: true, topic: null };
  if (!hash.startsWith('#talk/')) return { open: false };
  const slug = hash.slice('#talk/'.length);
  return { open: true, topic: isTopic(slug) ? slug : null };
}
