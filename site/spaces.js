// @ts-check
// What a thread can be about: every topic a visitor's note can name (site/talk-topics.js), plus the spaces only
// Suresh and the sync file threads under, such as the company. The Worker checks a thread's space against this
// list, and the threads' pages will draw it. Topics carry the questions a visitor sees; a space is only a name,
// so the two lists stay apart, and the site test holds that every topic is a space. Plain data and pure
// functions with no page and no side effect, because the Worker imports this file too.

/** @typedef {{ slug: string, label: string }} Space */

/** The spaces, in the order a picker shows them. A slug is part of a stored row. */
/** @type {readonly Space[]} */
export const SPACES = Object.freeze([
  { slug: 'stigmer', label: 'Stigmer' },
  { slug: 'company', label: 'Company' },
  { slug: 'videos', label: 'My videos' },
  { slug: 'capsjump', label: 'CapsJump' },
  { slug: 'other', label: 'Something else' },
]);

/**
 * @param {string} slug
 * @returns {boolean}
 */
export function isSpace(slug) {
  return SPACES.some((space) => space.slug === slug);
}
