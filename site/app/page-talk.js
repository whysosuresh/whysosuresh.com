// @ts-check
// The thread's half of what a page and its thread say to each other (frame/bridge.js holds the page's half): which
// messages from a page's frame the threads page takes, checked field by field, and what it tells the page about the
// discussion on it. Plain data and pure functions, so the tests read them without a browser (test/page-talk.test.ts).
//
// A comment sits in one of four places (the Worker's migrations/0013_anchors.sql): on the thread, as an answer to a
// page's question (`question`), on words of the page (`quote`), or under another comment (`parent`). `placesOf` sorts
// a thread's comments into those places once, for the history, the page and the column beside it. A public thread's
// visitors answer too: each visitor's answers carry their key's short hash (`visitor`), so two who typed the same name
// stay two people, and the public call answers each visitor's newest already, so its answers are told as given.
// `helloFor` is the hello that answers a page's `ready`, by who reads it (frame/bridge.js reads the same four).

/** The id a page marks a question with, as the Worker checks it. */
export const QUESTION_SHAPE = /^[a-z0-9-]{1,40}$/;
/** The most words one comment may quote, and the most text kept either side, as the Worker keeps them. */
export const MAX_QUOTE = 500;
export const MAX_CONTEXT = 64;
/** The longest answer, as the Worker keeps a comment. */
export const MAX_ANSWER = 32_000;
/** The most questions or discussions one message from a page names. */
export const MAX_ITEMS = 500;
/** Where a page's words may sit, in CSS pixels from its top. */
const MAX_TOP = 1_000_000;
/** What every message carries under this key: its kind. */
export const KEY = 'whysosuresh';
/** The id of the comment being written on selected words, before it is saved. */
export const DRAFT = 'draft';
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * @typedef {{ id: string, author: string, name: string | null, state: string, body: string, createdAt: string,
 *   personNumber?: number, parent?: string | null, question?: string | null,
 *   quote?: { text: string, prefix: string, suffix: string, version: number } | null, mine?: boolean, visitor?: string }} Comment
 *   What these functions read of a comment, as the thread's call answers it (threads-store.js's Comment has every
 *   field); written out here so the tests' type check, which has no browser, never reads the store's fetches.
 * @typedef {{ quote: string, prefix: string, suffix: string }} Words
 * @typedef {{ kind: 'height', height: number } | { kind: 'ready', questions: string[] }
 *   | { kind: 'selected', quote: string, prefix: string, suffix: string, top: number } | { kind: 'answer', question: string, body: string }
 *   | { kind: 'anchors', anchors: { id: string, top: number | null }[], questions: { id: string, top: number }[] } | { kind: 'open', id: string }} FromPage
 */

/**
 * A thread's comments by where they sit.
 * @template {Comment} [C=Comment]
 * @typedef {{ general: C[], answers: C[], words: C[], replies: Map<string, C[]> }} Places
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {Record<string, unknown>} value @param {readonly string[]} keys */
function hasExactly(value, keys) {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

/** @param {unknown} value @param {number} max @returns {value is string} */
function isText(value, max) {
  return typeof value === 'string' && value.length <= max;
}

/** @param {unknown} value @returns {value is number} */
function isTop(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= -MAX_TOP && value <= MAX_TOP;
}

/** A comment's id as the store gives it, or the composer's. @param {unknown} value @returns {value is string} */
export function isId(value) {
  return typeof value === 'string' && (value === DRAFT || ID_SHAPE.test(value));
}

/**
 * A message from a page's frame as the threads page takes it, or null for anything that isn't exactly one of its six
 * kinds, in range. The words of a selection keep their spaces and line breaks; a question named twice is one.
 * @param {unknown} data
 * @returns {FromPage | null}
 */
export function readPageMessage(data) {
  if (!isRecord(data)) return null;
  switch (data[KEY]) {
    case 'height':
      return hasExactly(data, [KEY, 'height']) && typeof data.height === 'number' && Number.isFinite(data.height) ? { kind: 'height', height: data.height } : null;
    case 'ready': {
      const { questions } = data;
      if (!hasExactly(data, [KEY, 'questions']) || !Array.isArray(questions) || questions.length > MAX_ITEMS) return null;
      if (!questions.every((id) => typeof id === 'string' && QUESTION_SHAPE.test(id))) return null;
      return { kind: 'ready', questions: [...new Set(/** @type {string[]} */ (questions))] };
    }
    case 'selected': {
      const { quote, prefix, suffix, top } = data;
      if (!hasExactly(data, [KEY, 'quote', 'prefix', 'suffix', 'top'])) return null;
      if (!isText(quote, MAX_QUOTE) || quote.trim() === '' || !isText(prefix, MAX_CONTEXT) || !isText(suffix, MAX_CONTEXT) || !isTop(top)) return null;
      return { kind: 'selected', quote, prefix, suffix, top };
    }
    case 'answer': {
      const { question, body } = data;
      if (!hasExactly(data, [KEY, 'question', 'body']) || typeof question !== 'string' || !QUESTION_SHAPE.test(question)) return null;
      if (!isText(body, MAX_ANSWER) || body.trim() === '') return null;
      return { kind: 'answer', question, body: body.trim() };
    }
    case 'anchors': {
      const { anchors, questions } = data;
      if (!hasExactly(data, [KEY, 'anchors', 'questions']) || !Array.isArray(anchors) || !Array.isArray(questions)) return null;
      if (anchors.length > MAX_ITEMS || questions.length > MAX_ITEMS) return null;
      /** @type {{ id: string, top: number | null }[]} */
      const placed = [];
      for (const one of anchors) {
        if (!isRecord(one) || !isId(one.id)) return null;
        if (hasExactly(one, ['id', 'top']) && isTop(one.top)) placed.push({ id: one.id, top: one.top });
        else if (hasExactly(one, ['id', 'missing']) && one.missing === true) placed.push({ id: one.id, top: null });
        else return null;
      }
      /** @type {{ id: string, top: number }[]} */
      const asked = [];
      for (const one of questions) {
        if (!isRecord(one) || !hasExactly(one, ['id', 'top']) || typeof one.id !== 'string' || !QUESTION_SHAPE.test(one.id) || !isTop(one.top)) return null;
        asked.push({ id: one.id, top: one.top });
      }
      return { kind: 'anchors', anchors: placed, questions: asked };
    }
    case 'open':
      return hasExactly(data, [KEY, 'id']) && isId(data.id) && data.id !== DRAFT ? { kind: 'open', id: /** @type {string} */ (data.id) } : null;
    default:
      return null;
  }
}

/**
 * The `hello` that answers a page's `ready`, by who reads it: a signed-in reader (`member`, the owner or a person he
 * invited) answers in boxes and comments on words; a public thread's visitor (`visitor`) answers in public boxes; an
 * ask's visitor (`private`) answers in boxes only Suresh reads; and the owner on an ask (`read`) reads the answers
 * under the questions with no box to type in. The first two are what the page always said, unchanged.
 * @param {'member' | 'visitor' | 'private' | 'read'} as
 */
export function helloFor(as) {
  if (as === 'member') return { [KEY]: 'hello' };
  if (as === 'visitor') return { [KEY]: 'hello', visitor: true };
  return { [KEY]: 'hello', mode: as };
}

/**
 * Whether a page answered with this hello takes answers from its frame: every one but a page he only reads (`read`),
 * whose boxes aren't drawn, so an answer from it can only be a page script's own.
 * @param {'member' | 'visitor' | 'private' | 'read'} as
 */
export function takesAnswers(as) {
  return as !== 'read';
}

/**
 * A thread's comments by where they sit, each list oldest first: on the thread, answers, discussions on the page's
 * words, and every comment's replies by its id. Dropped notes are left out, as the history leaves them out.
 * @template {Comment} C
 * @param {readonly C[]} comments
 * @returns {Places<C>}
 */
export function placesOf(comments) {
  /** @type {Places<C>} */
  const places = { general: [], answers: [], words: [], replies: new Map() };
  for (const said of comments) {
    if (said.state === 'dropped') continue;
    if (said.parent) places.replies.set(said.parent, [...(places.replies.get(said.parent) ?? []), said]);
    else if (said.question) places.answers.push(said);
    else if (said.quote) places.words.push(said);
    else places.general.push(said);
  }
  return places;
}

/**
 * Each person's newest answer to each question, in the order they answered: changing an answer is a new answer, and
 * the page shows the newest. A person is their own answers (`mine`), a visitor by their key (`visitor`), or the writer
 * by number for the owner, else by kind and name.
 * @template {Comment} C
 * @param {readonly C[]} answers
 * @returns {C[]}
 */
export function newestAnswers(answers) {
  /** @type {Map<string, C>} */
  const by = new Map();
  for (const said of answers) {
    const who = said.mine ? 'me' : said.visitor !== undefined ? `visitor:${said.visitor}` : said.personNumber !== undefined ? `#${said.personNumber}` : `${said.author}:${said.name ?? ''}`;
    const key = `${said.question}\u0000${who}`;
    by.delete(key);
    by.set(key, said);
  }
  return [...by.values()];
}

/**
 * What the page is told: each person's newest answer by name (`ownerName` for the owner's), the words of every
 * discussion and of the comment being written, and the one shown as chosen. Never an address or a person's number.
 * `asGiven` tells the answers as they are, for a list that holds each writer's newest already (the public call's).
 * @param {Places} places
 * @param {{ ownerName: string, draft: Words | null, active: string | null, asGiven?: boolean }} options
 */
export function discussionFor(places, options) {
  return {
    [KEY]: 'discussion',
    answers: (options.asGiven ? places.answers : newestAnswers(places.answers)).map((said) => ({
      question: said.question ?? '',
      name: said.author === 'owner' ? options.ownerName : (said.name?.trim() || 'Someone'),
      body: said.body,
      at: said.createdAt,
      mine: said.mine === true,
    })),
    anchors: [
      ...places.words.map((said) => ({ id: said.id, quote: said.quote?.text ?? '', prefix: said.quote?.prefix ?? '', suffix: said.quote?.suffix ?? '' })),
      ...(options.draft ? [{ id: DRAFT, ...options.draft }] : []),
    ],
    active: options.active,
  };
}

/**
 * Where each card beside the page goes: level with its words, less a little so the card's quote lines up with them,
 * and never over the card above it. `wanted` is each card's words' top in the column, `heights` each card's height.
 * @param {readonly { id: string, want: number, height: number }[]} cards
 * @param {number} gap
 * @returns {{ placed: Map<string, number>, bottom: number }}
 */
export function stack(cards, gap) {
  /** @type {Map<string, number>} */
  const placed = new Map();
  let floor = 0;
  for (const card of [...cards].sort((a, b) => a.want - b.want)) {
    const top = Math.max(card.want, floor);
    placed.set(card.id, top);
    floor = top + card.height + gap;
  }
  return { placed, bottom: floor };
}
