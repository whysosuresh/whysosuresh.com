// @ts-check
// The inbox: the notes people sent Suresh, in four queues (To look at, To act on, To discuss, Done). It is
// built for sorting, one note at a time: the newest note is open when the page loads, one key or tap sorts it
// (Act on it: feedback, something he made should change; Talk it through: an idea, a conversation; Drop, with
// a reason picked by one more key), and the next note opens by itself until "All sorted". No move asks "are
// you sure": each one shows a toast for a few seconds with Undo, which sends the move that reverses it. A move
// shows at once and is saved behind it; one the server refuses is put back, and the page says so. Reply drafts
// an email inside the note and opens it in Gmail, as the address he signed in with, for him to send.
//
// Beside the site's notes it shows what the recorder sync adds: things told to him in person ("told to you by
// <name>"), his own work and ideas ("yours", as "You"), each with a title, and items moved from a GitHub issue
// with a link back to it. A note the sync filed as an issue sits in Done as Filed, with a link to the issue;
// Done closes it once the issue is, and Reply then opens for its sender as for any feedback. What the sync
// adds is written in GitHub's Markdown, so it is shown formatted (markdown.js parses, this file builds the
// nodes, so nothing becomes markup); a visitor's note is always shown as the plain text they typed.
//
// Laptop: three columns (queues, list, note), every move on a key (`?` lists them). Phone: one note fills the
// screen with the moves under the thumb and the queues along the bottom. The data sits behind inbox-store.js.

import { TOPICS } from '../talk-topics.js';
import { Failed, SignedOut, change, list } from './inbox-store.js';
import { parse } from './markdown.js';

/**
 * @typedef {import('./inbox-store.js').Item} Item
 * @typedef {import('./inbox-store.js').Tab} Tab
 * @typedef {import('./inbox-store.js').Status} Status
 * @typedef {import('./inbox-store.js').Action} Action
 * @typedef {{ to: string, subject: string, body: string }} Draft
 * @typedef {{ tab: Tab, items: Item[], counts: Record<Tab, number>, sel: string | null }} Snapshot
 */

/** @type {readonly Tab[]} */
const TABS = ['look', 'act', 'discuss', 'done'];

/** @type {Record<Tab, string>} */
const TAB_NAMES = { look: 'To look at', act: 'To act on', discuss: 'To discuss', done: 'Done' };

/** The reasons Drop offers, in the order their keys (1 to 4) pick them. */
const REASONS = [
  { label: 'Junk', reason: 'Junk' },
  { label: 'A test', reason: 'A test' },
  { label: 'Said twice', reason: 'Said twice' },
  { label: 'No reason', reason: '' },
];

/** Gmail's compose window; the link names the signed-in account so no other account sends. */
const GMAIL = 'https://mail.google.com/mail/';

/** Where filed issues and moved items live; a link to one is built from this, so it names no other site. */
const GITHUB = 'https://github.com/';

/** A moved item's origin, `github:<owner>/<repo>#<n>`. */
const GITHUB_REF = /^github:([\w.-]+\/[\w.-]+)#(\d+)$/;

/** A filed item's issue address, as the server checks it. */
const ISSUE = /^https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/issues\/(\d+)$/;

/** The booking page an idea's reply offers. */
const BOOKING = 'https://cal.com/whysosuresh';

/** How much of a note a reply quotes. */
const QUOTE = 400;

/** How long a toast, and so its Undo, stays. */
const TOAST_MS = 6000;

/** Telugu script, so a note in it gets the taller line its letters need. */
const TELUGU = /[ఀ-౿]/;

/** Below this width the page is the phone layout: one pane at a time. */
const PHONE = window.matchMedia('(max-width: 899px)');

/** @param {Status} status @returns {Tab} */
function tabOf(status) {
  if (status === 'received') return 'look';
  if (status === 'dropped' || status === 'filed') return 'done';
  return status;
}

/**
 * @template {Element} T
 * @param {ParentNode} root
 * @param {string} selector
 * @param {new () => T} kind
 * @returns {T}
 */
function find(root, selector, kind) {
  const el = root.querySelector(selector);
  if (!(el instanceof kind)) throw new Error(`inbox: missing ${selector}`);
  return el;
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

/**
 * A button with its shortcut shown beside the label.
 * @param {string} label
 * @param {string} key
 * @param {string} className
 * @param {() => void} run
 */
function keyed(label, key, className, run) {
  const button = el('button', { type: 'button', class: className }, [label, ' ', el('kbd', {}, [key])]);
  button.addEventListener('click', run);
  return button;
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
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' });
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString([], sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** @param {string | null} slug */
function topicLabel(slug) {
  return TOPICS.find((topic) => topic.slug === slug)?.label ?? 'No topic';
}

/** @param {Item} item */
function who(item) {
  if (item.source === 'self') return 'You';
  return item.name?.trim() || 'Someone';
}

/** @param {Item} item */
function initial(item) {
  return (who(item) === 'Someone' ? '?' : who(item).charAt(0)).toUpperCase();
}

/**
 * The round initial beside a name; his own items show it filled, so "You" stands apart from other people.
 * @param {Item} item
 * @param {boolean} large
 */
function avatar(item, large) {
  const mine = item.source === 'self';
  const classes = large ? (mine ? { class: 'avatar avatar-large avatar-self' } : { class: 'avatar avatar-large' }) : mine ? { class: 'avatar avatar-self' } : { class: 'avatar' };
  return el('span', { ...classes, 'aria-hidden': 'true' }, [initial(item)]);
}

/** Where an item came from, as the note's header says it. @param {Item} item */
function sourceLabel(item) {
  if (item.source === 'self') return 'yours';
  if (item.source === 'told') return `told to you by ${item.name?.trim() || 'someone'}`;
  return 'from the site';
}

/** The line under the name: how to reach them, or why there's no reply. @param {Item} item */
function contact(item) {
  if (item.source === 'self') return item.kind === 'idea' ? 'Your own idea' : 'Your own work';
  if (item.source === 'told') return 'Told to you in person, so no reply here';
  return item.email || 'No email left, so no reply';
}

/** The row's badge beside the topic. @param {Item} item */
function badge(item) {
  if (item.status === 'filed') return 'filed';
  if (item.source === 'told') return 'told to you';
  if (item.source === 'self') return 'yours';
  return 'site';
}

/** What a kind is called: his own items are things to do, not feedback. @param {Item} item */
function kindWord(item) {
  if (item.kind === 'idea') return 'idea';
  return item.source === 'self' ? 'to do' : 'feedback';
}

/**
 * A GitHub issue as a link and its short name (`<repo>#<n>`), or null when the address isn't one.
 * @param {string | null} address
 * @returns {{ href: string, name: string } | null}
 */
function issueOf(address) {
  const match = address === null ? null : ISSUE.exec(address);
  return match ? { href: `${GITHUB}${address?.slice(GITHUB.length)}`, name: `${match[1]}#${match[2]}` } : null;
}

/** The issue a moved item came from, or null. @param {Item} item */
function fromOf(item) {
  const match = item.ref === null ? null : GITHUB_REF.exec(item.ref);
  if (!match) return null;
  return issueOf(`${GITHUB}${match[1]}/issues/${match[2]}`);
}

/**
 * Inline runs as nodes: text stays text, a link opens in a new tab.
 * @param {import('./markdown.js').Inline[]} runs
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
    }
  });
}

/**
 * An item the sync added, its Markdown shown formatted.
 * @param {string} text
 */
function formatted(text) {
  const box = el('div', { class: 'note-md', dir: 'auto' });
  for (const block of parse(text)) {
    switch (block.type) {
      case 'p':
        box.append(el('p', {}, inlineNodes(block.inline)));
        break;
      case 'h':
        box.append(el('h3', {}, inlineNodes(block.inline)));
        break;
      case 'quote':
        box.append(el('blockquote', {}, inlineNodes(block.inline)));
        break;
      case 'list':
        box.append(el(block.ordered ? 'ol' : 'ul', {}, block.items.map((runs) => el('li', {}, inlineNodes(runs)))));
        break;
      case 'pre':
        box.append(el('pre', {}, [el('code', {}, [block.text])]));
        break;
      case 'rule':
        box.append(el('hr'));
        break;
    }
  }
  return box;
}

/**
 * A link to an issue that opens in a new tab: a quiet text link under a title, or a button among the moves.
 * @param {{ href: string, name: string }} issue
 * @param {string} label
 * @param {boolean} asButton
 */
function outLink(issue, label, asButton) {
  const look = asButton ? { class: 'act-button' } : { class: 'note-link' };
  return el('a', { ...look, href: issue.href, target: '_blank', rel: 'noopener' }, [label, ' ↗']);
}

/** @param {string} text */
function quoted(text) {
  const cut = text.length > QUOTE ? `${text.slice(0, QUOTE).trimEnd()}…` : text;
  return cut.split('\n').map((line) => `> ${line}`).join('\n');
}

/** @param {Item} item */
function canReply(item) {
  if (!item.email) return false;
  if (item.kind === 'idea') return item.status !== 'dropped';
  return item.kind === 'feedback' && item.status === 'done';
}

/**
 * The reply he starts from: an idea's offers a call, a feedback reply asks him to say what changed.
 * @param {Item} item
 * @returns {Draft}
 */
function draftReply(item) {
  const first = (item.name ?? '').trim().split(/\s+/)[0] || 'there';
  if (item.kind === 'idea') {
    const about = item.topic === null || item.topic === 'other' ? '' : ` about ${topicLabel(item.topic)}`;
    return {
      to: item.email ?? '',
      subject: 'Your note',
      body: `Hi ${first},\n\nThanks for your note${about}:\n\n${quoted(item.body)}\n\nI'd like to talk it through. Book a time that suits you: ${BOOKING}\n\nSuresh`,
    };
  }
  return {
    to: item.email ?? '',
    subject: 'What changed after your feedback',
    body: `Hi ${first},\n\nYou told me:\n\n${quoted(item.body)}\n\nHere's what I changed: [say what changed]\n\nThanks for telling me.\n\nSuresh`,
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
 * The note as a move will leave it, shown before the server answers.
 * @param {Item} item
 * @param {Action} action
 * @returns {Item}
 */
function predict(item, action) {
  switch (action.action) {
    case 'act':
      return { ...item, status: 'act', kind: 'feedback' };
    case 'discuss':
      return { ...item, status: 'discuss', kind: 'idea' };
    case 'unsort':
      return { ...item, status: 'received', kind: null };
    case 'done':
      return { ...item, status: 'done' };
    case 'drop':
      return { ...item, status: 'dropped', dropReason: action.reason === '' ? null : action.reason };
    case 'reopen':
      return { ...item, status: item.filedLink ? 'filed' : item.kind === 'feedback' ? 'act' : item.kind === 'idea' ? 'discuss' : 'received', dropReason: null };
    case 'topic':
      return { ...item, topic: action.topic };
    case 'reply-opened':
      return { ...item, replyOpenedAt: new Date().toISOString() };
  }
}

/**
 * The move that puts a note back as it was before `action`, or null when there is none.
 * @param {Item} before
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
    case 'topic':
      return before.topic !== null && TOPICS.some((topic) => topic.slug === before.topic) ? { action: 'topic', topic: before.topic } : null;
    case 'reply-opened':
      return null;
  }
}

/** @param {Item} item */
function stateLabel(item) {
  switch (item.status) {
    case 'act':
      return item.source === 'self' ? 'To do' : 'Feedback';
    case 'discuss':
      return 'Idea';
    case 'filed':
      return 'Filed';
    case 'done':
      return `Done · ${item.filedLink ? 'filed' : kindWord(item)}`;
    case 'dropped':
      return item.dropReason ? `Dropped: ${item.dropReason}` : 'Dropped';
    default:
      return '';
  }
}

class Inbox {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    /** @type {Tab} */
    this.tab = 'look';
    /** @type {Item[]} */
    this.items = [];
    /** @type {string | null} */
    this.next = null;
    /** @type {Record<Tab, number>} */
    this.counts = { look: 0, act: 0, discuss: 0, done: 0 };
    /** The signed-in address, which Gmail's link names. */
    this.me = '';
    /** @type {string | null} */
    this.sel = null;
    /** @type {'read' | 'drop' | 'reply' | 'topic'} */
    this.mode = 'read';
    this.loaded = false;
    /** Bumped on every queue load, so an answer for a queue no longer shown is dropped. */
    this.loading = 0;
    /** @type {{ undo: (() => Promise<void>) | null } | null} */
    this.toastState = null;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.toastTimer = undefined;

    this.tabs = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[role="tab"]')]);
    this.listPane = find(root, '[role="tabpanel"]', HTMLElement);
    this.listTitle = find(root, '[data-list-title]', HTMLElement);
    this.listHint = find(root, '[data-list-hint]', HTMLElement);
    this.rows = find(root, '[data-rows]', HTMLElement);
    this.older = find(root, '[data-older]', HTMLButtonElement);
    this.notePane = find(root, '[data-note]', HTMLElement);
    this.problem = find(document, '[data-problem]', HTMLElement);
    this.toast = find(document, '[data-toast]', HTMLElement);
    this.toastText = find(document, '[data-toast-text]', HTMLElement);
    this.undoButton = find(document, '[data-undo]', HTMLButtonElement);
    this.keys = find(document, '[data-keys]', HTMLDialogElement);

    for (const tab of this.tabs) {
      tab.addEventListener('click', () => void this.select(/** @type {Tab} */ (tab.dataset.tab)));
    }
    this.older.addEventListener('click', () => void this.loadOlder());
    this.undoButton.addEventListener('click', () => void this.undo());
    find(document, '[data-keys-open]', HTMLButtonElement).addEventListener('click', () => this.keys.showModal());
    find(document, '[data-keys-close]', HTMLButtonElement).addEventListener('click', () => this.keys.close());
    document.addEventListener('keydown', (event) => this.onKey(event));
    PHONE.addEventListener('change', () => this.render());
  }

  current() {
    return this.items.find((item) => item.id === this.sel) ?? null;
  }

  /** @param {Tab} tab */
  async select(tab) {
    if (tab === this.tab && this.loaded) {
      if (PHONE.matches && tab !== 'look') this.show('list');
      return;
    }
    this.tab = tab;
    this.items = [];
    this.next = null;
    this.sel = null;
    this.mode = 'read';
    this.loaded = false;
    this.render();
    await this.load();
  }

  async load() {
    const ticket = ++this.loading;
    try {
      const page = await list(this.tab, null);
      if (ticket !== this.loading) return;
      this.items = page.items;
      this.next = page.next;
      this.counts = page.counts;
      this.me = page.me ?? '';
      this.sel = this.items[0]?.id ?? null;
      this.loaded = true;
      this.clearProblem();
      if (PHONE.matches) this.root.dataset.view = this.tab === 'look' ? 'note' : 'list';
      this.render();
    } catch (error) {
      if (ticket === this.loading) this.fail(error, "The inbox didn't load.");
    }
  }

  async loadOlder() {
    const ticket = this.loading;
    if (this.next === null) return;
    this.older.disabled = true;
    try {
      const page = await list(this.tab, this.next);
      if (ticket !== this.loading) return;
      const known = new Set(this.items.map((item) => item.id));
      this.items = [...this.items, ...page.items.filter((item) => !known.has(item.id))];
      this.next = page.next;
      this.counts = page.counts;
      this.render();
    } catch (error) {
      this.fail(error, "The older notes didn't load.");
    } finally {
      this.older.disabled = false;
    }
  }

  /** @param {'list' | 'note'} view */
  show(view) {
    this.root.dataset.view = view;
    if (view === 'note') this.notePane.focus({ preventScroll: true });
  }

  /** @param {string} id */
  open(id) {
    this.sel = id;
    this.mode = 'read';
    this.render();
    if (PHONE.matches) this.show('note');
  }

  /** @param {number} by */
  step(by) {
    const at = this.items.findIndex((item) => item.id === this.sel);
    const next = this.items[Math.max(0, Math.min(this.items.length - 1, at + by))];
    if (next) this.open(next.id);
  }

  /**
   * Shows why something failed: an ended sign-in gets a way back in.
   * @param {unknown} error
   * @param {string} what
   */
  fail(error, what) {
    if (error instanceof SignedOut) {
      this.problem.replaceChildren('Your sign-in ended. ', el('a', { href: '/inbox/' }, ['Sign in again']));
    } else {
      this.problem.replaceChildren(`${what} Check your connection and try again.`);
      if (!(error instanceof Failed)) console.error(error);
    }
    this.problem.hidden = false;
  }

  clearProblem() {
    this.problem.hidden = true;
  }

  /**
   * @param {string} text
   * @param {(() => Promise<void>) | null} undo
   */
  say(text, undo) {
    clearTimeout(this.toastTimer);
    this.toastState = { undo };
    this.toastText.textContent = text;
    this.undoButton.hidden = undo === null;
    this.toast.hidden = false;
    this.toastTimer = setTimeout(() => {
      this.toast.hidden = true;
      this.toastState = null;
    }, TOAST_MS);
  }

  async undo() {
    const undo = this.toastState?.undo;
    if (!undo) return;
    clearTimeout(this.toastTimer);
    this.toast.hidden = true;
    this.toastState = null;
    await undo();
  }

  /** @returns {Snapshot} */
  snapshot() {
    return { tab: this.tab, items: this.items, counts: { ...this.counts }, sel: this.sel };
  }

  /** @param {Snapshot} snap */
  restore(snap) {
    this.items = snap.items;
    this.counts = snap.counts;
    this.sel = snap.sel;
    this.mode = 'read';
    this.render();
  }

  /**
   * Puts `item` as it now is into the list: in place while it stays in this queue, out of it (opening the next
   * note) when it leaves.
   * @param {Item} before
   * @param {Item} after
   */
  place(before, after) {
    const from = tabOf(before.status);
    const to = tabOf(after.status);
    if (from !== to) {
      this.counts[from] = Math.max(0, this.counts[from] - 1);
      this.counts[to] += 1;
    }
    const at = this.items.findIndex((item) => item.id === before.id);
    if (to === this.tab) {
      this.items = this.items.map((item) => (item.id === before.id ? after : item));
      return;
    }
    this.items = this.items.filter((item) => item.id !== before.id);
    if (this.sel === before.id) this.sel = this.items[Math.min(Math.max(at, 0), this.items.length - 1)]?.id ?? null;
  }

  /**
   * Makes one move: shown at once, saved behind it, put back if the server refuses, undoable from the toast.
   * @param {Action} action
   * @param {string} said
   */
  async move(action, said) {
    const item = this.current();
    if (!item) return;
    const snap = this.snapshot();
    this.mode = 'read';
    this.place(item, predict(item, action));
    this.render();
    /** @type {Item} */
    let saved;
    try {
      saved = await change(item.id, action);
    } catch (error) {
      if (this.tab === snap.tab) this.restore(snap);
      this.fail(error, "That didn't save, so the note is back where it was.");
      return;
    }
    if (tabOf(saved.status) === this.tab) this.items = this.items.map((entry) => (entry.id === saved.id ? saved : entry));
    this.clearProblem();
    this.render();
    const back = inverse(item, action);
    this.say(said, back === null ? null : () => this.revert(saved, back, snap));
  }

  /**
   * Sends the move that undoes the last one, then shows the queue as it was before it.
   * @param {Item} moved
   * @param {Action} back
   * @param {Snapshot} snap
   */
  async revert(moved, back, snap) {
    try {
      const restored = await change(moved.id, back);
      if (this.tab === snap.tab) {
        this.restore({ ...snap, items: snap.items.map((item) => (item.id === restored.id ? restored : item)) });
        if (PHONE.matches && this.tab === 'look') this.show('note');
      } else {
        await this.load();
      }
      this.say('Undone', null);
    } catch (error) {
      this.fail(error, "The undo didn't save.");
    }
  }

  /** @param {KeyboardEvent} event */
  onKey(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (this.keys.open) return;
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    if (event.key === 'Escape') {
      if (this.mode !== 'read') {
        this.mode = 'read';
        this.render();
        event.preventDefault();
      }
      return;
    }
    if (typing) return;
    const item = this.current();
    const status = item?.status;
    const open = status === 'received' || status === 'act' || status === 'discuss';
    const key = event.key.toLowerCase();
    if (this.mode === 'drop' && ['1', '2', '3', '4'].includes(key)) {
      const pick = REASONS[Number(key) - 1];
      if (pick) void this.move({ action: 'drop', reason: pick.reason }, 'Dropped');
      event.preventDefault();
      return;
    }
    /** @type {Record<string, () => void>} */
    const keys = {
      j: () => this.step(1),
      arrowdown: () => this.step(1),
      k: () => this.step(-1),
      arrowup: () => this.step(-1),
      1: () => void this.select('look'),
      2: () => void this.select('act'),
      3: () => void this.select('discuss'),
      4: () => void this.select('done'),
      '?': () => this.keys.showModal(),
      z: () => void this.undo(),
      a: () => {
        if (status === 'received') void this.move({ action: 'act' }, 'Moved to To act on');
      },
      t: () => {
        if (status === 'received') void this.move({ action: 'discuss' }, 'Moved to To discuss');
      },
      d: () => {
        if (open) this.setMode('drop');
      },
      e: () => {
        if (status === 'act' || status === 'discuss' || status === 'filed') void this.move({ action: 'done' }, 'Done');
      },
      r: () => {
        if (item && canReply(item)) this.setMode('reply');
      },
      u: () => {
        if (status === 'done' || status === 'dropped') void this.move({ action: 'reopen' }, 'Reopened');
      },
      c: () => {
        if (item) this.setMode(this.mode === 'topic' ? 'read' : 'topic');
      },
    };
    const run = keys[key];
    if (run) {
      run();
      event.preventDefault();
    }
  }

  /** @param {'read' | 'drop' | 'reply' | 'topic'} mode */
  setMode(mode) {
    this.mode = mode;
    this.render();
    if (mode === 'reply') {
      const body = this.notePane.querySelector('#reply-body');
      if (body instanceof HTMLTextAreaElement) {
        body.focus();
        body.setSelectionRange(0, 0);
      }
    } else if (mode === 'drop' || mode === 'topic') {
      this.notePane.querySelector('.note-actions button, .topic-choices button')?.closest('button')?.focus();
    }
  }

  render() {
    this.renderQueues();
    this.renderList();
    this.renderNote();
  }

  renderQueues() {
    for (const tab of this.tabs) {
      const name = /** @type {Tab} */ (tab.dataset.tab);
      const selected = name === this.tab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      find(tab, '.queue-count', HTMLElement).textContent = String(this.counts[name]);
      if (selected) this.listPane.setAttribute('aria-labelledby', tab.id);
    }
  }

  renderList() {
    this.listTitle.textContent = TAB_NAMES[this.tab];
    const total = this.counts[this.tab];
    this.listHint.textContent = !this.loaded ? '' : this.tab === 'look' ? (total ? `${total} new` : '') : `${total} ${total === 1 ? 'note' : 'notes'}`;
    this.rows.setAttribute('aria-busy', String(!this.loaded));
    this.rows.replaceChildren(
      ...this.items.map((item) => {
        const row = el('button', { type: 'button', class: 'row' }, [
          avatar(item, false),
          el('span', { class: 'row-who' }, [who(item)]),
          el('span', { class: 'row-time' }, [when(item.receivedAt)]),
          el('span', { class: 'row-preview' }, [el('span', { class: 'row-topic' }, [`${topicLabel(item.topic)} · ${badge(item)}`]), ' · ', item.title ?? item.body]),
        ]);
        if (item.status === 'received') row.dataset.unread = '';
        if (item.id === this.sel) row.setAttribute('aria-current', 'true');
        row.addEventListener('click', () => this.open(item.id));
        return el('li', {}, [row]);
      }),
    );
    if (this.loaded && this.items.length === 0) this.rows.append(el('li', { class: 'rows-empty' }, [`Nothing in ${TAB_NAMES[this.tab]}.`]));
    this.older.hidden = this.next === null;
    this.rows.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  renderNote() {
    const item = this.current();
    if (!this.loaded) {
      this.notePane.replaceChildren();
      return;
    }
    if (!item) {
      this.notePane.replaceChildren(this.tab === 'look' ? this.allSorted() : el('p', { class: 'note-empty' }, [`Nothing in ${TAB_NAMES[this.tab]}.`]));
      return;
    }
    const back = el('button', { type: 'button', class: 'back-button' }, ['‹ ', TAB_NAMES[this.tab]]);
    back.addEventListener('click', () => this.show('list'));

    const topic = el('button', { type: 'button', class: 'topic-pill', 'aria-expanded': String(this.mode === 'topic') }, [topicLabel(item.topic), ' ', el('kbd', {}, ['C'])]);
    topic.addEventListener('click', () => this.setMode(this.mode === 'topic' ? 'read' : 'topic'));
    const tags = el('div', { class: 'note-tags' });
    const state = stateLabel(item);
    if (state) tags.append(el('span', { class: 'state-tag' }, [state]));
    if (item.replyOpenedAt) tags.append(el('span', { class: 'state-tag' }, ['Reply opened']));
    tags.append(topic);

    const head = el('header', { class: 'note-head' }, [
      el('div', { class: 'note-who' }, [
        avatar(item, true),
        el('div', {}, [el('p', { class: 'note-name' }, [who(item)]), el('p', { class: 'fine' }, [contact(item)])]),
      ]),
      el('div', { class: 'note-meta' }, [el('p', { class: 'fine' }, [`${when(item.receivedAt)} · ${sourceLabel(item)}`]), tags]),
    ]);

    const fromSync = item.source === 'self' || item.source === 'told';
    const text = fromSync ? formatted(item.body) : el('p', { class: 'note-text', dir: 'auto' }, [item.body]);
    if (TELUGU.test(item.body)) text.setAttribute('lang', 'te');
    const body = el('div', { class: 'note-body' });
    if (item.title) body.append(el('h2', { class: 'note-title', dir: 'auto' }, [item.title]));
    const from = fromOf(item);
    if (from) body.append(el('p', { class: 'note-from' }, [outLink(from, `From ${from.name}`, false)]));
    body.append(text);
    if (this.mode === 'reply' && canReply(item)) body.append(this.reply(item));

    const parts = [back, head];
    if (this.mode === 'topic') parts.push(this.topics(item));
    parts.push(body, this.actions(item));
    this.notePane.replaceChildren(...parts);
  }

  allSorted() {
    const act = keyed('To act on', '2', 'act-button', () => void this.select('act'));
    const discuss = keyed('To discuss', '3', 'act-button', () => void this.select('discuss'));
    return el('div', { class: 'all-sorted' }, [
      el('span', { class: 'all-sorted-mark', 'aria-hidden': 'true' }, ['✓']),
      el('h2', {}, ['All sorted.']),
      el('p', { class: 'fine' }, [`${this.counts.act} to act on · ${this.counts.discuss} to discuss`]),
      el('div', { class: 'note-actions-row' }, [act, discuss]),
    ]);
  }

  /** @param {Item} item */
  topics(item) {
    const group = el('div', { class: 'topic-choices', role: 'group', 'aria-label': 'Change the topic' });
    for (const topic of TOPICS) {
      const pressed = topic.slug === item.topic;
      const choice = el('button', { type: 'button', class: 'topic-pill', 'aria-pressed': String(pressed) }, [topic.label]);
      choice.addEventListener('click', () => {
        if (pressed) this.setMode('read');
        else void this.move({ action: 'topic', topic: topic.slug }, `Topic set to ${topic.label}`);
      });
      group.append(choice);
    }
    return group;
  }

  /** @param {Item} item */
  actions(item) {
    const bar = el('footer', { class: 'note-actions' });
    const row = el('div', { class: 'note-actions-row' });
    bar.append(row);
    const status = item.status;
    if (this.mode === 'drop') {
      row.append(el('span', { class: 'note-ask' }, ['Why drop it?']));
      REASONS.forEach((pick, i) => {
        row.append(keyed(pick.label, String(i + 1), 'act-button', () => void this.move({ action: 'drop', reason: pick.reason }, 'Dropped')));
      });
      row.append(keyed('Keep it', 'Esc', 'act-button act-quiet', () => this.setMode('read')));
      return bar;
    }
    if (status === 'received') {
      row.append(
        keyed('Act on it', 'A', 'act-button act-primary', () => void this.move({ action: 'act' }, 'Moved to To act on')),
        keyed('Talk it through', 'T', 'act-button act-primary', () => void this.move({ action: 'discuss' }, 'Moved to To discuss')),
        keyed('Drop', 'D', 'act-button', () => this.setMode('drop')),
      );
      bar.append(el('p', { class: 'fine note-hint' }, ['Act on it: something you made should change. Talk it through: their idea, a conversation.']));
    } else if (status === 'act' || status === 'discuss') {
      row.append(keyed('Done', 'E', 'act-button act-primary', () => void this.move({ action: 'done' }, 'Done')));
      if (canReply(item)) row.append(keyed('Reply', 'R', 'act-button', () => this.setMode('reply')));
      row.append(keyed('Drop', 'D', 'act-button', () => this.setMode('drop')));
      const other = status === 'act' ? 'discuss' : 'act';
      const switchTo = el('button', { type: 'button', class: 'act-button act-quiet' }, [status === 'act' ? "It's an idea" : 'It needs action']);
      switchTo.addEventListener('click', () => void this.move({ action: other }, `Moved to ${TAB_NAMES[other]}`));
      row.append(switchTo);
    } else if (status === 'filed') {
      row.append(keyed('Done', 'E', 'act-button act-primary', () => void this.move({ action: 'done' }, 'Done')));
      const issue = issueOf(item.filedLink);
      if (issue) row.append(outLink(issue, `Open ${issue.name}`, true));
      bar.append(el('p', { class: 'fine note-hint' }, ['Filed as an issue. When it closes, the sync offers to mark it Done, and Reply opens for them.']));
    } else {
      if (canReply(item)) row.append(keyed('Reply', 'R', 'act-button act-primary', () => this.setMode('reply')));
      row.append(keyed('Reopen', 'U', 'act-button', () => void this.move({ action: 'reopen' }, 'Reopened')));
      const hint = item.filedLink && item.status === 'done' ? 'Reopen puts it back as Filed.' : item.kind ? 'Reopen puts it back where it was.' : 'Reopen puts it back in To look at.';
      bar.append(el('p', { class: 'fine note-hint' }, [hint]));
    }
    return bar;
  }

  /** @param {Item} item */
  reply(item) {
    const draft = draftReply(item);
    const to = el('input', { id: 'reply-to', type: 'email', readonly: '', value: draft.to });
    const subject = /** @type {HTMLInputElement} */ (el('input', { id: 'reply-subject', type: 'text', value: draft.subject }));
    const body = /** @type {HTMLTextAreaElement} */ (el('textarea', { id: 'reply-body' }, [draft.body]));
    const open = /** @type {HTMLAnchorElement} */ (el('a', { class: 'act-button act-primary', target: '_blank', rel: 'noopener' }, ['Open in Gmail ↗']));
    const refresh = () => {
      open.href = gmailLink({ to: draft.to, subject: subject.value, body: body.value }, this.me);
    };
    refresh();
    subject.addEventListener('input', refresh);
    body.addEventListener('input', refresh);
    open.addEventListener('click', () => void this.move({ action: 'reply-opened' }, 'Opened in Gmail, as you. Send it there.'));
    const copy = el('button', { type: 'button', class: 'act-button' }, ['Copy']);
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(`To: ${draft.to}\nSubject: ${subject.value}\n\n${body.value}`).then(
        () => this.say('Copied the email', null),
        () => {
          body.select();
          this.say('Copy was refused here; the email is selected, so press Cmd+C', null);
        },
      );
    });
    const close = keyed('Not now', 'Esc', 'act-button act-quiet', () => this.setMode('read'));
    return el('section', { class: 'reply', 'aria-label': 'Reply' }, [
      el('div', { class: 'reply-top' }, [el('h2', {}, ['Reply, drafted for you']), el('span', { class: 'fine' }, ['Nothing is sent from here'])]),
      el('div', { class: 'field' }, [el('label', { for: 'reply-to' }, ['To']), to]),
      el('div', { class: 'field' }, [el('label', { for: 'reply-subject' }, ['Subject']), subject]),
      el('div', { class: 'field' }, [el('label', { for: 'reply-body' }, ['Email']), body]),
      el('div', { class: 'note-actions-row' }, [open, copy, close]),
      el('p', { class: 'fine' }, ['Gmail opens as the address you signed in with, with this written. You edit it there and press Send yourself.']),
    ]);
  }
}

const root = document.querySelector('[data-inbox]');
if (root instanceof HTMLElement) void new Inbox(root).load();
