// @ts-check
// The site's two hosts, as one rule that the Worker (src/worker.ts, src/home.ts), the pages' scripts and the privacy
// probe (tools/probe/) all read: the home page lives at a host (whysosuresh.com), and everything behind the door, the
// threads with Today at their root, one label below it, at `hey.` (hey.whysosuresh.com). The rule is derived from the
// host a request came to, never configured, so production, the local look (localhost:8790 and hey.localhost:8790) and
// the tests all follow it with nothing to set. A link from one host to the other is built here, never typed. Plain
// data and pure functions, with no page and no side effect, so a test reads them without a page and the Worker
// type-checks them with no browser library.

/** The label the threads' host carries in front of the home page's. */
export const THREADS_LABEL = 'hey';

const PREFIX = `${THREADS_LABEL}.`;

/**
 * Whether a hostname is the threads' host: the home page's with `hey.` in front.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isThreadsHost(hostname) {
  return hostname.toLowerCase().startsWith(PREFIX);
}

/**
 * The threads' origin for the home page's origin (`https://whysosuresh.com` → `https://hey.whysosuresh.com`); given
 * the threads' own origin, it answers that origin.
 * @param {string} homeOrigin
 * @returns {string}
 */
export function threadsOrigin(homeOrigin) {
  const url = new URL(homeOrigin);
  if (!isThreadsHost(url.hostname)) url.hostname = `${PREFIX}${url.hostname}`;
  return url.origin;
}

/**
 * The home page's origin for the threads' origin (`https://hey.whysosuresh.com` → `https://whysosuresh.com`); given
 * the home page's own origin, it answers that origin.
 * @param {string} origin
 * @returns {string}
 */
export function homeOrigin(origin) {
  const url = new URL(origin);
  if (isThreadsHost(url.hostname)) url.hostname = url.hostname.slice(PREFIX.length);
  return url.origin;
}

/**
 * An address as Suresh reads and copies it, with no scheme: `hey.whysosuresh.com/threads/42`.
 * @param {string} origin
 * @param {string} path a root-absolute path
 * @returns {string}
 */
export function shownAddress(origin, path) {
  return `${new URL(origin).host}${path}`;
}
