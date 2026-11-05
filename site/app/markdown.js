// @ts-check
// The part of GitHub's Markdown the threads read, as plain data, plus the blocks a thread's text is drawn from.
// What the recorder sync and the owner write (a thread's main text, its comments, a moved issue) is Markdown,
// and showing its `##` and `**` raw makes it hard to read. This module only parses: it returns blocks and inline
// runs, never HTML, and the pages build them with DOM calls (site/app/blocks.js), so nothing in a thread's words
// can become markup. Notes visitors type on the site are never parsed.
//
// What it knows: headings, paragraphs (their line breaks kept), quotes, bullet and numbered lists (task boxes
// shown as ☐ and ☑), fenced code, rules, and GitHub's pipe tables, as rows when a line of dashes follows the
// header and as preformatted text otherwise; inline code, bold, italic with `*`, links to http(s) addresses, and
// a thread's number (`#42`). And the blocks: a line `:::name`, Markdown, then a line `:::`, for
//
//   :::decision <question>     the options as a list, any other line a note under them
//   :::numbers                 lines of `value · label`
//   :::timeline                lines of `when · what happened`
//   :::columns                 two parts split by a line `+++`
//   :::link <http(s) address>  a title line, then an optional line under it
//
// A name it doesn't know, a block never closed, a link block without an http(s) address, or columns that aren't
// two parts stay as the text they are, so the same text reads as plain lines in GitHub, the command line or an
// email. Blocks don't nest: inside a column, `:::` is text. Each block keeps its own lines (`source`), so a reader
// that doesn't draw blocks can show them as written. `summaryLines` reads a thread's living summary: lines of
// `Label: words`, which the page lines up.

/**
 * @typedef {{ type: 'text', text: string } | { type: 'code', text: string } | { type: 'strong', text: string }
 *   | { type: 'em', text: string } | { type: 'link', text: string, href: string }
 *   | { type: 'thread', number: number }} Inline
 * @typedef {{ type: 'p', inline: Inline[] } | { type: 'h', inline: Inline[] } | { type: 'quote', inline: Inline[] }
 *   | { type: 'list', ordered: boolean, items: Inline[][] } | { type: 'pre', text: string } | { type: 'rule' }
 *   | { type: 'table', head: Inline[][], rows: Inline[][][] }
 *   | { type: 'decision', question: Inline[], options: Inline[][], note: Inline[][], source: string }
 *   | { type: 'numbers', items: { value: Inline[], label: Inline[] }[], source: string }
 *   | { type: 'timeline', items: { when: Inline[], what: Inline[] }[], source: string }
 *   | { type: 'columns', columns: Block[][], source: string }
 *   | { type: 'card', href: string, title: Inline[], note: Inline[] | null, source: string }} Block
 * @typedef {{ label: string, inline: Inline[] }} SummaryLine
 */

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const TABLE = /^\s*\|.*\|\s*$/;
const TABLE_CELL_RULE = /^:?-+:?$/;
const TASK = /^\[([ xX])\]\s+/;
const OPEN_BLOCK = /^:::([a-z]+)(?:[ \t]+(.*?))?\s*$/;
const CLOSE_BLOCK = /^:::\s*$/;
const COLUMN_BREAK = /^\+\+\+\s*$/;
const WEB_ADDRESS = /^https?:\/\/\S{1,2000}$/;
/** What separates a value from its label, and a date from what happened: a middle dot with a space each side. */
const DOT = ' · ';
const BLOCK_NAMES = ['decision', 'numbers', 'timeline', 'columns', 'link'];
/**
 * Inline code, bold, a link to an http(s) address, italic with `*`, a thread's number; the first that starts
 * earliest wins. A number joined to a word (`stigmer#311`, `&#39;`) is not a thread's.
 */
const INLINE = /(`[^`\n]+`)|(\*\*(?=\S)[^*\n]*?\S\*\*)|(\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\))|(\*(?=[^*\s])[^*\n]*?[^*\s]\*)|((?<![\w#&/])#([1-9]\d{0,8})(?![\w-]))/g;
const SUMMARY_LINE = /^\*{0,2}([A-Z][A-Za-z ]{0,18}?):\*{0,2}\s+(.+)$/;

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

/** @param {string} row */
function cells(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

/**
 * A line, without a list marker, split at its first middle dot: [before, after], or ['', line] with none.
 * @param {string} line
 * @returns {[string, string]}
 */
function splitDot(line) {
  const text = (BULLET.exec(line)?.[1] ?? line).trim();
  const at = text.indexOf(DOT);
  return at < 0 ? ['', text] : [text.slice(0, at).trim(), text.slice(at + DOT.length).trim()];
}

/**
 * The block that opens at `lines[at]`, drawn from its lines, with where it ends; null when the line opens none
 * this module draws: no known name, no closing line, or content a block can't hold.
 * @param {string[]} lines
 * @param {number} at
 * @returns {{ block: Block, end: number } | null}
 */
function blockAt(lines, at) {
  const open = OPEN_BLOCK.exec(lines[at] ?? '');
  const name = open?.[1] ?? '';
  if (!open || !BLOCK_NAMES.includes(name)) return null;
  let end = at + 1;
  while (end < lines.length && !CLOSE_BLOCK.test(lines[end] ?? '')) end += 1;
  if (end >= lines.length) return null;
  const arg = (open[2] ?? '').trim();
  const body = lines.slice(at + 1, end);
  const filled = body.filter((line) => line.trim() !== '');
  const source = lines.slice(at, end + 1).join('\n');
  switch (name) {
    case 'decision': {
      const options = filled.filter((line) => BULLET.test(line)).map((line) => inline((BULLET.exec(line)?.[1] ?? line).trim()));
      const note = filled.filter((line) => !BULLET.test(line)).map((line) => inline(line.trim()));
      return { block: { type: 'decision', question: inline(arg), options, note, source }, end };
    }
    case 'numbers':
      return { block: { type: 'numbers', items: filled.map(splitDot).map(([value, label]) => ({ value: inline(value), label: inline(label) })), source }, end };
    case 'timeline':
      return { block: { type: 'timeline', items: filled.map(splitDot).map(([when, what]) => ({ when: inline(when), what: inline(what) })), source }, end };
    case 'columns': {
      /** @type {string[][]} */
      const parts = [[]];
      for (const line of body) {
        if (COLUMN_BREAK.test(line)) parts.push([]);
        else parts[parts.length - 1]?.push(line);
      }
      if (parts.length !== 2) return null;
      return { block: { type: 'columns', columns: parts.map((part) => parseLines(part, false)), source }, end };
    }
    case 'link': {
      if (!WEB_ADDRESS.test(arg)) return null;
      const [title, note] = filled;
      return { block: { type: 'card', href: arg, title: inline((title ?? arg).trim()), note: note === undefined ? null : inline(note.trim()), source }, end };
    }
    default:
      return null;
  }
}

/**
 * The blocks of a Markdown text.
 * @param {string} source
 * @returns {Block[]}
 */
export function parse(source) {
  return parseLines(source.replace(/\r\n?/g, '\n').split('\n'), true);
}

/**
 * @param {string[]} lines
 * @param {boolean} blocks whether `:::` blocks are drawn here (not inside a column)
 * @returns {Block[]}
 */
function parseLines(lines, blocks) {
  /** @type {Block[]} */
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const found = blocks ? blockAt(lines, i) : null;
    if (found) {
      out.push(found.block);
      i = found.end + 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith(fence[1] ?? '```')) body.push(lines[i++] ?? '');
      i += 1;
      out.push({ type: 'pre', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ type: 'h', inline: inline(heading[1] ?? '') });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ type: 'rule' });
      i += 1;
      continue;
    }
    if (TABLE.test(line)) {
      const rows = [];
      while (i < lines.length && TABLE.test(lines[i] ?? '')) rows.push((lines[i++] ?? '').trim());
      const [head = '', rule = '', ...rest] = rows;
      const headCells = cells(head);
      if (rows.length >= 2 && cells(rule).every((cell) => TABLE_CELL_RULE.test(cell)) && cells(rule).length === headCells.length) {
        out.push({ type: 'table', head: headCells.map(inline), rows: rest.map((row) => headCells.map((_, k) => inline(cells(row)[k] ?? ''))) });
      } else {
        out.push({ type: 'pre', text: rows.join('\n') });
      }
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) quoted.push(QUOTE.exec(lines[i++] ?? '')?.[1] ?? '');
      out.push({ type: 'quote', inline: inline(quoted.join('\n').trim()) });
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
      out.push({ type: 'list', ordered, items });
      continue;
    }
    const paragraph = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      (paragraph.length === 0 || (!startsBlock(lines[i] ?? '') && !(blocks && blockAt(lines, i))))
    ) {
      paragraph.push((lines[i++] ?? '').trim());
    }
    out.push({ type: 'p', inline: inline(paragraph.join('\n')) });
  }
  return out;
}

/**
 * A living summary as labelled lines (`Decided: a release needs two people`), or null when any line isn't one,
 * and the summary is then drawn as Markdown.
 * @param {string} summary
 * @returns {SummaryLine[] | null}
 */
export function summaryLines(summary) {
  const lines = summary.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim() !== '');
  /** @type {SummaryLine[]} */
  const out = [];
  for (const line of lines) {
    const match = SUMMARY_LINE.exec(line.trim());
    if (!match) return null;
    out.push({ label: (match[1] ?? '').trim(), inline: inline((match[2] ?? '').trim()) });
  }
  return out.length > 0 ? out : null;
}
