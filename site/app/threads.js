// @ts-check
// whysosuresh.com/threads: Suresh's threads, one page for all of them (site/threads/index.html, which the Worker
// hands over at /threads/ and at every thread's own address). Three views, each at its own address: Today
// (/threads/: new notes, and open threads that sat a week untouched), the list (/threads/?tab=act&space=company:
// four tabs by where a thread stands, and the five spaces), and a thread (/threads/42-who-owns-what): its living
// summary on top, then its main section, then its comments and its history in the order they happened. The main
// section is the thread's text, a page or a link: a page is a Claude artifact's own HTML, shown in a sealed frame
// at its own address (the Worker's src/page.ts sets the seal) with a bar for its versions, Open in Claude and full
// screen; a link is a card that opens an artifact on claude.ai. Everything comes from the threads' private calls
// (threads-store.js); the page holds no data of its own.
//
// It carries the inbox's ways of working: one key or tap sorts a thread (keys.js), no move asks "are you sure"
// (each shows a toast with Undo, which sends the move that reverses it), a move shows at once and is saved behind
// it, and one the server refuses is put back with a line that says so. Reply drafts an email in the thread and
// opens it in Gmail as the address he signed in with, for him to send. On top of that: comments (M), editing the
// title, summary and main text with a preview (W; a visitor's own words are never editable), new threads (N), and
// ⌘K, a search over numbers, titles, summaries and text. On a list the next thread is selected after a move; on a
// thread the page stays, so its history shows the move.
//
// A thread can be shared. The owner's Share (S) invites a person by address and name, lists who is in the thread
// and takes an invitation back; his Gmail opens a draft with the thread's `?invite` link for him to send (share.js
// holds the sheet's words and the draft). He can write a comment for himself alone ("Only me", drawn dashed), and
// Today gains "Waiting on you": shared threads where an invited person had the last word. A person he invited
// gets the same page, knowing its caller (`me`): their threads (their home), each thread with its summary, its
// main section, its comments and its history as the Worker shapes them for them, and a comment box; no moves,
// edits, spaces, Reply or Share, and only their own keys. Removed from every thread, they are told "Nothing is
// shared with you now" rather than sent round the sign-in again.
//
// Signed out at a thread's address, the page shows what a missing address shows ("Nothing here"), so the address
// alone never says a thread exists; a device that has signed in before also gets a small "Sign in". The link in an
// invitation carries `?invite`: signed out, it goes straight to the sign-in and back; signed in, the page drops it
// from the address, so a copied link is the clean one. `?invite` on any number does the same, so it says nothing
// about a thread. At /threads/
// itself, which names no thread, it always says "Threads" with a Sign in button. Either sign-in goes through the
// threads' sign-in call and comes back to the same address. When the sign-in ends mid-use, a line says so and nothing typed
// is lost. Every element is built with DOM calls and every text is set as text, so nothing anyone wrote becomes
// markup; Markdown is parsed into blocks first (markdown.js). The CSP allows no inline script or style attribute.

import { SPACES } from '../spaces.js';
import { MEMBER_COMMANDS, MEMBER_SHEET, SHEET, commandFor } from './keys.js';
import { parse, summaryLines } from './markdown.js';
import { addressOf, invitation, invitationProblem, listed, seatsLine, seesLines } from './share.js';
import {
  Failed,
  Missing,
  NotShared,
  SignedOut,
  comment,
  edit,
  invite,
  listAll,
  listMine,
  me,
  move,
  pageAddress,
  people,
  search,
  show,
  signInAddress,
  start,
  uninvite,
} from './threads-store.js';

/**
 * @typedef {import('./threads-store.js').Thread} Thread
 * @typedef {import('./threads-store.js').Shown} Shown
 * @typedef {import('./threads-store.js').Page} Page
 * @typedef {import('./threads-store.js').Event} ThreadEvent
 * @typedef {import('./threads-store.js').Comment} ThreadComment
 * @typedef {import('./threads-store.js').Tab} Tab
 * @typedef {import('./threads-store.js').Status} Status
 * @typedef {import('./threads-store.js').Action} Action
 * @typedef {import('./threads-store.js').Field} Field
 * @typedef {import('./threads-store.js').Person} Person
 * @typedef {import('./markdown.js').Inline} Inline
 * @typedef {import('./keys.js').Command} Command
 * @typedef {{ view: 'today' } | { view: 'list', tab: Tab, space: string | null } | { view: 'thread', number: number }} Route
 * @typedef {{ to: string, subject: string, body: string }} Draft
 * @typedef {{ title: string, summary: string, body: string }} Editing
 * @typedef {{ title: string, space: string, status: 'received' | 'act' | 'discuss', body: string }} NewDraft
 * @typedef {null | 'find' | 'new' | 'keys' | 'drop' | 'space' | 'versions' | 'share'} Overlay
 * @typedef {{ number: number, people: Person[], count: number, email: string, name: string, problem: string,
 *   invited: { name: string, email: string } | null, busy: boolean }} Sharing
 * @typedef {{ label: string, sub: string, side: string, number: number | null, run: () => void }} FindItem
 */

/** @type {readonly Tab[]} */
const TABS = ['look', 'act', 'discuss', 'done'];

/** @type {Record<Tab, string>} */
const TAB_NAMES = { look: 'To look at', act: 'To act on', discuss: 'To discuss', done: 'Done' };

/** @type {Record<Tab, readonly Status[]>} */
const TAB_STATUSES = { look: ['received'], act: ['act'], discuss: ['discuss'], done: ['done', 'dropped', 'filed'] };

/** @type {Record<Status, string>} */
const STATUS_NAMES = { received: 'To look at', act: 'To act on', discuss: 'To discuss', done: 'Done', dropped: 'Dropped', filed: 'Filed' };

/** @type {readonly Status[]} */
const OPEN = ['received', 'act', 'discuss'];

/** The reasons Drop offers, in the order their keys (1 to 4) pick them. */
const REASONS = [
  { label: 'Junk', reason: 'Junk' },
  { label: 'A test', reason: 'A test' },
  { label: 'Said twice', reason: 'Said twice' },
  { label: 'No reason', reason: '' },
];

/** Gmail's compose window; the link names the signed-in account so no other account sends. */
const GMAIL = 'https://mail.google.com/mail/';
/** Where filed issues and moved threads live; a link to one is built from this, so it names no other site. */
const GITHUB = 'https://github.com/';
/** A moved thread's origin, `github:<owner>/<repo>#<n>`. */
const GITHUB_REF = /^github:([\w.-]+\/[\w.-]+)#(\d+)$/;
/** A filed thread's issue address, as the server checks it. */
const ISSUE = /^https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/issues\/(\d+)$/;
/** The booking page an idea's reply offers. */
const BOOKING = 'https://cal.com/whysosuresh';
/** How much of a note a reply quotes. */
const QUOTE = 400;
/** How long a toast, and so its Undo, stays. */
const TOAST_MS = 6000;
/** An open thread untouched this long shows on Today. */
const WEEK_MS = 7 * 24 * 3600 * 1000;
/** How long ⌘K waits after a key before it searches. */
const SEARCH_WAIT_MS = 150;
/** Telugu script, so text in it gets the taller line its letters need. */
const TELUGU = /[ఀ-౿]/;
/** Marks this device as one that has signed in before, so a signed-out visit shows a small "Sign in". */
const SIGNED_IN_KEY = 'threads:signed-in';
/** The sandbox a page's frame runs in, the same tokens its answer's CSP names (src/page.ts). */
const PAGE_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';
/** The heights a page may ask its frame for; anything else is ignored. */
const PAGE_HEIGHT = { min: 160, max: 20000 };
/** A thread's own address, with its title after the number or not. */
const THREAD_PATH = /^\/threads\/([1-9]\d{0,8})(?:-[^/]*)?$/;

/**
 * @template {Element} T
 * @param {ParentNode} root
 * @param {string} selector
 * @param {new () => T} kind
 * @returns {T}
 */
function find(root, selector, kind) {
  const found = root.querySelector(selector);
  if (!(found instanceof kind)) throw new Error(`threads: missing ${selector}`);
  return found;
}

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [children]
 * @returns {HTMLElement}
 */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

/** @type {HTMLTemplateElement | null} */
let iconTemplate = null;

/**
 * One of the page's icons, copied from its template.
 * @param {string} name
 * @returns {Node}
 */
function icon(name) {
  const found = iconTemplate?.content.querySelector(`svg[data-name="${name}"]`);
  return found ? found.cloneNode(true) : document.createTextNode('');
}

/** @param {string} key */
function kbd(key) {
  return el('kbd', {}, [key]);
}

/** @param {string | null} slug */
function spaceLabel(slug) {
  return SPACES.find((space) => space.slug === slug)?.label ?? 'No space';
}

/** @param {string} value @returns {value is Tab} */
function isTab(value) {
  return /** @type {readonly string[]} */ (TABS).includes(value);
}

/** @param {string} value */
function isSpace(value) {
  return SPACES.some((space) => space.slug === value);
}

/** @param {Status} status @returns {Tab} */
function tabOf(status) {
  if (status === 'received') return 'look';
  if (status === 'act' || status === 'discuss') return status;
  return 'done';
}

/** @param {Thread} thread */
function isOpen(thread) {
  return OPEN.includes(thread.status);
}

/** @param {string} iso */
function ago(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

/** @param {string} iso */
function when(iso) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString([], sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A thread's title, or for a visitor's note (which has none) its first words. @param {Thread} thread */
function titleOf(thread) {
  if (thread.title) return thread.title;
  const first = thread.body.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
  return first.length > 80 ? `${first.slice(0, 80).trimEnd()}…` : first || `A note from ${thread.senderName ?? 'someone'}`;
}

/** The thread's address words: its title, lower case, letters and digits joined by dashes. @param {Thread} thread */
function slugOf(thread) {
  const slug = titleOf(thread)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug === '' ? `${thread.number}` : `${thread.number}-${slug}`;
}

/** @param {Thread} thread */
function threadPath(thread) {
  return `/threads/${slugOf(thread)}`;
}

/** The line under a row's title: the summary's first line without its label, or the text's. @param {Thread} thread */
function firstLine(thread) {
  const summary = (thread.summary ?? '').split('\n').find((line) => line.trim() !== '');
  const line = summary ? summary.replace(/^\s*\*{0,2}[A-Za-z ]{1,20}:\*{0,2}\s*/, '') : (thread.body.split('\n').find((text) => text.trim() !== '') ?? '');
  return line.replace(/[*#`>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Who a thread is from, as a row says it. @param {Thread} thread */
function fromWords(thread) {
  if (thread.source === 'talk') return `${thread.senderName?.trim() || 'Someone'} · from the site`;
  if (thread.source === 'told') return `told to you by ${thread.senderName?.trim() || 'someone'}`;
  const moved = thread.ref === null ? null : GITHUB_REF.exec(thread.ref);
  return moved ? `yours · moved from ${moved[1]}#${moved[2]}` : 'yours';
}

/**
 * A GitHub issue as a link and its short name, or null when the address isn't one.
 * @param {string | null} address
 * @returns {{ href: string, name: string } | null}
 */
function issueOf(address) {
  const match = address === null ? null : ISSUE.exec(address);
  return match && address !== null ? { href: `${GITHUB}${address.slice(GITHUB.length)}`, name: `${match[1]}#${match[2]}` } : null;
}

/** @param {Thread} thread @returns {{ href: string, name: string } | null} */
function originOf(thread) {
  const match = thread.ref === null ? null : GITHUB_REF.exec(thread.ref);
  return match ? { href: `${GITHUB}${match[1]}/issues/${match[2]}`, name: `${match[1]}#${match[2]}` } : null;
}

/** @param {string} text */
function quoted(text) {
  const cut = text.length > QUOTE ? `${text.slice(0, QUOTE).trimEnd()}…` : text;
  return cut.split('\n').map((line) => `> ${line}`).join('\n');
}

/** @param {Thread} thread */
function canReply(thread) {
  if (!thread.senderEmail) return false;
  if (thread.kind === 'idea') return thread.status !== 'dropped';
  return thread.kind === 'feedback' && thread.status === 'done';
}

/**
 * The reply he starts from: an idea's offers a call, a feedback reply asks him to say what changed.
 * @param {Thread} thread
 * @returns {Draft}
 */
function draftReply(thread) {
  const first = (thread.senderName ?? '').trim().split(/\s+/)[0] || 'there';
  if (thread.kind === 'idea') {
    const about = thread.space === null || thread.space === 'other' ? '' : ` about ${spaceLabel(thread.space)}`;
    return {
      to: thread.senderEmail ?? '',
      subject: 'Your note',
      body: `Hi ${first},\n\nThanks for your note${about}:\n\n${quoted(thread.body)}\n\nI'd like to talk it through. Book a time that suits you: ${BOOKING}\n\nSuresh`,
    };
  }
  return {
    to: thread.senderEmail ?? '',
    subject: 'What changed after your feedback',
    body: `Hi ${first},\n\nYou told me:\n\n${quoted(thread.body)}\n\nHere's what I changed: [say what changed]\n\nThanks for telling me.\n\nSuresh`,
  };
}

/**
 * Gmail's compose link for a draft, as the signed-in account.
 * @param {Draft} draft
 * @param {string} account
 */
function gmailLink(draft, account) {
  const query = new URLSearchParams({ authuser: account, view: 'cm', fs: '1', to: draft.to, su: draft.subject, body: draft.body });
  return `${GMAIL}?${query.toString()}`;
}

/**
 * The thread as a move will leave it, shown before the server answers.
 * @param {Thread} thread
 * @param {Action} action
 * @returns {Thread}
 */
function predict(thread, action) {
  const now = new Date().toISOString();
  const touched = { ...thread, activityAt: now };
  switch (action.action) {
    case 'act':
      return { ...touched, status: 'act', kind: 'feedback', movedAt: now };
    case 'discuss':
      return { ...touched, status: 'discuss', kind: 'idea', movedAt: now };
    case 'unsort':
      return { ...touched, status: 'received', kind: null, movedAt: now };
    case 'done':
      return { ...touched, status: 'done', movedAt: now };
    case 'drop':
      return { ...touched, status: 'dropped', dropReason: action.reason === '' ? null : action.reason, movedAt: now };
    case 'reopen': {
      /** @type {Status} */
      const back = thread.filedLink ? 'filed' : thread.kind === 'feedback' ? 'act' : thread.kind === 'idea' ? 'discuss' : 'received';
      return { ...touched, status: back, dropReason: null, movedAt: now };
    }
    case 'space':
      return { ...touched, space: action.space, movedAt: now };
    case 'reply-opened':
      return { ...touched, replyOpenedAt: now, movedAt: now };
  }
}

/**
 * The move that puts a thread back as it was before `action`, or null when there is none.
 * @param {Thread} before
 * @param {Action} action
 * @returns {Action | null}
 */
function inverse(before, action) {
  switch (action.action) {
    case 'act':
    case 'discuss':
    case 'unsort':
      if (before.status === 'received') return { action: 'unsort' };
      return before.status === 'act' ? { action: 'act' } : { action: 'discuss' };
    case 'done':
    case 'drop':
      return { action: 'reopen' };
    case 'reopen':
      return before.status === 'dropped' ? { action: 'drop', reason: before.dropReason ?? '' } : { action: 'done' };
    case 'space':
      return before.space !== null && isSpace(before.space) ? { action: 'space', space: before.space } : null;
    case 'reply-opened':
      return null;
  }
}

/** What a move's toast says. @param {Thread} thread @param {Action} action */
function saidOf(thread, action) {
  switch (action.action) {
    case 'drop':
      return `Dropped #${thread.number}`;
    case 'space':
      return `Moved #${thread.number} to ${spaceLabel(action.space)}`;
    case 'reply-opened':
      return 'Opened in Gmail, as you. Send it there.';
    default:
      return `Moved #${thread.number} to ${STATUS_NAMES[predict(thread, action).status]}`;
  }
}

/** @param {string} address */
function isThreadAddress(address) {
  return THREAD_PATH.test(address);
}

/** @param {Location} at @returns {Route} */
function routeOf(at) {
  const thread = THREAD_PATH.exec(at.pathname);
  if (thread) return { view: 'thread', number: Number(thread[1]) };
  const query = new URLSearchParams(at.search);
  const tab = query.get('tab') ?? '';
  const space = query.get('space') ?? '';
  if (isTab(tab) || isSpace(space)) return { view: 'list', tab: isTab(tab) ? tab : 'look', space: isSpace(space) ? space : null };
  return { view: 'today' };
}

/** @param {Route} route @param {Map<number, Thread>} threads */
function pathOf(route, threads) {
  if (route.view === 'today') return '/threads/';
  if (route.view === 'list') {
    const query = new URLSearchParams({ tab: route.tab });
    if (route.space !== null) query.set('space', route.space);
    return `/threads/?${query.toString()}`;
  }
  const thread = threads.get(route.number);
  return thread ? threadPath(thread) : `/threads/${route.number}`;
}

/**
 * Inline runs as nodes: text stays text, a link opens in a new tab, a thread's number opens that thread.
 * @param {Inline[]} runs
 * @returns {(Node | string)[]}
 */
function inlineNodes(runs) {
  return runs.map((run) => {
    switch (run.type) {
      case 'text':
        return run.text;
      case 'code':
        return el('code', {}, [run.text]);
      case 'strong':
        return el('strong', {}, [run.text]);
      case 'em':
        return el('em', {}, [run.text]);
      case 'link':
        return el('a', { href: run.href, target: '_blank', rel: 'noopener' }, [run.text]);
      case 'thread':
        return el('a', { class: 't-ref', href: `/threads/${run.number}`, 'data-thread': String(run.number) }, [`#${run.number}`]);
    }
  });
}

/**
 * Markdown, drawn: headings, paragraphs, quotes, lists, code and rules; a table stays as typed.
 * @param {string} text
 * @returns {HTMLElement}
 */
function prose(text) {
  const box = el('div', { class: 't-prose' });
  if (TELUGU.test(text)) box.setAttribute('lang', 'te');
  for (const block of parse(text)) {
    switch (block.type) {
      case 'h':
        box.append(el('h3', { class: 't-md-h' }, inlineNodes(block.inline)));
        break;
      case 'p':
        box.append(el('p', {}, inlineNodes(block.inline)));
        break;
      case 'quote':
        box.append(el('blockquote', {}, inlineNodes(block.inline)));
        break;
      case 'list':
        box.append(el(block.ordered ? 'ol' : 'ul', {}, block.items.map((item) => el('li', {}, inlineNodes(item)))));
        break;
      case 'pre':
        box.append(el('pre', { class: 't-code' }, [el('code', {}, [block.text])]));
        break;
      case 'rule':
        box.append(el('hr'));
        break;
    }
  }
  return box;
}

/**
 * The living summary: labelled lines as a two-column grid, anything else as Markdown.
 * @param {string} text
 */
function summaryBody(text) {
  const lines = summaryLines(text);
  if (lines === null) return prose(text);
  const grid = el('dl', { class: 't-sum-grid' });
  for (const line of lines) grid.append(el('div', {}, [el('dt', {}, [line.label]), el('dd', {}, inlineNodes(line.inline))]));
  return grid;
}

/** A visitor's own words: plain text, never parsed. @param {string} text */
function plain(text) {
  const box = el('p', { class: 't-plain' }, [text]);
  if (TELUGU.test(text)) box.setAttribute('lang', 'te');
  return box;
}

/** The round initial beside a name. @param {'owner' | 'sync' | 'visitor' | 'member'} who @param {string} name */
function avatar(who, name) {
  if (who === 'owner') return el('span', { class: 't-av t-av-me', 'aria-hidden': 'true' }, ['S']);
  if (who === 'sync') return el('span', { class: 't-av t-av-agent', 'aria-hidden': 'true' }, ['C']);
  return el('span', { class: 't-av', 'aria-hidden': 'true' }, [(name.trim().charAt(0) || '?').toUpperCase()]);
}

/** Puts the focus in the element `selector` finds under `root`, when there is one. @param {ParentNode} root @param {string} selector */
function focusIn(root, selector) {
  const found = root.querySelector(selector);
  if (found instanceof HTMLElement) found.focus({ preventScroll: true });
}

/** Whether a press came from a field being typed in. @param {EventTarget | null} target */
function typingIn(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** Whether a click asks for a new tab or window, which the page leaves to the browser. @param {MouseEvent} event */
function wantsNewTab(event) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

/** A row's small mark for a thread that shows a page or a link. @param {Thread} thread @returns {Node[]} */
function rowMark(thread) {
  if (thread.main === 'text') return [];
  return [el('span', { class: 't-row-mark', title: thread.main === 'page' ? 'A page' : 'A link' }, [icon(thread.main === 'page' ? 'doc' : 'link')])];
}

/**
 * The card a link thread shows: the artifact's title and address, and Open in Claude, in a new tab.
 * @param {{ url: string, title: string | null }} link
 */
function linkCard(link) {
  const shown = link.url.replace(/^https:\/\//, '');
  return el('section', { class: 't-link-card', 'aria-label': 'Link' }, [
    el('div', { class: 't-link-thumb' }, [el('span', {}, ['Claude artifact']), el('b', {}, [link.title ?? 'On claude.ai'])]),
    el('div', { class: 't-link-main' }, [
      el('span', {}, [el('span', { class: 't-chip' }, [icon('link'), 'Claude artifact'])]),
      el('b', {}, [link.title ?? 'A Claude artifact']),
      el('small', {}, [shown]),
      el('p', {}, ['Kept as a link: it opens only on claude.ai, for the people it is shared with there.']),
      el('span', {}, [el('a', { class: 't-btn t-btn-primary', href: link.url, target: '_blank', rel: 'noopener' }, ['Open in Claude'])]),
    ]),
  ]);
}

/**
 * Puts a freshly drawn thread into the pane while keeping the page's frame that is already there, so a move, a
 * comment or a toggle never reloads the page (an iframe taken out of the document loads again). Everything around
 * the frame is replaced; the frame's own bar too. False when there is no such frame to keep.
 * @param {HTMLElement} pane
 * @param {HTMLElement} view
 */
function keepFrame(pane, view) {
  const fresh = view.querySelector('.t-page');
  const key = fresh instanceof HTMLElement ? fresh.dataset.pageKey : undefined;
  const kept = key === undefined ? null : pane.querySelector(`.t-page[data-page-key="${key}"]`);
  const doc = kept?.parentElement;
  const freshDoc = fresh?.parentElement;
  const details = pane.querySelector('.t-details');
  const freshDetails = view.querySelector('.t-details');
  if (!(kept instanceof HTMLElement) || !(fresh instanceof HTMLElement) || !doc || !freshDoc || !details || !freshDetails) return false;
  const children = [...freshDoc.children];
  const at = children.indexOf(fresh);
  for (const child of [...doc.children]) if (child !== kept) child.remove();
  kept.before(...children.slice(0, at));
  kept.after(...children.slice(at + 1));
  const bar = fresh.querySelector('.t-page-bar');
  if (bar) kept.querySelector('.t-page-bar')?.replaceWith(bar);
  kept.dataset.full = fresh.dataset.full ?? 'false';
  details.replaceWith(freshDetails);
  return true;
}

class Threads {
  constructor() {
    this.app = find(document, '[data-app]', HTMLElement);
    this.main = find(document, '[data-main]', HTMLElement);
    this.nav = find(document, '[data-nav]', HTMLElement);
    this.tabbar = find(document, '[data-tabbar]', HTMLElement);
    this.lost = find(document, '[data-lost]', HTMLElement);
    this.signIn = find(document, '[data-sign-in]', HTMLElement);
    this.lostTitle = find(document, '[data-lost-title]', HTMLElement);
    this.lostText = find(document, '[data-lost-text]', HTMLElement);
    this.signInLink = find(document, '[data-sign-in-link]', HTMLAnchorElement);
    this.banner = find(document, '[data-banner]', HTMLElement);
    this.toast = find(document, '[data-toast]', HTMLElement);
    this.toastText = find(document, '[data-toast-text]', HTMLElement);
    this.toastBar = find(document, '[data-toast-bar]', HTMLElement);
    this.undoButton = find(document, '[data-act="undo"]', HTMLButtonElement);
    this.dialog = find(document, '[data-dialog]', HTMLDialogElement);
    iconTemplate = find(document, 'template[data-icons]', HTMLTemplateElement);

    /** @type {Route} */
    this.route = routeOf(location);
    /** Where a thread was opened from, so Esc and the pager go back there. @type {'today' | 'list'} */
    this.from = 'today';
    /** The list's tab and space, kept while a thread is open. @type {Tab} */
    this.tab = 'look';
    /** @type {string | null} */
    this.space = null;
    /** @type {Map<number, Thread>} */
    this.threads = new Map();
    this.loaded = false;
    /** Who is signed in: the owner, or a person he invited to a thread. @type {'owner' | 'member'} */
    this.caller = 'owner';
    /** The signed-in address, which Gmail's link names. */
    this.me = '';
    /** Whether the comment being written is for the owner alone. */
    this.onlyMe = false;
    /** The Share sheet's state while it is open. @type {Sharing | null} */
    this.sharing = null;
    /** The selected row on Today or the list. @type {number | null} */
    this.sel = null;
    /** The open thread with its comments and history. @type {Shown | null} */
    this.shown = null;
    /** The thread's number the page couldn't find. @type {number | null} */
    this.missing = null;
    /** @type {Editing | null} */
    this.editing = null;
    this.editPreview = false;
    /** @type {Draft | null} */
    this.reply = null;
    /** Comments being written, by thread, kept across views and a sign-in that ends. @type {Map<number, string>} */
    this.drafts = new Map();
    this.commentPreview = false;
    /** Which edits show the text they replaced. @type {Set<number>} */
    this.opened = new Set();
    /** The page version shown, by thread; the newest when a thread has none here. @type {Map<number, number>} */
    this.pageVersions = new Map();
    /** Whether the page fills the window. */
    this.pageFull = false;
    /** @type {Overlay} */
    this.overlay = null;
    /** @type {NewDraft | null} */
    this.newDraft = null;
    this.newPreview = false;
    /** @type {FindItem[]} */
    this.found = [];
    this.foundSel = 0;
    this.findTicket = 0;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.findTimer = undefined;
    /** @type {(() => Promise<void>) | null} */
    this.undo = null;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.toastTimer = undefined;
    this.toastLeft = 0;
    this.toastStart = 0;
    /** Bumped on every thread load, so an answer for a thread no longer shown is dropped. */
    this.loading = 0;
    this.keepScroll = false;

    for (const holder of document.querySelectorAll('[data-icon]')) {
      if (holder instanceof HTMLElement) holder.replaceWith(icon(holder.dataset.icon ?? ''));
    }
    document.addEventListener('click', (event) => this.onClick(event));
    document.addEventListener('keydown', (event) => this.onKey(event));
    document.addEventListener('input', (event) => this.onInput(event));
    document.addEventListener('change', (event) => this.onChange(event));
    document.addEventListener('submit', (event) => this.onSubmit(event));
    window.addEventListener('popstate', () => this.go(routeOf(location), false));
    window.addEventListener('message', (event) => this.onPageHeight(event));
    // A dialog's close arrives as a task, after another may already have opened in its place; only a dialog still
    // closed is emptied, so nothing in it keeps the focus and keys reach the page again.
    this.dialog.addEventListener('close', () => {
      if (this.dialog.open) return;
      this.overlay = null;
      this.sharing = null;
      this.dialog.replaceChildren();
      this.main.focus({ preventScroll: true });
    });
    this.toast.addEventListener('mouseenter', () => this.pauseToast());
    this.toast.addEventListener('mouseleave', () => this.resumeToast());
  }

  /**
   * Asks who is calling and loads the thread the address names beside it, then that caller's threads: every one
   * for the owner, theirs for an invited person.
   */
  async start() {
    const route = this.route;
    const inviting = route.view === 'thread' && new URLSearchParams(location.search).has('invite');
    if (route.view === 'list') {
      this.tab = route.tab;
      this.space = route.space;
      this.from = 'list';
    }
    const thread = route.view === 'thread' ? this.loadThread(route.number) : Promise.resolve();
    // Its refusal is read below, after who is calling; until then it mustn't count as unhandled.
    thread.catch(() => undefined);
    try {
      const who = await me();
      this.caller = who.caller === 'member' ? 'member' : 'owner';
      this.me = who.email ?? '';
      if (this.caller === 'member' && route.view === 'list') this.route = { view: 'today' };
      await Promise.all([this.loadAll(), thread]);
    } catch (error) {
      if (error instanceof SignedOut && inviting) location.replace(signInAddress(location.pathname));
      else if (error instanceof SignedOut) this.showLost();
      else if (error instanceof NotShared) this.showNotShared();
      else this.fail(error, "The threads didn't load.");
      return;
    }
    if (inviting || (this.caller === 'member' && route.view === 'list')) history.replaceState(null, '', this.route.view === 'thread' ? location.pathname : '/threads/');
    this.applyCaller();
    rememberSignedIn();
    this.render();
  }

  async loadAll() {
    if (this.caller === 'member') {
      const mine = await listMine();
      this.threads = new Map(mine.map((thread) => [thread.number, thread]));
    } else {
      const pages = await Promise.all(TABS.map((tab) => listAll(tab)));
      this.threads = new Map(pages.flatMap((page) => page.threads).map((thread) => [thread.number, thread]));
    }
    this.loaded = true;
  }

  get member() {
    return this.caller === 'member';
  }

  /**
   * Keeps a thread as a call answered it, with what only the list says (how many people it is shared with, and
   * whether it waits on him) carried over; a change he made himself means it waits on him no longer.
   * @param {Thread} thread
   * @param {{ acted?: boolean, shared?: number }} [given]
   */
  remember(thread, given = {}) {
    const known = this.threads.get(thread.number);
    this.threads.set(thread.number, {
      ...thread,
      shared: given.shared ?? thread.shared ?? known?.shared ?? 0,
      waiting: given.acted ? false : (thread.waiting ?? known?.waiting ?? false),
    });
  }

  /**
   * The parts of the page that are the owner's alone, hidden from a person he invited: New, the list's tab and the
   * keys' owner sheet; the sidebar's foot names who is signed in.
   */
  applyCaller() {
    if (!this.member) return;
    for (const owners of document.querySelectorAll('.t-side-new, .t-tabbar [data-go="list"], .t-tabbar [data-act="new"]')) {
      if (owners instanceof HTMLElement) owners.hidden = true;
    }
    const today = this.tabbar.querySelector('[data-go="today"]');
    if (today) today.replaceChildren(icon('people'), 'Yours');
    const who = document.querySelector('.t-side-who');
    if (who) who.replaceChildren(this.me, el('small', {}, ['Signed in']));
    document.querySelector('.t-side-foot .t-av')?.replaceWith(avatar('member', this.me));
  }

  /** @param {number} number */
  async loadThread(number) {
    const ticket = ++this.loading;
    try {
      const shown = await show(number);
      if (ticket !== this.loading) return;
      this.shown = shown;
      this.missing = null;
      this.remember(shown.thread, this.member ? {} : { shared: shown.people.length });
    } catch (error) {
      if (ticket !== this.loading) return;
      if (error instanceof Missing) {
        this.shown = null;
        this.missing = number;
        return;
      }
      throw error;
    }
  }

  /**
   * The signed-out page. At /threads/ (Today and the list), which names no thread, it says what it is and offers
   * Sign in. At a thread's address it is what a missing address shows, with a small "Sign in" only on a device that
   * has signed in before, so the address never says whether that thread exists.
   */
  showLost() {
    this.app.hidden = true;
    this.lost.hidden = false;
    const here = location.pathname;
    this.signInLink.href = signInAddress(here === '/threads/' || isThreadAddress(here) ? here : '/threads/');
    if (here === '/threads/') {
      this.lostTitle.textContent = 'Threads';
      this.lostText.textContent = "Suresh's private threads. Sign in to open them.";
      this.signInLink.className = 't-btn t-btn-primary';
      this.signIn.hidden = false;
      document.title = 'Threads · whysosuresh.com';
      return;
    }
    this.signIn.hidden = !signedInBefore();
    document.title = 'Nothing here · whysosuresh.com';
  }

  /** Signed in, but nothing is shared with this address now: said plainly, with no sign-in to go round again. */
  showNotShared() {
    this.closeOverlay();
    this.app.hidden = true;
    this.lost.hidden = false;
    this.lostTitle.textContent = 'Nothing is shared with you now';
    this.lostText.textContent = 'This address has no threads on whysosuresh.com any more. If you expected one, ask Suresh.';
    this.signIn.hidden = true;
    document.title = 'Nothing shared · whysosuresh.com';
  }

  /**
   * Shows why something failed: an ended sign-in gets a way back in that returns to this address.
   * @param {unknown} error
   * @param {string} what
   */
  fail(error, what) {
    if (error instanceof NotShared) {
      this.showNotShared();
      return;
    }
    if (error instanceof SignedOut) {
      const here = location.pathname;
      const link = el('a', { href: signInAddress(here === '/threads/' || isThreadAddress(here) ? here : '/threads/') }, ['Sign in again']);
      this.banner.replaceChildren(icon('lock'), 'Your sign-in ended. Nothing you did was lost. ', link);
    } else {
      this.banner.replaceChildren(`${what} Check your connection and try again.`);
      if (!(error instanceof Failed) && !(error instanceof Missing)) console.error(error);
    }
    this.banner.hidden = false;
  }

  clearProblem() {
    this.banner.hidden = true;
  }

  /**
   * Goes to a view, with its own address in the history unless `push` is false (the browser's back and forward).
   * @param {Route} route
   * @param {boolean} [push]
   */
  async go(route, push = true) {
    if (this.member && route.view === 'list') route = { view: 'today' };
    this.closeOverlay();
    this.pageFull = false;
    this.editing = null;
    this.reply = null;
    this.commentPreview = false;
    if (route.view === 'list') {
      this.tab = route.tab;
      this.space = route.space;
      this.from = 'list';
    }
    if (route.view === 'today') this.from = 'today';
    this.route = route;
    if (push) history.pushState(null, '', pathOf(route, this.threads));
    if (route.view !== 'thread') {
      this.shown = null;
      this.missing = null;
      this.render();
      this.main.scrollTop = 0;
      return;
    }
    this.sel = route.number;
    const known = this.threads.get(route.number);
    this.shown = known ? { thread: known, page: null, people: [], comments: [], events: [], truncated: false } : null;
    this.render();
    this.main.scrollTop = 0;
    try {
      await this.loadThread(route.number);
    } catch (error) {
      this.fail(error, "The thread didn't load.");
      return;
    }
    if (this.route.view === 'thread' && this.route.number === route.number) {
      this.keepScroll = true;
      this.render();
    }
  }

  /** @param {number} number */
  openThread(number) {
    void this.go({ view: 'thread', number });
  }

  back() {
    void this.go(this.from === 'today' ? { view: 'today' } : { view: 'list', tab: this.tab, space: this.space });
  }

  /** Threads in a tab, in the chosen space, newest number first. @param {Tab} tab */
  inTab(tab) {
    return [...this.threads.values()]
      .filter((thread) => TAB_STATUSES[tab].includes(thread.status) && (this.space === null || thread.space === this.space))
      .sort((a, b) => b.number - a.number);
  }

  /** Shared threads where an invited person had the last word, the most recent first. */
  waiting() {
    return [...this.threads.values()].filter((thread) => thread.waiting === true).sort((a, b) => b.activityAt.localeCompare(a.activityAt));
  }

  /** New notes, newest first, but for one already waiting on him. */
  fresh() {
    return [...this.threads.values()].filter((thread) => thread.status === 'received' && !thread.waiting).sort((a, b) => b.activityAt.localeCompare(a.activityAt));
  }

  /** Open threads sorted into a tab that sat a week untouched, the longest first, but for one waiting on him. */
  sat() {
    const cutoff = Date.now() - WEEK_MS;
    return [...this.threads.values()]
      .filter((thread) => (thread.status === 'act' || thread.status === 'discuss') && !thread.waiting && new Date(thread.activityAt).getTime() <= cutoff)
      .sort((a, b) => a.activityAt.localeCompare(b.activityAt));
  }

  /** An invited person's threads, most recently active first. */
  mine() {
    return [...this.threads.values()].sort((a, b) => b.activityAt.localeCompare(a.activityAt) || b.number - a.number);
  }

  /** The threads J and K walk: an invited person's own, Today's, or the list's. */
  walk() {
    if (this.member) return this.mine().map((thread) => thread.number);
    return (this.from === 'today' ? [...this.waiting(), ...this.fresh(), ...this.sat()] : this.inTab(this.tab)).map((thread) => thread.number);
  }

  /** The thread a key acts on: the open one, or the selected row. */
  target() {
    if (this.route.view === 'thread') return this.shown?.thread ?? null;
    return this.sel === null ? null : (this.threads.get(this.sel) ?? null);
  }

  /** @param {number} by */
  step(by) {
    const list = this.walk();
    if (list.length === 0) return;
    if (this.route.view === 'thread') {
      const at = list.indexOf(this.route.number);
      const next = list[Math.max(0, Math.min(list.length - 1, at < 0 ? 0 : at + by))];
      if (next !== undefined && next !== this.route.number) this.openThread(next);
      return;
    }
    const at = this.sel === null ? -1 : list.indexOf(this.sel);
    this.sel = list[at < 0 ? 0 : Math.max(0, Math.min(list.length - 1, at + by))] ?? null;
    this.keepScroll = true;
    this.render();
  }

  render() {
    if (!this.loaded) return;
    this.lost.hidden = true;
    this.app.hidden = false;
    const scroll = this.main.scrollTop;
    this.renderNav();
    this.renderTabbar();
    if (this.route.view === 'thread') {
      const view = this.threadView();
      if (!keepFrame(this.main, view)) this.main.replaceChildren(view);
      const thread = this.shown?.thread;
      document.title = thread ? `#${thread.number} ${titleOf(thread)} · Threads` : 'Threads';
      if (thread && location.pathname !== threadPath(thread)) history.replaceState(null, '', threadPath(thread));
    } else if (this.route.view === 'list') {
      this.ensureSel();
      this.main.replaceChildren(this.listView());
      document.title = `${this.space === null ? 'All threads' : spaceLabel(this.space)} · Threads`;
    } else {
      this.ensureSel();
      this.main.replaceChildren(this.member ? this.mineView() : this.todayView());
      document.title = this.member ? 'Shared with you · Threads' : 'Today · Threads';
    }
    if (this.keepScroll) this.main.scrollTop = scroll;
    this.keepScroll = false;
    const selected = this.main.querySelector('.t-row[aria-selected="true"]');
    if (selected && this.route.view !== 'thread') selected.scrollIntoView({ block: 'nearest' });
  }

  ensureSel() {
    const list = this.walk();
    if (this.sel === null || !list.includes(this.sel)) this.sel = list[0] ?? null;
  }

  renderNav() {
    if (this.member) {
      const item = el('a', { class: 't-nav-item', href: '/threads/', 'data-go': 'today' }, [icon('people'), 'Your threads', el('span', { class: 't-nav-count' }, [String(this.threads.size)])]);
      if (this.route.view === 'today') item.setAttribute('aria-current', 'page');
      this.nav.replaceChildren(el('div', { class: 't-nav-label' }, ['Shared with you']), item);
      return;
    }
    const counts = new Map();
    for (const thread of this.threads.values()) if (isOpen(thread) && thread.space !== null) counts.set(thread.space, (counts.get(thread.space) ?? 0) + 1);
    const view = this.route.view;
    const today = this.waiting().length + this.fresh().length + this.sat().length;
    const todayItem = el('a', { class: 't-nav-item', href: '/threads/', 'data-go': 'today' }, [icon('sun'), 'Today', el('span', { class: 't-nav-count' }, [String(today)])]);
    const allItem = el('a', { class: 't-nav-item', href: '/threads/?tab=look', 'data-go': 'list' }, [icon('list'), 'All threads']);
    if (view === 'today') todayItem.setAttribute('aria-current', 'page');
    if (view === 'list' && this.space === null) allItem.setAttribute('aria-current', 'page');
    const spaces = SPACES.map((space) => {
      const item = el('a', { class: 't-nav-item', href: `/threads/?tab=${this.tab}&space=${space.slug}`, 'data-space': space.slug }, [
        el('span', { class: 't-nav-pad' }),
        space.label,
        el('span', { class: 't-nav-count' }, [String(counts.get(space.slug) ?? 0)]),
      ]);
      if (view === 'list' && this.space === space.slug) item.setAttribute('aria-current', 'page');
      return item;
    });
    this.nav.replaceChildren(todayItem, allItem, el('div', { class: 't-nav-label' }, ['Spaces']), ...spaces);
  }

  renderTabbar() {
    for (const button of this.tabbar.querySelectorAll('[data-go]')) {
      const current = button instanceof HTMLElement && button.dataset.go === this.route.view;
      if (current) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }

  /**
   * One thread as a row: its number, title, the line under it, its space, where it stands and when it last moved.
   * @param {Thread} thread
   * @param {string} sub
   */
  row(thread, sub) {
    const meta = el('span', { class: 't-row-meta' }, [el('span', { class: 't-chip' }, [spaceLabel(thread.space)])]);
    if (thread.status !== 'received') meta.append(el('span', {}, [STATUS_NAMES[thread.status]]));
    if ((thread.shared ?? 0) > 0) meta.append(el('span', { class: 't-people-mark', title: `Shared with ${thread.shared}` }, [icon('people'), String(thread.shared)]));
    meta.append(el('span', {}, [ago(thread.activityAt)]));
    const row = el('a', { class: 't-row', href: threadPath(thread), 'data-thread': String(thread.number), 'aria-selected': String(this.sel === thread.number) }, [
      el('span', { class: 't-num' }, [`#${thread.number}`]),
      el('span', { class: 't-row-main' }, [el('span', { class: 't-row-title' }, [...rowMark(thread), titleOf(thread)]), el('span', { class: 't-row-sub' }, [sub])]),
      meta,
    ]);
    return row;
  }

  /** @param {Thread} thread */
  rowLine(thread) {
    const line = firstLine(thread);
    const dropped = thread.status === 'dropped' ? ` · dropped${thread.dropReason ? `: ${thread.dropReason}` : ''}` : '';
    return `${fromWords(thread)}${line ? ` · ${line}` : ''}${dropped}`;
  }

  todayView() {
    const waiting = this.waiting();
    const fresh = this.fresh();
    const sat = this.sat();
    const total = waiting.length + fresh.length + sat.length;
    const date = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    /**
     * @param {string} title
     * @param {Thread[]} list
     * @param {(Node | string)[]} hint
     * @param {(thread: Thread) => string} sub
     * @param {string} empty
     */
    const section = (title, list, hint, sub, empty) =>
      el('section', { class: 't-section' }, [
        el('div', { class: 't-section-head' }, [el('h2', {}, [title]), el('span', { class: 't-n' }, [String(list.length)]), el('span', { class: 't-hint' }, hint)]),
        el('div', { class: 't-list' }, list.length > 0 ? list.map((thread) => this.row(thread, sub(thread))) : [el('div', { class: 't-empty' }, [empty])]),
      ]);
    return el('div', { class: 't-wrap' }, [
      el('div', { class: 't-head' }, [
        el('div', {}, [
          el('h1', {}, [date]),
          el('p', {}, [total > 0 ? `${total} thing${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} you. Everything else can wait.` : 'Nothing needs you. Everything is sorted.']),
        ]),
        el('button', { type: 'button', class: 't-btn t-btn-primary', 'data-act': 'new' }, [icon('plus'), 'New thread ', kbd('N')]),
      ]),
      ...(waiting.length > 0 ? [section('Waiting on you', waiting, ['the last word on a shared thread is theirs'], (thread) => firstLine(thread), '')] : []),
      section('New', fresh, [el('span', { class: 't-keys-hint' }, [kbd('A'), ' act · ', kbd('T'), ' talk · ', kbd('D'), ' drop'])], (thread) => this.rowLine(thread), 'All sorted.'),
      section('Sat a week', sat, ['still open, untouched for 7 days'], (thread) => `${ago(thread.activityAt)} in ${STATUS_NAMES[thread.status]}. Move it, or drop it.`, 'Nothing has sat a week.'),
    ]);
  }

  /** An invited person's home: the threads shared with them, most recently active first. */
  mineView() {
    const mine = this.mine();
    return el('div', { class: 't-wrap' }, [
      el('div', { class: 't-head' }, [el('div', {}, [el('h1', {}, ['Shared with you']), el('p', {}, ['The threads Suresh shared with you, newest activity first.'])])]),
      el('div', { class: 't-list' }, mine.length > 0 ? mine.map((thread) => this.row(thread, firstLine(thread))) : [el('div', { class: 't-empty' }, ['Nothing is shared with you yet.'])]),
      el('p', { class: 't-note' }, ['Only the threads Suresh invites you to show here.']),
    ]);
  }

  listView() {
    const list = this.inTab(this.tab);
    const filters = el('div', { class: 't-filters', role: 'group', 'aria-label': 'Space' }, [
      el('a', { class: 't-filter', href: `/threads/?tab=${this.tab}`, 'data-space': '', 'aria-current': String(this.space === null) }, ['All spaces']),
      ...SPACES.map((space) =>
        el('a', { class: 't-filter', href: `/threads/?tab=${this.tab}&space=${space.slug}`, 'data-space': space.slug, 'aria-current': String(this.space === space.slug) }, [space.label]),
      ),
    ]);
    const tabs = el(
      'div',
      { class: 't-tabs', role: 'tablist', 'aria-label': 'Where it stands' },
      TABS.map((tab, i) =>
        el('a', { class: 't-tab', role: 'tab', href: pathOf({ view: 'list', tab, space: this.space }, this.threads), 'data-tab': tab, 'aria-selected': String(this.tab === tab) }, [
          TAB_NAMES[tab],
          el('span', { class: 't-nav-count' }, [String(this.inTab(tab).length)]),
          kbd(String(i + 1)),
        ]),
      ),
    );
    return el('div', { class: 't-wrap' }, [
      el('div', { class: 't-head' }, [
        el('div', {}, [
          el('h1', {}, [this.space === null ? 'All threads' : spaceLabel(this.space)]),
          el('p', {}, [this.space === null ? 'Every thread, by where it stands. Newest number first.' : `Threads in ${spaceLabel(this.space)}, newest number first.`]),
        ]),
        el('button', { type: 'button', class: 't-btn', 'data-act': 'new' }, [icon('plus'), 'New thread']),
      ]),
      filters,
      el('div', {}, [
        tabs,
        el(
          'div',
          { class: 't-list t-list-tabbed', role: 'tabpanel' },
          list.length > 0 ? list.map((thread) => this.row(thread, this.rowLine(thread))) : [el('div', { class: 't-empty' }, [this.tab === 'look' ? 'All sorted.' : 'No threads here.'])],
        ),
      ]),
    ]);
  }

  threadView() {
    if (this.missing !== null || this.shown === null) {
      return el('div', { class: 't-wrap' }, [
        el('div', { class: 't-missing' }, [
          el('h1', {}, [this.missing !== null ? 'Nothing here' : 'Loading…']),
          el('p', {}, [this.missing !== null ? `There's no thread #${this.missing}.` : '']),
          el('a', { href: '/threads/', 'data-go': 'today' }, [this.member ? 'Back to your threads' : 'Back to Today']),
        ]),
      ]);
    }
    const thread = this.shown.thread;
    if (this.editing) return this.editorView(thread, this.editing);
    const list = this.walk();
    const at = list.indexOf(thread.number);
    const visitor = thread.source === 'talk';
    const pager = el('span', { class: 't-pager' }, [
      el('button', { type: 'button', 'data-act': 'prev', 'aria-label': 'Previous thread (K)', ...(at <= 0 ? { disabled: '' } : {}) }, [icon('up')]),
      el('button', { type: 'button', 'data-act': 'next', 'aria-label': 'Next thread (J)', ...(at < 0 || at >= list.length - 1 ? { disabled: '' } : {}) }, [icon('down')]),
      el('button', { type: 'button', 'data-act': 'back', 'aria-label': 'Back to the list (Esc)' }, [icon('x')]),
    ]);
    const crumbs = el('div', { class: 't-crumbs' }, [
      thread.space === null || this.member
        ? el('span', {}, [spaceLabel(thread.space)])
        : el('a', { href: `/threads/?tab=${tabOf(thread.status)}&space=${thread.space}`, 'data-space': thread.space }, [spaceLabel(thread.space)]),
      el('span', {}, ['/']),
      el('span', {}, [`#${thread.number}`]),
      el('span', { class: 't-chip' }, [STATUS_NAMES[thread.status]]),
      pager,
    ]);
    const by = this.member
      ? 'Suresh shared this with you'
      : visitor
      ? `${thread.senderName?.trim() || 'Someone'} sent this from the site`
      : thread.source === 'told'
        ? `${thread.senderName?.trim() || 'Someone'} told you this`
        : this.shown.events[0]?.actor === 'owner'
          ? 'You started this'
          : 'You said this; the recorder sync wrote it down';
    const summary = thread.summary
      ? el('section', { class: 't-summary', 'aria-label': 'Summary' }, [
          el('div', { class: 't-summary-head' }, [el('span', {}, ['Summary']), el('span', {}, ['kept current by the recorder sync'])]),
          summaryBody(thread.summary),
        ])
      : this.member
        ? el('section', { class: 't-summary t-summary-empty', 'aria-label': 'Summary' }, ['No summary yet.'])
        : el('section', { class: 't-summary t-summary-empty', 'aria-label': 'Summary' }, ['No summary yet. The sync writes one at its next pass, or press ', kbd('W'), ' to write it.']);
    const text = this.mainSection(thread, this.shown.page);
    const doc = el('article', { class: 't-doc' }, [
      crumbs,
      el('h1', { class: 't-title' }, [el('span', { class: 't-tn' }, [`#${thread.number}`]), ' ', titleOf(thread)]),
      el('div', { class: 't-byline' }, [`${by}, ${when(thread.createdAt)} · updated ${ago(thread.activityAt)} ago`]),
      ...(this.member ? [] : [this.moves(thread)]),
      summary,
      ...(this.reply ? [this.replyPanel(this.reply)] : []),
      ...text,
      el('div', { class: 't-feed' }, this.feed(this.shown, thread)),
      ...(this.shown.truncated ? [el('p', { class: 't-note' }, ['Only the first 500 comments and events are shown.'])] : []),
      this.composer(thread),
    ]);
    return el('div', { class: 't-thread' }, [doc, this.member ? this.memberDetails(thread) : this.details(thread)]);
  }

  /**
   * A thread's main section: its page, its link, or its text (a visitor's own words as typed, else Markdown). A page
   * thread still waiting for its call shows nothing in the page's place, so nothing jumps when it arrives.
   * @param {Thread} thread
   * @param {Page | null} page
   * @returns {HTMLElement[]}
   */
  mainSection(thread, page) {
    if (thread.main === 'page') return page ? [this.pageSection(thread, page)] : [];
    if (thread.main === 'link' && thread.link) return [linkCard(thread.link)];
    if (thread.source !== 'talk') return [prose(thread.body)];
    const name = thread.senderName?.trim() || 'Someone';
    return [
      el('div', { class: 't-byline' }, [
        avatar('visitor', thread.senderName ?? ''),
        el('span', {}, [el('b', {}, [name]), ` wrote, ${when(thread.createdAt)}${thread.senderEmail ? ` · ${thread.senderEmail}` : ''}`]),
      ]),
      plain(thread.body),
    ];
  }

  /**
   * A thread's page: its bar (the version shown, when it was saved, Versions, Open in Claude for the owner when
   * the version names its claude.ai address, Full screen) over its frame, which loads the version from the thread's
   * own call. The frame is 600 px tall until the page says its height.
   * @param {Thread} thread
   * @param {Page} page
   */
  pageSection(thread, page) {
    const version = this.pageVersions.get(thread.number) ?? page.version;
    const shown = page.versions.find((one) => one.version === version) ?? page.versions[page.versions.length - 1];
    const number = shown?.version ?? page.version;
    const older = number !== page.version;
    const bar = el('div', { class: 't-page-bar' }, [
      icon('doc'),
      el('b', {}, ['Page']),
      el('span', {}, [`version ${number} · saved ${shown ? when(shown.savedAt) : ''}`]),
      ...(older ? [el('span', { class: 't-page-old' }, [`An earlier version. The newest is ${page.version}.`])] : []),
      el('span', { class: 't-grow' }),
      ...(page.versions.length > 1 ? [el('button', { type: 'button', class: 't-btn', 'data-act': 'page-versions' }, ['Versions'])] : []),
      ...(shown?.source ? [el('a', { class: 't-btn', href: shown.source, target: '_blank', rel: 'noopener' }, ['Open in Claude'])] : []),
      el('button', { type: 'button', class: 't-btn', 'data-act': 'page-full' }, [this.pageFull ? 'Back to thread' : 'Full screen']),
    ]);
    const frame = el('iframe', { class: 't-page-frame', sandbox: PAGE_SANDBOX, src: pageAddress(thread.number, number), title: `Page, version ${number}`, loading: 'lazy' });
    return el('section', { class: 't-page', 'aria-label': 'Page', 'data-page-key': `${thread.number}-${number}`, 'data-full': String(this.pageFull) }, [bar, frame]);
  }

  /**
   * A page's height, from the script its answer carries: taken only from the open page's own frame, and only as a
   * number in range, so nothing else on the screen can resize it.
   * @param {MessageEvent} event
   */
  onPageHeight(event) {
    const frame = this.main.querySelector('.t-page-frame');
    if (!(frame instanceof HTMLIFrameElement) || event.source !== frame.contentWindow) return;
    const data = /** @type {unknown} */ (event.data);
    const height = typeof data === 'object' && data !== null && 'whysosureshPageHeight' in data ? data.whysosureshPageHeight : null;
    if (typeof height !== 'number' || !Number.isFinite(height) || height < PAGE_HEIGHT.min || height > PAGE_HEIGHT.max) return;
    frame.style.height = `${Math.round(height)}px`;
  }

  /** @param {Thread} thread @param {Page} page */
  openVersions(thread, page) {
    const current = this.pageVersions.get(thread.number) ?? page.version;
    const picks = [...page.versions].reverse().map((one) =>
      el('button', { type: 'button', class: 't-pick', 'data-act': 'page-version', 'data-version': String(one.version), ...(one.version === current ? { 'aria-current': 'true' } : {}) }, [
        `Version ${one.version} · ${when(one.savedAt)}`,
        ...(one.version === page.version ? [el('span', { class: 't-chip' }, ['newest'])] : []),
      ]),
    );
    this.openOverlay('versions', `Versions of #${thread.number}'s page`, 'narrow', [this.sheetHead('Versions'), el('div', { class: 't-sheet-body' }, [el('div', { class: 't-pick-list' }, picks)])]);
    picks.find((pick) => pick.getAttribute('aria-current') === 'true')?.focus();
  }

  /** @param {Thread} thread */
  moves(thread) {
    /** @param {string} act @param {string} label @param {string} key @param {boolean} primary */
    const button = (act, label, key, primary) =>
      primary
        ? el('button', { type: 'button', class: 't-btn t-btn-primary', 'data-act': act }, [label, ' ', kbd(key)])
        : el('button', { type: 'button', class: 't-btn', 'data-act': act }, [label, ' ', kbd(key)]);
    const status = thread.status;
    /** @type {(Node | string)[]} */
    const out = [];
    if (status === 'received') out.push(button('act', 'Act on it', 'A', true), button('discuss', 'Talk it through', 'T', false), button('drop', 'Drop', 'D', false));
    if (status === 'act' || status === 'discuss') out.push(button('done', 'Done', 'E', true), button('drop', 'Drop', 'D', false));
    if (status === 'filed') out.push(button('done', 'Done', 'E', true));
    if (status === 'done' || status === 'dropped') out.push(button('reopen', 'Reopen', 'U', false));
    if (canReply(thread)) out.push(el('button', { type: 'button', class: 't-btn', 'data-act': 'reply' }, [icon('reply'), 'Reply ', kbd('R')]));
    out.push(el('button', { type: 'button', class: 't-btn', 'data-act': 'share' }, [icon('people'), 'Share ', kbd('S')]));
    out.push(el('span', { class: 't-grow' }));
    out.push(el('button', { type: 'button', class: 't-btn t-btn-quiet', 'data-act': 'edit' }, [icon('pen'), 'Edit ', kbd('W')]));
    return el('div', { class: 't-moves' }, out);
  }

  /** @param {Draft} draft */
  replyPanel(draft) {
    const to = el('input', { class: 't-field', id: 'reply-to', type: 'email', readonly: '', value: draft.to });
    const subject = /** @type {HTMLInputElement} */ (el('input', { class: 't-field', id: 'reply-subject', type: 'text', value: draft.subject }));
    const body = /** @type {HTMLTextAreaElement} */ (el('textarea', { class: 't-field', id: 'reply-body', rows: '9' }, [draft.body]));
    const open = /** @type {HTMLAnchorElement} */ (el('a', { class: 't-btn t-btn-primary', target: '_blank', rel: 'noopener', 'data-act': 'reply-opened' }, [icon('mail'), 'Open in Gmail']));
    const link = () => {
      draft.subject = subject.value;
      draft.body = body.value;
      open.href = gmailLink(draft, this.me);
    };
    link();
    subject.addEventListener('input', link);
    body.addEventListener('input', link);
    const first = draft.body.split(',')[0]?.replace(/^Hi\s+/, '') ?? '';
    return el('section', { class: 't-reply', 'aria-label': 'Reply' }, [
      el('div', { class: 't-reply-head' }, [icon('reply'), el('h2', {}, ['Reply, drafted for you']), el('span', {}, ['Nothing is sent from here'])]),
      el('div', { class: 't-reply-body' }, [
        el('label', { class: 't-fld' }, [el('span', { class: 't-lbl' }, ['To']), to]),
        el('label', { class: 't-fld' }, [el('span', { class: 't-lbl' }, ['Subject']), subject]),
        el('label', { class: 't-fld' }, [el('span', { class: 't-lbl' }, ['Message']), body]),
      ]),
      el('div', { class: 't-reply-actions' }, [
        open,
        el('button', { type: 'button', class: 't-btn', 'data-act': 'reply-copy' }, ['Copy']),
        el('button', { type: 'button', class: 't-btn t-btn-quiet', 'data-act': 'reply-close' }, ['Not now']),
        el('span', { class: 't-note' }, [`Opens as the account you signed in with, ${first}'s note quoted.`]),
      ]),
    ]);
  }

  /**
   * The history and the comments, in the order they happened.
   * @param {Shown} shown
   * @param {Thread} thread
   */
  feed(shown, thread) {
    /** @type {{ at: string, order: number, node: HTMLElement }[]} */
    const entries = [];
    shown.events.forEach((event, i) => entries.push({ at: event.at, order: i, node: this.eventNode(event, thread) }));
    shown.comments.forEach((said, i) => entries.push({ at: said.createdAt, order: shown.events.length + i, node: this.commentNode(said, thread) }));
    entries.sort((a, b) => (a.at === b.at ? a.order - b.order : a.at.localeCompare(b.at)));
    return entries.map((entry) => entry.node);
  }

  /** @param {string} actor @param {Thread} thread */
  actorName(actor, thread) {
    if (actor === 'owner') return this.member ? 'Suresh' : 'You';
    if (actor === 'sync') return 'Claude';
    if (actor === 'import') return 'The inbox';
    return thread.senderName?.trim() || 'Someone';
  }

  /**
   * One event of a thread's history as a line: who, what, when, and for an edit the text it replaced.
   * @param {ThreadEvent} event
   * @param {Thread} thread
   */
  eventNode(event, thread) {
    const data = event.data;
    /** @param {unknown} value */
    const word = (value) => el('b', {}, [typeof value === 'string' ? value : '']);
    /** @param {unknown} status */
    const statusWord = (status) => word(typeof status === 'string' && status in STATUS_NAMES ? STATUS_NAMES[/** @type {Status} */ (status)] : String(status));
    let name = 'move';
    /** @type {(Node | string)[]} */
    let words = [event.type];
    /** @type {string | null | undefined} */
    let before;
    switch (event.type) {
      case 'created':
        if (event.actor === 'visitor') [name, words] = ['mail', ['sent this from the site']];
        else if (event.actor === 'owner') [name, words] = ['plus', ['started this thread']];
        else if (data.source === 'told') [name, words] = ['mic', ['added this, as told by ', word(thread.senderName ?? 'someone')]];
        else [name, words] = ['mic', ['added this']];
        break;
      case 'moved': {
        const issue = issueOf(typeof data.link === 'string' ? data.link : null);
        if (data.to === 'dropped') [name, words] = ['x', ['dropped this', ...(typeof data.reason === 'string' && data.reason !== '' ? [': ', word(data.reason)] : [])]];
        else if (data.to === 'filed' && issue && data.from !== 'done') [name, words] = ['link', ['filed this as ', el('a', { href: issue.href, target: '_blank', rel: 'noopener' }, [issue.name])]];
        else [name, words] = [data.to === 'done' ? 'check' : data.from === 'done' || data.from === 'dropped' ? 'reopen' : 'move', ['moved this from ', statusWord(data.from), ' to ', statusWord(data.to)]];
        break;
      }
      case 'space':
        [name, words] = ['space', ['moved this from ', word(spaceLabel(typeof data.from === 'string' ? data.from : null)), ' to ', word(spaceLabel(typeof data.to === 'string' ? data.to : null))]];
        break;
      case 'reply-opened':
        [name, words] = ['mail', ['opened a reply in Gmail']];
        break;
      case 'imported':
        [name, words] = ['doc', ['became a thread when the inbox did, in ', statusWord(data.status)]];
        break;
      case 'page-saved':
        [name, words] = ['doc', ['saved a page ', el('b', {}, [`(version ${typeof data.version === 'number' ? data.version : '?'})`])]];
        break;
      case 'link-set':
        if (typeof data.url === 'string') [name, words] = ['link', ['linked a Claude artifact', ...(typeof data.title === 'string' ? [': ', word(data.title)] : [])]];
        else [name, words] = ['link', ['removed the link']];
        break;
      case 'edited': {
        const field = data.field === 'body' ? 'main text' : data.field === 'title' ? 'title' : 'summary';
        name = 'pen';
        words = [`edited the ${field}`];
        // An invited person's history carries no earlier text at all, so it offers none.
        if ('before' in data) before = typeof data.before === 'string' ? data.before : null;
        break;
      }
      case 'invited':
        [name, words] = ['people', ['invited ', word(data.name ?? 'someone')]];
        break;
      case 'removed':
        [name, words] = ['people', ['removed ', word(data.name ?? 'someone')]];
        break;
    }
    const line = el('div', { class: 't-ev' }, [
      el('span', { class: 't-pip' }, [icon(name)]),
      el('span', { class: 't-ev-text' }, [el('b', {}, [this.actorName(event.actor, thread)]), ' ', ...words]),
      el('time', { datetime: event.at }, [when(event.at)]),
    ]);
    if (before !== undefined) {
      const shownBefore = this.opened.has(event.id);
      line.querySelector('.t-ev-text')?.append(
        ' · ',
        el('button', { type: 'button', class: 't-text-btn', 'data-act': 'before', 'data-event': String(event.id), 'aria-expanded': String(shownBefore) }, [
          shownBefore ? 'Hide the earlier one' : 'Show the earlier one',
        ]),
      );
      if (shownBefore) line.append(el('div', { class: 't-ev-before' }, [before ?? '(none)']));
    }
    return line;
  }

  /** @param {ThreadComment} said @param {Thread} thread */
  commentNode(said, thread) {
    const who = said.author === 'owner' ? 'owner' : said.author === 'member' ? 'member' : 'sync';
    const name = who === 'member' ? (said.name ?? 'Someone') : this.actorName(said.author, thread);
    const onlyMe = said.audience === 'owner';
    return el('div', { class: 't-cm', 'data-audience': onlyMe ? 'owner' : 'thread' }, [
      avatar(who, name),
      el('div', { class: 't-cm-box' }, [
        el('div', { class: 't-cm-head' }, [
          el('b', {}, [name]),
          ...(who === 'sync' ? [el('span', { class: 't-chip' }, ['Recorder sync'])] : []),
          ...(onlyMe ? [el('span', { class: 't-chip' }, [icon('lock'), 'Only me'])] : []),
          el('time', { datetime: said.createdAt }, [when(said.createdAt)]),
        ]),
        el('div', { class: 't-cm-body' }, [prose(said.body)]),
      ]),
    ]);
  }

  /** @param {Thread} thread */
  composer(thread) {
    const draft = this.drafts.get(thread.number) ?? '';
    const onlyMe = !this.member && this.onlyMe;
    const box = this.commentPreview
      ? el('div', { class: 't-preview-pane', id: 'comment-preview' }, [draft.trim() === '' ? el('span', { class: 't-note' }, ['Nothing to preview.']) : prose(draft)])
      : el('textarea', { id: 'comment-text', 'aria-label': 'Comment', placeholder: onlyMe ? 'A note for you alone. Markdown works.' : 'Comment. Markdown works.' }, [draft]);
    const others = (this.shown?.people ?? []).filter((person) => !person.owner).map((person) => person.name ?? 'someone');
    const note = this.member
      ? 'Suresh and everyone in this thread read this.'
      : onlyMe
        ? 'Only you and Claude read this.'
        : others.length > 0
          ? `${listed(others)} read${others.length === 1 ? 's' : ''} this too.`
          : 'Only you read this thread.';
    const audience = this.member
      ? []
      : [
          el('span', { class: 't-seg', role: 'group', 'aria-label': 'Who reads it' }, [
            el('button', { type: 'button', 'data-act': 'audience', 'data-audience': 'thread', 'aria-pressed': String(!onlyMe) }, ['Thread']),
            el('button', { type: 'button', 'data-act': 'audience', 'data-audience': 'owner', 'aria-pressed': String(onlyMe) }, [icon('lock'), ' Only me']),
          ]),
        ];
    return el('form', { class: 't-composer', 'data-submit': 'comment', 'data-audience': onlyMe ? 'owner' : 'thread' }, [
      this.member ? avatar('member', this.me) : avatar('owner', ''),
      el('div', { class: 't-composer-box' }, [
        box,
        el('div', { class: 't-composer-bar' }, [
          el('span', { class: 't-note' }, [note]),
          ...audience,
          el('span', { class: 't-seg', role: 'group', 'aria-label': 'Comment view' }, [
            el('button', { type: 'button', 'data-act': 'comment-view', 'data-view': 'write', 'aria-pressed': String(!this.commentPreview) }, ['Write']),
            el('button', { type: 'button', 'data-act': 'comment-view', 'data-view': 'preview', 'aria-pressed': String(this.commentPreview) }, ['Preview']),
          ]),
          el('button', { type: 'submit', class: 't-btn t-btn-primary' }, ['Comment ', kbd('⌘↵')]),
        ]),
      ]),
    ]);
  }

  /** @param {Thread} thread */
  details(thread) {
    const select = el(
      'select',
      { class: 't-select', 'data-change': 'space', 'aria-label': 'Space' },
      SPACES.map((space) => el('option', { value: space.slug, ...(space.slug === thread.space ? { selected: '' } : {}) }, [space.label])),
    );
    if (thread.space === null) select.prepend(el('option', { value: '', selected: '', disabled: '' }, ['No space']));
    /** @param {string} label @param {(Node | string)[]} value @param {boolean} [wide] */
    const row = (label, value, wide = false) => el('div', { class: 't-drow', ...(wide ? { 'data-wide': '' } : {}) }, [el('span', { class: 't-dlabel' }, [label]), ...value]);
    const origin = originOf(thread);
    const issue = issueOf(thread.filedLink);
    const address = `whysosuresh.com/threads/${thread.number}`;
    return el('aside', { class: 't-details', 'aria-label': 'About this thread' }, [
      row('Where it stands', [
        el('span', { class: 't-dval' }, [STATUS_NAMES[thread.status], ...(thread.status === 'dropped' && thread.dropReason ? [el('span', { class: 't-chip' }, [thread.dropReason])] : [])]),
      ]),
      row('Space', [el('span', { class: 't-dval' }, [select])]),
      row('Started', [el('span', { class: 't-dval t-dval-soft' }, [`${when(thread.createdAt)}, ${fromWords(thread)}`])]),
      row('Last activity', [el('span', { class: 't-dval t-dval-soft' }, [`${ago(thread.activityAt)} ago`])]),
      ...(origin ? [row('Moved from', [el('a', { class: 't-linkline', href: origin.href, target: '_blank', rel: 'noopener' }, [origin.name])], true)] : []),
      ...(issue ? [row('Filed as', [el('a', { class: 't-linkline', href: issue.href, target: '_blank', rel: 'noopener' }, [issue.name])], true)] : []),
      row(
        'People',
        [
          (this.shown?.people ?? []).length === 0
            ? el('span', { class: 't-dval t-dval-soft' }, ['Only you'])
            : el('span', { class: 't-dpeople' }, (this.shown?.people ?? []).map((person) => el('span', {}, [person.name ?? 'Someone', ' ', el('small', {}, [person.email ?? ''])]))),
          el('span', {}, [el('button', { type: 'button', class: 't-text-btn', 'data-act': 'share' }, ['Share…'])]),
        ],
        true,
      ),
      row('Link', [el('span', { class: 't-linkline' }, [address]), el('span', {}, [el('button', { type: 'button', class: 't-text-btn', 'data-act': 'copy-link' }, ['Copy link'])])], true),
    ]);
  }

  /** The details beside a thread, as an invited person sees them: where it stands, its people by name, its link. @param {Thread} thread */
  memberDetails(thread) {
    /** @param {string} label @param {(Node | string)[]} value @param {boolean} [wide] */
    const row = (label, value, wide = false) => el('div', { class: 't-drow', ...(wide ? { 'data-wide': '' } : {}) }, [el('span', { class: 't-dlabel' }, [label]), ...value]);
    const address = `whysosuresh.com/threads/${thread.number}`;
    return el('aside', { class: 't-details', 'aria-label': 'About this thread' }, [
      row('Where it stands', [el('span', { class: 't-dval' }, [STATUS_NAMES[thread.status]])]),
      row(
        'People',
        [el('span', { class: 't-dpeople' }, (this.shown?.people ?? []).map((person) => el('span', {}, [person.name ?? 'Someone', ...(person.owner ? [' ', el('small', {}, ['shared it'])] : [])])))],
        true,
      ),
      row('Last activity', [el('span', { class: 't-dval t-dval-soft' }, [`${ago(thread.activityAt)} ago`])]),
      row('Link', [el('span', { class: 't-linkline' }, [address]), el('span', {}, [el('button', { type: 'button', class: 't-text-btn', 'data-act': 'copy-link' }, ['Copy link'])])], true),
    ]);
  }

  /** @param {Thread} thread @param {Editing} editing */
  editorView(thread, editing) {
    const visitor = thread.source === 'talk';
    const title = el('input', { class: 't-field', id: 'edit-title', value: editing.title, maxlength: '200', autocomplete: 'off' });
    const summary = el('textarea', { class: 't-field t-field-mono', id: 'edit-summary', rows: '5' }, [editing.summary]);
    const body = el('textarea', { class: 't-field t-field-mono', id: 'edit-body', rows: visitor ? '4' : '16', ...(visitor ? { readonly: '' } : {}) }, [editing.body]);
    return el('form', { class: 't-editor', 'data-submit': 'edit', 'data-preview': String(this.editPreview) }, [
      el('div', { class: 't-editor-top' }, [
        el('h1', {}, [`Editing #${thread.number}`]),
        el('span', { class: 't-seg t-only-narrow', role: 'group', 'aria-label': 'Edit view' }, [
          el('button', { type: 'button', 'data-act': 'edit-view', 'data-view': 'write', 'aria-pressed': String(!this.editPreview) }, ['Write']),
          el('button', { type: 'button', 'data-act': 'edit-view', 'data-view': 'preview', 'aria-pressed': String(this.editPreview) }, ['Preview']),
        ]),
        el('span', { class: 't-grow' }),
        el('button', { type: 'button', class: 't-btn t-btn-quiet', 'data-act': 'edit-cancel' }, ['Cancel ', kbd('Esc')]),
        el('button', { type: 'submit', class: 't-btn t-btn-primary' }, ['Save ', kbd('⌘↵')]),
      ]),
      el('div', { class: 't-editor-form' }, [
        el('label', { class: 't-fld' }, [el('span', { class: 't-lbl' }, ['Title ', el('small', {}, ['one line, at most 200'])]), title]),
        el('label', { class: 't-fld' }, [el('span', { class: 't-lbl' }, ['Summary ', el('small', {}, ['four lines: Decided, Open, Waiting on, Next'])]), summary]),
        el('label', { class: 't-fld' }, [
          el('span', { class: 't-lbl' }, [
            thread.main === 'text' ? 'Text ' : 'Text, read by the command line and in email; this thread shows its ',
            ...(thread.main === 'text' ? [] : [thread.main === 'page' ? 'page ' : 'link ']),
            el('small', {}, [visitor ? 'their words, never edited' : 'Markdown']),
          ]),
          body,
        ]),
        el('p', { class: 't-note' }, ['Every save keeps the earlier text in the history.']),
      ]),
      el('div', { class: 't-editor-preview', id: 'edit-preview', 'aria-label': 'Preview' }, this.editorPreview(thread, editing)),
    ]);
  }

  /** @param {Thread} thread @param {Editing} editing */
  editorPreview(thread, editing) {
    return [
      el('span', { class: 't-tag' }, ['Preview']),
      el('h2', { class: 't-title' }, [el('span', { class: 't-tn' }, [`#${thread.number}`]), ' ', editing.title.trim() || 'Untitled']),
      ...(editing.summary.trim() ? [el('section', { class: 't-summary' }, [el('div', { class: 't-summary-head' }, [el('span', {}, ['Summary'])]), summaryBody(editing.summary)])] : []),
      thread.source === 'talk' ? plain(editing.body) : prose(editing.body),
    ];
  }

  /* ---------- Overlays: one dialog, filled for each ---------- */

  /**
   * @param {Overlay} overlay
   * @param {string} label
   * @param {'narrow' | 'wide' | 'find' | 'form'} kind
   * @param {(Node | string)[]} body
   */
  openOverlay(overlay, label, kind, body) {
    this.overlay = overlay;
    this.dialog.setAttribute('aria-label', label);
    this.dialog.dataset.kind = kind;
    this.dialog.replaceChildren(...body);
    if (!this.dialog.open) this.dialog.showModal();
  }

  closeOverlay() {
    if (this.dialog.open) this.dialog.close();
    this.overlay = null;
    this.sharing = null;
  }

  /** @param {string} title */
  sheetHead(title) {
    return el('div', { class: 't-sheet-head' }, [el('h2', {}, [title]), el('button', { type: 'button', class: 't-x', 'data-act': 'close', 'aria-label': 'Close' }, [icon('x')])]);
  }

  /** @param {Thread} thread */
  openDrop(thread) {
    const picks = REASONS.map((pick, i) => el('button', { type: 'button', class: 't-pick', 'data-act': 'drop-why', 'data-reason': String(i) }, [pick.label, kbd(String(i + 1))]));
    this.openOverlay('drop', `Drop #${thread.number}`, 'narrow', [this.sheetHead(`Drop #${thread.number}: why?`), el('div', { class: 't-sheet-body' }, [el('div', { class: 't-pick-list' }, picks)])]);
    picks[0]?.focus();
  }

  /** @param {Thread} thread */
  openSpace(thread) {
    const picks = SPACES.map((space, i) =>
      el('button', { type: 'button', class: 't-pick', 'data-act': 'space-to', 'data-space': space.slug, ...(thread.space === space.slug ? { 'aria-current': 'true' } : {}) }, [space.label, kbd(String(i + 1))]),
    );
    this.openOverlay('space', `Move #${thread.number} to a space`, 'narrow', [this.sheetHead(`Move #${thread.number} to a space`), el('div', { class: 't-sheet-body' }, [el('div', { class: 't-pick-list' }, picks)])]);
    picks[0]?.focus();
  }

  openKeys() {
    const groups = (this.member ? MEMBER_SHEET : SHEET).map((group) =>
      el('div', {}, [
        el('h3', {}, [group.title]),
        ...group.rows.map((row) =>
          el('div', { class: 't-key-row' }, [el('span', {}, row.keys.split(' ').map((key) => (key === '–' ? '–' : kbd(key)))), el('span', {}, [row.label])]),
        ),
      ]),
    );
    this.openOverlay('keys', 'Keys', 'wide', [
      this.sheetHead('Keys'),
      el('div', { class: 't-sheet-body' }, [
        el('div', { class: 't-keys' }, groups),
        el('p', { class: 't-note' }, [
          this.member
            ? 'Phones have no keys: the bar along the bottom holds your threads and Find.'
            : 'Phones have no keys: every move is a button on the thread, and the bar along the bottom holds Today, Threads, Find and New.',
        ]),
      ]),
    ]);
  }

  /** @param {Partial<NewDraft>} [given] */
  openNew(given = {}) {
    if (this.member) return;
    this.newDraft = { title: '', space: this.space ?? 'company', status: 'received', body: '', ...given };
    this.newPreview = false;
    this.renderNew();
    find(this.dialog, '#new-title', HTMLInputElement).focus();
  }

  renderNew() {
    const draft = this.newDraft;
    if (draft === null) return;
    const statuses = /** @type {const} */ ([
      ['received', 'To look at'],
      ['act', 'To act on'],
      ['discuss', 'To discuss'],
    ]);
    const text = this.newPreview
      ? el('div', { class: 't-preview-pane', id: 'new-preview' }, [draft.body.trim() === '' ? el('span', { class: 't-note' }, ['Nothing to preview.']) : prose(draft.body)])
      : el('textarea', { class: 't-field t-field-mono', id: 'new-body', rows: '6', 'aria-label': 'Text', placeholder: 'Markdown.' }, [draft.body]);
    this.openOverlay('new', 'New thread', 'form', [
      this.sheetHead('New thread'),
      el('form', { class: 't-sheet-body t-form', 'data-submit': 'new' }, [
        el('label', { class: 't-fld' }, [
          el('span', { class: 't-lbl' }, ['Title']),
          el('input', { class: 't-field', id: 'new-title', value: draft.title, placeholder: 'Something you can say out loud', maxlength: '200', autocomplete: 'off' }),
        ]),
        el('div', { class: 't-two' }, [
          el('label', { class: 't-fld' }, [
            el('span', { class: 't-lbl' }, ['Space']),
            el('select', { class: 't-field', id: 'new-space' }, SPACES.map((space) => el('option', { value: space.slug, ...(space.slug === draft.space ? { selected: '' } : {}) }, [space.label]))),
          ]),
          el('label', { class: 't-fld' }, [
            el('span', { class: 't-lbl' }, ['Where it starts']),
            el('select', { class: 't-field', id: 'new-status' }, statuses.map(([value, label]) => el('option', { value, ...(value === draft.status ? { selected: '' } : {}) }, [label]))),
          ]),
        ]),
        el('div', { class: 't-fld' }, [
          el('span', { class: 't-lbl' }, [
            'Text ',
            el('span', { class: 't-seg', role: 'group', 'aria-label': 'Text view' }, [
              el('button', { type: 'button', 'data-act': 'new-view', 'data-view': 'write', 'aria-pressed': String(!this.newPreview) }, ['Write']),
              el('button', { type: 'button', 'data-act': 'new-view', 'data-view': 'preview', 'aria-pressed': String(this.newPreview) }, ['Preview']),
            ]),
          ]),
          text,
        ]),
        el('div', { class: 't-moves' }, [
          el('span', { class: 't-note' }, ['It gets the next number.']),
          el('span', { class: 't-grow' }),
          el('button', { type: 'button', class: 't-btn t-btn-quiet', 'data-act': 'close' }, ['Cancel']),
          el('button', { type: 'submit', class: 't-btn t-btn-primary' }, ['Start thread ', kbd('⌘↵')]),
        ]),
      ]),
    ]);
  }

  readNew() {
    const draft = this.newDraft;
    if (draft === null) return;
    const title = this.dialog.querySelector('#new-title');
    const space = this.dialog.querySelector('#new-space');
    const status = this.dialog.querySelector('#new-status');
    const body = this.dialog.querySelector('#new-body');
    if (title instanceof HTMLInputElement) draft.title = title.value;
    if (space instanceof HTMLSelectElement) draft.space = space.value;
    if (status instanceof HTMLSelectElement && (status.value === 'received' || status.value === 'act' || status.value === 'discuss')) draft.status = status.value;
    if (body instanceof HTMLTextAreaElement) draft.body = body.value;
  }

  openFind() {
    const input = el('input', {
      id: 'find-words',
      class: 't-find-input',
      placeholder: this.member ? 'A number, or words from your threads' : 'A number, or words from a title, summary or text',
      autocomplete: 'off',
      'aria-label': 'Find',
      'aria-controls': 'find-list',
    });
    this.openOverlay('find', 'Find', 'find', [
      el('div', { class: 't-find-head' }, [icon('search'), input, kbd('Esc')]),
      el('div', { class: 't-find-list', id: 'find-list', role: 'listbox', 'aria-label': 'Results' }),
      el('div', { class: 't-find-foot' }, [
        el('span', {}, [kbd('↑'), ' ', kbd('↓'), ' choose']),
        el('span', {}, [kbd('↵'), ' open']),
        el('span', {}, ['Type ', el('b', {}, ['61']), ' or ', el('b', {}, ['#61']), ' to jump; words search titles, summaries and text']),
      ]),
    ]);
    input.focus();
    this.findFor('');
  }

  /** The actions ⌘K offers beside threads, matched by their words. @param {string} words @returns {FindItem[]} */
  findActions(words) {
    const query = words.toLowerCase();
    /** @type {{ label: string, hay: string, key: string, run: () => void }[]} */
    const actions = this.member
      ? [
          { label: 'Go to your threads', hay: 'threads home mine yours', key: '', run: () => void this.go({ view: 'today' }) },
          { label: 'Show the keys', hay: 'keys keyboard shortcuts help', key: '?', run: () => this.openKeys() },
        ]
      : [
          { label: 'Go to Today', hay: 'today', key: '', run: () => void this.go({ view: 'today' }) },
          { label: 'Go to all threads', hay: 'threads all list', key: '', run: () => void this.go({ view: 'list', tab: this.tab, space: null }) },
          { label: 'New thread', hay: 'new thread start create', key: 'N', run: () => this.openNew({ title: words !== '' && !/^#?\d+$/.test(words) ? words : '' }) },
          { label: 'Show the keys', hay: 'keys keyboard shortcuts help', key: '?', run: () => this.openKeys() },
        ];
    return actions
      .filter((action) => query === '' || action.hay.includes(query) || action.label.toLowerCase().includes(query))
      .map((action) => ({ label: action.label, sub: '', side: action.key, number: null, run: action.run }));
  }

  /** Searches for the words after a short pause; nothing typed shows the five most recently active. @param {string} words */
  findFor(words) {
    const trimmed = words.trim();
    clearTimeout(this.findTimer);
    const ticket = ++this.findTicket;
    if (trimmed === '') {
      const recent = [...this.threads.values()].sort((a, b) => b.activityAt.localeCompare(a.activityAt)).slice(0, 5);
      this.showFound(trimmed, recent, 'Recent');
      return;
    }
    this.findTimer = setTimeout(() => {
      search(trimmed).then(
        (threads) => {
          if (ticket === this.findTicket && this.overlay === 'find') this.showFound(trimmed, threads, 'Threads');
        },
        (error) => {
          if (ticket === this.findTicket) this.fail(error, "The search didn't run.");
        },
      );
    }, SEARCH_WAIT_MS);
  }

  /**
   * @param {string} words
   * @param {Thread[]} threads
   * @param {string} group
   */
  showFound(words, threads, group) {
    const list = this.dialog.querySelector('#find-list');
    if (!(list instanceof HTMLElement)) return;
    const query = words.toLowerCase().replace(/^#/, '');
    const numeric = /^\d+$/.test(query);
    /** @param {Thread} thread */
    const snippet = (thread) => {
      if (query === '' || numeric) return `${spaceLabel(thread.space)} · ${STATUS_NAMES[thread.status]}`;
      const hay = `${thread.summary ?? ''}\n${thread.body}`.replace(/[|*#`>]+/g, ' ').replace(/\s+/g, ' ');
      const at = hay.toLowerCase().indexOf(query);
      return at < 0 ? `${spaceLabel(thread.space)} · ${STATUS_NAMES[thread.status]}` : `…${hay.slice(Math.max(0, at - 30), at + 50).trim()}…`;
    };
    this.found = [
      ...threads.map((thread) => ({ label: titleOf(thread), sub: snippet(thread), side: ago(thread.activityAt), number: thread.number, run: () => this.openThread(thread.number) })),
      ...this.findActions(words.trim()),
    ];
    this.foundSel = 0;
    /** @param {string} text */
    const marked = (text) => {
      if (query === '' || numeric) return [text];
      const at = text.toLowerCase().indexOf(query);
      return at < 0 ? [text] : [text.slice(0, at), el('mark', {}, [text.slice(at, at + query.length)]), text.slice(at + query.length)];
    };
    /** @type {Node[]} */
    const nodes = [];
    let last = '';
    this.found.forEach((item, i) => {
      const heading = item.number === null ? 'Do' : group;
      if (heading !== last) nodes.push(el('div', { class: 't-find-group', role: 'presentation' }, [(last = heading)]));
      nodes.push(
        el('button', { type: 'button', class: 't-find-item', role: 'option', id: `find-${i}`, 'data-act': 'found', 'data-index': String(i), 'aria-selected': String(i === 0) }, [
          el('span', { class: 't-num' }, item.number === null ? [icon(item.label.startsWith('New') ? 'plus' : item.label.startsWith('Show') ? 'keys' : 'move')] : [`#${item.number}`]),
          el('span', { class: 't-find-text' }, [el('span', {}, marked(item.label)), ...(item.sub ? [el('small', {}, marked(item.sub))] : [])]),
          el('span', { class: 't-find-side' }, item.side.length === 1 ? [kbd(item.side)] : [item.side]),
        ]),
      );
    });
    if (threads.length === 0 && words.trim() !== '') {
      const none = this.member ? `None of your threads matches "${words.trim()}".` : `No thread matches "${words.trim()}". Press ↵ to start one with this title.`;
      nodes.unshift(el('div', { class: 't-empty' }, [none]));
    }
    list.replaceChildren(...nodes);
  }

  /** @param {number} by */
  moveFound(by) {
    if (this.found.length === 0) return;
    this.foundSel = (this.foundSel + by + this.found.length) % this.found.length;
    for (const option of this.dialog.querySelectorAll('.t-find-item')) {
      option.setAttribute('aria-selected', String(option.id === `find-${this.foundSel}`));
    }
    this.dialog.querySelector(`#find-${this.foundSel}`)?.scrollIntoView({ block: 'nearest' });
  }

  /** @param {number} index */
  runFound(index) {
    const item = this.found[index];
    this.closeOverlay();
    item?.run();
  }

  /* ---------- The toast: six seconds, Undo or Z, paused while the pointer is on it ---------- */

  /**
   * @param {string} text
   * @param {(() => Promise<void>) | null} undo
   */
  say(text, undo) {
    this.undo = undo;
    this.toastText.textContent = text;
    this.undoButton.hidden = undo === null;
    const bar = this.toastBar.cloneNode(false);
    if (bar instanceof HTMLElement) {
      this.toastBar.replaceWith(bar);
      this.toastBar = bar;
    }
    this.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastLeft = TOAST_MS;
    this.toastStart = Date.now();
    this.toastTimer = setTimeout(() => this.endToast(), this.toastLeft);
  }

  pauseToast() {
    clearTimeout(this.toastTimer);
    this.toastLeft -= Date.now() - this.toastStart;
  }

  resumeToast() {
    if (this.toast.hidden) return;
    this.toastStart = Date.now();
    this.toastTimer = setTimeout(() => this.endToast(), Math.max(this.toastLeft, 800));
  }

  endToast() {
    this.toast.hidden = true;
    this.undo = null;
  }

  async runUndo() {
    const undo = this.undo;
    if (undo === null) return;
    this.endToast();
    await undo();
  }

  /* ---------- Writes: shown at once, saved behind, put back when refused ---------- */

  /**
   * Makes one move: shown at once, saved behind it, put back if the server refuses, undoable from the toast.
   * @param {Thread} thread
   * @param {Action} action
   */
  async makeMove(thread, action) {
    const list = this.walk();
    const at = list.indexOf(thread.number);
    const predicted = { ...predict(thread, action), waiting: false };
    this.threads.set(thread.number, predicted);
    if (this.shown?.thread.number === thread.number) this.shown = { ...this.shown, thread: predicted };
    this.closeOverlay();
    this.reply = null;
    if (this.route.view !== 'thread') {
      const after = this.walk();
      this.sel = after.includes(thread.number) ? thread.number : (after[Math.min(Math.max(at, 0), after.length - 1)] ?? null);
    }
    this.keepScroll = true;
    this.render();
    /** @type {Thread} */
    let saved;
    try {
      saved = await move(thread.number, action);
    } catch (error) {
      this.threads.set(thread.number, thread);
      if (this.shown?.thread.number === thread.number) this.shown = { ...this.shown, thread };
      this.keepScroll = true;
      this.render();
      this.fail(error, `That didn't save, so #${thread.number} is back where it was.`);
      return;
    }
    this.remember(saved, { acted: true });
    this.clearProblem();
    await this.refreshShown(saved.number);
    const back = inverse(thread, action);
    this.say(saidOf(thread, action), back === null ? null : () => this.revert(saved, back));
  }

  /**
   * Sends the move that undoes the last one.
   * @param {Thread} moved
   * @param {Action} back
   */
  async revert(moved, back) {
    try {
      const restored = await move(moved.number, back);
      this.remember(restored, { acted: true });
      if (this.route.view !== 'thread') this.sel = restored.number;
      await this.refreshShown(restored.number);
      this.say('Undone', null);
    } catch (error) {
      this.fail(error, "The undo didn't save.");
    }
  }

  /** Reloads the open thread when it is `number`, so its history shows what just happened. @param {number} number */
  async refreshShown(number) {
    if (this.route.view === 'thread' && this.route.number === number) {
      try {
        await this.loadThread(number);
      } catch (error) {
        this.fail(error, "The thread didn't reload.");
      }
    }
    this.keepScroll = true;
    this.render();
  }

  /** @param {Thread} thread */
  async sendComment(thread) {
    const text = (this.drafts.get(thread.number) ?? '').trim();
    if (text === '') return;
    const onlyMe = !this.member && this.onlyMe;
    try {
      await comment(thread.number, text, onlyMe ? 'owner' : 'thread');
    } catch (error) {
      this.fail(error, "The comment didn't save. It is still in the box.");
      return;
    }
    this.drafts.delete(thread.number);
    this.commentPreview = false;
    this.onlyMe = false;
    this.clearProblem();
    const known = this.threads.get(thread.number);
    if (known) this.threads.set(thread.number, { ...known, activityAt: new Date().toISOString(), waiting: this.member ? (known.waiting ?? false) : false });
    await this.refreshShown(thread.number);
    this.main.scrollTo({ top: this.main.scrollHeight });
    this.say(onlyMe ? `Noted on #${thread.number}, for you alone` : `Commented on #${thread.number}`, null);
  }

  /* ---------- Share: the owner invites people to a thread, and takes invitations back ---------- */

  /** Opens the Share sheet for a thread, then fills it with its people. @param {Thread} thread */
  async openShare(thread) {
    if (this.member) return;
    this.sharing = { number: thread.number, people: [], count: 0, email: '', name: '', problem: '', invited: null, busy: true };
    this.renderShare();
    try {
      const answer = await people(thread.number);
      if (this.sharing?.number !== thread.number) return;
      this.sharing = { ...this.sharing, people: answer.people, count: answer.invitedCount, busy: false };
    } catch (error) {
      this.closeOverlay();
      this.fail(error, "The people on this thread didn't load.");
      return;
    }
    this.renderShare();
    focusIn(this.dialog, '#share-email');
  }

  renderShare() {
    const sharing = this.sharing;
    const thread = sharing === null ? undefined : this.threads.get(sharing.number);
    if (sharing === null || thread === undefined) return;
    const shown = this.shown?.thread.number === sharing.number ? this.shown : null;
    const comments = shown?.comments ?? [];
    const lines = seesLines(comments.filter((said) => said.audience !== 'owner').length, comments.filter((said) => said.audience === 'owner').length);
    const form = el('form', { class: 't-invite', 'data-submit': 'invite', novalidate: '' }, [
      el('label', { class: 't-fld' }, [
        el('span', { class: 't-lbl' }, ['Email']),
        el('input', { class: 't-field', id: 'share-email', type: 'email', autocomplete: 'off', placeholder: 'meera@example.com', value: sharing.email }),
      ]),
      el('label', { class: 't-fld' }, [
        el('span', { class: 't-lbl' }, ['Name']),
        el('input', { class: 't-field', id: 'share-name', autocomplete: 'off', placeholder: 'Meera', value: sharing.name }),
      ]),
      el('button', { type: 'submit', class: 't-btn t-btn-primary', ...(sharing.busy ? { disabled: '' } : {}) }, ['Invite ', kbd('↵')]),
    ]);
    const rows = [
      el('div', { class: 't-prow' }, [avatar('owner', ''), el('span', { class: 't-prow-name' }, [el('b', {}, ['You']), el('small', {}, ['owner'])]), el('span', { class: 't-prow-role' }, ['Everything'])]),
      ...sharing.people.map((person) =>
        el('div', { class: 't-prow' }, [
          avatar('member', person.name ?? ''),
          el('span', { class: 't-prow-name' }, [el('b', {}, [person.name ?? 'Someone']), el('small', {}, [person.email ?? ''])]),
          el('button', { type: 'button', class: 't-text-btn', 'data-act': 'share-remove', 'data-person': person.id ?? '', ...(sharing.busy ? { disabled: '' } : {}) }, ['Remove']),
        ]),
      ),
    ];
    const invited = sharing.invited;
    const draft = invited === null ? null : invitation({ number: thread.number, title: titleOf(thread), path: threadPath(thread) }, invited, location.origin);
    this.openOverlay('share', `Share #${thread.number}`, 'form', [
      this.sheetHead(`Share #${thread.number} ${titleOf(thread)}`),
      el('div', { class: 't-sheet-body' }, [
        form,
        ...(sharing.problem ? [el('p', { class: 't-err', role: 'alert' }, [sharing.problem])] : []),
        el('div', { class: 't-plist' }, rows),
        el('div', { class: 't-sees' }, [el('span', {}, [el('b', {}, ['They see']), ' ', lines.sees]), el('span', {}, [el('b', {}, ['Never']), ' ', lines.never])]),
        el('div', { class: 't-seats' }, [el('meter', { class: 't-seat-bar', min: '0', max: '50', value: String(sharing.count), 'aria-label': 'People with access' }), el('span', {}, [seatsLine(sharing.count)])]),
        ...(draft === null || invited === null
          ? []
          : [
              el('div', { class: 't-reply' }, [
                el('div', { class: 't-reply-head' }, [el('h2', {}, [`Send ${invited.name} the link`]), el('span', {}, [`to ${invited.email}`])]),
                el('div', { class: 't-reply-body' }, [el('span', { class: 't-note' }, ['Nothing is sent from the site. Gmail opens a draft as you; read it, change it if you like, and press Send there.'])]),
                el('div', { class: 't-reply-actions' }, [el('a', { class: 't-btn t-btn-primary', href: gmailLink(draft, this.me), target: '_blank', rel: 'noopener' }, [icon('mail'), 'Open the draft in Gmail'])]),
              ]),
            ]),
      ]),
    ]);
  }

  /** Reads the sheet's two fields into its state. */
  readShare() {
    if (this.sharing === null) return;
    const email = this.dialog.querySelector('#share-email');
    const name = this.dialog.querySelector('#share-name');
    if (email instanceof HTMLInputElement) this.sharing.email = email.value;
    if (name instanceof HTMLInputElement) this.sharing.name = name.value;
  }

  async sendInvite() {
    this.readShare();
    const sharing = this.sharing;
    if (sharing === null || sharing.busy) return;
    const problem = invitationProblem(sharing.email, sharing.name, this.me, sharing.people);
    if (problem !== null) {
      this.sharing = { ...sharing, problem };
      this.renderShare();
      focusIn(this.dialog, problem.startsWith('Add') || problem.startsWith('Keep') ? '#share-name' : '#share-email');
      return;
    }
    const person = { name: sharing.name.trim(), email: addressOf(sharing.email) };
    this.sharing = { ...sharing, busy: true, problem: '' };
    this.renderShare();
    /** @type {import('./threads-store.js').People} */
    let answer;
    try {
      answer = await invite(sharing.number, person.email, person.name);
    } catch (error) {
      const said = error instanceof Failed && error.message === 'owner' ? "That's your own address. You're in every thread." : null;
      this.sharing = { ...sharing, busy: false, problem: said ?? "The invitation didn't save. Check the address and try again." };
      this.renderShare();
      if (said === null) this.fail(error, "The invitation didn't save.");
      return;
    }
    this.sharing = { ...sharing, people: answer.people, count: answer.invitedCount, email: '', name: '', problem: '', invited: person, busy: false };
    const known = this.threads.get(sharing.number);
    if (known) this.remember(known, { shared: answer.people.length });
    await this.refreshShown(sharing.number);
    this.renderShare();
    this.say(`${person.name} can open #${sharing.number}. Open the draft to send them the link.`, null);
  }

  /** @param {string} id */
  async removePerson(id) {
    const sharing = this.sharing;
    const person = sharing?.people.find((one) => one.id === id);
    if (sharing === null || sharing.busy || person === undefined) return;
    this.sharing = { ...sharing, busy: true };
    this.renderShare();
    /** @type {import('./threads-store.js').People} */
    let answer;
    try {
      answer = await uninvite(sharing.number, id);
    } catch (error) {
      this.sharing = { ...sharing, busy: false };
      this.renderShare();
      this.fail(error, `${person.name ?? 'They'} wasn't removed.`);
      return;
    }
    const invited = sharing.invited?.email === person.email ? null : sharing.invited;
    this.sharing = { ...sharing, people: answer.people, count: answer.invitedCount, invited, busy: false };
    const known = this.threads.get(sharing.number);
    if (known) this.remember(known, { shared: answer.people.length });
    await this.refreshShown(sharing.number);
    this.renderShare();
    this.say(`${person.name ?? 'They'} removed. Their next click is refused.`, null);
  }

  readEditor() {
    if (this.editing === null) return;
    const title = this.main.querySelector('#edit-title');
    const summary = this.main.querySelector('#edit-summary');
    const body = this.main.querySelector('#edit-body');
    if (title instanceof HTMLInputElement) this.editing.title = title.value;
    if (summary instanceof HTMLTextAreaElement) this.editing.summary = summary.value;
    if (body instanceof HTMLTextAreaElement) this.editing.body = body.value;
  }

  /** @param {Thread} thread */
  async saveEdit(thread) {
    this.readEditor();
    const editing = this.editing;
    if (editing === null) return;
    const title = editing.title.trim();
    if (title === '') {
      this.say("A title can't be empty", null);
      return;
    }
    /** @type {[Field, string, string][]} */
    const wanted = [
      ['title', title, thread.title ?? ''],
      ['summary', editing.summary.trim(), thread.summary ?? ''],
      ...(thread.source === 'talk' || editing.body.trim() === '' ? [] : /** @type {[Field, string, string][]} */ ([['body', editing.body.trim(), thread.body]])),
    ];
    const changes = wanted.filter(([, after, before]) => after !== before);
    /** @type {string[]} */
    const saved = [];
    for (const [field, text] of changes) {
      try {
        this.remember(await edit(thread.number, field, text), { acted: true });
        saved.push(field === 'body' ? 'text' : field);
      } catch (error) {
        this.fail(error, saved.length > 0 ? `Saved the ${saved.join(' and ')}, but not the rest. It is still in the editor.` : "That didn't save. It is still in the editor.");
        await this.refreshShown(thread.number);
        return;
      }
    }
    this.editing = null;
    this.editPreview = false;
    this.clearProblem();
    await this.refreshShown(thread.number);
    this.say(saved.length > 0 ? `Saved the ${saved.join(', ')}. The earlier ${saved.length > 1 ? 'versions are' : 'one is'} in the history` : 'Nothing changed', null);
  }

  async saveNew() {
    this.readNew();
    const draft = this.newDraft;
    if (draft === null) return;
    if (draft.title.trim() === '') {
      this.say('Give it a title first', null);
      find(this.dialog, '#new-title', HTMLInputElement).focus();
      return;
    }
    /** @type {Thread} */
    let thread;
    try {
      thread = await start({ title: draft.title.trim(), body: draft.body.trim(), space: draft.space, status: draft.status });
    } catch (error) {
      this.fail(error, "The thread didn't start. It is still in the form.");
      return;
    }
    this.newDraft = null;
    this.closeOverlay();
    this.clearProblem();
    this.threads.set(thread.number, thread);
    this.tab = tabOf(thread.status);
    this.from = 'list';
    this.openThread(thread.number);
    this.say(`Started #${thread.number}`, null);
  }

  /** @param {Thread} thread */
  startEdit(thread) {
    this.editing = { title: thread.title ?? titleOf(thread), summary: thread.summary ?? '', body: thread.body };
    this.editPreview = false;
    this.reply = null;
    this.render();
    find(this.main, '#edit-title', HTMLInputElement).focus();
  }

  /** @param {Thread} thread */
  startReply(thread) {
    this.reply = draftReply(thread);
    this.keepScroll = true;
    this.render();
    find(this.main, '#reply-body', HTMLTextAreaElement).focus();
  }

  /* ---------- Input ---------- */

  /** @param {MouseEvent} event */
  onClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target === this.dialog) {
      this.closeOverlay();
      return;
    }
    const link = target.closest('a[data-thread], a[data-go], a[data-space], a[data-tab]');
    if (link instanceof HTMLAnchorElement && !wantsNewTab(event)) {
      event.preventDefault();
      if (link.dataset.thread !== undefined) {
        if (link.classList.contains('t-row')) this.from = this.route.view === 'today' ? 'today' : this.route.view === 'list' ? 'list' : this.from;
        this.openThread(Number(link.dataset.thread));
      } else if (link.dataset.go === 'today') void this.go({ view: 'today' });
      else if (link.dataset.go === 'list') void this.go({ view: 'list', tab: this.tab, space: null });
      else if (link.dataset.tab !== undefined && isTab(link.dataset.tab)) {
        this.sel = null;
        void this.go({ view: 'list', tab: link.dataset.tab, space: this.space });
      } else if (link.dataset.space !== undefined) {
        this.sel = null;
        void this.go({ view: 'list', tab: this.route.view === 'thread' && this.shown ? tabOf(this.shown.thread.status) : this.tab, space: link.dataset.space === '' ? null : link.dataset.space });
      }
      return;
    }
    const button = target.closest('[data-act], [data-go]');
    if (!(button instanceof HTMLElement)) return;
    if (button.dataset.go === 'today' || button.dataset.go === 'list') {
      event.preventDefault();
      void this.go(button.dataset.go === 'today' ? { view: 'today' } : { view: 'list', tab: this.tab, space: this.space });
      return;
    }
    const thread = this.target();
    switch (button.dataset.act) {
      case 'find':
        this.openFind();
        break;
      case 'new':
        this.openNew();
        break;
      case 'keys':
        this.openKeys();
        break;
      case 'close':
        this.closeOverlay();
        break;
      case 'share':
        if (thread) void this.openShare(thread);
        break;
      case 'share-remove':
        void this.removePerson(button.dataset.person ?? '');
        break;
      case 'audience':
        this.onlyMe = button.dataset.audience === 'owner';
        this.keepScroll = true;
        this.render();
        focusIn(this.main, '#comment-text');
        break;
      case 'undo':
        void this.runUndo();
        break;
      case 'act':
      case 'discuss':
      case 'done':
      case 'reopen':
        if (thread) void this.makeMove(thread, { action: button.dataset.act });
        break;
      case 'drop':
        if (thread) this.openDrop(thread);
        break;
      case 'drop-why': {
        const pick = REASONS[Number(button.dataset.reason)];
        if (thread && pick) void this.makeMove(thread, { action: 'drop', reason: pick.reason });
        break;
      }
      case 'space-to':
        if (thread && button.dataset.space && button.dataset.space !== thread.space) void this.makeMove(thread, { action: 'space', space: button.dataset.space });
        else this.closeOverlay();
        break;
      case 'prev':
      case 'next':
        this.step(button.dataset.act === 'next' ? 1 : -1);
        break;
      case 'back':
        this.back();
        break;
      case 'edit':
        if (thread) this.startEdit(thread);
        break;
      case 'edit-cancel':
        this.editing = null;
        this.render();
        break;
      case 'edit-view':
        this.readEditor();
        this.editPreview = button.dataset.view === 'preview';
        this.render();
        break;
      case 'reply':
        if (thread) this.startReply(thread);
        break;
      case 'reply-close':
        this.reply = null;
        this.keepScroll = true;
        this.render();
        break;
      case 'reply-copy': {
        const draft = this.reply;
        if (draft) {
          navigator.clipboard.writeText(`To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`).then(
            () => this.say('Copied the reply', null),
            () => this.say("Couldn't copy. Select the text instead.", null),
          );
        }
        break;
      }
      case 'reply-opened':
        // The link opens Gmail itself; the move only marks that he opened it.
        if (thread) void this.makeMove(thread, { action: 'reply-opened' });
        break;
      case 'copy-link':
        if (thread) {
          navigator.clipboard.writeText(`${location.origin}/threads/${thread.number}`).then(
            () => this.say(`Copied whysosuresh.com/threads/${thread.number}`, null),
            () => this.say("Couldn't copy the link.", null),
          );
        }
        break;
      case 'before': {
        const id = Number(button.dataset.event);
        if (this.opened.has(id)) this.opened.delete(id);
        else this.opened.add(id);
        this.keepScroll = true;
        this.render();
        break;
      }
      case 'comment-view':
        this.commentPreview = button.dataset.view === 'preview';
        this.keepScroll = true;
        this.render();
        break;
      case 'new-view':
        this.readNew();
        this.newPreview = button.dataset.view === 'preview';
        this.renderNew();
        break;
      case 'found':
        this.runFound(Number(button.dataset.index));
        break;
      case 'page-full':
        this.pageFull = !this.pageFull;
        this.keepScroll = true;
        this.render();
        break;
      case 'page-versions':
        if (thread && this.shown?.page) this.openVersions(thread, this.shown.page);
        break;
      case 'page-version':
        if (thread) {
          this.pageVersions.set(thread.number, Number(button.dataset.version));
          this.closeOverlay();
          this.keepScroll = true;
          this.render();
        }
        break;
    }
  }

  /** @param {Event} event */
  onInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === 'find-words' && target instanceof HTMLInputElement) this.findFor(target.value);
    else if (target.id === 'comment-text' && target instanceof HTMLTextAreaElement && this.shown) this.drafts.set(this.shown.thread.number, target.value);
    else if (target.id.startsWith('edit-') && this.editing && this.shown) {
      this.readEditor();
      this.main.querySelector('#edit-preview')?.replaceChildren(...this.editorPreview(this.shown.thread, this.editing));
    } else if (target.id.startsWith('new-')) this.readNew();
    else if (target.id.startsWith('share-')) this.readShare();
  }

  /** @param {Event} event */
  onChange(event) {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.dataset.change === 'space') {
      const thread = this.target();
      if (thread && target.value !== '' && target.value !== thread.space) void this.makeMove(thread, { action: 'space', space: target.value });
    }
  }

  /** @param {SubmitEvent} event */
  onSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    this.submit(form.dataset.submit ?? '');
  }

  /** @param {string} kind */
  submit(kind) {
    const thread = this.shown?.thread;
    if (kind === 'comment' && thread) void this.sendComment(thread);
    if (kind === 'edit' && thread) void this.saveEdit(thread);
    if (kind === 'new') void this.saveNew();
    if (kind === 'invite') void this.sendInvite();
  }

  /** @param {KeyboardEvent} event */
  onKey(event) {
    if (!this.loaded || !this.lost.hidden) return;
    const target = event.target;
    const typing = typingIn(target);
    const command = commandFor(event);

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      const form = target instanceof Element ? target.closest('form[data-submit]') : null;
      if (form instanceof HTMLFormElement) {
        event.preventDefault();
        this.submit(form.dataset.submit ?? '');
      }
      return;
    }
    if (command === 'find') {
      event.preventDefault();
      this.openFind();
      return;
    }
    if (this.overlay !== null) {
      this.onOverlayKey(event, typing);
      return;
    }
    if (event.key === 'Escape') {
      if (this.pageFull) {
        event.preventDefault();
        this.pageFull = false;
        this.keepScroll = true;
        this.render();
      } else if (this.editing) {
        event.preventDefault();
        this.editing = null;
        this.render();
      } else if (this.reply) {
        event.preventDefault();
        this.reply = null;
        this.keepScroll = true;
        this.render();
      } else if (typing && target instanceof HTMLElement) target.blur();
      else if (this.route.view === 'thread') {
        event.preventDefault();
        this.back();
      }
      return;
    }
    if (typing || command === null) return;
    if (command === 'open' && target instanceof Element && target.closest('button, a, summary')) return;
    event.preventDefault();
    this.run(command);
  }

  /**
   * Keys while a dialog is open: its own picks by number, and in ⌘K the arrows and Enter.
   * @param {KeyboardEvent} event
   * @param {boolean} typing
   */
  onOverlayKey(event, typing) {
    if (this.overlay === 'find' && event.target instanceof HTMLInputElement && event.target.id === 'find-words') {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.moveFound(event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const words = event.target.value.trim();
        if (this.found.length > 0) this.runFound(this.foundSel);
        else if (words !== '') this.openNew({ title: words });
      }
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    const thread = this.target();
    if (this.overlay === 'drop' && /^[1-4]$/.test(event.key)) {
      const pick = REASONS[Number(event.key) - 1];
      event.preventDefault();
      if (thread && pick) void this.makeMove(thread, { action: 'drop', reason: pick.reason });
    } else if (this.overlay === 'space' && /^[1-5]$/.test(event.key)) {
      const space = SPACES[Number(event.key) - 1];
      event.preventDefault();
      if (thread && space && space.slug !== thread.space) void this.makeMove(thread, { action: 'space', space: space.slug });
      else this.closeOverlay();
    }
  }

  /** @param {Command} command */
  run(command) {
    if (this.member && !MEMBER_COMMANDS.has(command)) return;
    const thread = this.target();
    const status = thread?.status;
    switch (command) {
      case 'next':
        this.step(1);
        break;
      case 'prev':
        this.step(-1);
        break;
      case 'open':
        if (this.route.view !== 'thread' && this.sel !== null) this.openThread(this.sel);
        break;
      case 'back':
        if (this.route.view === 'thread') this.back();
        break;
      case 'tab-look':
      case 'tab-act':
      case 'tab-discuss':
      case 'tab-done': {
        const tab = command.slice(4);
        if (isTab(tab)) {
          this.sel = null;
          void this.go({ view: 'list', tab, space: this.space });
        }
        break;
      }
      case 'find':
        this.openFind();
        break;
      case 'act':
      case 'discuss':
        if (thread && status === 'received') void this.makeMove(thread, { action: command });
        break;
      case 'drop':
        if (thread && isOpen(thread)) this.openDrop(thread);
        break;
      case 'done':
        if (thread && (status === 'act' || status === 'discuss' || status === 'filed')) void this.makeMove(thread, { action: 'done' });
        break;
      case 'reopen':
        if (thread && (status === 'done' || status === 'dropped')) void this.makeMove(thread, { action: 'reopen' });
        break;
      case 'space':
        if (thread) this.openSpace(thread);
        break;
      case 'undo':
        void this.runUndo();
        break;
      case 'comment': {
        if (this.route.view !== 'thread') break;
        this.commentPreview = false;
        this.keepScroll = true;
        this.render();
        const box = this.main.querySelector('#comment-text');
        if (box instanceof HTMLTextAreaElement) {
          box.focus();
          box.scrollIntoView({ block: 'center' });
        }
        break;
      }
      case 'edit':
        if (this.route.view === 'thread' && thread) this.startEdit(thread);
        break;
      case 'reply':
        if (this.route.view === 'thread' && thread && canReply(thread)) this.startReply(thread);
        break;
      case 'new':
        this.openNew();
        break;
      case 'share':
        if (this.route.view === 'thread' && thread) void this.openShare(thread);
        break;
      case 'keys':
        this.openKeys();
        break;
    }
  }
}

/** Whether this device has signed in to the threads before; storage may be off, which reads as no. */
function signedInBefore() {
  try {
    return localStorage.getItem(SIGNED_IN_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSignedIn() {
  try {
    localStorage.setItem(SIGNED_IN_KEY, '1');
  } catch {
    // Storage may be off; the page then shows no "Sign in" when signed out, as for a stranger.
  }
}

void new Threads().start();
