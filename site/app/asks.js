// @ts-check
// Asks, as the threads page says them (site/app/threads.js draws the pages): an ask is one of Suresh's own threads
// whose page asks a few questions, handed to many people by one link, whysosuresh.com/ask/<slug>, and every browser
// that answers it becomes a thread of its own (the Worker's src/asks.ts). These are the words and addresses the pages
// use: the Asks room's rows (the link, how many answered, the state, the Send a note topic that opens it), the folded
// row Today shows for several new answers to one ask, the head of an ask's Answered by and the filter over it, a
// response thread's byline, the history's lines for an ask, and what a visitor on /ask/<slug> reads around the page.
// Plain data and pure functions, so a test can read them without a page (test/asks-words.test.ts).

import { TOPICS } from '../talk-topics.js';

/**
 * @typedef {'draft' | 'open' | 'closed'} AskState
 * @typedef {{ number: number, name: string | null, at: string, waiting: boolean }} Answerer
 */

/** The Asks room's address, and an ask's own, whose slug is the Worker's shape (src/asks.ts). */
export const ASKS_PATH = '/asks';
export const ASK_PATH = /^\/ask\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)$/;
/** How many people Answered by shows before "Show all". */
export const FIRST_ANSWERERS = 8;

/** An ask's link as he copies it and as a row shows it, without the scheme. @param {string} slug */
export function askShown(slug) {
  return `whysosuresh.com/ask/${slug}`;
}

/** An ask's link on this site, as he pastes it to people. @param {string} origin @param {string} slug */
export function askLink(origin, slug) {
  return `${origin}/ask/${slug}`;
}

/** What an ask's state chip says. @param {AskState} state */
export function stateWords(state) {
  return state === 'draft' ? 'Draft' : state === 'open' ? 'Open' : 'Closed';
}

/**
 * The line under an ask's row: who can answer, or how many did and when the last did ("4 answered · last 2 h ago").
 * @param {{ state: AskState, answered: number }} ask
 * @param {string | null} lastAgo how long ago the last answer came, as the page says it ("2 h", or "now"), or null
 */
export function countLine(ask, lastAgo) {
  if (ask.state === 'draft') return 'Nobody can answer yet';
  if (ask.answered === 0) return 'Nobody has answered yet';
  return `${ask.answered} answered${lastAgo === null ? '' : ` · last ${agoWords(lastAgo)}`}`;
}

/** How long ago, as a sentence says it: "2 h ago", or "just now". @param {string} ago the page's short form ("2 h", "now") */
export function agoWords(ago) {
  return ago === 'now' ? 'just now' : `${ago} ago`;
}

/** The Send a note topic that opens an ask, as its row says it, or null. @param {string | null} topic */
export function topicLine(topic) {
  const found = TOPICS.find((one) => one.slug === topic);
  return found ? `on Send a note · ${found.label}` : null;
}

/** Where "Send a note" goes from a closed ask: its topic's note when a topic opens it, else the picker. @param {string} slug */
export function talkLinkFor(slug) {
  const topic = TOPICS.find((one) => one.ask === slug);
  return topic ? `/#talk/${topic.slug}` : '/#talk';
}

/** Who answered, as a name: what they typed, or "Someone". @param {{ name: string | null }} one */
export function answererName(one) {
  return one.name?.trim() || 'Someone';
}

/**
 * Answered by, new answers first, then the newest; with `query`, only those whose name or number holds it.
 * @template {Answerer} A
 * @param {readonly A[]} answered
 * @param {string} query
 * @returns {A[]}
 */
export function answerersShown(answered, query) {
  const needle = query.trim().toLowerCase().replace(/^#/, '');
  return [...answered]
    .sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.at.localeCompare(a.at) || b.number - a.number)
    .filter((one) => needle === '' || answererName(one).toLowerCase().includes(needle) || String(one.number).startsWith(needle));
}

/** Answered by's head: "4 people · 2 new". @param {readonly Answerer[]} answered */
export function answeredHead(answered) {
  const count = answered.length;
  if (count === 0) return 'nobody yet';
  const fresh = answered.filter((one) => one.waiting).length;
  return `${count} ${count === 1 ? 'person' : 'people'}${fresh > 0 ? ` · ${fresh} new` : ''}`;
}

/** What Answered by says when nobody answered: a draft's next step, or that the link is out. @param {AskState} state */
export function nobodyLine(state) {
  return state === 'draft' ? 'Open it, then copy the link to the people you want to ask.' : 'Nobody has answered yet.';
}

/**
 * Today's folded row for several new answers to one ask: who, by name, the first two and how many others.
 * @param {readonly { name: string | null }[]} answered newest first
 */
export function foldedWho(answered) {
  const named = [...new Set(answered.map((one) => one.name?.trim() ?? '').filter((name) => name !== ''))];
  const others = answered.length - Math.min(2, named.length);
  if (named.length === 0) return `${answered.length} people`;
  if (others === 0) return named.slice(0, 2).join(' and ');
  return `${named.slice(0, 2).join(', ')} and ${others} ${others === 1 ? 'other' : 'others'}`;
}

/** Today's folded row's title: "Tuesday demo · 3 new answers". @param {string} title @param {number} count */
export function foldedTitle(title, count) {
  return `${title} · ${count} new answers`;
}

/** The toast after Mark read. @param {number} marked */
export function markedWords(marked) {
  return marked === 1 ? 'Marked 1 answer read' : `Marked ${marked} answers read`;
}

/** What a visitor reads above an ask's page before their first answer. @param {boolean} kept whether this browser keeps their answers */
export function visitorHint(kept) {
  return `Both optional. Suresh reads every answer, and writes back if you leave your email.${kept ? '' : " This browser won't keep your answers, so you can't change them after you leave."}`;
}

/** What a visitor reads once an answer is saved. @param {boolean} kept */
export function savedLine(kept) {
  return kept ? 'Come back on this browser to change it.' : "This browser keeps nothing, so it can't be changed later.";
}

/** What a visitor reads on a closed ask. */
export const CLOSED_LINE = 'This isn’t taking answers any more.';

/**
 * A history line's words for an ask's event, after who did it, or null for an event that isn't an ask's.
 * @param {string} type
 * @param {string | null} slug
 */
export function askEventWords(type, slug) {
  const at = slug === null ? '' : ` at /ask/${slug}`;
  if (type === 'ask-drafted') return `made this an ask, a draft${at}`;
  if (type === 'ask-opened') return `opened the ask${at} to anyone with the link`;
  if (type === 'ask-closed') return 'closed the ask';
  if (type === 'ask-read') return 'marked the answers read';
  return null;
}
