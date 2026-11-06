// @ts-check
// whysosuresh.com/me and /threads: Suresh's threads, one page for all of them (site/threads/index.html, which the
// Worker hands over at every room's address and every thread's). /me is the door everyone signed in enters by, and
// the side rail is drawn for rooms, side by side at the top level: its head is the site, then Today (/me), Threads
// (/threads/) with the five spaces under it, People (/people) and Meetings (/meetings). On a phone the bar holds
// Today, Threads, Find, New and More, with People and Meetings under More. The views, each at its own address: Today
// (/me: the next meeting as a card, then threads waiting on him, new ones, and open threads
// that sat a week untouched), the Threads room (/threads/, or
// /threads/?tab=act&space=company: four tabs by where a thread stands, and the five spaces), and a thread
// (/threads/42-who-owns-what): its living
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
// One of his own threads can be public (Share's switch). Anyone who isn't in it (signed out, signed in to other
// threads, or removed from every one) then reads it at its address in the public view: the thread as the public call
// answers it (`showPublic`, outside Access), the comments written as Public, and "Send Suresh a note on this", a form
// with the site's bot check (../talk-send.js) whose note shows at once. When its page asks questions, a visitor
// answers them too, with no sign-in: they type their name once (in a line above the page, or in the page's bar in full
// screen), and their browser keeps a random key with it (`localStorage`, or for the visit when storage is off), which
// the public call reads to say which answers are theirs; under each question the page shows their answer, and other
// people's once they gave their own. A thread's address with `?full` opens its page in full screen at once, which is
// the link Share offers for answering. On his side a visitor's note is a comment with Drop and Reply by email, a
// visitor's answer sits under its question and has a line in the history with Drop, and Drop's Undo shows it again;
// a visitor's word makes the thread wait on him, and a globe marks a public thread in every list. A comment on a
// public thread is written for anyone by default (Public), or for the people here, or for him alone. A visitor's words
// are drawn as typed, never as Markdown, wherever they show.
//
// A page that asks questions takes their answers in place, and any page takes comments on its words. The page's frame
// carries the bridge (frame/bridge.js), which speaks to this page by message alone (page-talk.js holds this side's
// checks): it draws an answer box under each of the page's questions, offers Comment beside selected words, and
// underlines the words each discussion is on (on a public thread, the answer boxes alone). Every write is this page's,
// as whoever is signed in or the visitor who named themselves: an answer the page asks for is taken only while the
// frame holds the focus (the reader clicked or typed in it), at most ten a minute,
// for a question the page named; words and replies are typed here, never in the frame. A discussion on the page's
// words sits beside them on a wide screen, in a column under the details; below 1000 px and in full screen its words
// open it in a sheet, and the page's discussions are listed under it. Every comment can have replies, except a
// visitor's note, a comment for anyone, an answer or a reply; the history keeps one line for each answer and
// discussion, with Show, and a discussion whose words this version no longer has stays in the history whole.
//
// Everyone he deals with is a person (people.js holds their words and addresses): People lists everyone at /people,
// whoever was last in touch first, those only ever in threads he dropped folded away; a person's page
// (/people/7-meera) shows the meetings they are in, every thread they are in and how, what they said, newest first,
// his own notes on them (only he reads them; Markdown, saved on ⌘↵ or on leaving the box), their name to change (W)
// and, while they have none, their address to add once. Every name on a thread opens that person for him (who a
// thread is from, a comment's author, a thread's people), and ⌘K finds people too. Invited people get none of this:
// at a people address they get their own home, as the Worker refuses them every people call.
//
// Any thread can be one meeting (meetings.js holds their words): a day, its time not set, or a moment shown in the
// reader's own zone, with a length, a where and the people in the room besides him. A meeting's thread opens with
// it as a strip above the summary, and his B (or the strip's button) opens its editor: the day and a time typed in
// his own zone, the length and the where, and the people, picked from everyone he deals with or added by name as
// someone new; clearing it takes its people off, with Undo. A row carries a meeting's date as a chip, solid while it
// is near. The Meetings room lists them, coming soonest first, then past. Being in one grants nothing: an invited
// person reads the meeting of a thread they are in, read only, with their own place marked, and gets Your meetings,
// the ones they are in, and their next one as a card at /me.
//
// Signed out at a thread's address, the page shows what a missing address shows ("Nothing here"), so the address
// alone never says a thread exists; a device that has signed in before also gets a small "Sign in". The link in an
// invitation carries `?invite`: signed out, it goes straight to the sign-in and back; signed in, the page drops it
// from the address, so a copied link is the clean one. `?invite` on any number does the same, so it says nothing
// about a thread. At /me, /meetings and a people address (which says nothing about whether a person exists) it says
// "Suresh's private space" with a Sign in button, and at /threads/ itself "Threads" with one. An invited person's home is
// /me too: the rail lists their threads under "Shared with you, by Suresh". Either sign-in goes through the
// threads' sign-in call and comes back to the same address. When the sign-in ends mid-use, a line says so and nothing typed
// is lost. Every element is built with DOM calls and every text is set as text, so nothing anyone wrote becomes
// markup; Markdown is parsed into blocks first (markdown.js). The CSP allows no inline script or style attribute.

import { SPACES } from '../spaces.js';
import { MEMBER_COMMANDS, MEMBER_SHEET, SHEET, commandFor } from './keys.js';
import { parse, summaryLines } from './markdown.js';
import { cardLines, chipWords, isDay, leadWords, lengthWords, momentWords, partsOf, peopleChanges, split, stateOf, whenLine, whenOf, withLine } from './meetings.js';
import { DRAFT, KEY, discussionFor, placesOf, readPageMessage, stack } from './page-talk.js';
import { PEOPLE_PATH, PERSON_PATH, addressLine, folded, howLine, initials, nameOf, personPath, roleLine, takenLine } from './people.js';
import { addressOf, invitation, invitationProblem, isAddress, levelOf, listed, noteReply, publicLines, seatsLine, seesLines } from './share.js';
import { prepare as prepareBotCheck, sendTo } from '../talk-send.js';
import {
  Failed,
  Missing,
  NotShared,
  SignedOut,
  attendee,
  comment,
  edit,
  editPerson,
  invite,
  judge,
  listAll,
  listMine,
  listPeople,
  me,
  meet,
  move,
  pageAddress,
  people,
  publicPageAddress,
  search,
  show,
  showPerson,
  showPublic,
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
 * @typedef {import('./threads-store.js').Audience} Audience
 * @typedef {import('./threads-store.js').PublicShown} PublicShown
 * @typedef {import('./threads-store.js').Judgement} Judgement
 * @typedef {import('./threads-store.js').Someone} Someone
 * @typedef {import('./threads-store.js').PersonShown} PersonShown
 * @typedef {import('./threads-store.js').PersonChange} PersonChange
 * @typedef {import('./meetings.js').Meeting} Meeting
 * @typedef {{ number: number, day: string, time: string, minutes: string, where: string, chosen: number[], named: string[], query: string, problem: string, busy: boolean }} MeetingDraft
 * @typedef {import('./page-talk.js').Places<ThreadComment>} Places
 * @typedef {{ quote: string, prefix: string, suffix: string, top: number }} WordsDraft
 * @typedef {{ ready: boolean, questions: Set<string>, anchors: Map<string, number | null>, questionTops: Map<string, number>, answered: number[], sent: string }} Talk
 * @typedef {import('./markdown.js').Inline} Inline
 * @typedef {import('./keys.js').Command} Command
 * @typedef {{ view: 'today' } | { view: 'list', tab: Tab, space: string | null } | { view: 'thread', number: number } | { view: 'people' }
 *   | { view: 'person', number: number } | { view: 'meetings' }} Route
 * @typedef {{ to: string, subject: string, body: string }} Draft
 * @typedef {{ title: string, summary: string, body: string }} Editing
 * @typedef {{ title: string, space: string, status: 'received' | 'act' | 'discuss', body: string }} NewDraft
 * @typedef {null | 'find' | 'new' | 'keys' | 'drop' | 'space' | 'versions' | 'share' | 'discussion' | 'meeting' | 'more'} Overlay
 * @typedef {{ number: number, people: Person[], count: number, email: string, name: string, problem: string,
 *   invited: { name: string, email: string } | null, busy: boolean }} Sharing
 * @typedef {{ label: string, sub: string, side: string, number: number | null, person: number | null, run: () => void }} FindItem
 * @typedef {{ text: string } | { email: string, holder: { number: number, name: string | null, email: string | null } }} AddressProblem
 * @typedef {{ name: string, email: string, body: string, sent: boolean, busy: boolean, problem: string }} NoteForm
 * @typedef {{ name: string, key: string, kept: boolean, naming: boolean, missing: boolean }} Visitor
 *   Who answers a public page from this browser: the name they gave, their key, whether the browser keeps both,
 *   whether the name is being typed, and whether a save just asked for it.
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
/** Where this browser keeps a visitor's name and key, as JSON. */
const VISITOR_KEY = 'threads:visitor';
/** A visitor's key: 32 random bytes as hex, the Worker's own shape (src/note.ts). */
const VISITOR_KEY_SHAPE = /^[0-9a-f]{64}$/;
/** The longest name a visitor may give, as the Worker takes it. */
const MAX_VISITOR_NAME = 80;
/** The sandbox a page's frame runs in, the same tokens its answer's CSP names (src/page.ts). */
const PAGE_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';
/** The heights a page may ask its frame for; anything else is ignored. */
const PAGE_HEIGHT = { min: 160, max: 20000 };
/** The most answers one page's frame may ask to save in a minute. */
const ANSWERS_A_MINUTE = 10;
/** How far a card beside the page sits above its words, so its quote lines up with them. */
const CARD_LIFT = 10;
/** The gap between two cards beside the page. */
const CARD_GAP = 8;

/** What a new page's frame has said: nothing yet. @returns {Talk} */
function freshTalk() {
  return { ready: false, questions: new Set(), anchors: new Map(), questionTops: new Map(), answered: [], sent: '' };
}

/** Whether a comment can have replies: shown, not a reply, an answer or words' discussion's reply, not a visitor's or for anyone. @param {ThreadComment} said */
function repliable(said) {
  return !said.parent && !said.question && said.author !== 'visitor' && said.audience !== 'public' && said.state === 'shown';
}
/** The longest note a visitor may send, as the Worker counts it (trimmed, in UTF-16 code units). */
const MAX_NOTE = 4000;
/** A thread's own address, with its title after the number or not. */
const THREAD_PATH = /^\/threads\/([1-9]\d{0,8})(?:-[^/]*)?$/;
/** The door everyone signed in enters by: Today for him, their threads for a person he invited. */
const ME = '/me';
/** The Threads room, its first tab and every space. */
const THREADS = '/threads/';
/** The Meetings room: his meetings, or an invited person's own. */
const MEETINGS = '/meetings';
/** The People room. */
const PEOPLE = '/people';
/** The reader's own locale and zone, which every meeting is said in. */
const LOCALE = undefined;
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** The lengths the meeting editor offers, in minutes; empty is not said. */
const LENGTHS = [15, 30, 45, 60, 90, 120];
/** How many people the meeting editor's picker shows for what is typed. */
const PICKS = 6;

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
    case 'publish':
      return { ...touched, publicAt: now, movedAt: now };
    case 'unpublish':
      return { ...touched, publicAt: null, movedAt: now };
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
    case 'publish':
      return { action: 'unpublish' };
    case 'unpublish':
      return { action: 'publish' };
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
    case 'publish':
      return `#${thread.number} is public. Anyone can read it.`;
    case 'unpublish':
      return `#${thread.number} is no longer public.`;
    default:
      return `Moved #${thread.number} to ${STATUS_NAMES[predict(thread, action).status]}`;
  }
}

/** @param {string} address */
function isThreadAddress(address) {
  return THREAD_PATH.test(address);
}

/** Everyone's address or a person's, which a signed-out page treats as a room. @param {string} address */
function isPeopleAddress(address) {
  return PEOPLE_PATH.test(address) || PERSON_PATH.test(address);
}

/** A day's name inside a sentence: "today", "tomorrow" and "yesterday" lower case, a date as it is. @param {string} words */
function inSentence(words) {
  return /^(Today|Tomorrow|Yesterday)\b/.test(words) ? `${words.charAt(0).toLowerCase()}${words.slice(1)}` : words;
}

/** A meeting as an event's `from` or `to` carries it, or null when it is none. @param {unknown} value @returns {{ when: string, minutes: number | null, where: string | null } | null} */
function meetingData(value) {
  if (typeof value !== 'object' || value === null || !('when' in value) || typeof value.when !== 'string') return null;
  const minutes = 'minutes' in value && typeof value.minutes === 'number' ? value.minutes : null;
  const where = 'where' in value && typeof value.where === 'string' ? value.where : null;
  return { when: value.when, minutes, where };
}

/** Whether a view is his alone: the Threads room and the people. @param {Route} route */
function isHis(route) {
  return route.view === 'list' || route.view === 'people' || route.view === 'person';
}

/** @param {Location} at @returns {Route} */
function routeOf(at) {
  const thread = THREAD_PATH.exec(at.pathname);
  if (thread) return { view: 'thread', number: Number(thread[1]) };
  if (PEOPLE_PATH.test(at.pathname)) return { view: 'people' };
  const person = PERSON_PATH.exec(at.pathname);
  if (person) return { view: 'person', number: Number(person[1]) };
  if (at.pathname === ME) return { view: 'today' };
  if (at.pathname === MEETINGS) return { view: 'meetings' };
  const query = new URLSearchParams(at.search);
  const tab = query.get('tab') ?? '';
  const space = query.get('space') ?? '';
  return { view: 'list', tab: isTab(tab) ? tab : 'look', space: isSpace(space) ? space : null };
}

/** @param {Route} route @param {Map<number, Thread>} threads @param {readonly Someone[]} [people] */
function pathOf(route, threads, people = []) {
  if (route.view === 'today') return ME;
  if (route.view === 'meetings') return MEETINGS;
  if (route.view === 'people') return PEOPLE;
  if (route.view === 'person') {
    const someone = people.find((one) => one.number === route.number);
    return someone ? personPath(someone) : `${PEOPLE}/${route.number}`;
  }
  if (route.view === 'list') {
    if (route.tab === 'look' && route.space === null) return THREADS;
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

/** A row's small marks: a globe for a public thread, and a mark for one that shows a page or a link. @param {Thread} thread @returns {Node[]} */
function rowMark(thread) {
  /** @type {Node[]} */
  const marks = thread.publicAt ? [el('span', { class: 't-row-mark', title: 'Public' }, [icon('globe')])] : [];
  if (thread.main !== 'text') marks.push(el('span', { class: 't-row-mark', title: thread.main === 'page' ? 'A page' : 'A link' }, [icon(thread.main === 'page' ? 'doc' : 'link')]));
  return marks;
}

/** The chip a public thread or a comment for anyone carries. */
function publicChip() {
  return el('span', { class: 't-chip t-chip-public' }, [icon('globe'), 'Public']);
}

/** A day as a public byline says it: "2 Nov". @param {string} iso */
function day(iso) {
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
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
 * the frame is replaced: the frame's own bar, and the side column with its details and discussions. False when there
 * is no such frame to keep.
 * @param {HTMLElement} pane
 * @param {HTMLElement} view
 */
function keepFrame(pane, view) {
  const fresh = view.querySelector('.t-page');
  const key = fresh instanceof HTMLElement ? fresh.dataset.pageKey : undefined;
  const kept = key === undefined ? null : pane.querySelector(`.t-page[data-page-key="${key}"]`);
  const doc = kept?.parentElement;
  const freshDoc = fresh?.parentElement;
  const side = pane.querySelector('.t-rail');
  const freshSide = view.querySelector('.t-rail');
  const frame = pane.querySelector('.t-thread');
  if (!(kept instanceof HTMLElement) || !(fresh instanceof HTMLElement) || !doc || !freshDoc || !side || !freshSide || !frame) return false;
  const children = [...freshDoc.children];
  const at = children.indexOf(fresh);
  for (const child of [...doc.children]) if (child !== kept) child.remove();
  kept.before(...children.slice(0, at));
  kept.after(...children.slice(at + 1));
  const bar = fresh.querySelector('.t-page-bar');
  if (bar) kept.querySelector('.t-page-bar')?.replaceWith(bar);
  kept.dataset.full = fresh.dataset.full ?? 'false';
  side.replaceWith(freshSide);
  frame.toggleAttribute('data-rail', view.hasAttribute('data-rail'));
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
    this.pub = find(document, '[data-public]', HTMLElement);
    this.pubDoc = find(document, '[data-public-doc]', HTMLElement);
    this.pubSignIn = find(document, '[data-public-sign-in]', HTMLAnchorElement);
    iconTemplate = find(document, 'template[data-icons]', HTMLTemplateElement);

    /** @type {Route} */
    this.route = routeOf(location);
    /** Where a thread was opened from, so Esc and the pager go back there. @type {'today' | 'list' | 'person' | 'meetings'} */
    this.from = 'today';
    /** The person whose page a thread was opened from. @type {number | null} */
    this.fromPerson = null;
    /** Everyone he deals with, as the people call answered. @type {Someone[]} */
    this.people = [];
    /** The open person with their threads and words. @type {PersonShown | null} */
    this.person = null;
    /** The person's number the page couldn't find. @type {number | null} */
    this.personMissing = null;
    /** Whether Everyone shows the people only in dropped threads. */
    this.peopleFold = false;
    /** What of the open person is being changed: his notes on them, or their name. @type {'note' | 'name' | null} */
    this.personEdit = null;
    /** His notes as typed so far, kept across a redraw. @type {string | null} */
    this.personDraft = null;
    /** The address being added to a person, as typed. */
    this.personAddress = '';
    /** Why that address wasn't added. @type {AddressProblem | null} */
    this.personProblem = null;
    /** Bumped on every person load, so an answer for a person no longer shown is dropped. */
    this.personLoading = 0;
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
    /** Who the comment being written is for, when the writer chose; null for the thread's own default. @type {Audience | null} */
    this.audience = null;
    /** A public thread, as the public view shows it. @type {PublicShown | null} */
    this.publicShown = null;
    /** The public view's note, as it is being written. @type {NoteForm} */
    this.note = { name: '', email: '', body: '', sent: false, busy: false, problem: '' };
    /** Who answers a public page from this browser. @type {Visitor} */
    this.visitor = readVisitor();
    /** Dropped notes whose words are shown under their line. @type {Set<string>} */
    this.notesOpened = new Set();
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
    /** Whether the page fills the window: at first, when the address asks for it (`?full`, Share's link for answering). */
    this.pageFull = new URLSearchParams(location.search).has('full');
    /** What the open page's frame has said. @type {Talk} */
    this.talk = freshTalk();
    /** The comment being written on words selected in the page, and its text. @type {WordsDraft | null} */
    this.wordsDraft = null;
    this.wordsText = '';
    /** The discussion on the page's words shown as chosen. @type {string | null} */
    this.activeDisc = null;
    /** The comment a reply is being written under, and each reply's words so far. @type {string | null} */
    this.replyingTo = null;
    /** @type {Map<string, string>} */
    this.replyDrafts = new Map();
    /** Which discussions the sheet or drawer shows: one by id, the comment being written, or all. @type {string | null} */
    this.discussionShown = null;
    /** Wide enough for discussions beside the page. */
    this.wide = window.matchMedia('(min-width: 1000px)');
    /** @type {Overlay} */
    this.overlay = null;
    /** @type {NewDraft | null} */
    this.newDraft = null;
    /** The meeting being set in its editor. @type {MeetingDraft | null} */
    this.meetingDraft = null;
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
    // His notes on a person, and their name, are saved when he leaves the box for anywhere outside its own form.
    document.addEventListener('focusout', (event) => {
      const box = event.target;
      const next = event.relatedTarget;
      if (!(box instanceof HTMLElement) || (next instanceof Element && box.closest('form') !== null && next.closest('form') === box.closest('form'))) return;
      if (box.id === 'person-note') void this.savePersonNote();
      if (box.id === 'person-name') void this.savePersonName();
    });
    window.addEventListener('popstate', () => this.go(routeOf(location), false));
    window.addEventListener('message', (event) => this.onPageMessage(event));
    this.wide.addEventListener('change', () => {
      if (this.route.view !== 'thread') return;
      this.keepScroll = true;
      this.render();
    });
    // A dialog's close arrives as a task, after another may already have opened in its place; only a dialog still
    // closed is emptied, so nothing in it keeps the focus and keys reach the page again.
    this.dialog.addEventListener('close', () => {
      if (this.dialog.open) return;
      this.overlay = null;
      this.sharing = null;
      this.discussionShown = null;
      this.meetingDraft = null;
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
      if (this.caller === 'member' && isHis(route)) this.route = { view: 'today' };
      const person = this.caller === 'owner' && route.view === 'person' ? this.loadPerson(route.number) : Promise.resolve();
      await Promise.all([this.loadAll(), thread, person]);
    } catch (error) {
      if (error instanceof SignedOut && inviting) location.replace(signInAddress(location.pathname));
      else if (error instanceof SignedOut) {
        if (!(await this.tryPublic(route))) this.showLost();
      } else if (error instanceof NotShared) {
        if (!(await this.tryPublic(route))) this.showNotShared();
      } else this.fail(error, "The threads didn't load.");
      return;
    }
    if (inviting || (this.caller === 'member' && isHis(route))) history.replaceState(null, '', this.route.view === 'thread' ? location.pathname : ME);
    this.applyCaller();
    rememberSignedIn();
    if (this.member && this.missing !== null && (await this.tryPublic(route))) return;
    this.render();
  }

  /**
   * Shows the thread an address names in the public view when it is public, for anyone who can't read it otherwise;
   * false when the address names no thread or the thread isn't public, and nothing is shown.
   * @param {Route} route
   */
  async tryPublic(route) {
    if (route.view !== 'thread') return false;
    try {
      this.publicShown = await showPublic(route.number, this.visitor.key);
    } catch {
      return false;
    }
    this.renderPublic();
    return true;
  }

  async loadAll() {
    if (this.caller === 'member') {
      const mine = await listMine();
      this.threads = new Map(mine.map((thread) => [thread.number, thread]));
    } else {
      const [pages, people] = await Promise.all([Promise.all(TABS.map((tab) => listAll(tab))), listPeople()]);
      this.threads = new Map(pages.flatMap((page) => page.threads).map((thread) => [thread.number, thread]));
      this.people = people;
    }
    this.loaded = true;
  }

  /** Everyone again, as the people call answers now, drawn when People is still shown. */
  async loadPeople() {
    try {
      this.people = await listPeople();
    } catch (error) {
      this.fail(error, "People didn't load.");
      return;
    }
    if (this.route.view === 'people') {
      this.keepScroll = true;
      this.render();
    }
  }

  /** @param {number} number */
  async loadPerson(number) {
    const ticket = ++this.personLoading;
    try {
      const shown = await showPerson(number);
      if (ticket !== this.personLoading) return;
      this.person = shown;
      this.personMissing = null;
    } catch (error) {
      if (ticket !== this.personLoading) return;
      if (error instanceof Missing) {
        this.person = null;
        this.personMissing = number;
        return;
      }
      throw error;
    }
  }

  /**
   * Keeps a person as the change call answered them, on their page and in Everyone.
   * @param {Someone} saved
   */
  rememberPerson(saved) {
    if (this.person?.person.number === saved.number) this.person = { ...this.person, person: saved };
    this.people = this.people.map((one) => (one.number === saved.number ? { ...one, ...saved } : one));
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
    for (const owners of document.querySelectorAll('.t-side-new, .t-tabbar [data-go="list"], .t-tabbar [data-act="more"], .t-tabbar [data-act="new"]')) {
      if (owners instanceof HTMLElement) owners.hidden = true;
    }
    for (const theirs of document.querySelectorAll('.t-tabbar [data-member]')) {
      if (theirs instanceof HTMLElement) theirs.hidden = false;
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
      if (this.shown?.thread.number !== number) this.forgetPage();
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
   * The signed-out page. At /me, the door, it says whose space this is and offers Sign in; at /threads/ (the list),
   * which names no thread, it says what it is and offers Sign in. At a thread's address it is what a missing address
   * shows, with a small "Sign in" only on a device that has signed in before, so the address never says whether that
   * thread exists.
   */
  showLost() {
    this.app.hidden = true;
    this.lost.hidden = false;
    const here = location.pathname;
    const room = here === ME || here === MEETINGS || isPeopleAddress(here);
    const index = here === THREADS;
    this.signInLink.href = signInAddress(room || index || isThreadAddress(here) ? here : ME);
    if (room) {
      this.lostTitle.textContent = 'whysosuresh.com';
      this.lostText.textContent = "Suresh's private space. Sign in to open it.";
      this.signInLink.className = 't-btn t-btn-primary';
      this.signIn.hidden = false;
      document.title = 'Sign in · whysosuresh.com';
      return;
    }
    if (index) {
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
      const link = el('a', { href: signInAddress(here === ME || here === MEETINGS || here === THREADS || isThreadAddress(here) || isPeopleAddress(here) ? here : ME) }, ['Sign in again']);
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
    if (this.member && isHis(route)) route = { view: 'today' };
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
    if (route.view === 'meetings') this.from = 'meetings';
    this.route = route;
    this.personEdit = null;
    this.personDraft = null;
    this.personAddress = '';
    this.personProblem = null;
    if (push) history.pushState(null, '', pathOf(route, this.threads, this.people));
    if (route.view === 'person') {
      this.shown = null;
      this.missing = null;
      if (this.person?.person.number !== route.number) this.person = null;
      this.personMissing = null;
      this.render();
      this.main.scrollTop = 0;
      try {
        await this.loadPerson(route.number);
      } catch (error) {
        this.fail(error, "The person didn't load.");
        return;
      }
      if (this.route.view === 'person' && this.route.number === route.number) {
        this.keepScroll = true;
        this.render();
      }
      return;
    }
    if (route.view === 'people') void this.loadPeople();
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
      if (this.member && this.missing === route.number && (await this.tryPublic(route))) return;
      this.keepScroll = true;
      this.render();
    }
  }

  /** @param {number} number */
  openThread(number) {
    void this.go({ view: 'thread', number });
  }

  back() {
    if (this.route.view === 'person') void this.go({ view: 'people' });
    else if (this.from === 'person' && this.fromPerson !== null) void this.go({ view: 'person', number: this.fromPerson });
    else if (this.from === 'meetings') void this.go({ view: 'meetings' });
    else void this.go(this.from === 'today' ? { view: 'today' } : { view: 'list', tab: this.tab, space: this.space });
  }

  /** Threads in a tab, in the chosen space, newest number first. @param {Tab} tab */
  inTab(tab) {
    return [...this.threads.values()]
      .filter((thread) => TAB_STATUSES[tab].includes(thread.status) && (this.space === null || thread.space === this.space))
      .sort((a, b) => b.number - a.number);
  }

  /** Threads where someone else had the last word (a person he invited, or a visitor), the most recent first. */
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

  /**
   * The meetings the reader is in, coming soonest first and past newest first: his own every one, an invited
   * person's those that mark them as in the room.
   */
  meetings() {
    // A dropped thread's meeting isn't happening, so it is in no list of meetings.
    const theirs = [...this.threads.values()].filter(
      (thread) => thread.meeting && thread.status !== 'dropped' && (!this.member || thread.meeting.attendees.some((one) => one.you === true)),
    );
    return split(theirs, (thread) => thread.meeting ?? null, Date.now(), ZONE);
  }

  /** The threads J and K walk: an invited person's own, Today's, the meetings', or the list's. */
  walk() {
    if (this.from === 'meetings') {
      const { coming, past } = this.meetings();
      return [...coming, ...past].map((thread) => thread.number);
    }
    if (this.member) return this.mine().map((thread) => thread.number);
    if (this.from === 'person' && this.person) return this.person.threads.map((thread) => thread.number);
    if (this.from !== 'today') return this.inTab(this.tab).map((thread) => thread.number);
    const seen = new Set();
    return [...this.waiting(), ...this.fresh(), ...this.sat()]
      .map((thread) => thread.number)
      .filter((number) => (seen.has(number) ? false : (seen.add(number), true)));
  }

  /** The thread a key acts on: the open one, or the selected row. */
  target() {
    if (this.route.view === 'thread') return this.shown?.thread ?? null;
    if (this.route.view === 'people' || this.route.view === 'person' || this.route.view === 'meetings') return this.route.view === 'meetings' && this.sel !== null ? (this.threads.get(this.sel) ?? null) : null;
    return this.sel === null ? null : (this.threads.get(this.sel) ?? null);
  }

  /** @param {number} by */
  step(by) {
    if (this.route.view === 'people' || this.route.view === 'person') return;
    if (this.route.view === 'meetings') this.from = 'meetings';
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
    this.pub.hidden = true;
    this.publicShown = null;
    this.app.hidden = false;
    const scroll = this.main.scrollTop;
    // A box being typed in keeps its focus and its cursor across a redraw (a page saying where its words moved).
    const typing = document.activeElement;
    const kept = typing instanceof HTMLTextAreaElement && typing.id !== '' && this.main.contains(typing) ? { id: typing.id, from: typing.selectionStart, to: typing.selectionEnd } : null;
    this.renderNav();
    this.renderTabbar();
    if (this.route.view === 'thread') {
      const view = this.threadView();
      if (!keepFrame(this.main, view)) {
        this.main.replaceChildren(view);
        this.talk = freshTalk();
      }
      this.tellPage();
      this.placeCards();
      if (this.overlay === 'discussion') this.renderDiscussion();
      const thread = this.shown?.thread;
      document.title = thread ? `#${thread.number} ${titleOf(thread)} · Threads` : 'Threads';
      if (thread && location.pathname !== threadPath(thread)) history.replaceState(null, '', threadPath(thread));
    } else if (this.route.view === 'people') {
      this.main.replaceChildren(this.peopleView());
      document.title = 'People · Threads';
    } else if (this.route.view === 'person') {
      this.main.replaceChildren(this.personView());
      const someone = this.person?.person;
      document.title = someone ? `${nameOf(someone)} · People · Threads` : 'People · Threads';
      if (someone && location.pathname !== personPath(someone)) history.replaceState(null, '', personPath(someone));
    } else if (this.route.view === 'meetings') {
      this.ensureSel();
      this.main.replaceChildren(this.meetingsView());
      document.title = this.member ? 'Your meetings · whysosuresh.com' : 'Meetings · whysosuresh.com';
    } else if (this.route.view === 'list') {
      this.ensureSel();
      this.main.replaceChildren(this.listView());
      document.title = `${this.space === null ? 'Threads' : `${spaceLabel(this.space)} · Threads`} · whysosuresh.com`;
    } else {
      this.ensureSel();
      this.main.replaceChildren(this.member ? this.mineView() : this.todayView());
      document.title = this.member ? 'Shared with you · whysosuresh.com' : 'Today · whysosuresh.com';
    }
    if (this.keepScroll) this.main.scrollTop = scroll;
    this.keepScroll = false;
    const again = kept === null ? null : this.main.querySelector(`#${kept.id}`);
    if (kept !== null && again instanceof HTMLTextAreaElement && document.activeElement !== again) {
      again.focus({ preventScroll: true });
      again.setSelectionRange(kept.from, kept.to);
    }
    const selected = this.main.querySelector('.t-row[aria-selected="true"]');
    if (selected && this.route.view !== 'thread') selected.scrollIntoView({ block: 'nearest' });
  }

  ensureSel() {
    const list = this.walk();
    if (this.sel === null || !list.includes(this.sel)) this.sel = list[0] ?? null;
  }

  renderNav() {
    if (this.member) {
      const item = el('a', { class: 't-nav-item', href: ME, 'data-go': 'today' }, [icon('people'), 'Yours', el('span', { class: 't-nav-count' }, [String(this.threads.size)])]);
      if (this.route.view === 'today') item.setAttribute('aria-current', 'page');
      const theirs = this.mine().map((thread) => {
        const link = el('a', { class: 't-nav-item t-nav-sub', href: threadPath(thread), 'data-thread': String(thread.number) }, [
          el('span', { class: 't-nav-pad' }),
          el('span', { class: 't-nav-text' }, [`#${thread.number} ${titleOf(thread)}`]),
        ]);
        if (this.route.view === 'thread' && this.route.number === thread.number) link.setAttribute('aria-current', 'page');
        return link;
      });
      const { coming } = this.meetings();
      const meetings = el('a', { class: 't-nav-item', href: MEETINGS, 'data-go': 'meetings' }, [icon('cal'), 'Your meetings', el('span', { class: 't-nav-count' }, [String(coming.length)])]);
      if (this.route.view === 'meetings') meetings.setAttribute('aria-current', 'page');
      this.nav.replaceChildren(el('div', { class: 't-nav-label' }, ['Shared with you, by Suresh']), item, ...theirs, meetings);
      return;
    }
    const counts = new Map();
    for (const thread of this.threads.values()) if (isOpen(thread) && thread.space !== null) counts.set(thread.space, (counts.get(thread.space) ?? 0) + 1);
    const view = this.route.view;
    const today = this.waiting().length + this.fresh().length + this.sat().length;
    const todayItem = el('a', { class: 't-nav-item', href: ME, 'data-go': 'today' }, [icon('sun'), 'Today', el('span', { class: 't-nav-count' }, [String(today)])]);
    const allItem = el('a', { class: 't-nav-item', href: THREADS, 'data-go': 'list' }, [icon('list'), 'Threads']);
    const peopleItem = el('a', { class: 't-nav-item', href: PEOPLE, 'data-go': 'people' }, [
      icon('person'),
      'People',
      el('span', { class: 't-nav-count' }, [String(folded(this.people).live.length)]),
    ]);
    if (view === 'people' || view === 'person') peopleItem.setAttribute('aria-current', 'page');
    const meetingsItem = el('a', { class: 't-nav-item', href: MEETINGS, 'data-go': 'meetings' }, [icon('cal'), 'Meetings', el('span', { class: 't-nav-count' }, [String(this.meetings().coming.length)])]);
    if (view === 'meetings') meetingsItem.setAttribute('aria-current', 'page');
    if (view === 'today') todayItem.setAttribute('aria-current', 'page');
    if (view === 'list' && this.space === null) allItem.setAttribute('aria-current', 'page');
    const spaces = SPACES.map((space) => {
      const item = el('a', { class: 't-nav-item t-nav-sub', href: `/threads/?tab=${this.tab}&space=${space.slug}`, 'data-space': space.slug }, [
        el('span', { class: 't-nav-pad' }),
        space.label,
        el('span', { class: 't-nav-count' }, [String(counts.get(space.slug) ?? 0)]),
      ]);
      if (view === 'list' && this.space === space.slug) item.setAttribute('aria-current', 'page');
      return item;
    });
    // A space is a filter on the threads, so the five sit under Threads rather than beside the rooms.
    this.nav.replaceChildren(todayItem, allItem, ...spaces, peopleItem, meetingsItem);
  }

  renderTabbar() {
    const view = this.route.view === 'person' ? 'people' : this.route.view;
    for (const button of this.tabbar.querySelectorAll('[data-go], [data-act="more"]')) {
      if (!(button instanceof HTMLElement)) continue;
      // People and Meetings sit under More on his bar, so More is where he is when he is in either.
      const current = button.dataset.act === 'more' ? view === 'people' || view === 'meetings' : button.dataset.go === view;
      if (current) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }

  /** The rooms that don't fit on his phone's bar, in a sheet: People and Meetings. */
  openMore() {
    const picks = [
      el('a', { class: 't-pick', href: PEOPLE, 'data-go': 'people' }, [icon('person'), 'People']),
      el('a', { class: 't-pick', href: MEETINGS, 'data-go': 'meetings' }, [icon('cal'), 'Meetings']),
    ];
    this.openOverlay('more', 'More rooms', 'narrow', [this.sheetHead('More'), el('div', { class: 't-sheet-body' }, [el('div', { class: 't-pick-list' }, picks)])]);
    picks[0]?.focus();
  }

  /**
   * One thread as a row: its number, title, the line under it, its space, where it stands and when it last moved.
   * @param {Thread} thread
   * @param {string} sub
   * @param {boolean} [selectable] whether the row may show as selected; a person's page selects none
   */
  row(thread, sub, selectable = true) {
    const meta = el('span', { class: 't-row-meta' }, [...this.meetingChip(thread), el('span', { class: 't-chip' }, [spaceLabel(thread.space)])]);
    if (thread.status !== 'received') meta.append(el('span', {}, [STATUS_NAMES[thread.status]]));
    if ((thread.shared ?? 0) > 0) meta.append(el('span', { class: 't-people-mark', title: `Shared with ${thread.shared}` }, [icon('people'), String(thread.shared)]));
    meta.append(el('span', {}, [ago(thread.activityAt)]));
    const row = el('a', { class: 't-row', href: threadPath(thread), 'data-thread': String(thread.number), 'aria-selected': String(selectable && this.sel === thread.number) }, [
      el('span', { class: 't-num' }, [`#${thread.number}`]),
      el('span', { class: 't-row-main' }, [el('span', { class: 't-row-title' }, [...rowMark(thread), titleOf(thread)]), el('span', { class: 't-row-sub' }, [sub])]),
      meta,
    ]);
    return row;
  }

  /** A meeting's date on its row, solid while it is near and faint once it is past. @param {Thread} thread */
  meetingChip(thread) {
    const meeting = thread.meeting;
    if (!meeting) return [];
    return [el('span', { class: 't-chip t-chip-meet', 'data-when': stateOf(meeting, Date.now(), ZONE) }, [icon('cal'), chipWords(meeting, Date.now(), LOCALE, ZONE)])];
  }

  /**
   * A meeting as a room's row: its time today or its day where a number goes, the thread's title, then when and who.
   * @param {Thread} thread
   */
  meetingRow(thread) {
    const meeting = thread.meeting;
    if (!meeting) return this.row(thread, firstLine(thread));
    const now = Date.now();
    return el('a', { class: 't-row t-row-meet', href: threadPath(thread), 'data-thread': String(thread.number), 'data-when': stateOf(meeting, now, ZONE), 'aria-selected': String(this.sel === thread.number) }, [
      el('span', { class: 't-num t-meet-lead' }, [leadWords(meeting, now, LOCALE, ZONE)]),
      el('span', { class: 't-row-main' }, [
        el('span', { class: 't-row-title' }, [...rowMark(thread), titleOf(thread)]),
        el('span', { class: 't-row-sub' }, [el('span', { class: 't-row-when' }, [whenLine(meeting, now, LOCALE, ZONE)]), ` · ${withLine(meeting.attendees)}`]),
      ]),
      el('span', { class: 't-row-meta' }, [el('span', { class: 't-num' }, [`#${thread.number}`])]),
    ]);
  }

  /**
   * The next meeting as a card, which opens its thread; none when nothing is coming.
   * @param {string} label
   */
  nextMeetingCard(label) {
    const next = this.meetings().coming[0];
    const meeting = next?.meeting;
    if (!next || !meeting) return [];
    const { head, rest } = cardLines(meeting, titleOf(next), Date.now(), LOCALE, ZONE);
    return [
      el('a', { class: 't-card', href: threadPath(next), 'data-thread': String(next.number) }, [
        el('span', { class: 't-card-lbl' }, [label]),
        el('span', { class: 't-card-big' }, [head]),
        el('span', { class: 't-card-sm' }, [`${rest} · ${withLine(meeting.attendees)}`]),
      ]),
    ];
  }

  /** The Meetings room: his every meeting, or an invited person's own, coming soonest first, then past. */
  meetingsView() {
    const { coming, past } = this.meetings();
    /** @param {string} title @param {Thread[]} list @param {string} hint @param {string} empty */
    const section = (title, list, hint, empty) =>
      el('section', { class: 't-section' }, [
        el('div', { class: 't-section-head' }, [el('h2', {}, [title]), el('span', { class: 't-n' }, [String(list.length)]), el('span', { class: 't-hint' }, [hint])]),
        el('div', { class: 't-list' }, list.length > 0 ? list.map((thread) => this.meetingRow(thread)) : [el('div', { class: 't-empty' }, [empty])]),
      ]);
    return el('div', { class: 't-wrap' }, [
      el('div', { class: 't-head' }, [
        el('div', {}, [
          el('h1', {}, [this.member ? 'Your meetings' : 'Meetings']),
          el('p', {}, [this.member ? 'Only the meetings Suresh has with you, in your own time.' : 'What’s coming up, and what each one decided. A meeting opens its thread.']),
        ]),
      ]),
      section('Coming up', coming, 'soonest first', this.member ? 'No meeting with Suresh yet.' : 'Nothing booked. Press B on a thread to make it a meeting.'),
      ...(past.length > 0 ? [section('Past', past, 'newest first', '')] : []),
    ]);
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
      ...this.nextMeetingCard('Next meeting'),
      ...(waiting.length > 0 ? [section('Waiting on you', waiting, ["the last word is someone else's: a person you invited, or a visitor"], (thread) => firstLine(thread), '')] : []),
      section('New', fresh, [el('span', { class: 't-keys-hint' }, [kbd('A'), ' act · ', kbd('T'), ' talk · ', kbd('D'), ' drop'])], (thread) => this.rowLine(thread), 'All sorted.'),
      section('Sat a week', sat, ['still open, untouched for 7 days'], (thread) => `${ago(thread.activityAt)} in ${STATUS_NAMES[thread.status]}. Move it, or drop it.`, 'Nothing has sat a week.'),
    ]);
  }

  /** An invited person's home: the threads shared with them, most recently active first. */
  mineView() {
    const mine = this.mine();
    return el('div', { class: 't-wrap' }, [
      el('div', { class: 't-head' }, [el('div', {}, [el('h1', {}, ['Shared with you']), el('p', {}, ['The threads Suresh shared with you, newest activity first.'])])]),
      ...this.nextMeetingCard('Your next meeting'),
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
      // The keys 1 to 4 still open each tab (keys.js, and the keys sheet lists them); the tabs show only their counts.
      TABS.map((tab) =>
        el('a', { class: 't-tab', role: 'tab', href: pathOf({ view: 'list', tab, space: this.space }, this.threads), 'data-tab': tab, 'aria-selected': String(this.tab === tab) }, [
          TAB_NAMES[tab],
          el('span', { class: 't-nav-count' }, [String(this.inTab(tab).length)]),
        ]),
      ),
    );
    return el('div', { class: 't-wrap' }, [
      el('div', { class: 't-head' }, [
        el('div', {}, [
          el('h1', {}, [this.space === null ? 'Threads' : spaceLabel(this.space)]),
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
          el('a', { href: ME, 'data-go': 'today' }, [this.member ? 'Back to your threads' : 'Back to Today']),
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
      ...(thread.publicAt ? [publicChip()] : []),
      pager,
    ]);
    const sender = thread.senderName?.trim() || 'Someone';
    const by = this.member
      ? ['Suresh shared this with you']
      : visitor
        ? [this.nameNode(thread.senderNumber, sender), ' sent this from the site']
        : thread.source === 'told'
          ? [this.nameNode(thread.senderNumber, sender), ' told you this']
          : [this.shown.events[0]?.actor === 'owner' ? 'You started this' : 'You said this; the recorder sync wrote it down'];
    const summary = thread.summary
      ? el('section', { class: 't-summary', 'aria-label': 'Summary' }, [
          el('div', { class: 't-summary-head' }, [el('span', {}, ['Summary']), el('span', {}, ['kept current by the recorder sync'])]),
          summaryBody(thread.summary),
        ])
      : this.member
        ? el('section', { class: 't-summary t-summary-empty', 'aria-label': 'Summary' }, ['No summary yet.'])
        : el('section', { class: 't-summary t-summary-empty', 'aria-label': 'Summary' }, ['No summary yet. The sync writes one at its next pass, or press ', kbd('W'), ' to write it.']);
    const text = this.mainSection(thread, this.shown.page);
    const places = placesOf(this.shown.comments);
    const paged = thread.main === 'page' && this.shown.page !== null;
    const beside = paged && !this.columnless() && (places.words.length > 0 || this.wordsDraft !== null);
    const doc = el('article', { class: 't-doc' }, [
      crumbs,
      el('h1', { class: 't-title' }, [el('span', { class: 't-tn' }, [`#${thread.number}`]), ' ', titleOf(thread)]),
      el('div', { class: 't-byline' }, [...by, `, ${when(thread.createdAt)} · updated ${ago(thread.activityAt)} ago`]),
      ...(this.member ? [] : [this.moves(thread)]),
      ...this.meetingStrip(thread),
      summary,
      ...(this.reply ? [this.replyPanel(this.reply)] : []),
      ...text,
      ...(paged && this.columnless() ? this.pageDiscussions(places, thread) : []),
      el('div', { class: 't-feed' }, this.feed(this.shown, thread, places)),
      ...(this.shown.truncated ? [el('p', { class: 't-note' }, ['Only the first 500 comments and events are shown.'])] : []),
      this.composer(thread),
    ]);
    const details = this.member ? this.memberDetails(thread) : this.details(thread);
    const cards = beside
      ? [
          el('div', { class: 't-rail-head' }, ['Discussions on the page']),
          el('div', { class: 't-rail-cards', 'data-rail-cards': '' }, [
            ...places.words.filter((said) => this.talk.anchors.get(said.id) !== null).map((said) => this.discCard(said, places, thread)),
            ...(this.wordsDraft ? [this.draftCard()] : []),
          ]),
        ]
      : [];
    return el('div', beside ? { class: 't-thread', 'data-rail': '' } : { class: 't-thread' }, [doc, el('div', { class: 't-rail' }, [details, ...cards])]);
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
        el('span', {}, [el('b', {}, [this.nameNode(thread.senderNumber, name)]), ` wrote, ${when(thread.createdAt)}${thread.senderEmail ? ` · ${thread.senderEmail}` : ''}`]),
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
      ...(this.pageFull && this.shown && placesOf(this.shown.comments).words.length > 0
        ? [el('button', { type: 'button', class: 't-btn', 'data-act': 'discussions' }, [`Discussions · ${placesOf(this.shown.comments).words.filter((said) => this.talk.anchors.get(said.id) !== null).length}`])]
        : []),
      el('button', { type: 'button', class: 't-btn', 'data-act': 'page-full' }, [this.pageFull ? 'Back to thread' : 'Full screen']),
    ]);
    const frame = el('iframe', { class: 't-page-frame', sandbox: PAGE_SANDBOX, src: pageAddress(thread.number, number), title: `Page, version ${number}`, loading: 'lazy' });
    return el('section', { class: 't-page', 'aria-label': 'Page', 'data-page-key': `${thread.number}-${number}`, 'data-full': String(this.pageFull) }, [bar, frame]);
  }

  /**
   * A message from a page's frame (frame/bridge.js), taken only from the open page's own frame and only as one of the
   * kinds page-talk.js reads. Its height, as a number in range, sizes the frame wherever it is. Everything else is the
   * signed-in thread's: `ready` (a page loaded) is answered with `hello` and the discussion on it; `anchors` says
   * where each discussion's words sit; and the three that ask for something (`selected`, `answer`, `open`) are taken
   * only while the frame holds the focus, which it does when the reader clicked or typed in it, so a page script
   * acting on its own at load is refused. An answer also has to name a question the page named in `ready`, at most
   * ten a minute from one frame, and is saved here as whoever is signed in. The public view answers its own frame
   * (`onPublicPageMessage`).
   * @param {MessageEvent} event
   */
  onPageMessage(event) {
    const signedIn = this.pub.hidden;
    const frame = (signedIn ? this.main : this.pubDoc).querySelector('.t-page-frame');
    if (!(frame instanceof HTMLIFrameElement) || event.source !== frame.contentWindow) return;
    const said = readPageMessage(/** @type {unknown} */ (event.data));
    if (said === null) return;
    if (said.kind === 'height') {
      if (said.height >= PAGE_HEIGHT.min && said.height <= PAGE_HEIGHT.max) frame.style.height = `${Math.round(said.height)}px`;
      return;
    }
    if (!signedIn) {
      this.onPublicPageMessage(said, frame);
      return;
    }
    const thread = this.shown?.thread;
    if (this.route.view !== 'thread' || !thread || thread.main !== 'page') return;
    if (said.kind === 'ready') {
      this.talk = { ...freshTalk(), ready: true, questions: new Set(said.questions) };
      this.wordsDraft = null;
      frame.contentWindow?.postMessage({ [KEY]: 'hello' }, '*');
      this.tellPage();
      return;
    }
    if (said.kind === 'anchors') {
      // Only a discussion found or lost changes what is drawn; the comment being written is drawn already.
      const found = (/** @type {Iterable<[string, number | null]>} */ pairs) => [...pairs].filter(([id]) => id !== DRAFT).map(([id, top]) => `${id}:${top === null}`).join(',');
      const before = found(this.talk.anchors);
      this.talk.anchors = new Map(said.anchors.map((one) => [one.id, one.top]));
      this.talk.questionTops = new Map(said.questions.map((one) => [one.id, one.top]));
      const after = found(this.talk.anchors);
      if (before !== after) {
        this.keepScroll = true;
        this.render();
      } else this.placeCards();
      return;
    }
    if (document.activeElement !== frame) return;
    if (said.kind === 'selected') {
      this.wordsDraft = { quote: said.quote, prefix: said.prefix, suffix: said.suffix, top: said.top };
      this.wordsText = '';
      this.activeDisc = null;
      this.keepScroll = true;
      this.render();
      if (this.columnless()) this.openDiscussion(DRAFT);
      else focusIn(this.main, '#words-text');
    } else if (said.kind === 'open') {
      this.showDisc(said.id);
    } else if (said.kind === 'answer') {
      const now = Date.now();
      this.talk.answered = this.talk.answered.filter((at) => now - at < 60_000);
      if (!this.talk.questions.has(said.question) || this.talk.answered.length >= ANSWERS_A_MINUTE) {
        frame.contentWindow?.postMessage({ [KEY]: 'saved', question: said.question, ok: false }, '*');
        return;
      }
      this.talk.answered.push(now);
      void this.saveAnswer(thread, said.question, said.body);
    }
  }

  /**
   * What a public thread's page says, for a visitor: a page that asks questions is answered `hello` as a visitor's, so
   * it draws its answer boxes alone, and is told the answers the public call gave; an answer is taken under the same
   * gates as a signed-in one (the frame's focus, ten a minute, a question the page named), needs the visitor's name
   * first, and is sent with the site's bot check as this browser's.
   * @param {import('./page-talk.js').FromPage} said
   * @param {HTMLIFrameElement} frame
   */
  onPublicPageMessage(said, frame) {
    const shown = this.publicShown;
    if (!shown || shown.thread.main !== 'page' || !shown.page) return;
    if (said.kind === 'ready') {
      this.talk = { ...freshTalk(), ready: true, questions: new Set(said.questions) };
      // A page that asks nothing is read as it is, as every public page was.
      if (said.questions.length === 0) return;
      frame.contentWindow?.postMessage({ [KEY]: 'hello', visitor: true }, '*');
      prepareBotCheck();
      this.renderPublic();
      this.tellPublicPage();
      return;
    }
    if (said.kind !== 'answer' || document.activeElement !== frame) return;
    const tell = (/** @type {string} */ problem) => frame.contentWindow?.postMessage({ [KEY]: 'saved', question: said.question, ok: false, problem }, '*');
    const now = Date.now();
    this.talk.answered = this.talk.answered.filter((at) => now - at < 60_000);
    if (!this.talk.questions.has(said.question) || this.talk.answered.length >= ANSWERS_A_MINUTE) {
      tell('That answer didn’t save. It is still in the box.');
      return;
    }
    if (this.visitor.naming) this.takeVisitorName();
    if (this.visitor.name === '') {
      tell(this.pageFull ? 'Add your name in the bar at the top first.' : 'Add your name above the page first.');
      this.visitor = { ...this.visitor, naming: true, missing: true };
      this.renderPublic();
      focusIn(this.pubDoc, '#visitor-name');
      return;
    }
    this.talk.answered.push(now);
    void this.saveVisitorAnswer(shown.thread.number, said.question, said.body);
  }

  /**
   * Tells a public page the answers the public call gave, as given: the visitor's own, and other people's under the
   * questions they answered. Only when that changed.
   */
  tellPublicPage() {
    const shown = this.publicShown;
    const frame = this.pubDoc.querySelector('.t-page-frame');
    if (!this.talk.ready || shown === null || !(frame instanceof HTMLIFrameElement)) return;
    const comments = shown.comments.map((said) => ({
      id: '',
      author: said.author,
      name: said.name,
      state: 'shown',
      body: said.body,
      createdAt: said.createdAt,
      question: said.question ?? null,
      mine: said.mine === true,
    }));
    const message = discussionFor(placesOf(comments), { ownerName: 'Suresh', draft: null, active: null, asGiven: true });
    const text = JSON.stringify(message);
    if (text === this.talk.sent) return;
    this.talk.sent = text;
    frame.contentWindow?.postMessage(message, '*');
  }

  /**
   * Sends a visitor's answer as this browser's, with the name they gave, tells the page whether it was kept (and why
   * not), and reads the thread again, so their answer and the ones it opens show.
   * @param {number} number
   * @param {string} question
   * @param {string} body
   */
  async saveVisitorAnswer(number, question, body) {
    const frame = this.pubDoc.querySelector('.t-page-frame');
    const tell = (/** @type {boolean} */ ok, /** @type {string | null} */ problem) =>
      frame instanceof HTMLIFrameElement ? frame.contentWindow?.postMessage({ [KEY]: 'saved', question, ok, ...(problem === null ? {} : { problem }) }, '*') : undefined;
    try {
      await sendTo(`/api/threads/${number}/answers`, { question, body, name: this.visitor.name, key: this.visitor.key });
    } catch (error) {
      const reason = error instanceof Error && 'reason' in error ? error.reason : 'failed';
      tell(
        false,
        reason === 'limit'
          ? 'Today’s limit for answers is reached. Your answer is still in the box; try again tomorrow.'
          : reason === 'gone'
            ? 'This page doesn’t take answers any more.'
            : 'That answer didn’t save. It is still in the box.',
      );
      return;
    }
    tell(true, null);
    await this.refreshPublic(number);
  }

  /** Reads a public thread again, as this visitor, and draws it, its page and what the page is told. @param {number} number */
  async refreshPublic(number) {
    try {
      this.publicShown = await showPublic(number, this.visitor.key);
    } catch {
      return;
    }
    this.renderPublic();
    this.tellPublicPage();
  }

  /** Takes the name typed in the public view's name box, when there is one, and keeps it with the key. */
  takeVisitorName() {
    const field = this.pubDoc.querySelector('#visitor-name');
    const name = field instanceof HTMLInputElement ? field.value.trim().slice(0, MAX_VISITOR_NAME) : this.visitor.name;
    if (name === '') return;
    this.visitor = { ...this.visitor, name, naming: false, missing: false, kept: keepVisitor(name, this.visitor.key) };
  }

  /** Forgets what the open page's frame said and what was being written on it, as another thread opens. */
  forgetPage() {
    this.talk = freshTalk();
    this.wordsDraft = null;
    this.wordsText = '';
    this.activeDisc = null;
    this.replyingTo = null;
  }

  /** Whether discussions open in a sheet rather than beside the page: below 1000 px, and in full screen. */
  columnless() {
    return !this.wide.matches || this.pageFull;
  }

  /** The page version shown on the open thread, or null when it shows no page. */
  shownVersion() {
    const shown = this.shown;
    if (!shown?.page) return null;
    return this.pageVersions.get(shown.thread.number) ?? shown.page.version;
  }

  /**
   * Tells the open page the discussion on it, once its frame said it is ready, and only when that changed: each
   * person's newest answer by name, the words of every discussion and of the comment being written, and the one
   * chosen. The frame has no address of its own, so it is posted to `*`, and holds only what the reader may read.
   */
  tellPage() {
    if (!this.talk.ready || !this.shown) return;
    const frame = this.main.querySelector('.t-page-frame');
    if (!(frame instanceof HTMLIFrameElement)) return;
    const words = this.wordsDraft ? { quote: this.wordsDraft.quote, prefix: this.wordsDraft.prefix, suffix: this.wordsDraft.suffix } : null;
    const message = discussionFor(placesOf(this.shown.comments), { ownerName: 'Suresh', draft: words, active: this.activeDisc ?? (words ? DRAFT : null) });
    const text = JSON.stringify(message);
    if (text === this.talk.sent) return;
    this.talk.sent = text;
    frame.contentWindow?.postMessage(message, '*');
  }

  /** Puts each card beside the page level with its words, pushed down where two would overlap. */
  placeCards() {
    const box = this.main.querySelector('[data-rail-cards]');
    const frame = this.main.querySelector('.t-page-frame');
    if (!(box instanceof HTMLElement) || !(frame instanceof HTMLElement)) return;
    const offset = frame.getBoundingClientRect().top - box.getBoundingClientRect().top;
    const cards = [...box.querySelectorAll('[data-card]')].filter((card) => card instanceof HTMLElement);
    const wanted = cards.map((card) => {
      const id = card.dataset.card ?? '';
      const top = id === DRAFT ? (this.wordsDraft?.top ?? 0) : (this.talk.anchors.get(id) ?? 0);
      return { id, want: offset + top - CARD_LIFT, height: card.offsetHeight };
    });
    const { placed, bottom } = stack(wanted, CARD_GAP);
    for (const card of cards) card.style.top = `${Math.round(placed.get(card.dataset.card ?? '') ?? 0)}px`;
    box.style.height = `${Math.round(bottom)}px`;
  }

  /**
   * Opens one discussion on the page's words, or all of them, or the comment being written, where there is no room
   * beside the page: a sheet, or in full screen a drawer.
   * @param {string} which a discussion's id, `draft`, or `all`
   */
  openDiscussion(which) {
    this.discussionShown = which;
    this.renderDiscussion();
    focusIn(this.dialog, which === DRAFT ? '#words-text' : '#reply-text');
  }

  /** Draws the open sheet or drawer of discussions again, as the thread now stands. */
  renderDiscussion() {
    const shown = this.shown;
    const which = this.discussionShown;
    if (!shown || which === null) return;
    const places = placesOf(shown.comments);
    const thread = shown.thread;
    const here = places.words.filter((said) => this.talk.anchors.get(said.id) !== null);
    const one = places.words.find((said) => said.id === which);
    const body =
      which === DRAFT && this.wordsDraft ? [this.draftCard()] : which === 'all' ? here.map((said) => this.discCard(said, places, thread)) : one ? [this.discCard(one, places, thread)] : [];
    const title = which === DRAFT ? 'Comment on these words' : which === 'all' ? 'Discussions on this page' : 'Discussion';
    this.openOverlay('discussion', title, this.pageFull ? 'drawer' : 'narrow', [this.sheetHead(title), el('div', { class: 't-sheet-body t-disc-list' }, body)]);
  }

  /**
   * Shows one discussion on the page's words: chosen in the page, beside it when there is room (scrolled to), else in
   * a sheet; in full screen the page scrolls to its words.
   * @param {string} id
   */
  showDisc(id) {
    this.activeDisc = id;
    this.keepScroll = true;
    this.render();
    const frame = this.main.querySelector('.t-page-frame');
    if (this.pageFull && frame instanceof HTMLIFrameElement) frame.contentWindow?.postMessage({ [KEY]: 'focus', id, scroll: true }, '*');
    if (this.columnless()) this.openDiscussion(id);
    else this.main.querySelector(`.t-rail [data-card="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /** Scrolls the thread to a question on its page, where the page said it sits. @param {string} question */
  showAnswer(question) {
    const frame = this.main.querySelector('.t-page-frame');
    if (!(frame instanceof HTMLElement)) return;
    const top = frame.getBoundingClientRect().top - this.main.getBoundingClientRect().top + this.main.scrollTop + (this.talk.questionTops.get(question) ?? 0) - 80;
    this.main.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  /**
   * Saves an answer the page asked for, as whoever is signed in, and tells the page whether it was kept.
   * @param {Thread} thread
   * @param {string} question
   * @param {string} body
   */
  async saveAnswer(thread, question, body) {
    const frame = this.main.querySelector('.t-page-frame');
    const tell = (/** @type {boolean} */ ok) => (frame instanceof HTMLIFrameElement ? frame.contentWindow?.postMessage({ [KEY]: 'saved', question, ok }, '*') : undefined);
    try {
      await comment(thread.number, body, { question });
    } catch (error) {
      tell(false);
      this.fail(error, "That answer didn't save. It is still in its box on the page.");
      return;
    }
    tell(true);
    this.clearProblem();
    this.touchThread(thread.number);
    await this.refreshShown(thread.number);
    this.say(this.member ? `Answer saved on #${thread.number} as ${this.me}` : `Answer saved on #${thread.number}`, null);
  }

  /** Saves the comment written on the page's selected words, on the version shown. @param {Thread} thread */
  async sendWords(thread) {
    const draft = this.wordsDraft;
    const text = this.wordsText.trim();
    const version = this.shownVersion();
    if (!draft || text === '' || version === null) return;
    let saved;
    try {
      saved = await comment(thread.number, text, { quote: draft.quote, prefix: draft.prefix, suffix: draft.suffix, version });
    } catch (error) {
      this.fail(error, "The comment didn't save. It is still in the box.");
      return;
    }
    this.wordsDraft = null;
    this.wordsText = '';
    this.activeDisc = saved.id;
    if (this.overlay === 'discussion') this.discussionShown = saved.id;
    this.clearProblem();
    this.touchThread(thread.number);
    await this.refreshShown(thread.number);
    this.say(`Commented on the page's words on #${thread.number}`, null);
  }

  /** Saves the reply being written, under its comment, in that comment's audience. @param {Thread} thread */
  async sendReply(thread) {
    const parent = this.replyingTo;
    const text = (parent === null ? '' : (this.replyDrafts.get(parent) ?? '')).trim();
    if (parent === null || text === '') return;
    try {
      await comment(thread.number, text, { parent });
    } catch (error) {
      this.fail(error, "The reply didn't save. It is still in the box.");
      return;
    }
    this.replyDrafts.delete(parent);
    this.replyingTo = null;
    this.clearProblem();
    this.touchThread(thread.number);
    await this.refreshShown(thread.number);
    this.say(`Replied on #${thread.number}`, null);
  }

  /** Marks a thread active now, and for the owner no longer waiting on him. @param {number} number */
  touchThread(number) {
    const known = this.threads.get(number);
    if (known) this.threads.set(number, { ...known, activityAt: new Date().toISOString(), waiting: this.member ? (known.waiting ?? false) : false });
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

  /**
   * A thread's meeting as a strip above its summary: its day as a calendar leaf, the when, length and where, and who is
   * in the room, each name opening their page for him; his Change (B). A thread with no meeting offers him "Make it a
   * meeting" and nothing to anyone else.
   * @param {Thread} thread
   */
  meetingStrip(thread) {
    const meeting = thread.meeting;
    if (!meeting) {
      return this.member ? [] : [el('button', { type: 'button', class: 't-btn t-meet-add', 'data-act': 'meeting' }, [icon('cal'), 'Make it a meeting ', kbd('B')])];
    }
    const now = Date.now();
    const leaf = partsOf(meeting.when, ZONE).day;
    const noon = new Date(`${leaf}T12:00:00Z`);
    // The reader's own place comes first, as everywhere a meeting says who is in it.
    const people = [...meeting.attendees.filter((one) => one.you === true), ...meeting.attendees.filter((one) => one.you !== true)];
    /** @type {(Node | string)[]} */
    const names = [];
    people.forEach((one, i) => {
      if (i > 0) names.push(i === people.length - 1 ? ' and ' : ', ');
      names.push(one.you ? 'you' : this.nameNode(typeof one.number === 'number' ? one.number : null, one.name?.trim() || 'someone'));
    });
    const [day = '', ...rest] = whenLine(meeting, now, LOCALE, ZONE).split(' · ');
    return [
      el('section', { class: 't-meet', 'aria-label': 'Meeting', 'data-when': stateOf(meeting, now, ZONE) }, [
        el('span', { class: 't-meet-cal', 'aria-hidden': 'true' }, [
          el('small', {}, [noon.toLocaleDateString(LOCALE, { timeZone: 'UTC', month: 'short' })]),
          el('b', {}, [String(noon.getUTCDate())]),
        ]),
        el('span', { class: 't-meet-when' }, [day, ...rest.map((part) => el('span', {}, [` · ${part}`]))]),
        el('span', { class: 't-meet-with' }, people.length === 0 ? ['No one added yet'] : ['With ', ...names]),
        ...(this.member ? [] : [el('button', { type: 'button', class: 't-btn t-meet-act', 'data-act': 'meeting' }, ['Change ', kbd('B')])]),
      ]),
    ];
  }

  /** Opens the meeting editor for a thread, filled with its meeting, or tomorrow when it is none. @param {Thread} thread */
  openMeeting(thread) {
    if (this.member) return;
    const meeting = thread.meeting;
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const parts = meeting ? partsOf(meeting.when, ZONE) : { day: partsOf(tomorrow.toISOString(), ZONE).day, time: '' };
    this.meetingDraft = {
      number: thread.number,
      day: parts.day,
      time: parts.time,
      minutes: meeting?.minutes === null || meeting?.minutes === undefined ? '' : String(meeting.minutes),
      where: meeting?.where ?? '',
      chosen: (meeting?.attendees ?? []).flatMap((one) => (typeof one.number === 'number' ? [one.number] : [])),
      named: [],
      query: '',
      problem: '',
      busy: false,
    };
    this.renderMeeting();
    focusIn(this.dialog, '#meet-day');
  }

  /** The meeting editor, drawn from its draft. */
  renderMeeting() {
    const draft = this.meetingDraft;
    const thread = draft === null ? null : this.threads.get(draft.number);
    if (draft === null || !thread) return;
    const zone = new Intl.DateTimeFormat(LOCALE, { timeZoneName: 'long' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value ?? ZONE;
    const words = draft.query.trim().toLowerCase();
    const found = this.people.filter((one) => !draft.chosen.includes(one.number) && (words === '' || nameOf(one).toLowerCase().includes(words))).slice(0, PICKS);
    const exact = this.people.some((one) => nameOf(one).toLowerCase() === words) || draft.named.some((name) => name.toLowerCase() === words);
    const lengths = [['', 'Not said'], ...LENGTHS.map((minutes) => [String(minutes), lengthWords(minutes)])];
    /** @param {string} name @param {boolean} known @param {string} act @param {string} id */
    const chosenChip = (name, known, act, id) =>
      el('span', { class: 't-attendee' }, [
        el('span', { class: 't-av', 'aria-hidden': 'true' }, [initials(name)]),
        name,
        ...(known ? [] : [el('small', {}, ['someone new'])]),
        el('button', { type: 'button', 'data-act': act, 'data-id': id, 'aria-label': `Take ${name} off` }, [icon('x')]),
      ]);
    const chips = [
      ...draft.chosen.map((number) => {
        const someone = this.people.find((one) => one.number === number);
        const named = thread.meeting?.attendees.find((one) => one.number === number)?.name;
        return chosenChip(someone ? nameOf(someone) : named?.trim() || `Person #${number}`, true, 'meet-unchoose', String(number));
      }),
      ...draft.named.map((name, i) => chosenChip(name, false, 'meet-unname', String(i))),
    ];
    const day = el('input', { class: 't-field', type: 'date', id: 'meet-day', value: draft.day, required: '' });
    const time = el('input', { class: 't-field', type: 'time', id: 'meet-time', value: draft.time, step: '300' });
    const minutes = el(
      'select',
      { class: 't-field', id: 'meet-minutes' },
      lengths.map(([value = '', label = '']) => el('option', { value, ...(value === draft.minutes ? { selected: '' } : {}) }, [label])),
    );
    const where = el('input', { class: 't-field', id: 'meet-where', value: draft.where, maxlength: '200', placeholder: 'Google Meet', autocomplete: 'off' });
    const find = el('input', { class: 't-field', id: 'meet-find', value: draft.query, placeholder: 'Add a person: type a name', autocomplete: 'off', 'aria-label': 'Find a person to add' });
    const picks = [
      ...found.map((one, i) =>
        el('button', { type: 'button', class: 't-picker-item', 'data-act': 'meet-choose', 'data-person': String(one.number), 'aria-selected': String(i === 0 && words !== '') }, [
          this.personMark(one, false),
          el('span', {}, [nameOf(one)]),
          el('small', {}, [`#${one.number}${one.email === null ? ' · no address' : ''}`]),
        ]),
      ),
      ...(words !== '' && !exact
        ? [el('button', { type: 'button', class: 't-picker-item t-picker-new', 'data-act': 'meet-name' }, [icon('plus'), el('span', {}, [`Add “${draft.query.trim()}” as someone new`]), el('small', {}, ['no address'])])]
        : []),
    ];
    this.openOverlay('meeting', thread.meeting ? `Change the meeting on #${thread.number}` : `Make #${thread.number} a meeting`, 'wide', [
      this.sheetHead(thread.meeting ? `Change the meeting · #${thread.number}` : `Make it a meeting · #${thread.number}`),
      el('form', { class: 't-meet-form', 'data-submit': 'meeting' }, [
        el('div', { class: 't-sheet-body' }, [
          el('div', { class: 't-meet-time' }, [
            el('label', { class: 't-fld' }, [el('span', { class: 't-lbl' }, ['Day']), day]),
            el('label', { class: 't-fld' }, [el('span', { class: 't-lbl' }, ['Time ', el('small', {}, ['empty until it’s agreed'])]), time]),
            el('label', { class: 't-fld' }, [el('span', { class: 't-lbl' }, ['Length']), minutes]),
          ]),
          el('p', { class: 't-meet-zone' }, [draft.time ? `In your time, ${zone}. Everyone in the thread sees it in their own.` : 'A day with no time shows as “time not set” to everyone.']),
          el('label', { class: 't-fld' }, [el('span', { class: 't-lbl' }, ['Where ', el('small', {}, ['one line: a call, an office'])]), where]),
          el('div', { class: 't-fld' }, [
            el('span', { class: 't-lbl' }, ['Who will be there ', el('small', {}, ['besides you; this invites no one'])]),
            el('div', { class: 't-attendees' }, chips.length > 0 ? chips : [el('span', { class: 't-note' }, ['No one yet.'])]),
            el('div', { class: 't-picker' }, [find, el('div', { class: 't-picker-list', role: 'listbox', 'aria-label': 'People' }, picks)]),
          ]),
          ...(draft.problem ? [el('p', { class: 't-err', role: 'alert' }, [draft.problem])] : []),
        ]),
        el('div', { class: 't-sheet-foot' }, [
          ...(thread.meeting ? [el('button', { type: 'button', class: 't-btn t-btn-quiet', 'data-act': 'meet-clear' }, ['Clear meeting'])] : []),
          el('span', { class: 't-grow' }),
          el('button', { type: 'button', class: 't-btn t-btn-quiet', 'data-act': 'close' }, ['Cancel ', kbd('Esc')]),
          el('button', { type: 'submit', class: 't-btn t-btn-primary', ...(draft.busy ? { disabled: '' } : {}) }, ['Save ', kbd('⌘↵')]),
        ]),
      ]),
    ]);
  }

  /** Reads what the meeting editor holds into its draft. */
  readMeeting() {
    const draft = this.meetingDraft;
    if (draft === null) return;
    /** @param {string} id */
    const value = (id) => {
      const field = this.dialog.querySelector(`#${id}`);
      return field instanceof HTMLInputElement || field instanceof HTMLSelectElement ? field.value : '';
    };
    draft.day = value('meet-day');
    draft.time = value('meet-time');
    draft.minutes = value('meet-minutes');
    draft.where = value('meet-where');
    draft.query = value('meet-find');
  }

  /** Redraws the editor keeping the box being typed in and its cursor. @param {string} [focus] */
  redrawMeeting(focus) {
    const typing = document.activeElement;
    const id = focus ?? (typing instanceof HTMLInputElement && this.dialog.contains(typing) ? typing.id : '');
    const at = typing instanceof HTMLInputElement && typing.type === 'text' ? typing.selectionStart : null;
    this.renderMeeting();
    const again = id === '' ? null : this.dialog.querySelector(`#${id}`);
    if (again instanceof HTMLElement) {
      again.focus();
      if (again instanceof HTMLInputElement && again.type === 'text' && at !== null) again.setSelectionRange(at, at);
    }
  }

  /**
   * Saves the meeting editor: the when (the day alone, or the moment with his zone's offset that day), the length and
   * the where in one call, then each person added, named and taken off, in turn; the thread is read again after.
   */
  async saveMeeting() {
    this.readMeeting();
    const draft = this.meetingDraft;
    const thread = draft === null ? null : this.threads.get(draft.number);
    if (draft === null || !thread || draft.busy) return;
    const offset = draft.time === '' ? 0 : -new Date(`${draft.day}T${draft.time}`).getTimezoneOffset();
    const when = whenOf(draft.day, draft.time, offset);
    if (when === null) {
      draft.problem = 'Pick a day, and a time if one is agreed.';
      this.redrawMeeting('meet-day');
      return;
    }
    const before = (thread.meeting?.attendees ?? []).flatMap((one) => (typeof one.number === 'number' ? [one.number] : []));
    const changes = peopleChanges(before, draft.chosen, draft.named);
    draft.busy = true;
    draft.problem = '';
    this.redrawMeeting();
    const had = thread.meeting;
    const asked = { when, minutes: draft.minutes === '' ? null : Number(draft.minutes), where: draft.where.trim() === '' ? null : draft.where.trim() };
    // The when, length and where go only when one of them changed, so a change of people alone writes no meeting line.
    // A day compares as itself; a moment by its instant, since the Worker keeps it in UTC and the editor sends an offset.
    const sameWhen = had !== null && had !== undefined && (isDay(had.when) || isDay(when) ? had.when === when : Date.parse(had.when) === Date.parse(when));
    const same = sameWhen && had?.minutes === asked.minutes && had?.where === asked.where;
    try {
      let saved = same ? thread : await meet(thread.number, asked);
      for (const number of changes.add) saved = await attendee(thread.number, { add: { person: number } });
      for (const name of changes.named) saved = await attendee(thread.number, { add: { name } });
      for (const number of changes.remove) saved = await attendee(thread.number, { remove: number });
      this.remember(saved, { acted: true });
    } catch (error) {
      draft.busy = false;
      draft.problem = 'That didn’t all save. What did is on the thread; check it and try again.';
      await this.refreshShown(thread.number);
      this.redrawMeeting();
      this.fail(error, 'The meeting didn’t save.');
      return;
    }
    this.closeOverlay();
    this.clearProblem();
    // Someone new is a person now, so People and the picker know them.
    if (changes.named.length > 0) void this.loadPeople();
    await this.refreshShown(thread.number);
    this.say(had ? `Changed the meeting on #${thread.number}` : `#${thread.number} is a meeting`, null);
  }

  /** Clears the meeting, its people with it, with Undo that sets it back and adds the same people by number. */
  async clearMeeting() {
    const draft = this.meetingDraft;
    const thread = draft === null ? null : this.threads.get(draft.number);
    const had = thread?.meeting;
    if (!thread || !had) return;
    this.closeOverlay();
    try {
      this.remember(await meet(thread.number, { when: null, minutes: null, where: null }), { acted: true });
    } catch (error) {
      this.fail(error, 'The meeting wasn’t cleared.');
      return;
    }
    this.clearProblem();
    await this.refreshShown(thread.number);
    this.say(`Cleared the meeting on #${thread.number}`, async () => {
      try {
        let back = await meet(thread.number, { when: had.when, minutes: had.minutes, where: had.where });
        for (const one of had.attendees) if (typeof one.number === 'number') back = await attendee(thread.number, { add: { person: one.number } });
        this.remember(back, { acted: true });
        await this.refreshShown(thread.number);
        this.say('Undone', null);
      } catch (error) {
        this.fail(error, "The undo didn't save.");
      }
    });
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
   * The history and the comments, in the order they happened: each general comment with its replies, and one line
   * for each answer and each discussion on the page's words.
   * @param {Shown} shown
   * @param {Thread} thread
   * @param {Places} places
   */
  feed(shown, thread, places) {
    /** @type {{ at: string, order: number, node: HTMLElement }[]} */
    const entries = [];
    shown.events.forEach((event, i) => entries.push({ at: event.at, order: i, node: this.eventNode(event, thread) }));
    shown.comments.forEach((said, i) => {
      const order = shown.events.length + i;
      if (said.parent) return;
      // A dropped answer, like a dropped note, is drawn only on its drop's line, which can show it again.
      if (said.question) {
        if (said.state !== 'dropped') entries.push({ at: said.createdAt, order, node: this.answerLine(said, thread) });
      }
      else if (said.quote) {
        // Words this version no longer has keep their whole discussion here, marked with the version they were on.
        if (this.talk.anchors.get(said.id) === null || thread.main !== 'page') entries.push({ at: said.createdAt, order, node: this.goneDisc(said, places, thread) });
        else entries.push({ at: said.createdAt, order, node: this.wordsLine(said, places, thread) });
      } else for (const node of this.commentNode(said, thread, places)) entries.push({ at: said.createdAt, order, node });
    });
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
      case 'published':
        [name, words] = ['globe', ['made this public']];
        break;
      case 'unpublished':
        [name, words] = ['globe', ['made this no longer public']];
        break;
      case 'note-shown':
        [name, words] = ['check', ['showed ', this.visitorWordsOf(data.note), ' from ', word(data.name ?? 'someone')]];
        break;
      case 'note-dropped':
        [name, words] = ['x', ['dropped ', this.visitorWordsOf(data.note), ' from ', word(data.name ?? 'someone')]];
        break;
      case 'note-held':
        [name, words] = ['reopen', ['put a note from ', word(data.name ?? 'someone'), ' back to wait']];
        break;
      case 'meeting-set': {
        const from = meetingData(data.from);
        const to = meetingData(data.to);
        const now = Date.now();
        if (to === null) break;
        if (from === null) [name, words] = ['cal', ['made this a meeting for ', word(inSentence(momentWords(to.when, now, LOCALE, ZONE)))]];
        else if (from.when !== to.when) {
          [name, words] = ['cal', ['moved the meeting from ', word(inSentence(momentWords(from.when, now, LOCALE, ZONE))), ' to ', word(inSentence(momentWords(to.when, now, LOCALE, ZONE)))]];
        }
        else {
          const said = [lengthWords(to.minutes), to.where ?? ''].filter((part) => part !== '').join(' · ');
          [name, words] = ['cal', said === '' ? ['changed the meeting'] : ['changed the meeting: ', word(said)]];
        }
        break;
      }
      case 'meeting-cleared': {
        const from = meetingData(data.from);
        [name, words] = ['cal', ['cleared the meeting', ...(from ? [' for ', word(inSentence(momentWords(from.when, Date.now(), LOCALE, ZONE)))] : [])]];
        break;
      }
      case 'attendee-added':
        [name, words] = ['people', ['added ', word(data.name ?? 'someone'), ' to the meeting']];
        break;
      case 'attendee-removed':
        [name, words] = ['people', ['took ', word(data.name ?? 'someone'), ' off the meeting']];
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
    // A dropped note or answer is drawn nowhere else; the line of its latest drop can show its words and show it again.
    const latest = event.type === 'note-dropped' && this.shown?.events.findLast((one) => one.type === 'note-dropped' && one.data.note === data.note)?.id === event.id;
    const dropped = latest && !this.member ? this.shown?.comments.find((said) => said.id === data.note && said.state === 'dropped') : undefined;
    if (dropped) {
      const open = this.notesOpened.has(dropped.id);
      line.querySelector('.t-ev-text')?.append(
        ' · ',
        el('button', { type: 'button', class: 't-text-btn', 'data-act': 'note-peek', 'data-note': dropped.id, 'aria-expanded': String(open) }, [open ? 'Hide the words' : 'Show the words']),
      );
      if (open) {
        line.append(
          el('div', { class: 't-ev-before' }, [
            plain(dropped.body),
            el('button', { type: 'button', class: 't-text-btn', 'data-act': 'note-show', 'data-note': dropped.id }, ['Show it again']),
          ]),
        );
      }
    }
    return line;
  }

  /**
   * A comment: the owner's, the sync's, an invited person's, or a visitor's note on a public thread, whose words are
   * drawn as typed and which he may drop (Undo shows it again) or answer from his Gmail; a dropped one is drawn only on
   * its event's line. Given the thread's places, a comment that can have replies is followed by them, and by Reply or
   * its box.
   * @param {ThreadComment} said
   * @param {Thread} thread
   * @param {Places | null} [places]
   * @returns {HTMLElement[]}
   */
  commentNode(said, thread, places = null) {
    if (said.state === 'dropped') return [];
    const who = said.author === 'owner' ? 'owner' : said.author === 'member' ? 'member' : said.author === 'visitor' ? 'visitor' : 'sync';
    const name = who === 'member' || who === 'visitor' ? (said.name?.trim() || 'Someone') : this.actorName(said.author, thread);
    const onlyMe = said.audience === 'owner';
    const email = who === 'visitor' && !this.member && said.senderEmail ? [el('span', { class: 't-cm-from' }, [`${said.senderEmail} · only you see this`])] : [];
    return [
      el('div', { class: 't-cm', 'data-audience': said.audience }, [
        avatar(who, name),
        el('div', { class: 't-cm-box' }, [
          el('div', { class: 't-cm-head' }, [
            el('b', {}, [who === 'member' || who === 'visitor' ? this.nameNode(said.personNumber, name) : name]),
            ...(who === 'sync' ? [el('span', { class: 't-chip' }, ['Recorder sync'])] : []),
            ...(onlyMe ? [el('span', { class: 't-chip' }, [icon('lock'), 'Only me'])] : []),
            ...(said.audience === 'public' ? [publicChip()] : []),
            ...email,
            el('time', { datetime: said.createdAt }, [when(said.createdAt)]),
          ]),
          el('div', { class: 't-cm-body' }, [who === 'visitor' ? plain(said.body) : prose(said.body)]),
          ...(who === 'visitor' && !this.member ? [this.visitorActions(said, thread)] : []),
        ]),
      ]),
      ...(places && repliable(said) ? this.repliesOf(said, places, thread) : []),
    ];
  }

  /**
   * What he can do with a visitor's note: drop it (Undo shows it again), and reply from his own Gmail when they gave an
   * address.
   * @param {ThreadComment} said
   * @param {Thread} thread
   */
  visitorActions(said, thread) {
    const reply = said.senderEmail
      ? [
          el('a', { class: 't-btn t-btn-quiet', target: '_blank', rel: 'noopener', href: gmailLink(noteReply({ number: thread.number, title: titleOf(thread) }, { name: said.name, email: said.senderEmail, body: said.body }), this.me) }, [
            icon('mail'),
            'Reply by email',
          ]),
        ]
      : [];
    return el('div', { class: 't-cm-actions' }, [el('button', { type: 'button', class: 't-btn t-btn-quiet', 'data-act': 'note-drop', 'data-note': said.id }, ['Drop']), ...reply]);
  }

  /** "a note" or "an answer", as the history names a visitor's words by their id. @param {unknown} id */
  visitorWordsOf(id) {
    return this.shown?.comments.find((said) => said.id === id)?.question ? 'an answer' : 'a note';
  }

  /**
   * A comment's replies, oldest first, then the reply box when a reply is being written under it, else Reply.
   * @param {ThreadComment} said
   * @param {Places} places
   * @param {Thread} thread
   * @returns {HTMLElement[]}
   */
  repliesOf(said, places, thread) {
    const replies = places.replies.get(said.id) ?? [];
    const writing = this.replyingTo === said.id;
    const nodes = replies.flatMap((reply) => this.commentNode(reply, thread));
    return [
      ...(nodes.length > 0 || writing ? [el('div', { class: 't-replies' }, [...nodes, ...(writing ? [this.replyBox(said, 't-composer')] : [])])] : []),
      ...(writing ? [] : [el('button', { type: 'button', class: 't-reply-to', 'data-act': 'reply-open', 'data-id': said.id }, [icon('reply'), replies.length > 0 ? `Reply · ${replies.length}` : 'Reply'])]),
    ];
  }

  /**
   * The box a reply is written in, under the comment it answers: in a card beside the page, or in the history.
   * @param {ThreadComment} said
   * @param {'t-composer' | 't-disc-reply'} kind
   */
  replyBox(said, kind) {
    const onlyMe = said.audience === 'owner';
    const box = el('textarea', { id: 'reply-text', 'aria-label': 'Reply', placeholder: onlyMe ? 'Reply, for you alone' : 'Reply' }, [this.replyDrafts.get(said.id) ?? '']);
    const send = [
      el('button', { type: 'button', class: 't-btn t-btn-quiet', 'data-act': 'reply-cancel' }, ['Cancel']),
      el('button', { type: 'submit', class: 't-btn t-btn-primary' }, ['Reply ', kbd('⌘↵')]),
    ];
    const note = el('span', { class: 't-note' }, [onlyMe ? 'Only you and Claude read this reply.' : 'Everyone in the thread reads this reply.']);
    if (kind === 't-disc-reply') return el('form', { class: 't-disc-reply', 'data-submit': 'reply', 'data-parent': said.id }, [box, el('div', { class: 't-disc-bar' }, [note, ...send])]);
    return el('form', { class: 't-composer', 'data-submit': 'reply', 'data-parent': said.id, 'data-audience': said.audience }, [
      this.member ? avatar('member', this.me) : avatar('owner', ''),
      el('div', { class: 't-composer-box' }, [box, el('div', { class: 't-composer-bar' }, [note, ...send])]),
    ]);
  }

  /** Who wrote a comment, as a discussion card names them. @param {ThreadComment} said @param {Thread} thread */
  writerOf(said, thread) {
    if (said.mine) return 'You';
    if (said.author === 'member' || said.author === 'visitor') return said.name?.trim() || 'Someone';
    return this.actorName(said.author, thread);
  }

  /**
   * A discussion on the page's words: the words, the comment and its replies, then Reply or its box.
   * @param {ThreadComment} said
   * @param {Places} places
   * @param {Thread} thread
   */
  discCard(said, places, thread) {
    const replies = places.replies.get(said.id) ?? [];
    const writing = this.replyingTo === said.id;
    const message = (/** @type {ThreadComment} */ one) =>
      el('div', { class: 't-msg' }, [
        avatar(one.author === 'owner' ? 'owner' : 'member', one.name ?? ''),
        el('div', {}, [
          el('div', { class: 't-msg-head' }, [el('b', {}, [this.writerOf(one, thread)]), el('time', { datetime: one.createdAt }, [when(one.createdAt)])]),
          el('div', { class: 't-msg-body' }, [prose(one.body)]),
        ]),
      ]);
    const version = said.quote?.version;
    const shown = this.shownVersion();
    return el('div', { class: 't-disc', 'data-card': said.id, ...(this.activeDisc === said.id ? { 'aria-current': 'true' } : {}) }, [
      el('p', { class: 't-disc-quote' }, [
        el('q', {}, [said.quote?.text ?? '']),
        ...(version !== undefined && version !== shown ? [el('span', { class: 't-chip t-disc-old' }, [`version ${version}`])] : []),
      ]),
      message(said),
      ...replies.map(message),
      writing
        ? this.replyBox(said, 't-disc-reply')
        : el('div', { class: 't-disc-reply' }, [
            el('button', { type: 'button', class: 't-disc-open', 'data-act': 'reply-open', 'data-id': said.id }, [replies.length > 0 ? `Reply · ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : 'Reply']),
          ]),
    ]);
  }

  /** The comment being written on selected words, as a card. */
  draftCard() {
    return el('form', { class: 't-disc', 'data-card': DRAFT, 'data-submit': 'words', 'aria-current': 'true' }, [
      el('p', { class: 't-disc-quote' }, [el('q', {}, [this.wordsDraft?.quote.trim() ?? ''])]),
      el('div', { class: 't-disc-reply' }, [
        el('textarea', { id: 'words-text', 'aria-label': 'Comment on the selected words', placeholder: 'Comment on these words' }, [this.wordsText]),
        el('div', { class: 't-disc-bar' }, [
          el('span', { class: 't-note' }, ['Everyone in the thread reads this.']),
          el('button', { type: 'button', class: 't-btn t-btn-quiet', 'data-act': 'words-cancel' }, ['Cancel']),
          el('button', { type: 'submit', class: 't-btn t-btn-primary' }, ['Comment ', kbd('⌘↵')]),
        ]),
      ]),
    ]);
  }

  /**
   * The page's discussions under it, where there is no room beside it: every one whose words this version has.
   * @param {Places} places
   * @param {Thread} thread
   * @returns {HTMLElement[]}
   */
  pageDiscussions(places, thread) {
    const here = places.words.filter((said) => this.talk.anchors.get(said.id) !== null);
    if (here.length === 0 && this.wordsDraft === null) return [];
    return [
      el('section', { class: 't-page-discs', 'aria-label': 'Discussions on this page' }, [
        el('div', { class: 't-section-head' }, [el('h2', {}, ['Discussions on this page']), el('span', { class: 't-n' }, [String(here.length)]), el('span', { class: 't-hint' }, ['Tap underlined words to open theirs'])]),
        ...(this.wordsDraft && !this.pageFull ? [this.draftCard()] : []),
        ...here.map((said) => this.discCard(said, places, thread)),
      ]),
    ];
  }

  /**
   * A discussion whose words the version shown no longer has (or a thread that no longer shows its page): whole, in
   * the history, under a line that says so.
   * @param {ThreadComment} said
   * @param {Places} places
   * @param {Thread} thread
   */
  goneDisc(said, places, thread) {
    const version = said.quote?.version;
    const why = thread.main !== 'page' ? 'on words of the page' : `on words of version ${version ?? '?'} that this version no longer has`;
    return el('div', { class: 't-gone' }, [
      el('div', { class: 't-ev' }, [el('span', { class: 't-pip' }, [icon('doc')]), el('span', { class: 't-ev-text' }, [el('b', {}, [this.writerOf(said, thread)]), ` commented ${why}`]), el('time', { datetime: said.createdAt }, [when(said.createdAt)])]),
      this.discCard(said, places, thread),
    ]);
  }

  /**
   * One line in the history for a discussion on the page's words, with Show.
   * @param {ThreadComment} said
   * @param {Places} places
   * @param {Thread} thread
   */
  wordsLine(said, places, thread) {
    const replies = (places.replies.get(said.id) ?? []).length;
    return el('div', { class: 't-ev' }, [
      el('span', { class: 't-pip' }, [icon('doc')]),
      el('span', { class: 't-ev-text' }, [
        el('b', {}, [this.writerOf(said, thread)]),
        ' commented on ',
        el('span', { class: 't-ev-on' }, [`“${(said.quote?.text ?? '').trim()}”`]),
        ...(replies > 0 ? [` · ${replies} ${replies === 1 ? 'reply' : 'replies'}`] : []),
        ' ',
        el('button', { type: 'button', class: 't-text-btn', 'data-act': 'disc-show', 'data-id': said.id }, ['Show']),
      ]),
      el('time', { datetime: said.createdAt }, [when(said.createdAt)]),
    ]);
  }

  /**
   * One line in the history for an answer to the page's question: who, its words, Show, and for a visitor's, Drop.
   * @param {ThreadComment} said
   * @param {Thread} thread
   */
  answerLine(said, thread) {
    const words = said.body.length > 140 ? `${said.body.slice(0, 140).trimEnd()}…` : said.body;
    return el('div', { class: 't-ev' }, [
      el('span', { class: 't-pip' }, [icon('check')]),
      el('span', { class: 't-ev-text' }, [
        el('b', {}, [this.writerOf(said, thread)]),
        ' answered on the page ',
        el('span', { class: 't-ev-on' }, [`“${words}”`]),
        ...(thread.main === 'page' ? [' ', el('button', { type: 'button', class: 't-text-btn', 'data-act': 'answer-show', 'data-q': said.question ?? '' }, ['Show'])] : []),
        ...(said.author === 'visitor' && !this.member ? [' · ', el('button', { type: 'button', class: 't-text-btn', 'data-act': 'note-drop', 'data-note': said.id }, ['Drop'])] : []),
      ]),
      el('time', { datetime: said.createdAt }, [when(said.createdAt)]),
    ]);
  }

  /**
   * The audiences the comment box offers on a thread, the one it starts on first: on a public thread, Public, then the
   * people here (for the owner, only when it has people) and his Only me; elsewhere the thread and Only me, as before.
   * @param {Thread} thread
   * @returns {Audience[]}
   */
  audiences(thread) {
    if (this.member) return thread.publicAt ? ['public', 'thread'] : ['thread'];
    const people = (this.shown?.people ?? []).length > 0;
    if (thread.publicAt) return people ? ['public', 'thread', 'owner'] : ['public', 'owner'];
    return ['thread', 'owner'];
  }

  /** Who the comment being written is for: the writer's choice when the thread offers it, else its first. @param {Thread} thread */
  audienceOf(thread) {
    const offered = this.audiences(thread);
    return this.audience !== null && offered.includes(this.audience) ? this.audience : (offered[0] ?? 'thread');
  }

  /** @param {Thread} thread */
  composer(thread) {
    const draft = this.drafts.get(thread.number) ?? '';
    const audience = this.audienceOf(thread);
    const onlyMe = audience === 'owner';
    const box = this.commentPreview
      ? el('div', { class: 't-preview-pane', id: 'comment-preview' }, [draft.trim() === '' ? el('span', { class: 't-note' }, ['Nothing to preview.']) : prose(draft)])
      : el('textarea', {
          id: 'comment-text',
          'aria-label': 'Comment',
          placeholder: onlyMe ? 'A note for you alone. Markdown works.' : audience === 'public' ? 'A comment anyone can read. Markdown works.' : 'Comment. Markdown works.',
        }, [draft]);
    const others = (this.shown?.people ?? []).filter((person) => !person.owner).map((person) => person.name ?? 'someone');
    const note =
      audience === 'public'
        ? 'Anyone can read this.'
        : this.member
          ? 'Suresh and everyone in this thread read this.'
          : onlyMe
            ? 'Only you and Claude read this.'
            : others.length > 0
              ? `${listed(others)} read${others.length === 1 ? 's' : ''} this too.`
              : 'Only you read this thread.';
    /** @type {Record<Audience, (Node | string)[]>} */
    const labels = {
      public: [icon('globe'), ' Public'],
      thread: [thread.publicAt ? 'People here' : 'Thread'],
      owner: [icon('lock'), ' Only me'],
    };
    const offered = this.audiences(thread);
    const choice =
      offered.length > 1
        ? [
            el(
              'span',
              { class: 't-seg', role: 'group', 'aria-label': 'Who reads it' },
              offered.map((one) => el('button', { type: 'button', 'data-act': 'audience', 'data-audience': one, 'aria-pressed': String(audience === one) }, labels[one])),
            ),
          ]
        : [];
    return el('form', { class: 't-composer', 'data-submit': 'comment', 'data-audience': audience }, [
      this.member ? avatar('member', this.me) : avatar('owner', ''),
      el('div', { class: 't-composer-box' }, [
        box,
        el('div', { class: 't-composer-bar' }, [
          el('span', { class: 't-note' }, [note]),
          ...choice,
          el('span', { class: 't-seg', role: 'group', 'aria-label': 'Comment view' }, [
            el('button', { type: 'button', 'data-act': 'comment-view', 'data-view': 'write', 'aria-pressed': String(!this.commentPreview) }, ['Write']),
            el('button', { type: 'button', 'data-act': 'comment-view', 'data-view': 'preview', 'aria-pressed': String(this.commentPreview) }, ['Preview']),
          ]),
          el('button', { type: 'submit', class: 't-btn t-btn-primary' }, ['Comment ', kbd('⌘↵')]),
        ]),
      ]),
    ]);
  }

  /**
   * A person's name as a link to their page, for the owner; plain words for an invited person, and for a name that
   * names no person (a visitor who gave no address).
   * @param {number | null | undefined} number
   * @param {string} name
   * @returns {Node | string}
   */
  nameNode(number, name) {
    if (this.member || typeof number !== 'number') return name;
    const known = this.people.find((one) => one.number === number);
    return el('a', { class: 't-name-link', href: known ? personPath(known) : `${PEOPLE}/${number}`, 'data-person': String(number) }, [name]);
  }

  /** Who a thread is from, as the details column's Started row says it, the name opening their page. @param {Thread} thread */
  fromNodes(thread) {
    const name = thread.senderName?.trim();
    if (thread.source === 'talk') return [this.nameNode(thread.senderNumber, name || 'Someone'), ' · from the site'];
    if (thread.source === 'told') return ['told to you by ', this.nameNode(thread.senderNumber, name || 'someone')];
    return [fromWords(thread)];
  }

  /** A person's round mark: their initials, dashed while they have no address. @param {Someone} someone @param {boolean} large */
  personMark(someone, large) {
    const letters = initials(nameOf(someone));
    if (large) return someone.email === null ? el('span', { class: 't-av t-av-lg t-av-faint', 'aria-hidden': 'true' }, [letters]) : el('span', { class: 't-av t-av-lg', 'aria-hidden': 'true' }, [letters]);
    return someone.email === null ? el('span', { class: 't-av t-av-faint', 'aria-hidden': 'true' }, [letters]) : el('span', { class: 't-av', 'aria-hidden': 'true' }, [letters]);
  }

  /** Everyone, whoever was last in touch first; those only in threads he dropped fold away. */
  peopleView() {
    const { live, dropped } = folded(this.people);
    /** @param {Someone} someone */
    const rowOf = (someone) =>
      el('a', { class: 't-row t-row-person', href: personPath(someone), 'data-person': String(someone.number) }, [
        this.personMark(someone, false),
        el('span', { class: 't-row-main' }, [
          el('span', { class: 't-row-name' }, [el('b', {}, [nameOf(someone)]), el('small', {}, [someone.name?.trim() ? (someone.email ?? 'no address') : ''])]),
          el('span', { class: 't-row-sub' }, [howLine(someone.counts)]),
        ]),
        el('span', { class: 't-row-meta' }, [
          ...(someone.invited ? [el('span', { class: 't-people-mark', title: 'Invited to a thread' }, [icon('people')])] : []),
          el('span', {}, [ago(someone.lastContact)]),
        ]),
      ]);
    const fold = el('button', { type: 'button', class: 't-fold', 'data-act': 'people-fold', 'aria-expanded': String(this.peopleFold) }, [
      icon('down'),
      `Only in dropped threads (${dropped.length})`,
    ]);
    return el('div', { class: 't-wrap' }, [
      el('div', { class: 't-head' }, [el('div', {}, [el('h1', {}, ['People']), el('p', {}, ['Everyone you deal with, whoever was last in touch first.'])])]),
      el('section', { class: 't-section' }, [
        el('div', { class: 't-section-head' }, [el('h2', {}, ['Everyone']), el('span', { class: 't-n' }, [String(live.length)])]),
        el('div', { class: 't-list' }, [
          ...(live.length > 0 ? live.map(rowOf) : [el('div', { class: 't-empty' }, ['Nobody yet. People arrive with the threads: a note from the site, an invite, or something someone told you.'])]),
          ...(dropped.length > 0 ? [fold, ...(this.peopleFold ? [el('div', { class: 't-fold-rows' }, dropped.map(rowOf))] : [])] : []),
        ]),
      ]),
      el('p', { class: 't-note' }, ["People come from the threads: you invite them, they write to you, or the recorder hears that they told you something. There's no new person button."]),
    ]);
  }

  /** A person's page: who they are, every thread they are in and how, what they said, and his notes on them. */
  personView() {
    if (this.person === null) {
      return el('div', { class: 't-wrap' }, [
        el('div', { class: 't-missing' }, [
          el('h1', {}, [this.personMissing !== null ? 'Nothing here' : 'Loading…']),
          el('p', {}, [this.personMissing !== null ? `There's no person #${this.personMissing}.` : '']),
          el('a', { href: PEOPLE, 'data-go': 'people' }, ['Back to People']),
        ]),
      ]);
    }
    const { person, threads, words, truncated } = this.person;
    const name = nameOf(person);
    const first = name.split(/\s+/)[0] ?? name;
    const crumbs = el('div', { class: 't-crumbs' }, [
      el('a', { href: PEOPLE, 'data-go': 'people' }, ['People']),
      el('span', {}, ['/']),
      el('span', {}, [`#${person.number}`]),
      ...(person.invited ? [el('span', { class: 't-chip' }, [icon('people'), 'Invited'])] : []),
      el('span', { class: 't-pager' }, [el('button', { type: 'button', 'data-act': 'back', 'aria-label': 'Back to People (Esc)' }, [icon('x')])]),
    ]);
    const title =
      this.personEdit === 'name'
        ? el('form', { class: 't-person-rename', 'data-submit': 'person-name' }, [
            el('input', { class: 't-field', id: 'person-name', value: person.name ?? '', maxlength: '80', autocomplete: 'off', 'aria-label': 'Name' }),
          ])
        : el('h1', {}, [name, el('button', { type: 'button', class: 't-btn t-btn-quiet', 'data-act': 'person-rename', 'aria-label': 'Rename (W)' }, [icon('pen'), kbd('W')])]);
    const head = el('header', { class: 't-person-head' }, [
      crumbs,
      el('div', { class: 't-person-id' }, [
        this.personMark(person, true),
        el('div', {}, [title, el('div', { class: 't-person-sub' }, [el('span', {}, [addressLine(person)]), el('span', {}, [howLine(person.counts)])])]),
      ]),
    ]);
    const rows = threads.map((thread) => this.row(thread, roleLine(thread.roles), false));
    const met = split(
      threads.filter((thread) => thread.roles.includes('met')),
      (thread) => thread.meeting ?? null,
      Date.now(),
      ZONE,
    );
    const meetingRows = [...met.coming, ...met.past].map((thread) => this.meetingRow(thread));
    const said = words.map((word) => {
      const number = word.thread.number;
      const known = this.threads.get(number);
      const chip =
        word.kind === 'note'
          ? el('span', { class: 't-chip' }, ['From the site'])
          : word.state === 'dropped'
            ? el('span', { class: 't-chip' }, ['Dropped'])
            : word.audience === 'public'
              ? publicChip()
              : el('span', { class: 't-chip' }, [icon('people'), 'People here']);
      const on = el('a', { class: 't-said-on', href: `/threads/${number}`, 'data-thread': String(number) }, [
        'on ',
        el('b', {}, [`#${number}`]),
        el('span', {}, [known ? titleOf(known) : (word.thread.title ?? '')]),
      ]);
      return el('div', { class: 't-cm' }, [
        el('div', { class: 't-cm-box' }, [
          el('div', { class: 't-cm-head' }, [on, chip, el('time', { datetime: word.at }, [when(word.at)])]),
          el('div', { class: 't-cm-body' }, [word.kind === 'comment' ? prose(word.body) : plain(word.body)]),
        ]),
      ]);
    });
    /** @param {string} label @param {(Node | string)[]} value */
    const row = (label, value) => el('div', { class: 't-drow' }, [el('span', { class: 't-dlabel' }, [label]), ...value]);
    return el('div', { class: 't-person' }, [
      head,
      el('div', { class: 't-person-main' }, [
        ...(meetingRows.length > 0
          ? [
              el('section', { class: 't-section' }, [
                el('div', { class: 't-section-head' }, [el('h2', {}, ['Meetings']), el('span', { class: 't-n' }, [String(meetingRows.length)]), el('span', { class: 't-hint' }, ['coming first, soonest first; then past'])]),
                el('div', { class: 't-list' }, meetingRows),
              ]),
            ]
          : []),
        el('section', { class: 't-section' }, [
          el('div', { class: 't-section-head' }, [el('h2', {}, ['Threads']), el('span', { class: 't-n' }, [String(threads.length)]), el('span', { class: 't-hint' }, ["how they're in each"])]),
          el('div', { class: 't-list' }, rows.length > 0 ? rows : [el('div', { class: 't-empty' }, ['No threads yet.'])]),
        ]),
        el('section', { class: 't-section' }, [
          el('div', { class: 't-section-head' }, [el('h2', {}, ['What they said']), el('span', { class: 't-n' }, [String(words.length)]), el('span', { class: 't-hint' }, ['newest first'])]),
          el('div', { class: 't-said' }, said.length > 0 ? said : [el('p', { class: 't-note' }, [`Nothing in ${first}'s own words yet. What they told you is in the threads above, in yours.`])]),
        ]),
        ...(truncated ? [el('p', { class: 't-note' }, ['Only the newest 200 threads and words are shown.'])] : []),
      ]),
      el('div', { class: 't-person-side' }, [
        this.notesBox(person, first),
        ...(person.email === null ? [this.addressForm()] : []),
        el('aside', { class: 't-details', 'aria-label': `About ${name}` }, [
          row('Their page', [el('span', { class: 't-linkline' }, [`whysosuresh.com${personPath(person)}`])]),
          row('First in touch', [el('span', { class: 't-dval t-dval-soft' }, [when(person.createdAt)])]),
          row('Last in touch', [el('span', { class: 't-dval t-dval-soft' }, [`${ago(person.lastContact)} ago`])]),
        ]),
      ]),
    ]);
  }

  /**
   * His notes on a person, which only he reads: drawn as Markdown, and a box to write in once he clicks them.
   * @param {Someone} person
   * @param {string} first
   */
  notesBox(person, first) {
    const head = el('div', { class: 't-mine-head' }, [el('span', {}, [`Your notes on ${first}`]), el('span', { class: 't-chip' }, [icon('lock'), 'Only you'])]);
    if (this.personEdit === 'note') {
      return el('form', { class: 't-mine', 'data-submit': 'person-note', 'aria-label': `Your notes on ${first}` }, [
        head,
        el('textarea', { id: 'person-note', 'aria-label': `Your notes on ${first}`, placeholder: 'How you know them, what they care about, what you owe them. Markdown works.' }, [this.personDraft ?? person.note ?? '']),
        el('div', { class: 't-mine-bar' }, [el('span', { class: 't-note' }, ['Saved when you leave the box']), el('button', { type: 'submit', class: 't-btn t-btn-primary' }, ['Save ', kbd('⌘↵')])]),
      ]);
    }
    return el('section', { class: 't-mine', 'aria-label': `Your notes on ${first}` }, [
      head,
      el('div', { class: 't-mine-body', role: 'button', tabindex: '0', 'data-act': 'person-note', 'aria-label': `Edit your notes on ${first}` }, [
        person.note ? prose(person.note) : el('span', { class: 't-mine-empty' }, [`Nothing yet. Write how you know ${first}, what they care about, what you owe them.`]),
      ]),
    ]);
  }

  /** Adding an address to a person who has none: once, never one another person holds. */
  addressForm() {
    const problem = this.personProblem;
    /** @type {(Node | string)[]} */
    const said =
      problem === null
        ? []
        : 'text' in problem
          ? [problem.text]
          : [takenLine(problem.email, problem.holder), ' ', this.nameNode(problem.holder.number, `Open ${nameOf(problem.holder)}`)];
    return el('form', { class: 't-addr', 'data-submit': 'person-email' }, [
      el('label', { class: 't-lbl', for: 'person-email' }, ['Add their email', el('small', {}, ['Once. An invite to this address then lands on this person.'])]),
      el('div', { class: 't-addr-row' }, [
        el('input', { class: 't-field', id: 'person-email', type: 'email', autocomplete: 'off', placeholder: 'name@example.com', value: this.personAddress }),
        el('button', { type: 'submit', class: 't-btn' }, ['Add']),
      ]),
      ...(said.length > 0 ? [el('p', { class: 't-err', role: 'alert' }, said)] : []),
    ]);
  }

  /** Starts changing a person's notes or name, the box focused with its text. @param {'note' | 'name'} what */
  startPersonEdit(what) {
    if (this.person === null) return;
    this.personEdit = what;
    this.personDraft = null;
    this.keepScroll = true;
    this.render();
    const box = this.main.querySelector(what === 'note' ? '#person-note' : '#person-name');
    if (box instanceof HTMLTextAreaElement || box instanceof HTMLInputElement) {
      box.focus();
      if (what === 'name') box.select();
      else box.setSelectionRange(box.value.length, box.value.length);
    }
  }

  /**
   * Saves a change to a person, shown at once and put back with a line when the server refuses it; the toast offers
   * `undo`, the change that puts it back, when there is one.
   * @param {Someone} person
   * @param {PersonChange} change
   * @param {string} said
   * @param {PersonChange | null} undo
   */
  async changePerson(person, change, said, undo) {
    const before = this.person;
    if (this.person?.person.number === person.number) {
      const shown = 'note' in change ? { ...person, note: change.note === '' ? null : change.note } : 'name' in change ? { ...person, name: change.name } : person;
      this.person = { ...this.person, person: shown };
    }
    this.keepScroll = true;
    this.render();
    try {
      this.rememberPerson(await editPerson(person.number, change));
    } catch (error) {
      this.person = before;
      this.keepScroll = true;
      this.render();
      this.fail(error, "That change wasn't saved.");
      return;
    }
    this.keepScroll = true;
    this.render();
    const saved = this.person?.person;
    this.say(said, undo === null || !saved ? null : async () => this.changePerson(saved, undo, 'Undone', null));
  }

  async savePersonNote() {
    const person = this.person?.person;
    if (this.personEdit !== 'note' || !person) return;
    const box = this.main.querySelector('#person-note');
    const text = box instanceof HTMLTextAreaElement ? box.value.trim() : (this.personDraft ?? '').trim();
    this.personEdit = null;
    this.personDraft = null;
    const before = person.note ?? '';
    if (text === before) {
      this.keepScroll = true;
      this.render();
      return;
    }
    await this.changePerson(person, { note: text }, `Saved your notes on ${nameOf(person)}.`, { note: before });
  }

  async savePersonName() {
    const person = this.person?.person;
    if (this.personEdit !== 'name' || !person) return;
    const box = this.main.querySelector('#person-name');
    const name = box instanceof HTMLInputElement ? box.value.trim() : '';
    this.personEdit = null;
    if (name === '' || name === (person.name ?? '')) {
      this.keepScroll = true;
      this.render();
      return;
    }
    if (name.length > 80) {
      this.keepScroll = true;
      this.render();
      this.say('Keep the name to one short line.', null);
      return;
    }
    await this.changePerson(person, { name }, `Renamed to ${name}. Threads and their history keep the name they were written with.`, person.name ? { name: person.name } : null);
  }

  async savePersonEmail() {
    const person = this.person?.person;
    if (!person || person.email !== null) return;
    const typed = this.personAddress;
    const email = addressOf(typed);
    const problem = !isAddress(typed) ? "That isn't an email address." : this.me !== '' && email === this.me.toLowerCase() ? "That's your own address. No person can hold it." : null;
    if (problem === null) {
      try {
        this.rememberPerson(await editPerson(person.number, { email }));
        this.personAddress = '';
        this.personProblem = null;
        this.keepScroll = true;
        this.render();
        this.say(`${nameOf(person)}'s address is ${email}. An invite to it now lands on this person.`, null);
        return;
      } catch (error) {
        if (!(error instanceof Failed) || (error.message !== 'email-taken' && error.message !== 'has-email')) {
          this.fail(error, "The address wasn't added.");
          return;
        }
        const detail = /** @type {{ number?: unknown }} */ (error.detail ?? {});
        const number = typeof detail.number === 'number' ? detail.number : null;
        const holder = number === null ? null : (this.people.find((one) => one.number === number) ?? { number, name: null, email });
        this.personProblem = holder === null ? { text: takenLine(email, null) } : { email, holder };
      }
    } else this.personProblem = { text: problem };
    this.keepScroll = true;
    this.render();
    focusIn(this.main, '#person-email');
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
      row('Who can see it', [this.level(thread), el('span', {}, [el('button', { type: 'button', class: 't-text-btn', 'data-act': 'share' }, ['Share…'])])]),
      row('Started', [el('span', { class: 't-dval t-dval-soft' }, [`${when(thread.createdAt)}, `, ...this.fromNodes(thread)])]),
      row('Last activity', [el('span', { class: 't-dval t-dval-soft' }, [`${ago(thread.activityAt)} ago`])]),
      ...(origin ? [row('Moved from', [el('a', { class: 't-linkline', href: origin.href, target: '_blank', rel: 'noopener' }, [origin.name])], true)] : []),
      ...(issue ? [row('Filed as', [el('a', { class: 't-linkline', href: issue.href, target: '_blank', rel: 'noopener' }, [issue.name])], true)] : []),
      row(
        'People',
        [
          (this.shown?.people ?? []).length === 0
            ? el('span', { class: 't-dval t-dval-soft' }, ['Only you'])
            : el('span', { class: 't-dpeople' }, (this.shown?.people ?? []).map((person) => el('span', {}, [this.nameNode(person.number, person.name ?? 'Someone'), ' ', el('small', {}, [person.email ?? ''])]))),
          el('span', {}, [el('button', { type: 'button', class: 't-text-btn', 'data-act': 'share' }, ['Share…'])]),
        ],
        true,
      ),
      row('Link', [el('span', { class: 't-linkline' }, [address]), el('span', {}, [el('button', { type: 'button', class: 't-text-btn', 'data-act': 'copy-link' }, ['Copy link'])])], true),
    ]);
  }

  /** Who can see a thread: Public, Invited or Private, with its mark. @param {Thread} thread */
  level(thread) {
    const level = levelOf(thread.publicAt, this.member ? 1 : (this.shown?.people ?? []).length);
    return el('span', { class: 't-dval' }, [el('span', { class: 't-level' }, [icon(level === 'Public' ? 'globe' : level === 'Invited' ? 'people' : 'lock'), level])]);
  }

  /** The details beside a thread, as an invited person sees them: where it stands, its people by name, its link. @param {Thread} thread */
  memberDetails(thread) {
    /** @param {string} label @param {(Node | string)[]} value @param {boolean} [wide] */
    const row = (label, value, wide = false) => el('div', { class: 't-drow', ...(wide ? { 'data-wide': '' } : {}) }, [el('span', { class: 't-dlabel' }, [label]), ...value]);
    const address = `whysosuresh.com/threads/${thread.number}`;
    return el('aside', { class: 't-details', 'aria-label': 'About this thread' }, [
      row('Where it stands', [el('span', { class: 't-dval' }, [STATUS_NAMES[thread.status]])]),
      ...(thread.publicAt ? [row('Who can see it', [this.level(thread)])] : []),
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
   * @param {'narrow' | 'wide' | 'find' | 'form' | 'drawer'} kind
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
            ? 'Phones have no keys: the bar along the bottom holds your threads, your meetings and Find.'
            : 'Phones have no keys: every move is a button on the thread, and the bar along the bottom holds Today, Threads, Find, New and More (People, Meetings).',
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
          { label: 'Go to your meetings', hay: 'meetings calendar when', key: '', run: () => void this.go({ view: 'meetings' }) },
          { label: 'Show the keys', hay: 'keys keyboard shortcuts help', key: '?', run: () => this.openKeys() },
        ]
      : [
          { label: 'Go to Today', hay: 'today', key: '', run: () => void this.go({ view: 'today' }) },
          { label: 'Go to Threads', hay: 'threads all list', key: '', run: () => void this.go({ view: 'list', tab: this.tab, space: null }) },
          { label: 'Go to people', hay: 'people person everyone who', key: '', run: () => void this.go({ view: 'people' }) },
          { label: 'Go to Meetings', hay: 'meetings calendar when', key: '', run: () => void this.go({ view: 'meetings' }) },
          { label: 'New thread', hay: 'new thread start create', key: 'N', run: () => this.openNew({ title: words !== '' && !/^#?\d+$/.test(words) ? words : '' }) },
          { label: 'Show the keys', hay: 'keys keyboard shortcuts help', key: '?', run: () => this.openKeys() },
        ];
    return actions
      .filter((action) => query === '' || action.hay.includes(query) || action.label.toLowerCase().includes(query))
      .map((action) => ({ label: action.label, sub: '', side: action.key, number: null, person: null, run: action.run }));
  }

  /** Searches for the words after a short pause; nothing typed shows the five most recently active. @param {string} words */
  findFor(words) {
    const trimmed = words.trim();
    clearTimeout(this.findTimer);
    const ticket = ++this.findTicket;
    if (trimmed === '') {
      const recent = [...this.threads.values()].sort((a, b) => b.activityAt.localeCompare(a.activityAt)).slice(0, 5);
      this.showFound(trimmed, recent, 'Recent', []);
      return;
    }
    this.findTimer = setTimeout(() => {
      search(trimmed).then(
        (found) => {
          if (ticket === this.findTicket && this.overlay === 'find') this.showFound(trimmed, found.threads, 'Threads', found.people);
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
   * @param {Someone[]} people
   */
  showFound(words, threads, group, people) {
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
      ...people.map((someone) => ({
        label: nameOf(someone),
        sub: someone.name?.trim() ? (someone.email ?? 'no address') : howLine(someone.counts),
        side: `#${someone.number}`,
        number: null,
        person: someone.number,
        run: () => void this.go({ view: 'person', number: someone.number }),
      })),
      ...threads.map((thread) => ({ label: titleOf(thread), sub: snippet(thread), side: ago(thread.activityAt), number: thread.number, person: null, run: () => this.openThread(thread.number) })),
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
      const heading = item.person !== null ? 'People' : item.number === null ? 'Do' : group;
      if (heading !== last) nodes.push(el('div', { class: 't-find-group', role: 'presentation' }, [(last = heading)]));
      nodes.push(
        el('button', { type: 'button', class: 't-find-item', role: 'option', id: `find-${i}`, 'data-act': 'found', 'data-index': String(i), 'aria-selected': String(i === 0) }, [
          item.person !== null
            ? el('span', { class: 't-num' }, [el('span', { class: 't-av', 'aria-hidden': 'true' }, [initials(item.label)])])
            : el('span', { class: 't-num' }, item.number === null ? [icon(item.label.startsWith('New') ? 'plus' : item.label.startsWith('Show') ? 'keys' : 'move')] : [`#${item.number}`]),
          el('span', { class: 't-find-text' }, [el('span', {}, marked(item.label)), ...(item.sub ? [el('small', {}, marked(item.sub))] : [])]),
          el('span', { class: 't-find-side' }, item.side.length === 1 ? [kbd(item.side)] : [item.side]),
        ]),
      );
    });
    if (threads.length === 0 && people.length === 0 && words.trim() !== '') {
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
    const audience = this.audienceOf(thread);
    const onlyMe = audience === 'owner';
    try {
      await comment(thread.number, text, audience);
    } catch (error) {
      this.fail(error, "The comment didn't save. It is still in the box.");
      return;
    }
    this.drafts.delete(thread.number);
    this.commentPreview = false;
    this.audience = null;
    this.clearProblem();
    this.touchThread(thread.number);
    await this.refreshShown(thread.number);
    this.main.scrollTo({ top: this.main.scrollHeight });
    this.say(onlyMe ? `Noted on #${thread.number}, for you alone` : audience === 'public' ? `Commented on #${thread.number}, for anyone` : `Commented on #${thread.number}`, null);
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
    // Invited people read the comments for the thread or for anyone that are shown, never a note waiting or dropped.
    const lines = seesLines(comments.filter((said) => said.audience !== 'owner' && said.state === 'shown').length, comments.filter((said) => said.audience === 'owner').length);
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
        this.publicSwitch(thread),
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

  /**
   * Share's one switch: the thread is public, or not. Off and disabled, with the reason, for words that aren't his.
   * @param {Thread} thread
   */
  publicSwitch(thread) {
    const on = thread.publicAt !== null;
    const said = publicLines(thread.number, thread.source, on);
    return el('div', { class: 't-switch-row', ...(said.allowed ? {} : { 'aria-disabled': 'true' }) }, [
      el('b', { id: 'public-label' }, [icon('globe'), ' ', said.label]),
      el('button', {
        type: 'button',
        class: 't-switch',
        role: 'switch',
        'aria-checked': String(on),
        'aria-labelledby': 'public-label',
        'aria-describedby': 'public-note',
        'data-act': 'public',
        ...(said.allowed ? {} : { disabled: '' }),
      }),
      el('small', { id: 'public-note' }, [said.note]),
      ...(on && thread.main === 'page'
        ? [
            el('div', { class: 't-full-link' }, [
              el('span', {}, [el('b', {}, ['Full-screen link, for answering']), ' · the page alone, with their name on top']),
              el('button', { type: 'button', class: 't-btn', 'data-act': 'copy-full-link' }, ['Copy full-screen link']),
            ]),
          ]
        : []),
    ]);
  }

  /**
   * Makes a thread public or not, from Share: shown at once and saved behind it, put back if refused, with Undo. The
   * sheet stays open.
   * @param {Thread} thread
   */
  async togglePublic(thread) {
    /** @type {Action} */
    const action = { action: thread.publicAt === null ? 'publish' : 'unpublish' };
    const predicted = predict(thread, action);
    this.threads.set(thread.number, { ...predicted, shared: thread.shared ?? 0 });
    if (this.shown?.thread.number === thread.number) this.shown = { ...this.shown, thread: predicted };
    this.keepScroll = true;
    this.render();
    this.renderShare();
    /** @type {Thread} */
    let saved;
    try {
      saved = await move(thread.number, action);
    } catch (error) {
      this.threads.set(thread.number, thread);
      if (this.shown?.thread.number === thread.number) this.shown = { ...this.shown, thread };
      this.keepScroll = true;
      this.render();
      this.renderShare();
      this.fail(error, `That didn't save, so #${thread.number} is as it was.`);
      return;
    }
    this.remember(saved, { acted: true });
    this.clearProblem();
    await this.refreshShown(saved.number);
    this.renderShare();
    const back = inverse(thread, action);
    this.say(saidOf(thread, action), back === null ? null : async () => {
      await this.revert(saved, back);
      this.renderShare();
    });
  }

  /**
   * His ruling on a visitor's note or answer: dropped, or shown again, each undone by the other from the toast.
   * @param {Thread} thread
   * @param {string} note
   * @param {Judgement} action
   */
  async judgeNote(thread, note, action) {
    const what = this.visitorWordsOf(note) === 'an answer' ? 'answer' : 'note';
    try {
      await judge(thread.number, note, action);
    } catch (error) {
      this.fail(error, `That didn't save, so the ${what} is as it was.`);
      return;
    }
    this.clearProblem();
    this.notesOpened.delete(note);
    await this.refreshShown(thread.number);
    this.keepScroll = true;
    this.render();
    const said = action === 'show' ? `The ${what} is on the thread again, for anyone.` : `${what === 'answer' ? 'Answer' : 'Note'} dropped. Nobody else sees it.`;
    this.say(said, () => this.judgeNote(thread, note, action === 'show' ? 'drop' : 'show'));
  }

  /* ---------- The public view: a public thread, for anyone who isn't in it ---------- */

  /** Draws the public view of `publicShown`, its note form last. */
  renderPublic() {
    const shown = this.publicShown;
    if (shown === null) return;
    const thread = shown.thread;
    this.app.hidden = true;
    this.lost.hidden = true;
    this.pub.hidden = false;
    this.pubSignIn.hidden = !signedInBefore() || this.loaded;
    this.pubSignIn.href = signInAddress(location.pathname);
    const title = thread.title ?? `#${thread.number}`;
    document.title = `#${thread.number} ${title} · whysosuresh.com`;
    /** @type {HTMLElement[]} */
    let main = [];
    if (thread.main === 'page' && shown.page) main = [this.publicPage(thread.number, shown.page)];
    else if (thread.main === 'link' && thread.link) main = [linkCard(thread.link)];
    else if (thread.body !== null) main = [prose(thread.body)];
    // Answers sit under their questions in the page; the feed is the notes and the comments written for anyone.
    const comments = shown.comments.filter((said) => !said.question).map((said) => {
      const who = said.author === 'owner' ? 'owner' : said.author === 'member' ? 'member' : 'visitor';
      const name = who === 'owner' ? 'Suresh' : said.name?.trim() || 'Someone';
      return el('div', { class: 't-cm' }, [
        avatar(who, name),
        el('div', { class: 't-cm-box' }, [
          el('div', { class: 't-cm-head' }, [el('b', {}, [name]), el('time', { datetime: said.createdAt }, [day(said.createdAt)])]),
          el('div', { class: 't-cm-body' }, [who === 'visitor' ? plain(said.body) : prose(said.body)]),
        ]),
      ]);
    });
    const view = [
      el('div', { class: 't-crumbs' }, [el('span', {}, [spaceLabel(thread.space)]), el('span', {}, ['/']), el('span', {}, [`#${thread.number}`]), publicChip()]),
      el('h1', { class: 't-title' }, [el('span', { class: 't-tn' }, [`#${thread.number}`]), ' ', title]),
      el('div', { class: 't-byline' }, [el('span', {}, [el('b', {}, ['Suresh']), `, ${day(thread.createdAt)}`])]),
      ...(thread.summary ? [el('section', { class: 't-summary', 'aria-label': 'Summary' }, [el('div', { class: 't-summary-head' }, [el('span', {}, ['Summary'])]), summaryBody(thread.summary)])] : []),
      ...(this.answering() && !this.pageFull ? [this.answeringNode(false)] : []),
      ...main,
      ...(comments.length > 0 ? [el('div', { class: 't-feed' }, comments)] : []),
      ...(shown.truncated ? [el('p', { class: 't-note' }, ['Only the first 500 comments are shown.'])] : []),
      el('div', { 'data-note-area': '' }, [this.noteForm()]),
    ];
    const frame = this.pubDoc.querySelector('.t-page');
    const fresh = view.find((node) => node.classList.contains('t-page'));
    if (frame instanceof HTMLElement && frame.parentElement === this.pubDoc && fresh && frame.dataset.pageKey === fresh.dataset.pageKey) {
      // The frame already loaded stays where it is, and only its bar and what is around it are redrawn: moving a frame
      // in the document reloads its page, which would lose what the visitor typed and say `ready` again.
      const bar = fresh.querySelector('.t-page-bar');
      if (bar) frame.querySelector('.t-page-bar')?.replaceWith(bar);
      frame.dataset.full = fresh.dataset.full ?? 'false';
      const at = view.indexOf(fresh);
      for (const child of [...this.pubDoc.children]) if (child !== frame) child.remove();
      frame.before(...view.slice(0, at));
      frame.after(...view.slice(at + 1));
      return;
    }
    this.pubDoc.replaceChildren(...view);
  }

  /**
   * A public thread's page: its bar (the version shown, Versions, Full screen; no claude.ai address, which is his) over
   * its frame, from the public page address.
   * @param {number} number
   * @param {import('./threads-store.js').PublicPage} page
   */
  publicPage(number, page) {
    const version = this.pageVersions.get(number) ?? page.version;
    const shown = page.versions.find((one) => one.version === version) ?? page.versions[page.versions.length - 1];
    const at = shown?.version ?? page.version;
    // In full screen a page that asks questions puts the visitor's name in its bar, where they can see it.
    const naming = this.pageFull && this.answering();
    const bar = el('div', { class: 't-page-bar', ...(naming ? { 'data-answering': '' } : {}) }, [
      ...(naming
        ? [el('span', { class: 't-page-site' }, [el('b', {}, ['whysosuresh.com']), ` · #${number} ${this.publicShown?.thread.title ?? ''}`]), this.answeringNode(true)]
        : [icon('doc'), el('b', {}, ['Page']), el('span', {}, [`version ${at} of ${page.version} · saved ${shown ? day(shown.savedAt) : ''}`])]),
      el('span', { class: 't-grow' }),
      ...(page.versions.length > 1 && !naming ? [el('button', { type: 'button', class: 't-btn', 'data-act': 'public-versions' }, ['Versions'])] : []),
      el('button', { type: 'button', class: naming ? 't-text-btn' : 't-btn', 'data-act': 'page-full' }, [this.pageFull ? (naming ? 'Thread' : 'Back to thread') : 'Full screen']),
    ]);
    const frame = el('iframe', { class: 't-page-frame', sandbox: PAGE_SANDBOX, src: publicPageAddress(number, at), title: `Page, version ${at}`, loading: 'lazy' });
    return el('section', { class: 't-page', 'aria-label': 'Page', 'data-page-key': `${number}-${at}`, 'data-full': String(this.pageFull) }, [bar, frame]);
  }

  /** Whether the public page asks questions, so the visitor answers it: its frame said so. */
  answering() {
    return this.talk.ready && this.talk.questions.size > 0 && this.publicShown?.thread.main === 'page';
  }

  /**
   * Who answers the public page: the name box until they give a name, then "Answering as" with Change; above the page,
   * with what their answers do, or in full screen in the page's bar.
   * @param {boolean} full
   */
  answeringNode(full) {
    const visitor = this.visitor;
    const lines = [
      full
        ? "Type your name once, then answer in the box under each question. Your answers show on this page with your name, and other people's open under a question once you've given yours."
        : "Your answers show on this page with your name. Under each question, other people's answers open once you've given yours.",
      ...(visitor.kept ? [] : ["This browser won't keep your answers, so you can't change them after you leave."]),
    ];
    const hint = lines.length > 0 && (!full || visitor.naming || visitor.name === '') ? [el('span', { class: 't-answering-hint' }, [lines.join(' ')])] : [];
    if (!visitor.naming && visitor.name !== '') {
      return el('div', { class: 't-answering', 'data-full': String(full) }, [
        el('span', {}, ['Answering as ', el('b', {}, [visitor.name])]),
        el('button', { type: 'button', class: 't-text-btn', 'data-act': 'visitor-rename' }, ['Change']),
        ...hint,
      ]);
    }
    return el('div', { class: 't-answering', 'data-full': String(full) }, [
      el('label', { class: 't-answering-label', for: 'visitor-name' }, [full ? 'Answering as' : 'Your name']),
      el('input', {
        class: 't-field t-answering-field',
        id: 'visitor-name',
        autocomplete: 'name',
        maxlength: String(MAX_VISITOR_NAME),
        value: visitor.name,
        placeholder: full ? 'Your name' : 'Shown with your answers',
        ...(visitor.missing ? { 'aria-invalid': 'true' } : {}),
      }),
      el('button', { type: 'button', class: 't-btn', 'data-act': 'visitor-name' }, ['Done']),
      ...hint,
    ]);
  }

  /** "Send Suresh a note on this", or its Sent state. */
  noteForm() {
    const note = this.note;
    if (note.sent) {
      return el('section', { class: 't-noteform', 'aria-label': 'Send Suresh a note' }, [
        el('div', { class: 't-noteform-sent', role: 'status' }, [
          el('b', {}, [icon('check'), ' Sent']),
          el('p', {}, ["It's on the thread now, with your name. Your email stays with Suresh."]),
          el('button', { type: 'button', class: 't-text-btn', 'data-act': 'note-again' }, ['Send another']),
        ]),
      ]);
    }
    const count = note.body.trim().length;
    return el('form', { class: 't-noteform', 'data-submit': 'note', novalidate: '', 'aria-label': 'Send Suresh a note' }, [
      el('h2', {}, ['Send Suresh a note on this']),
      el('div', { class: 't-two' }, [
        el('label', { class: 't-fld' }, [el('span', { class: 't-lbl' }, ['Your name']), el('input', { class: 't-field', id: 'note-name', autocomplete: 'name', maxlength: '80', value: note.name || this.visitor.name })]),
        el('label', { class: 't-fld' }, [
          el('span', { class: 't-lbl' }, ['Email, if you want an answer']),
          el('input', { class: 't-field', id: 'note-email', type: 'email', autocomplete: 'email', maxlength: '200', value: note.email }),
        ]),
      ]),
      el('label', { class: 't-fld' }, [
        el('span', { class: 't-lbl' }, ['Your note', el('small', { 'data-note-count': '' }, [`${count} / ${MAX_NOTE}`])]),
        el('textarea', { class: 't-field', id: 'note-body', rows: '4', ...(note.problem === 'empty' ? { 'aria-invalid': 'true' } : {}) }, [note.body]),
      ]),
      ...(note.problem !== '' && note.problem !== 'empty' ? [el('p', { class: 't-err', role: 'alert' }, [note.problem])] : []),
      el('div', { class: 't-noteform-bar' }, [
        el('span', { class: 't-note' }, ['It shows here at once, with your name. Your email is never shown.']),
        el('button', { type: 'submit', class: 't-btn t-btn-primary', ...(note.busy ? { disabled: '' } : {}) }, [note.busy ? 'Sending…' : 'Send']),
      ]),
    ]);
  }

  /** Redraws the note form alone, so the thread above it, and its page, stay as they are. */
  renderNote() {
    this.pubDoc.querySelector('[data-note-area]')?.replaceChildren(this.noteForm());
  }

  /** Reads the note form's fields into its state. */
  readNote() {
    for (const [id, key] of /** @type {const} */ ([['note-name', 'name'], ['note-email', 'email'], ['note-body', 'body']])) {
      const field = this.pubDoc.querySelector(`#${id}`);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) this.note[key] = field.value;
    }
  }

  /** Sends the note on the public thread through the site's bot check; it shows at once. */
  async sendNote() {
    this.readNote();
    const shown = this.publicShown;
    const note = this.note;
    if (shown === null || note.busy) return;
    const body = note.body.trim();
    if (body === '') {
      this.note = { ...note, problem: 'empty' };
      this.renderNote();
      focusIn(this.pubDoc, '#note-body');
      return;
    }
    if (body.length > MAX_NOTE) {
      this.note = { ...note, problem: `Keep it to ${MAX_NOTE} characters.` };
      this.renderNote();
      return;
    }
    this.note = { ...note, busy: true, problem: '' };
    this.renderNote();
    try {
      await sendTo(`/api/threads/${shown.thread.number}/notes`, { body, name: note.name.trim(), email: note.email.trim() });
    } catch (error) {
      const reason = error instanceof Error && 'reason' in error ? error.reason : 'failed';
      const problem =
        reason === 'limit'
          ? "Today's limit for notes is reached. Your note is still here; try again tomorrow."
          : reason === 'gone'
            ? "This thread isn't public any more, so the note can't be sent."
            : "That didn't send. Your note is still here; try again.";
      this.note = { ...this.note, busy: false, problem };
      this.renderNote();
      return;
    }
    this.note = { name: note.name, email: note.email, body: '', sent: true, busy: false, problem: '' };
    await this.refreshPublic(shown.thread.number);
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
    if (!this.pub.hidden) {
      this.onPublicClick(target);
      return;
    }
    const link = target.closest('a[data-thread], a[data-go], a[data-space], a[data-tab], a[data-person]');
    if (link instanceof HTMLAnchorElement && !wantsNewTab(event)) {
      event.preventDefault();
      if (link.dataset.thread !== undefined) {
        if (this.route.view === 'person' && this.person) {
          this.from = 'person';
          this.fromPerson = this.person.person.number;
        } else if (link.classList.contains('t-row') || link.classList.contains('t-card')) {
          this.from = this.route.view === 'today' ? 'today' : this.route.view === 'list' ? 'list' : this.route.view === 'meetings' ? 'meetings' : this.from;
        }
        this.openThread(Number(link.dataset.thread));
      } else if (link.dataset.person !== undefined) void this.go({ view: 'person', number: Number(link.dataset.person) });
      else if (link.dataset.go === 'people') void this.go({ view: 'people' });
      else if (link.dataset.go === 'meetings') void this.go({ view: 'meetings' });
      else if (link.dataset.go === 'today') void this.go({ view: 'today' });
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
    // A card beside the page, clicked anywhere but its controls, is the discussion chosen: its words light up.
    const card = button === null ? target.closest('.t-rail [data-card]') : null;
    if (card instanceof HTMLElement && card.dataset.card !== DRAFT && card.dataset.card !== this.activeDisc && !target.closest('textarea')) {
      this.activeDisc = card.dataset.card ?? null;
      this.keepScroll = true;
      this.render();
      return;
    }
    if (!(button instanceof HTMLElement)) return;
    if (button.dataset.go === 'today' || button.dataset.go === 'list' || button.dataset.go === 'people' || button.dataset.go === 'meetings') {
      event.preventDefault();
      const go = button.dataset.go;
      void this.go(go === 'today' ? { view: 'today' } : go === 'people' ? { view: 'people' } : go === 'meetings' ? { view: 'meetings' } : { view: 'list', tab: this.tab, space: this.space });
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
      case 'more':
        this.openMore();
        break;
      case 'meeting':
        if (thread && this.route.view === 'thread') this.openMeeting(thread);
        break;
      case 'meet-choose':
      case 'meet-unchoose':
      case 'meet-name':
      case 'meet-unname': {
        const draft = this.meetingDraft;
        if (draft === null) break;
        this.readMeeting();
        const act = button.dataset.act;
        if (act === 'meet-choose') draft.chosen.push(Number(button.dataset.person));
        if (act === 'meet-unchoose') draft.chosen = draft.chosen.filter((number) => number !== Number(button.dataset.id));
        if (act === 'meet-name' && draft.query.trim() !== '') draft.named.push(draft.query.trim());
        if (act === 'meet-unname') draft.named = draft.named.filter((_, i) => i !== Number(button.dataset.id));
        if (act === 'meet-choose' || act === 'meet-name') draft.query = '';
        this.redrawMeeting('meet-find');
        break;
      }
      case 'meet-clear':
        void this.clearMeeting();
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
      case 'public':
        if (thread && thread.source === 'self' && !this.member) void this.togglePublic(thread);
        break;
      case 'note-show':
      case 'note-drop':
        if (thread && !this.member && button.dataset.note) void this.judgeNote(thread, button.dataset.note, button.dataset.act === 'note-show' ? 'show' : 'drop');
        break;
      case 'people-fold':
        this.peopleFold = !this.peopleFold;
        this.keepScroll = true;
        this.render();
        break;
      case 'person-note':
        // A link in his notes opens; anywhere else on them starts writing.
        if (!target.closest('a')) this.startPersonEdit('note');
        break;
      case 'person-rename':
        this.startPersonEdit('name');
        break;
      case 'note-peek': {
        const id = button.dataset.note ?? '';
        if (this.notesOpened.has(id)) this.notesOpened.delete(id);
        else this.notesOpened.add(id);
        this.keepScroll = true;
        this.render();
        break;
      }
      case 'audience':
        this.audience = button.dataset.audience === 'owner' ? 'owner' : button.dataset.audience === 'public' ? 'public' : 'thread';
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
      case 'copy-full-link':
        if (thread) {
          navigator.clipboard.writeText(`${location.origin}${fullLinkOf(thread)}`).then(
            () => this.say(`Copied whysosuresh.com${fullLinkOf(thread)}`, null),
            () => this.say("Couldn't copy the link.", null),
          );
        }
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
        if (!this.pageFull) dropFullFromAddress();
        this.keepScroll = true;
        this.render();
        break;
      case 'discussions':
        this.openDiscussion('all');
        break;
      case 'reply-open':
        this.replyingTo = button.dataset.id ?? null;
        if (this.shown && placesOf(this.shown.comments).words.some((said) => said.id === this.replyingTo)) this.activeDisc = this.replyingTo;
        this.keepScroll = true;
        this.render();
        focusIn(this.overlay === 'discussion' ? this.dialog : this.main, '#reply-text');
        break;
      case 'reply-cancel':
        this.replyingTo = null;
        this.keepScroll = true;
        this.render();
        break;
      case 'words-cancel':
        this.wordsDraft = null;
        this.wordsText = '';
        if (this.overlay === 'discussion') this.closeOverlay();
        this.keepScroll = true;
        this.render();
        break;
      case 'disc-show':
        this.showDisc(button.dataset.id ?? '');
        break;
      case 'answer-show':
        this.showAnswer(button.dataset.q ?? '');
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

  /**
   * A click in the public view: its page's bar, its versions, and the note form's Send another. Links (a thread's
   * number in the text among them) are left to the browser, which loads that address as a page of its own.
   * @param {Element} target
   */
  onPublicClick(target) {
    const button = target.closest('[data-act]');
    const shown = this.publicShown;
    if (!(button instanceof HTMLElement) || shown === null) return;
    switch (button.dataset.act) {
      case 'page-full':
        this.pageFull = !this.pageFull;
        if (!this.pageFull) dropFullFromAddress();
        this.renderPublic();
        break;
      case 'visitor-name':
        this.takeVisitorName();
        if (this.visitor.name === '') {
          this.visitor = { ...this.visitor, missing: true };
          this.renderPublic();
          focusIn(this.pubDoc, '#visitor-name');
        } else this.renderPublic();
        break;
      case 'visitor-rename':
        this.visitor = { ...this.visitor, naming: true };
        this.renderPublic();
        focusIn(this.pubDoc, '#visitor-name');
        break;
      case 'public-versions':
        if (shown.page) {
          const page = shown.page;
          const current = this.pageVersions.get(shown.thread.number) ?? page.version;
          const picks = [...page.versions].reverse().map((one) =>
            el('button', { type: 'button', class: 't-pick', 'data-act': 'public-version', 'data-version': String(one.version), ...(one.version === current ? { 'aria-current': 'true' } : {}) }, [
              `Version ${one.version} · ${day(one.savedAt)}`,
              ...(one.version === page.version ? [el('span', { class: 't-chip' }, ['newest'])] : []),
            ]),
          );
          this.openOverlay('versions', `Versions of #${shown.thread.number}'s page`, 'narrow', [this.sheetHead('Versions'), el('div', { class: 't-sheet-body' }, [el('div', { class: 't-pick-list' }, picks)])]);
        }
        break;
      case 'public-version':
        this.pageVersions.set(shown.thread.number, Number(button.dataset.version));
        this.closeOverlay();
        this.renderPublic();
        break;
      case 'close':
        this.closeOverlay();
        break;
      case 'note-again':
        this.note = { ...this.note, sent: false };
        this.renderNote();
        focusIn(this.pubDoc, '#note-body');
        break;
    }
  }

  /** @param {Event} event */
  onInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === 'find-words' && target instanceof HTMLInputElement) this.findFor(target.value);
    else if (target.id === 'comment-text' && target instanceof HTMLTextAreaElement && this.shown) this.drafts.set(this.shown.thread.number, target.value);
    else if (target.id === 'words-text' && target instanceof HTMLTextAreaElement) this.wordsText = target.value;
    else if (target.id === 'reply-text' && target instanceof HTMLTextAreaElement && this.replyingTo !== null) this.replyDrafts.set(this.replyingTo, target.value);
    else if (target.id.startsWith('edit-') && this.editing && this.shown) {
      this.readEditor();
      this.main.querySelector('#edit-preview')?.replaceChildren(...this.editorPreview(this.shown.thread, this.editing));
    } else if (target.id.startsWith('new-')) this.readNew();
    else if (target.id.startsWith('meet-') && this.meetingDraft !== null) {
      const timed = this.meetingDraft.time !== '';
      this.readMeeting();
      // The line under the time says whose zone it is in only once there is a time; the picker follows the name typed.
      if (target.id === 'meet-find' || (target.id === 'meet-time' && timed !== (this.meetingDraft.time !== ''))) this.redrawMeeting();
    }
    else if (target.id.startsWith('share-')) this.readShare();
    else if (target.id === 'person-note' && target instanceof HTMLTextAreaElement) this.personDraft = target.value;
    else if (target.id === 'person-email' && target instanceof HTMLInputElement) {
      this.personAddress = target.value;
      this.personProblem = null;
    }
    else if (target.id.startsWith('note-')) {
      this.readNote();
      prepareBotCheck();
      const count = this.pubDoc.querySelector('[data-note-count]');
      if (count) count.textContent = `${this.note.body.trim().length} / ${MAX_NOTE}`;
    }
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
    if (kind === 'words' && thread) void this.sendWords(thread);
    if (kind === 'reply' && thread) void this.sendReply(thread);
    if (kind === 'edit' && thread) void this.saveEdit(thread);
    if (kind === 'new') void this.saveNew();
    if (kind === 'meeting') void this.saveMeeting();
    if (kind === 'invite') void this.sendInvite();
    if (kind === 'note') void this.sendNote();
    if (kind === 'person-note') void this.savePersonNote();
    if (kind === 'person-name') void this.savePersonName();
    if (kind === 'person-email') void this.savePersonEmail();
  }

  /** @param {KeyboardEvent} event */
  onKey(event) {
    if (!this.pub.hidden) {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.id === 'visitor-name') {
        event.preventDefault();
        this.takeVisitorName();
        this.renderPublic();
        return;
      }
      const form = event.target instanceof Element ? event.target.closest('form[data-submit="note"]') : null;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && form) {
        event.preventDefault();
        void this.sendNote();
      }
      return;
    }
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
    if (event.key === 'Escape' && this.personEdit === 'name') {
      event.preventDefault();
      this.personEdit = null;
      this.keepScroll = true;
      this.render();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && target instanceof HTMLElement && target.dataset.act === 'person-note') {
      event.preventDefault();
      this.startPersonEdit('note');
      return;
    }
    if (event.key === 'Escape') {
      if (this.wordsDraft !== null || this.replyingTo !== null) {
        event.preventDefault();
        this.wordsDraft = null;
        this.replyingTo = null;
        this.keepScroll = true;
        this.render();
      } else if (this.pageFull) {
        event.preventDefault();
        this.pageFull = false;
        dropFullFromAddress();
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
      else if (this.route.view === 'thread' || this.route.view === 'person') {
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
    if (this.overlay === 'meeting' && event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.id === 'meet-find') {
      // Enter in the people box picks the first match, or adds the name typed as someone new.
      event.preventDefault();
      const first = this.dialog.querySelector('.t-picker-item');
      if (first instanceof HTMLElement) first.click();
      return;
    }
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
        if (this.route.view === 'thread' || this.route.view === 'person') this.back();
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
        if (this.route.view === 'person') this.startPersonEdit('name');
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
      case 'meeting':
        if (this.route.view === 'thread' && thread) this.openMeeting(thread);
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

/** A thread's address that opens its page in full screen, for answering: its number, its title's words, `?full`. @param {Thread} thread */
function fullLinkOf(thread) {
  return `${threadPath(thread)}?full`;
}

/** Takes `?full` off the address once the page leaves full screen, so a reload or a copied address is the plain one. */
function dropFullFromAddress() {
  const url = new URL(location.href);
  if (!url.searchParams.has('full')) return;
  url.searchParams.delete('full');
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Who answers a public page from this browser, as it kept them: their name and key, or a fresh key when it kept none
 * (or keeps nothing at all, when the key lasts this visit only, which `kept` says).
 * @returns {Visitor}
 */
function readVisitor() {
  /** @type {unknown} */
  let kept = null;
  let works = true;
  try {
    kept = JSON.parse(localStorage.getItem(VISITOR_KEY) ?? 'null');
  } catch {
    works = false;
  }
  if (typeof kept === 'object' && kept !== null && 'key' in kept && 'name' in kept && typeof kept.key === 'string' && VISITOR_KEY_SHAPE.test(kept.key) && typeof kept.name === 'string') {
    const name = kept.name.trim().slice(0, MAX_VISITOR_NAME);
    return { name, key: kept.key, kept: true, naming: name === '', missing: false };
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { name: '', key, kept: works && keepVisitor('', key), naming: true, missing: false };
}

/** Keeps a visitor's name and key in this browser, and says whether it could. @param {string} name @param {string} key */
function keepVisitor(name, key) {
  try {
    localStorage.setItem(VISITOR_KEY, JSON.stringify({ name, key }));
    return true;
  } catch {
    return false;
  }
}

void new Threads().start();
