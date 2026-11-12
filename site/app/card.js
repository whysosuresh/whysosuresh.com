// @ts-check
// A public thread's preview card, the picture a chat shows under its link: its number, its title, his face and
// hey.whysosuresh.com, black, on a 1200 x 630 canvas his own page draws and uploads (`refreshCards` in
// site/app/threads.js; the Worker only checks and keeps the bytes, src/cards.ts). Two halves: `layoutCard` decides
// every line, size, wrap and ellipsis from a measuring function alone, so a test runs it in Node with no canvas;
// site/app/card-paint.js only paints what the layout says, the one half that needs a browser. A card with no number
// is the site's own card, his face large with his name, which a thread's preview shows until its own card is drawn:
// `site/img/card.png`, exported once from this code in Chrome (`cardBlob` with `{ number: null, title: null }`, his
// photo and the page's `--font`, the PNG saved as it came), and exported again only when this look or his photo
// changes. Sizes are chosen for the phone: a chat shows the card about a quarter size, so nothing is under 40 px here
// (10 px there).
//
// `cardStamp` is the record of what a drawn card shows (the layout's version, the thread's number and title, and his
// photo's id), kept beside the card by the Worker, so his page redraws exactly the cards whose stamp differs. The
// font family is left out on purpose: opening the site on another device must not redraw every card. A card asks
// the network for nothing.

/** The card's size, the large preview size chats ask for (1.91:1). */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
/** Bumped whenever the layout changes, so every drawn card counts as stale and is drawn again. */
export const CARD_LAYOUT = 1;
/** The name the site card shows, and whose first letter stands in for his face when he has no photo. */
export const CARD_NAME = 'Suresh Attaluri';

/** The card's colours, the site's own dark tokens (site/style.css). */
const CARD_INK = { background: '#0a0a0a', ink: '#f1f1f1', muted: '#a3a3a3' };

const MARGIN = 80;
const NUMBER_SIZE = 44;
const TITLE_TOP = 150;
const TITLE_SIZES = [76, 72, 68, 64, 60, 56];
const TITLE_LINES = 3;
const TITLE_LEADING = 1.15;
const BARE_NUMBER_SIZE = 160;
const FACE_SIZE = 88;
const FACE_GAP = 28;
const TEXT_ABOVE_FACE = 40;
const DOMAIN = 'hey.whysosuresh.com';
const DOMAIN_SIZE = 40;
const SITE_FACE_SIZE = 200;
const SITE_NAME_SIZE = 76;
/** Where a line's baseline sits under the top of its box, and a capital's height, as shares of the font size. */
const ASCENT = 0.95;
const CAP = 0.72;
const ELLIPSIS = '…';

/**
 * @typedef {{ number: number | null, title: string | null }} Card everything the card says about a thread; no
 *   number is the site's own card
 * @typedef {{ family: string, name: string }} CardStyle the font family (the page's --font) and his name
 * @typedef {(text: string, font: string) => number} Measure the width of a string drawn in a CSS font
 * @typedef {'background' | 'ink' | 'muted'} Tone
 * @typedef {{ text: string, font: string, tone: Tone, x: number, y: number, align: 'left' | 'center' }} CardLine
 *   one line of text, its y the baseline
 * @typedef {{ x: number, y: number, size: number, initial: CardLine }} CardFace his face's square, and his initial
 *   for when there is no photo
 * @typedef {{ width: number, height: number, background: string, ink: string, muted: string, lines: CardLine[],
 *   face: CardFace }} CardLayout
 */

/** @param {string} text */
function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/** @param {string} text @returns {{ segment: string, index: number }[]} */
function segments(text, /** @type {'grapheme' | 'word'} */ granularity) {
  return Array.from(new Intl.Segmenter(undefined, { granularity }).segment(text), ({ segment, index }) => ({ segment, index }));
}

/**
 * Lines that fit `width`, each with where it starts in `text`. A line breaks after a space; a run too wide for a
 * line of its own breaks between its words, and a word too wide between its graphemes, so a script without spaces
 * still wraps and no line splits a letter.
 * @param {string} text one line of text, spaces collapsed @param {string} font @param {number} width
 * @param {Measure} measure @returns {{ text: string, start: number }[]}
 */
function wrapLines(text, font, width, measure) {
  /** @type {{ text: string, start: number }[]} */
  const lines = [];
  let line = '';
  let start = 0;
  const fits = (/** @type {string} */ candidate) => measure(candidate.trimEnd(), font) <= width;
  const add = (/** @type {string} */ piece, /** @type {number} */ at) => {
    if (line === '') start = at;
    else if (!fits(line + piece)) {
      lines.push({ text: line.trimEnd(), start });
      line = '';
      start = at;
    }
    line += piece;
  };
  for (const run of text.matchAll(/\S+\s*/g)) {
    const at = run.index ?? 0;
    if (fits(run[0])) {
      add(run[0], at);
      continue;
    }
    for (const word of segments(run[0], 'word')) {
      if (fits(word.segment)) add(word.segment, at + word.index);
      else for (const letter of segments(word.segment, 'grapheme')) add(letter.segment, at + word.index + letter.index);
    }
  }
  if (line.trim() !== '') lines.push({ text: line.trimEnd(), start });
  return lines;
}

/**
 * `text` cut to fit `width` with an ellipsis, never inside a grapheme; at a space when one falls in its second half.
 * @param {string} text @param {string} font @param {number} width @param {Measure} measure
 */
function withEllipsis(text, font, width, measure) {
  if (measure(text, font) <= width) return text;
  const letters = segments(text, 'grapheme').map((letter) => letter.segment);
  let kept = letters.length;
  while (kept > 0 && measure(letters.slice(0, kept).join('').trimEnd() + ELLIPSIS, font) > width) kept -= 1;
  const cut = letters.slice(0, kept).join('');
  const space = cut.trimEnd().lastIndexOf(' ');
  return (space > cut.length / 2 ? cut.slice(0, space) : cut).trimEnd() + ELLIPSIS;
}

/**
 * At most `max` lines of `text`, the last ending in an ellipsis when the text runs on.
 * @param {string} text @param {string} font @param {number} width @param {number} max @param {Measure} measure
 * @returns {string[]}
 */
function clampLines(text, font, width, max, measure) {
  const lines = wrapLines(text, font, width, measure);
  if (lines.length <= max) return lines.map((line) => line.text);
  const last = lines[max - 1];
  return [...lines.slice(0, max - 1).map((line) => line.text), withEllipsis(text.slice(last?.start ?? 0), font, width, measure)];
}

/**
 * The title at the largest size that fits `height` in at most three lines; when none does, the smallest size with
 * an ellipsis.
 * @param {string} title @param {string} family @param {number} height @param {Measure} measure
 * @returns {{ lines: string[], size: number, leading: number }}
 */
function fitTitle(title, family, height, measure) {
  const width = CARD_WIDTH - 2 * MARGIN;
  for (const size of TITLE_SIZES) {
    const font = `700 ${size}px ${family}`;
    const leading = Math.round(size * TITLE_LEADING);
    const lines = wrapLines(title, font, width, measure);
    if (lines.length <= TITLE_LINES && lines.length * leading <= height) return { lines: lines.map((line) => line.text), size, leading };
  }
  const size = TITLE_SIZES[TITLE_SIZES.length - 1] ?? 56;
  const leading = Math.round(size * TITLE_LEADING);
  const max = Math.max(1, Math.min(TITLE_LINES, Math.floor(height / leading)));
  return { lines: clampLines(title, `700 ${size}px ${family}`, width, max, measure), size, leading };
}

/**
 * His face's square and his initial, centred in it.
 * @param {number} x @param {number} y @param {number} size @param {CardStyle} style @returns {CardFace}
 */
function faceAt(x, y, size, style) {
  const letterSize = Math.round(size * 0.46);
  const initial = segments(style.name.trim(), 'grapheme')[0]?.segment.toLocaleUpperCase() ?? '';
  return {
    x,
    y,
    size,
    initial: { text: initial, font: `600 ${letterSize}px ${style.family}`, tone: 'background', x: x + size / 2, y: Math.round(y + size / 2 + (letterSize * CAP) / 2), align: 'center' },
  };
}

/**
 * Every line the card draws and where his face sits.
 * @param {Card} card @param {CardStyle} style @param {Measure} measure @returns {CardLayout}
 */
export function layoutCard(card, style, measure) {
  const family = style.family;
  /** @type {CardLine[]} */
  const lines = [];
  const line = (/** @type {string} */ text, /** @type {string} */ font, /** @type {Tone} */ tone, /** @type {number} */ x, /** @type {number} */ y) =>
    lines.push({ text, font, tone, x, y: Math.round(y), align: 'left' });

  if (card.number === null) {
    const faceTop = (CARD_HEIGHT - SITE_FACE_SIZE) / 2;
    const x = MARGIN + SITE_FACE_SIZE + 48;
    const nameBaseline = CARD_HEIGHT / 2 - 9;
    line(style.name, `700 ${SITE_NAME_SIZE}px ${family}`, 'ink', x, nameBaseline);
    line(DOMAIN, `400 ${DOMAIN_SIZE}px ${family}`, 'muted', x, nameBaseline + 64);
    return { width: CARD_WIDTH, height: CARD_HEIGHT, ...CARD_INK, lines, face: faceAt(MARGIN, faceTop, SITE_FACE_SIZE, style) };
  }

  const faceTop = CARD_HEIGHT - MARGIN - FACE_SIZE;
  const face = faceAt(MARGIN, faceTop, FACE_SIZE, style);
  line(DOMAIN, `400 ${DOMAIN_SIZE}px ${family}`, 'muted', MARGIN + FACE_SIZE + FACE_GAP, faceTop + FACE_SIZE / 2 + DOMAIN_SIZE * 0.33);
  const bottom = faceTop - TEXT_ABOVE_FACE;
  const number = `#${card.number}`;
  const title = oneLine(card.title ?? '');

  if (title === '') {
    line(number, `700 ${BARE_NUMBER_SIZE}px ${family}`, 'ink', MARGIN, (MARGIN + bottom) / 2 + (BARE_NUMBER_SIZE * CAP) / 2);
    return { width: CARD_WIDTH, height: CARD_HEIGHT, ...CARD_INK, lines, face };
  }

  line(number, `500 ${NUMBER_SIZE}px ${family}`, 'muted', MARGIN, MARGIN + NUMBER_SIZE * CAP);
  const fitted = fitTitle(title, family, bottom - TITLE_TOP, measure);
  fitted.lines.forEach((text, at) => line(text, `700 ${fitted.size}px ${family}`, 'ink', MARGIN, TITLE_TOP + fitted.size * ASCENT + at * fitted.leading));
  return { width: CARD_WIDTH, height: CARD_HEIGHT, ...CARD_INK, lines, face };
}

/**
 * What a drawn card shows, as 64 lowercase hex characters: the SHA-256 of `[CARD_LAYOUT, number, title, photo]` as
 * JSON. Two cards with the same stamp are the same picture on any device but for its fonts.
 * @param {Card} card @param {string | null} photo his photo's id, or null for his initial @returns {Promise<string>}
 */
export async function cardStamp(card, photo) {
  const said = JSON.stringify([CARD_LAYOUT, card.number, card.title, photo]);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(said)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
