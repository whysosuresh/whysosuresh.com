// @ts-check
// Suresh's journal, read: one entry is the whole page text the recorder sync writes for a day (`2026-11-06`) or a
// week's chapter (`2026-W44`), in the sync's small page grammar, blocks apart by blank lines: `## title` with an
// italic line under it, `### story` with its own italic when, `> quote`, `· · ·` between the card, each story and the
// close, `- ` contents lines, `**Label:** …` and `→ …` margin lines, `![caption](photo:<id>)` photos, and inline bold,
// italic and links. This module only parses: it returns data, never HTML, and the threads page (site/app/threads.js)
// builds it with DOM calls, so nothing in a page can become markup. The Worker imports it too (src/journal.ts), to
// index each saved version (its title, line, stories, photos, question and storylines), so a page is read one way.
// It also holds the journal's keys and ISO weeks, its addresses, and the countdown rule: a storyline line saying
// "N days to go" on day D counts down to D + N, so every page shows the days left from today, not from the day it was
// written. Today is always given (the page makes it in the reader's zone), so nothing here reads a clock; plain data
// and pure functions, which the site test holds.

/**
 * @typedef {{ type: 'text', text: string } | { type: 'strong', text: string } | { type: 'em', text: string }
 *   | { type: 'link', text: string, href: string } | { type: 'site', text: string, path: string }} Inline
 * @typedef {{ type: 'p', inline: Inline[] } | { type: 'quote', inline: Inline[] } | { type: 'list', items: Inline[][] }
 *   | { type: 'photo', id: string | null, caption: Inline[] }} Block
 * @typedef {'new' | 'closed' | null} Mark
 * @typedef {{ name: string, state: string, mark: Mark }} Storyline
 * @typedef {{ when: string | null, title: string }} Contents
 * @typedef {{ title: string | null, when: string | null, blocks: Block[] }} Story
 * @typedef {{
 *   title: string, subtitle: string | null, oneLine: string | null, contents: Contents[], people: string[],
 *   wins: string[], storylines: Storyline[], body: Block[], stories: Story[], sittingWith: string | null,
 *   stillAsking: string | null, question: string | null, quiet: string | null, weekAhead: string | null,
 *   arrows: Inline[][], note: string | null, notes: { label: string, text: string }[]
 * }} Entry
 * @typedef {{ key: string, state: string, mark: Mark }} Touch
 * @typedef {{ target: string, left: number }} Countdown
 */

/** The journal's room, and every address under it (the threads page draws them; src/pages.ts hands them the shell). */
export const JOURNAL_PATH = '/journal';
export const STORYLINES_PATH = '/journal/storylines';
/** The site itself: a link to one of its own addresses opens in place, every other link in a new tab. */
export const SITE_ORIGIN = 'https://whysosuresh.com';
/** A day's key, and a week's, as they name an entry and its address. */
export const DAY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const WEEK_SHAPE = /^(\d{4})-W(\d{2})$/;
/** A photo the sync uploaded, as a page names it: `photo:` and its id. Any other source draws as its caption alone. */
export const PHOTO_SOURCE = /^photo:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const DAY_MS = 24 * 3600 * 1000;

/** Whether `key` is a real calendar day, `YYYY-MM-DD`. @param {string} key */
export function isDayKey(key) {
  if (!DAY_SHAPE.test(key)) return false;
  const time = Date.parse(`${key}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === key;
}

/** The ISO week a day falls in, `YYYY-Www` (weeks run Monday to Sunday; week 1 holds the year's first Thursday). @param {string} day */
export function weekOf(day) {
  const time = Date.parse(`${day}T00:00:00Z`);
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  const thursday = time + (3 - weekday) * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const january4 = Date.UTC(year, 0, 4);
  const firstMonday = january4 - ((new Date(january4).getUTCDay() + 6) % 7) * DAY_MS;
  const week = Math.floor((thursday - firstMonday) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Whether `key` is a real ISO week, `YYYY-Www`. @param {string} key */
export function isWeekKey(key) {
  const match = WEEK_SHAPE.exec(key);
  if (match === null) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // 28 December is always in the year's last week, so its week number is how many weeks the year has.
  return week >= 1 && year >= 1000 && week <= Number(weekOf(`${match[1]}-12-28`).slice(6));
}

/** What an entry's key names: a day, a week, or nothing the journal holds. @param {string} key @returns {'day' | 'week' | null} */
export function kindOf(key) {
  if (isDayKey(key)) return 'day';
  return isWeekKey(key) ? 'week' : null;
}

/** A day `n` days after another. @param {string} key @param {number} n */
export function addDays(key, n) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** How many days from one day to another; negative when `to` is earlier. @param {string} from @param {string} to */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** A week's seven days, Monday to Sunday. @param {string} week */
export function weekDays(week) {
  const match = WEEK_SHAPE.exec(week);
  const year = Number(match?.[1] ?? 'NaN');
  const january4 = Date.UTC(year, 0, 4);
  const firstMonday = january4 - ((new Date(january4).getUTCDay() + 6) % 7) * DAY_MS;
  const monday = new Date(firstMonday + (Number(match?.[2] ?? 'NaN') - 1) * 7 * DAY_MS).toISOString().slice(0, 10);
  return [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(monday, n));
}

/** The day an entry ends on, which orders the journal: a day itself, a week its Sunday. @param {string} key */
export function endOf(key) {
  return isWeekKey(key) ? addDays(weekDays(key)[0] ?? key, 6) : key;
}

/**
 * Entries in the journal's order, newest first; a week comes just before its own Sunday, so its chapter opens it.
 * @template {{ key: string }} T @param {readonly T[]} entries @returns {T[]}
 */
export function newestFirst(entries) {
  return [...entries].sort((a, b) => {
    const order = endOf(b.key).localeCompare(endOf(a.key));
    if (order !== 0) return order;
    return Number(isWeekKey(b.key)) - Number(isWeekKey(a.key));
  });
}

/** An entry's address. @param {string} key */
export function entryPath(key) {
  return `${JOURNAL_PATH}/${key}`;
}

/**
 * A storyline's name as its address says it: lowercase letters and digits, hyphens between, at most 80 characters and
 * never ending in a hyphen. A name with no Latin letter or digit (Telugu, say) is spelled by its characters' code
 * points instead, so each such name has an address of its own. Names that differ only in punctuation share one.
 * @param {string} name
 */
export function storylineSlug(name) {
  const latin = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = latin !== '' ? latin : `u-${[...name.trim()].map((c) => (c.codePointAt(0) ?? 0).toString(36)).join('-')}`;
  return slug.slice(0, 80).replace(/-+$/, '');
}

/** A storyline's address. @param {string} name */
export function storylinePath(name) {
  return `${STORYLINES_PATH}/${storylineSlug(name)}`;
}

/**
 * The inline runs of one stretch of text: bold, italic with `*`, and links. A link to the site's own address keeps
 * just its path, so the page opens it in place; a link anywhere else must be http(s), and any other is its words.
 * @param {string} text @returns {Inline[]}
 */
export function inline(text) {
  /** @type {Inline[]} */
  const runs = [];
  // Every body is bounded (no star in a bold or italic body, at most 300 characters of a link's words), so a long run of
  // openers with no closer is read in linear time, as markdown.js reads its own.
  const pattern = /(\*\*(?=\S)([^*\n]*?\S)\*\*)|(\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\))|((?<![\w*])\*(?=[^*\s])([^*\n]*?[^*\s])\*(?![\w*]))/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > at) runs.push({ type: 'text', text: text.slice(at, start) });
    if (match[1] !== undefined) runs.push({ type: 'strong', text: match[2] ?? '' });
    else if (match[3] !== undefined) runs.push(linkRun(match[4] ?? '', match[5] ?? ''));
    else runs.push({ type: 'em', text: match[7] ?? '' });
    at = start + match[0].length;
  }
  if (at < text.length) runs.push({ type: 'text', text: text.slice(at) });
  return runs;
}

/**
 * A link's run: the site's own path, another http(s) address, or just its words. A path opens in place only when it
 * stays on the site: one `/` and no second `/` or `\` after it, which a browser would read as another host.
 * @param {string} words @param {string} href @returns {Inline}
 */
export function linkRun(words, href) {
  const path = href === SITE_ORIGIN ? '/' : href.startsWith(`${SITE_ORIGIN}/`) ? href.slice(SITE_ORIGIN.length) : null;
  if (path !== null && /^\/(?![/\\])/.test(path)) return { type: 'site', text: words, path };
  if (/^https?:\/\/[^\s/]+/.test(href)) return { type: 'link', text: words, href };
  return { type: 'text', text: words };
}

/** Text with its inline marks taken off, for a title or a label read as words. @param {string} text */
export function plain(text) {
  return inline(text).map((run) => run.text).join('');
}

/** A line wrapped in one pair of `*`, without them; null when it isn't one. @param {string} text */
export function italicLine(text) {
  const match = /^\*(?!\*)(.+)(?<!\*)\*$/.exec(text.trim());
  return match === null ? null : (match[1] ?? '').trim();
}

/**
 * The page's blocks, as the sync's grammar groups them (the same rules as its writer): a photo alone on its line, a
 * group of margin lines, a contents list, a story's or the page's heading with the lines under it, a quote, a break.
 * @param {string} text
 * @returns {{ kind: 'photo' | 'margin' | 'list' | 'h3' | 'h2' | 'quote' | 'break' | 'para', lines: string[] }[]}
 */
export function chunks(text) {
  return text
    .trim()
    .split(/\n[ \t]*\n/)
    .map((chunk) => chunk.trim().split('\n').map((line) => line.trimEnd()))
    .filter((lines) => lines.join('') !== '')
    .map((lines) => {
      const first = lines[0] ?? '';
      if (lines.length === 1 && /^·\s*·\s*·$/.test(first)) return { kind: 'break', lines };
      if (lines.length === 1 && /^!\[[^\]]*\]\([^)]+\)$/.test(first)) return { kind: 'photo', lines };
      if (lines.every((line) => line.startsWith('→') || line.startsWith('**'))) return { kind: 'margin', lines };
      if (lines.every((line) => line.startsWith('- '))) return { kind: 'list', lines: lines.map((line) => line.slice(2)) };
      if (first.startsWith('### ')) return { kind: 'h3', lines: [first.slice(4), ...lines.slice(1)] };
      if (first.startsWith('## ')) return { kind: 'h2', lines: [first.slice(3), ...lines.slice(1)] };
      if (lines.every((line) => line.startsWith('>'))) return { kind: 'quote', lines: lines.map((line) => line.replace(/^>\s?/, '')) };
      return { kind: 'para', lines };
    });
}

/** A storyline's margin line, its mark read from its label or its words. @param {string} label @param {string} state @returns {Storyline} */
export function storyline(label, state) {
  const marked = /\((new|closed)\)/i.exec(label) ?? /\((new|closed)\)/i.exec(state);
  const name = label.replace(/^Storyline\s*·\s*/, '').replace(/\s*\((new|closed)\)\s*/gi, ' ').trim();
  return { name, state, mark: marked === null ? null : /** @type {Mark} */ ((marked[1] ?? '').toLowerCase()) };
}

/**
 * A page text as data: its card (title, subtitle, one line, contents, people, wins, storylines), a week's chapter
 * prose (`body`), its stories, and its close. Null when it has no `## ` title first, which no page the sync writes
 * lacks. Every line lands somewhere: a margin label it doesn't know is kept in `notes`, and anything else is a paragraph.
 * @param {string} text @returns {Entry | null}
 */
export function parse(text) {
  const all = chunks(text);
  const head = all[0];
  if (head === undefined || head.kind !== 'h2' || plain(head.lines[0] ?? '').trim() === '') return null;
  /** @type {Entry} */
  const entry = {
    title: plain(head.lines[0] ?? '').trim(),
    subtitle: head.lines.length > 1 ? (italicLine(head.lines.slice(1).join(' ')) ?? head.lines.slice(1).join(' ')) : null,
    oneLine: null,
    contents: [],
    people: [],
    wins: [],
    storylines: [],
    body: [],
    stories: [],
    sittingWith: null,
    stillAsking: null,
    question: null,
    quiet: null,
    weekAhead: null,
    arrows: [],
    note: null,
    notes: [],
  };
  /** @type {(typeof all)[]} */
  const sections = [[]];
  for (const chunk of all.slice(1)) {
    if (chunk.kind === 'break') sections.push([]);
    else sections[sections.length - 1]?.push(chunk);
  }
  const card = sections[0] ?? [];
  const rest = sections.slice(1).filter((section) => section.length > 0);
  const last = rest[rest.length - 1];
  const closing = last !== undefined && last.every((chunk) => chunk.kind === 'margin' || (chunk.kind === 'para' && italicLine(chunk.lines.join(' ')) !== null));
  for (const chunk of card) {
    if (chunk.kind === 'margin') margin(entry, chunk.lines);
    else if (chunk.kind === 'list') entry.contents.push(...chunk.lines.map(contentsLine));
    else entry.body.push(...blocksOf([chunk]));
  }
  for (const section of closing ? rest.slice(0, -1) : rest) entry.stories.push(storyOf(section));
  if (closing && last !== undefined) {
    for (const chunk of last) {
      if (chunk.kind === 'margin') margin(entry, chunk.lines);
      else entry.note = italicLine(chunk.lines.join(' '));
    }
  }
  return entry;
}

/** One contents line, `**Morning** · A new morning ritual`. @param {string} line @returns {Contents} */
export function contentsLine(line) {
  const match = /^\*\*(.+?)\*\*\s*·\s*(.+)$/.exec(line);
  return match === null ? { when: null, title: plain(line) } : { when: match[1] ?? null, title: plain(match[2] ?? '') };
}

/** A group of margin lines read into the entry. @param {Entry} entry @param {string[]} lines */
export function margin(entry, lines) {
  for (const line of lines) {
    if (line.startsWith('→')) {
      entry.arrows.push(inline(line.replace(/^→\s*/, '')));
      continue;
    }
    const match = /^\*\*(.+?):\*\*\s*(.*)$/.exec(line);
    if (match === null) {
      entry.notes.push({ label: '', text: line });
      continue;
    }
    const label = (match[1] ?? '').trim();
    const words = (match[2] ?? '').trim();
    const named = label.replace(/’/g, "'").toLowerCase();
    if (named.startsWith('storyline')) entry.storylines.push(storyline(label, words));
    else if (named === 'in one line') entry.oneLine = words;
    else if (named === 'people') entry.people = words.split(/\s*,\s*/).filter((name) => name !== '');
    else if (named === 'wins') entry.wins = words.split(/\s+·\s+/).filter((win) => win !== '');
    else if (named === 'sitting with') entry.sittingWith = words;
    else if (named === "tomorrow's question") entry.question = words;
    else if (named === 'still asking') entry.stillAsking = words;
    else if (named === 'quiet') entry.quiet = words;
    else if (named === 'the week ahead') entry.weekAhead = words;
    else entry.notes.push({ label, text: words });
  }
}

/** A story's section: its title and when, when it opens with `### `, then its blocks. @param {ReturnType<typeof chunks>} section @returns {Story} */
export function storyOf(section) {
  const head = section[0];
  if (head !== undefined && (head.kind === 'h3' || head.kind === 'h2')) {
    const under = head.lines.slice(1).join(' ');
    const when = under === '' ? null : italicLine(under);
    /** @type {Block[]} */
    const lead = under !== '' && when === null ? [{ type: 'p', inline: inline(under) }] : [];
    return { title: plain(head.lines[0] ?? ''), when, blocks: [...lead, ...blocksOf(section.slice(1))] };
  }
  return { title: null, when: null, blocks: blocksOf(section) };
}

/** Chunks as the blocks a story draws: a heading or margin line that strays into prose is drawn as a paragraph. @param {ReturnType<typeof chunks>} section @returns {Block[]} */
export function blocksOf(section) {
  /** @type {Block[]} */
  const blocks = [];
  for (const chunk of section) {
    if (chunk.kind === 'quote') blocks.push({ type: 'quote', inline: inline(chunk.lines.join(' ')) });
    else if (chunk.kind === 'list') blocks.push({ type: 'list', items: chunk.lines.map(inline) });
    else if (chunk.kind === 'photo') {
      const match = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(chunk.lines[0] ?? '');
      const id = PHOTO_SOURCE.exec(match?.[2] ?? '')?.[1] ?? null;
      blocks.push({ type: 'photo', id, caption: inline(match?.[1] ?? '') });
    } else if (chunk.kind === 'margin') blocks.push(...chunk.lines.map((line) => /** @type {Block} */ ({ type: 'p', inline: inline(line) })));
    else blocks.push({ type: 'p', inline: inline(chunk.lines.join(' ')) });
  }
  return blocks;
}

/** Every photo a page shows, by id, in order (its body's and its stories'). @param {Entry} entry @returns {string[]} */
export function photosOf(entry) {
  const ids = [];
  for (const block of [...entry.body, ...entry.stories.flatMap((story) => story.blocks)]) {
    if (block.type === 'photo' && block.id !== null) ids.push(block.id);
  }
  return ids;
}

/** The day a storyline's "N days to go" points at, written on day `day`; null when its line counts nothing down. @param {string} state @param {string} day */
export function countdownTarget(state, day) {
  const match = /\b(\d{1,4}) days? to go\b/i.exec(state);
  return match === null ? null : addDays(day, Number(match[1]));
}

/**
 * A storyline's countdown on `today`: the target its latest counting line set, while it hasn't closed since and the
 * day hasn't passed. A week's margin is never a touch (its lines repeat the days'), so `touches` are days only.
 * @param {readonly Touch[]} touches @param {string} today @returns {Countdown | null}
 */
export function countdownOn(touches, today) {
  let target = null;
  for (const touch of [...touches].sort((a, b) => a.key.localeCompare(b.key))) {
    if (touch.mark === 'closed') target = null;
    else target = countdownTarget(touch.state, touch.key) ?? target;
  }
  if (target === null) return null;
  const left = daysBetween(today, target);
  return left < 0 ? null : { target, left };
}

/** "7 days to go", "1 day to go", or "Today". @param {number} left */
export function leftWords(left) {
  if (left === 0) return 'Today';
  return `${left} ${left === 1 ? 'day' : 'days'} to go`;
}
