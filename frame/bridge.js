// @ts-check
// The bridge: the one script the Worker adds to every page saved into a thread (src/page.ts, from the text
// tools/frame.ts writes into src/frame-bridge.ts), run inside the page's sealed frame. It is the page's only way to
// speak to the thread around it, by `postMessage` to the threads page, because the frame has an opaque origin and no
// network (`connect-src 'none'`). Nothing here saves anything or knows who is reading: the thread saves every answer
// and comment through its own calls, as whoever is signed in, or, on a public thread, as the visitor who named
// themselves there.
//
// On its own (the page opened at its address) it only says how tall the page is, as the frame's first script always
// did, and hides the page's own "answer on the thread" lines (`data-outside-thread`), which are for the page as
// claude.ai shows it. A public thread's view answers its `ready` with `hello` and `visitor: true`, and then it draws the
// answer boxes alone, for answers of at most 4,000 characters, public with the name the visitor gave, and never the
// Comment pill or underlines, which strangers don't get. The signed-in thread answers its `ready` with `hello`, and
// then it also:
//
// - draws an answer box under each of the page's questions (`data-thread-question="<id>"`), with everyone's answers
//   under it, in a closed shadow root and the threads' own look, so the page's CSS and the box can't touch each other;
// - offers Comment beside words the reader selects, and says which words (`selected`: the words, up to 64 characters
//   of text either side, and where they sit), so the thread can open its own composer beside them;
// - underlines the words each discussion is on, with the CSS Custom Highlight API, which never changes the page's
//   own markup, finds them again in a later version by the text either side, and says where each sits (`anchors`);
// - says when underlined words are clicked (`open`), and on a page that moves on a click (a deck), swallows the one
//   click that ends a selection, so selecting words doesn't move it.
//
// The thread says whether an answer was kept (`saved`), and when it wasn't, may say why in a short line (`problem`),
// drawn as text under the box.
//
// Every message is one object whose `whysosuresh` names its kind, checked field by field on arrival (`readFromThread`
// here, site/app/page-talk.js on the thread's side); every text is drawn as text. The page posts to the site's own
// origin, named by the Worker in the JSON script before this one; the thread can only post to `*`, because the frame
// has no other address, so it sends only what the reader may read anyway. The pure parts are exported for the tests
// (test/bridge.test.ts); the start below them runs only in a document.

/** The id a page marks a question with, which stays fixed across its versions (src/threads.ts holds the same). */
export const QUESTION_SHAPE = /^[a-z0-9-]{1,40}$/;
/** The most words one comment may quote, in UTF-16 code units, and the most text kept either side of them. */
export const MAX_QUOTE = 500;
export const MAX_CONTEXT = 64;
/** The longest answer, as the threads' calls keep it, and the longest a visitor's may be (src/note.ts). */
export const MAX_ANSWER = 32_000;
export const MAX_VISITOR_ANSWER = 4000;
/** The longest reason the thread may give for an answer it didn't keep. */
export const MAX_PROBLEM = 200;
/** The most questions, answers and discussions one page's messages carry. */
export const MAX_ITEMS = 500;
/** What every message carries under this key: its kind. */
export const KEY = 'whysosuresh';

/**
 * @typedef {{ quote: string, prefix: string, suffix: string }} Quote
 * @typedef {{ question: string, name: string, body: string, at: string, mine: boolean }} Answer
 * @typedef {{ id: string, quote: string, prefix: string, suffix: string }} Anchor
 * @typedef {{ kind: 'hello', visitor: boolean } | { kind: 'discussion', answers: Answer[], anchors: Anchor[], active: string | null }
 *   | { kind: 'focus', id: string, scroll: boolean } | { kind: 'saved', question: string, ok: boolean, problem: string | null }} FromThread
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @param {readonly string[]} keys */
function hasExactly(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

/** @param {unknown} value @param {number} max @returns {value is string} */
function isText(value, max) {
  return typeof value === 'string' && value.length <= max;
}

/** A discussion's or a comment's id, as the store gives it, or the composer's own `draft`. @param {unknown} value */
export function isId(value) {
  return typeof value === 'string' && (value === 'draft' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value));
}

/** @param {unknown} value @returns {Answer | null} */
function readAnswer(value) {
  if (!hasExactly(value, ['question', 'name', 'body', 'at', 'mine']) || !isRecord(value)) return null;
  const { question, name, body, at, mine } = value;
  if (typeof question !== 'string' || !QUESTION_SHAPE.test(question) || !isText(name, 200) || !isText(body, MAX_ANSWER) || !isText(at, 40) || typeof mine !== 'boolean') return null;
  return { question, name, body, at, mine };
}

/** @param {unknown} value @returns {Anchor | null} */
function readAnchor(value) {
  if (!hasExactly(value, ['id', 'quote', 'prefix', 'suffix']) || !isRecord(value)) return null;
  const { id, quote, prefix, suffix } = value;
  if (!isId(id) || typeof id !== 'string' || !isText(quote, MAX_QUOTE) || quote === '' || !isText(prefix, MAX_CONTEXT) || !isText(suffix, MAX_CONTEXT)) return null;
  return { id, quote, prefix, suffix };
}

/**
 * A message from the thread, or null for anything that isn't exactly one of its four kinds.
 * @param {unknown} data
 * @returns {FromThread | null}
 */
export function readFromThread(data) {
  if (!isRecord(data)) return null;
  switch (data[KEY]) {
    case 'hello':
      if (hasExactly(data, [KEY])) return { kind: 'hello', visitor: false };
      return hasExactly(data, [KEY, 'visitor']) && data.visitor === true ? { kind: 'hello', visitor: true } : null;
    case 'discussion': {
      if (!hasExactly(data, [KEY, 'answers', 'anchors', 'active'])) return null;
      const { answers, anchors, active } = data;
      if (!Array.isArray(answers) || !Array.isArray(anchors) || answers.length > MAX_ITEMS || anchors.length > MAX_ITEMS) return null;
      if (active !== null && !isId(active)) return null;
      const readAnswers = answers.map(readAnswer);
      const readAnchors = anchors.map(readAnchor);
      if (readAnswers.some((one) => one === null) || readAnchors.some((one) => one === null)) return null;
      return {
        kind: 'discussion',
        answers: /** @type {Answer[]} */ (readAnswers),
        anchors: /** @type {Anchor[]} */ (readAnchors),
        active: typeof active === 'string' ? active : null,
      };
    }
    case 'focus':
      return hasExactly(data, [KEY, 'id', 'scroll']) && isId(data.id) && typeof data.id === 'string' && typeof data.scroll === 'boolean'
        ? { kind: 'focus', id: data.id, scroll: data.scroll }
        : null;
    case 'saved': {
      const given = hasExactly(data, [KEY, 'question', 'ok']) || hasExactly(data, [KEY, 'question', 'ok', 'problem']);
      const { question, ok, problem } = data;
      if (!given || typeof question !== 'string' || !QUESTION_SHAPE.test(question) || typeof ok !== 'boolean') return null;
      if (problem !== undefined && (!isText(problem, MAX_PROBLEM) || problem.trim() === '')) return null;
      return { kind: 'saved', question, ok, problem: typeof problem === 'string' ? problem : null };
    }
    default:
      return null;
  }
}

/** How many characters `a` and `b` share at their ends. @param {string} a @param {string} b */
function sharedEnd(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}

/** How many characters `a` and `b` share at their starts. @param {string} a @param {string} b */
function sharedStart(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

/**
 * Where quoted words are in a page's text: of every place the words appear, the one whose text either side matches
 * the quote's context best (the first such on a tie); -1 when the words appear nowhere, as in a version that cut them.
 * @param {string} text
 * @param {Quote} quote
 */
export function locate(text, quote) {
  if (quote.quote === '') return -1;
  let best = -1;
  let score = -1;
  for (let at = text.indexOf(quote.quote); at !== -1; at = text.indexOf(quote.quote, at + 1)) {
    const before = text.slice(Math.max(0, at - quote.prefix.length), at);
    const after = text.slice(at + quote.quote.length, at + quote.quote.length + quote.suffix.length);
    const fit = sharedEnd(before, quote.prefix) + sharedStart(after, quote.suffix);
    if (fit > score) {
      best = at;
      score = fit;
    }
  }
  return best;
}

/**
 * Words selected in a page's text, from `start` to `end`, with up to `MAX_CONTEXT` characters either side; null when
 * they are blank or longer than one comment may quote.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {Quote | null}
 */
export function quoteOf(text, start, end) {
  const quote = text.slice(start, end);
  if (quote.trim() === '' || quote.length > MAX_QUOTE) return null;
  return { quote, prefix: text.slice(Math.max(0, start - MAX_CONTEXT), start), suffix: text.slice(end, end + MAX_CONTEXT) };
}

/* ---------- The start: everything below runs only in a page's document. ---------- */

/** Elements whose text isn't the page's words. */
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION']);
/** The threads' own look, inside each shadow root: the site's black and white, the device's light or dark. */
const LOOK = `:host{all:initial;display:block;margin:10px 0 4px}
:host([hidden]){display:none}
*{box-sizing:border-box}
.b{--ink:#0a0a0a;--muted:#5c5c5c;--faint:#8c8c8c;--line:#e5e5e5;--surface:#fff;--soft:#ededed;--on:#fff;font:13.5px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden;text-align:left}
@media (prefers-color-scheme:dark){.b{--ink:#f1f1f1;--muted:#a3a3a3;--faint:#767676;--line:#2a2a2a;--surface:#161616;--soft:#262626;--on:#0a0a0a}}
.b:focus-within{border-color:var(--muted)}
textarea{display:block;width:100%;min-height:46px;padding:8px 12px;border:0;background:transparent;color:inherit;font:inherit;resize:vertical}
textarea:focus{outline:none}
.bar{display:flex;align-items:center;gap:8px;padding:5px 8px;border-top:1px solid var(--line)}
.note{margin-right:auto;color:var(--muted);font-size:11.5px}
button{font:600 12px/1.4 inherit;font-family:inherit;border:1px solid var(--line);border-radius:8px;padding:3px 10px;background:var(--surface);color:var(--ink);cursor:pointer}
button.go{background:var(--ink);color:var(--on);border-color:var(--ink)}
button.link{border:0;background:none;padding:0;color:var(--muted);text-decoration:underline;text-underline-offset:.2em}
button:disabled{opacity:.5;cursor:default}
button:focus-visible,textarea:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.row{display:grid;grid-template-columns:20px minmax(0,1fr) auto;gap:8px;align-items:start;padding:7px 12px}
.av{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--soft);border:1px solid var(--line);font-size:9.5px;font-weight:700}
.av.me{background:var(--ink);color:var(--on);border-color:var(--ink)}
p{margin:0;white-space:pre-line;overflow-wrap:anywhere}
b{margin-right:6px}
time{color:var(--faint);font-size:11.5px;white-space:nowrap}
.list{border-top:1px solid var(--line)}
.head{padding:6px 12px 0;color:var(--faint);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.problem{padding:0 12px 6px;color:var(--ink);font-size:12px;font-weight:600}
.problem:empty{display:none}
.count{color:var(--faint);font-size:11.5px;font-variant-numeric:tabular-nums}
.count.over{color:var(--ink);font-weight:700}`;
/**
 * The Comment pill sits on the page's own ground, which may be light or dark whatever the device says, so it is one
 * look on every page: black, with a pale ring that keeps it apart from a dark page.
 */
const PILL = `:host{all:initial;position:absolute;z-index:2147483647}
:host([hidden]){display:none}
button{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border:0;border-radius:999px;background:#0a0a0a;color:#fff;font:600 12.5px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;box-shadow:0 0 0 1px rgba(255,255,255,.55),0 8px 20px -8px rgba(0,0,0,.6);cursor:pointer}
button:focus-visible{outline:2px solid #888;outline-offset:2px}`;
/** How the words of a discussion are marked: a faint ground and an underline, which read on a light or a dark page. */
const MARKS = '[data-outside-thread]{display:none!important}::highlight(whysosuresh){background-color:rgba(128,128,128,.2);text-decoration:underline 2px}::highlight(whysosuresh-on){background-color:rgba(128,128,128,.42);text-decoration:underline 2px}';

/** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node | string)[]} [children] */
function make(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** @param {string} name */
function initialsOf(name) {
  return (
    name
      .replace(/[^\p{L}\s]/gu, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? '')
      .join('')
      .toUpperCase() || '?'
  );
}

/** "Mon 10 Nov, 11:10", in the reader's own time zone. @param {string} iso */
function shortTime(iso) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function start() {
  // The Worker's own, the last one: it comes after everything the page holds.
  const config = [...document.querySelectorAll('script[data-whysosuresh-frame]')].at(-1);
  /** @type {unknown} */
  let given = null;
  try {
    given = JSON.parse(config?.textContent ?? 'null');
  } catch {
    given = null;
  }
  const origin = isRecord(given) && typeof given.origin === 'string' ? given.origin : null;
  if (origin === null) return;
  /** @param {string} kind @param {Record<string, unknown>} [fields] */
  const post = (kind, fields = {}) => parent.postMessage({ [KEY]: kind, ...fields }, origin);

  document.head.append(make('style', {}, [MARKS]));

  // The height, as the frame's first script always said it: the document's own box, not its scroll height, which
  // never drops below the frame's, so a short page lets its frame shrink to fit.
  let height = 0;
  const sayHeight = () => {
    const now = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (now !== height) {
      height = now;
      post('height', { height: now });
    }
  };

  /** @type {Map<string, HTMLElement>} */
  const questions = new Map();
  for (const node of document.querySelectorAll('[data-thread-question]')) {
    const id = node.getAttribute('data-thread-question') ?? '';
    if (node instanceof HTMLElement && QUESTION_SHAPE.test(id) && !questions.has(id) && questions.size < MAX_ITEMS) questions.set(id, node);
  }

  /** Everything the bridge drew into the page, which is never the page's words. @type {Set<Element>} */
  const hosts = new Set();
  /** Whether the thread said hello: answer boxes for everyone; Comment and underlines only for the signed-in thread. */
  let answering = false;
  let discussing = false;
  /** The longest answer a box takes, and what its bar says: the signed-in thread's, until a visitor's hello. */
  let maxAnswer = MAX_ANSWER;
  let boxNote = 'Saved on the thread, under your sign-in';
  /** @type {Extract<FromThread, { kind: 'discussion' }> | null} */
  let discussion = null;
  /** @type {Map<string, Range>} */
  let ranges = new Map();

  /** The page's words as one string, and where each text node starts in it. */
  const textOf = () => {
    /** @type {{ node: Text, at: number }[]} */
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        for (let up = node.parentElement; up !== null; up = up.parentElement) {
          if (SKIPPED.has(up.tagName) || hosts.has(up)) return NodeFilter.FILTER_REJECT;
        }
        return (node.nodeValue ?? '').trim() === '' ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (!(node instanceof Text)) continue;
      nodes.push({ node, at: text.length });
      text += node.data;
    }
    return { text, nodes };
  };

  /** A range over the page's text from `from` to `to`, or null when the text has moved on. @param {number} from @param {number} to */
  const rangeOf = (from, to, model = textOf()) => {
    const startAt = model.nodes.findLast((one) => one.at <= from);
    const endAt = model.nodes.findLast((one) => one.at < to);
    if (startAt === undefined || endAt === undefined) return null;
    const range = document.createRange();
    range.setStart(startAt.node, from - startAt.at);
    range.setEnd(endAt.node, Math.min(to - endAt.at, endAt.node.length));
    return range;
  };

  /** Where in the page's text a selection runs, from the text nodes it touches. @param {Range} range */
  const offsetsOf = (range, model = textOf()) => {
    let from = -1;
    let to = -1;
    for (const { node, at } of model.nodes) {
      if (!range.intersectsNode(node)) continue;
      const begin = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.length;
      if (end <= begin && node !== range.startContainer) continue;
      if (from === -1) from = at + begin;
      to = at + end;
    }
    return from === -1 || to <= from ? null : { from, to };
  };

  const top = (/** @type {Range | Element} */ thing) => Math.round(thing.getBoundingClientRect().top + scrollY);

  // Underlines each discussion's words where this version has them, and says where each sits, or that it is gone.
  const mark = () => {
    if (!discussion) return;
    const model = textOf();
    ranges = new Map();
    for (const anchor of discussion.anchors) {
      const at = locate(model.text, anchor);
      const range = at === -1 ? null : rangeOf(at, at + anchor.quote.length, model);
      if (range) ranges.set(anchor.id, range);
    }
    if (typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function') {
      const active = discussion.active;
      CSS.highlights.set('whysosuresh', new Highlight(...[...ranges].filter(([id]) => id !== active).map(([, range]) => range)));
      const on = active === null ? undefined : ranges.get(active);
      if (on) CSS.highlights.set('whysosuresh-on', new Highlight(on));
      else CSS.highlights.delete('whysosuresh-on');
    }
    post('anchors', {
      anchors: discussion.anchors.map(({ id }) => {
        const range = ranges.get(id);
        return range ? { id, top: top(range) } : { id, missing: true };
      }),
      questions: [...questions].map(([id, node]) => ({ id, top: top(node) })),
    });
  };
  let marking = 0;
  const markSoon = () => {
    cancelAnimationFrame(marking);
    marking = requestAnimationFrame(mark);
  };

  /* An answer box under each question: the reader's own answer (or a box for it), then everyone else's. */
  /** @type {Map<string, { box: HTMLElement, mine: HTMLElement, form: HTMLElement, area: HTMLTextAreaElement, save: HTMLButtonElement, cancel: HTMLButtonElement, problem: HTMLElement, count: HTMLElement, list: HTMLElement, editing: boolean }>} */
  const boxes = new Map();
  const drawBoxes = () => {
    for (const [id, node] of questions) {
      let parts = boxes.get(id);
      if (!parts) {
        const host = make('div', { 'data-whysosuresh': 'answer' });
        hosts.add(host);
        const root = host.attachShadow({ mode: 'closed' });
        const area = /** @type {HTMLTextAreaElement} */ (make('textarea', { 'aria-label': 'Your answer', placeholder: 'Your answer' }));
        const save = /** @type {HTMLButtonElement} */ (make('button', { type: 'button', class: 'go' }, ['Save answer']));
        const cancel = /** @type {HTMLButtonElement} */ (make('button', { type: 'button', class: 'link' }, ['Cancel']));
        const problem = make('div', { class: 'problem', role: 'status' });
        const count = make('span', { class: 'count' });
        count.hidden = true;
        const form = make('div', {}, [area, problem, make('div', { class: 'bar' }, [make('span', { class: 'note' }, [boxNote]), count, cancel, save])]);
        const mine = make('div', { class: 'row' });
        const list = make('div', { class: 'list' });
        const box = make('div', { class: 'b' }, [mine, form, list]);
        root.append(make('style', {}, [LOOK]), box);
        const made = { box, mine, form, area, save, cancel, problem, count, list, editing: false };
        parts = made;
        // Near the limit, the box counts; past it, it says so, and Save keeps the words.
        const counted = () => {
          const length = area.value.trim().length;
          count.hidden = length <= maxAnswer - 500;
          count.textContent = `${length.toLocaleString('en-GB')} / ${maxAnswer.toLocaleString('en-GB')}`;
          count.classList.toggle('over', length > maxAnswer);
        };
        area.addEventListener('input', counted);
        const send = () => {
          const body = area.value.trim();
          if (body.length > maxAnswer) {
            problem.textContent = `Keep it to ${maxAnswer.toLocaleString('en-GB')} characters.`;
            return area.focus();
          }
          if (body === '') return area.focus();
          save.disabled = true;
          save.textContent = 'Saving…';
          problem.textContent = '';
          post('answer', { question: id, body });
        };
        save.addEventListener('click', send);
        area.addEventListener('keydown', (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            send();
          }
        });
        cancel.addEventListener('click', () => {
          made.editing = false;
          drawBoxes();
        });
        boxes.set(id, made);
        // Inside the question's element, unless it holds only words (a paragraph, a heading), then right after it.
        if (/^(P|H[1-6]|LABEL|SPAN|B|STRONG|EM|I)$/.test(node.tagName)) node.after(host);
        else node.append(host);
      }
      const answers = discussion?.answers.filter((one) => one.question === id) ?? [];
      const own = answers.findLast((one) => one.mine);
      const others = answers.filter((one) => !one.mine);
      const editing = parts.editing || own === undefined;
      parts.mine.hidden = editing;
      parts.form.hidden = !editing;
      parts.cancel.hidden = own === undefined;
      if (own) {
        const change = make('button', { type: 'button', class: 'link' }, ['Change']);
        const shown = parts;
        change.addEventListener('click', () => {
          shown.editing = true;
          shown.area.value = own.body;
          drawBoxes();
          shown.area.focus();
        });
        parts.mine.replaceChildren(make('span', { class: 'av me', 'aria-hidden': 'true' }, [initialsOf(own.name)]), make('p', {}, [make('b', {}, ['You']), own.body]), change);
      }
      parts.list.hidden = others.length === 0;
      parts.list.replaceChildren(
        make('div', { class: 'head' }, [others.length === 1 ? '1 other answer' : `${others.length} other answers`]),
        ...others.map((one) => make('div', { class: 'row' }, [make('span', { class: 'av', 'aria-hidden': 'true' }, [initialsOf(one.name)]), make('p', {}, [make('b', {}, [one.name]), one.body]), make('time', { datetime: one.at }, [shortTime(one.at)])])),
      );
    }
  };

  /* Comment beside selected words. */
  const pillHost = make('div', { 'data-whysosuresh': 'comment' });
  hosts.add(pillHost);
  const pillRoot = pillHost.attachShadow({ mode: 'closed' });
  const pill = make('button', { type: 'button' }, ['Comment']);
  pillRoot.append(make('style', {}, [PILL]), pill);
  pillHost.hidden = true;
  /** @type {(Quote & { top: number }) | null} */
  let chosen = null;
  const choose = () => {
    chosen = null;
    pillHost.hidden = true;
    if (!discussing) return;
    const selection = getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const model = textOf();
    const at = offsetsOf(range, model);
    const quote = at === null ? null : quoteOf(model.text, at.from, at.to);
    if (at === null || quote === null) return;
    const rect = range.getBoundingClientRect();
    chosen = { ...quote, top: top(range) };
    if (!pillHost.isConnected) document.body.append(pillHost);
    pillHost.style.top = `${Math.round(rect.bottom + scrollY + 6)}px`;
    pillHost.style.left = `${Math.round(Math.max(8, Math.min(rect.left + scrollX, scrollX + innerWidth - 120)))}px`;
    pillHost.hidden = false;
  };
  pill.addEventListener('mousedown', (event) => event.preventDefault());
  pill.addEventListener('click', () => {
    if (chosen === null) return;
    post('selected', { quote: chosen.quote, prefix: chosen.prefix, suffix: chosen.suffix, top: chosen.top });
    pillHost.hidden = true;
    getSelection()?.removeAllRanges();
  });

  /** Whether an event happened in something the bridge drew. @param {Event} event */
  const ours = (event) => event.composedPath().some((node) => node instanceof Element && hosts.has(node));

  // A page that moves on a click (a deck) would move on the click that ends a selection: that one click is the reader
  // choosing words, so it stops here. Every other click is the page's own.
  addEventListener(
    'click',
    (event) => {
      if (!discussing || ours(event)) return;
      const selection = getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim() !== '') event.stopImmediatePropagation();
    },
    { capture: true },
  );
  // Clicked words that a discussion is on open it in the thread.
  document.addEventListener('click', (event) => {
    if (!discussing || ours(event) || !(getSelection()?.isCollapsed ?? true)) return;
    const caret =
      'caretPositionFromPoint' in document
        ? document.caretPositionFromPoint(event.clientX, event.clientY)
        : /** @type {{ caretRangeFromPoint?: (x: number, y: number) => Range | null }} */ (document).caretRangeFromPoint?.(event.clientX, event.clientY);
    if (!caret) return;
    const node = 'offsetNode' in caret ? caret.offsetNode : caret.startContainer;
    const offset = 'offset' in caret ? caret.offset : caret.startOffset;
    for (const [id, range] of ranges) {
      if (id !== 'draft' && range.isPointInRange(node, offset)) {
        post('open', { id });
        return;
      }
    }
  });
  for (const kind of ['mouseup', 'keyup', 'touchend']) document.addEventListener(kind, () => setTimeout(choose, kind === 'touchend' ? 300 : 0));
  document.addEventListener('selectionchange', () => {
    if (getSelection()?.isCollapsed ?? true) pillHost.hidden = true;
  });

  addEventListener('message', (event) => {
    if (event.source !== parent) return;
    const said = readFromThread(event.data);
    if (said === null) return;
    if (said.kind === 'hello') {
      if (boxes.size === 0 && said.visitor) {
        maxAnswer = MAX_VISITOR_ANSWER;
        boxNote = 'Public, with the name you gave';
      }
      answering = true;
      discussing = !said.visitor && maxAnswer === MAX_ANSWER;
      drawBoxes();
    } else if (said.kind === 'discussion' && answering) {
      discussion = said;
      drawBoxes();
      mark();
    } else if (said.kind === 'focus' && discussion) {
      discussion = { ...discussion, active: said.id };
      mark();
      const range = ranges.get(said.id);
      if (said.scroll && range) range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (said.kind === 'saved') {
      const parts = boxes.get(said.question);
      if (!parts) return;
      parts.save.disabled = false;
      parts.save.textContent = 'Save answer';
      if (said.ok) {
        parts.editing = false;
        parts.area.value = '';
        parts.problem.textContent = '';
        parts.count.hidden = true;
        drawBoxes();
      } else parts.problem.textContent = said.problem ?? 'That answer didn’t save. It is still in the box.';
    }
  });

  new ResizeObserver(() => {
    sayHeight();
    markSoon();
  }).observe(document.documentElement);
  // A page that redraws itself (a deck's next slide) moves its words: they are found again once it settles.
  let settling = 0;
  new MutationObserver(() => {
    clearTimeout(settling);
    settling = setTimeout(markSoon, 150);
  }).observe(document.body ?? document.documentElement, { childList: true, subtree: true, characterData: true });
  addEventListener('load', sayHeight);
  sayHeight();
  post('ready', { questions: [...questions.keys()] });
}

if (typeof document !== 'undefined' && typeof parent !== 'undefined') start();
