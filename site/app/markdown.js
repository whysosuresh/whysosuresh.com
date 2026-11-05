// @ts-check
// The small part of GitHub's Markdown the threads read, as plain data: what the recorder sync and Suresh write
// (a moved issue with its comments, an idea written up, a comment, a living summary) is Markdown, and showing
// its `##` and `**` raw makes it hard to read. This module only parses: it returns blocks and inline runs, never
// HTML, and the threads page (site/app/threads.js) builds them with DOM calls,
// so nothing in anyone's words can become markup. What it knows: headings, paragraphs (their line breaks kept),
// quotes, bullet and numbered lists (task boxes shown as ☐ and ☑), fenced code, rules, and tables kept as
// preformatted text, as typed; inline code, bold, italic with `*`, links to http(s) addresses, and a thread's
// number (`#59`), which the threads page links to that thread. A living summary written as labelled lines
// ("Decided: …", "Open: …") is read as those lines (`summaryLines`), and drawn as a grid; any other summary is
// Markdown. Anything else stays as the text it is. Notes visitors type on the site are never parsed.

/**
 * @typedef {{ type: 'text', text: string } | { type: 'code', text: string } | { type: 'strong', text: string }
 *   | { type: 'em', text: string } | { type: 'link', text: string, href: string } | { type: 'thread', number: number }} Inline
 * @typedef {{ type: 'p', inline: Inline[] } | { type: 'h', inline: Inline[] } | { type: 'quote', inline: Inline[] }
 *   | { type: 'list', ordered: boolean, items: Inline[][] } | { type: 'pre', text: string } | { type: 'rule' }} Block
 */

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const TABLE = /^\s*\|.*\|\s*$/;
const TASK = /^\[([ xX])\]\s+/;
/**
 * Inline code, bold, a link to an http(s) address, italic with `*`, a thread's number; the first that starts
 * earliest wins. A number is `#` and one to nine digits with no leading zero, at the start or after a space or an
 * opening bracket, and not followed by a letter, a digit or `_`, so `a#1`, `#1a` and `#0` stay text.
 */
const INLINE = /(`[^`\n]+`)|(\*\*(?=\S)[^*\n]*?\S\*\*)|(\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\))|(\*(?=[^*\s])[^*\n]*?[^*\s]\*)|((?<=^|[\s(\[])#([1-9]\d{0,8})(?![\w]))/g;
/** One line of a living summary: a capitalised label of at most 20 characters, a colon, then its words. */
const SUMMARY_LINE = /^\s*\*{0,2}([A-Z][A-Za-z ]{0,19}?)\*{0,2}:\*{0,2}\s+(\S.*)$/;

/**
 * The inline runs of one stretch of text.
 * @param {string} text
 * @returns {Inline[]}
 */
export function inline(text) {
  /** @type {Inline[]} */
  const runs = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > at) runs.push({ type: 'text', text: text.slice(at, start) });
    const [whole, code, strong, , label, href, em, , number] = match;
    if (code !== undefined) runs.push({ type: 'code', text: code.slice(1, -1) });
    else if (strong !== undefined) runs.push({ type: 'strong', text: strong.slice(2, -2) });
    else if (label !== undefined && href !== undefined) runs.push({ type: 'link', text: label, href });
    else if (em !== undefined) runs.push({ type: 'em', text: em.slice(1, -1) });
    else if (number !== undefined) runs.push({ type: 'thread', number: Number(number) });
    at = start + whole.length;
  }
  if (at < text.length) runs.push({ type: 'text', text: text.slice(at) });
  return runs;
}

/**
 * One list item: its first line without the marker, then the lines indented under it.
 * @param {string[]} lines
 */
function listItem(lines) {
  const [first = '', ...rest] = lines;
  const text = [(BULLET.exec(first) ?? NUMBERED.exec(first))?.[1] ?? first, ...rest].join('\n');
  const task = TASK.exec(text);
  return inline(task ? `${task[1] === ' ' ? '☐' : '☑'} ${text.slice(task[0].length)}` : text);
}

/** @param {string} line */
function startsBlock(line) {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || BULLET.test(line) || NUMBERED.test(line) || TABLE.test(line);
}

/**
 * The blocks of a Markdown text.
 * @param {string} source
 * @returns {Block[]}
 */
export function parse(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  /** @type {Block[]} */
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith(fence[1] ?? '```')) body.push(lines[i++] ?? '');
      i += 1;
      blocks.push({ type: 'pre', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'h', inline: inline(heading[1] ?? '') });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }
    if (TABLE.test(line)) {
      const rows = [];
      while (i < lines.length && TABLE.test(lines[i] ?? '')) rows.push((lines[i++] ?? '').trim());
      blocks.push({ type: 'pre', text: rows.join('\n') });
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) quoted.push(QUOTE.exec(lines[i++] ?? '')?.[1] ?? '');
      blocks.push({ type: 'quote', inline: inline(quoted.join('\n').trim()) });
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line);
      /** @type {Inline[][]} */
      const items = [];
      /** @type {string[]} */
      let item = [];
      while (i < lines.length) {
        const next = lines[i] ?? '';
        if (ordered ? NUMBERED.test(next) : BULLET.test(next)) {
          if (item.length > 0) items.push(listItem(item));
          item = [next];
        } else if (next.trim() !== '' && /^\s+\S/.test(next) && !startsBlock(next.trimStart())) {
          item.push(next.trim());
        } else {
          break;
        }
        i += 1;
      }
      if (item.length > 0) items.push(listItem(item));
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const paragraph = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && (paragraph.length === 0 || !startsBlock(lines[i] ?? ''))) {
      paragraph.push((lines[i++] ?? '').trim());
    }
    blocks.push({ type: 'p', inline: inline(paragraph.join('\n')) });
  }
  return blocks;
}

/**
 * A living summary's labelled lines, as label and inline runs, when every line that isn't blank is one
 * ("Decided: a release needs two people."); null for any other summary, which is drawn as Markdown.
 * @param {string} source
 * @returns {{ label: string, inline: Inline[] }[] | null}
 */
export function summaryLines(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim() !== '');
  /** @type {{ label: string, inline: Inline[] }[]} */
  const read = [];
  for (const line of lines) {
    const match = SUMMARY_LINE.exec(line);
    if (match === null) return null;
    read.push({ label: (match[1] ?? '').trim(), inline: inline((match[2] ?? '').trim()) });
  }
  return read.length === 0 ? null : read;
}
