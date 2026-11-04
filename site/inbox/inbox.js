// @ts-check
// The inbox: the notes people sent Suresh, newest first, in four tabs (To look at, To act on, To discuss,
// Done). A card shows who wrote (if they said), when, the topic they picked (correctable in one click) and
// what they typed. A new note is sorted by his one click: Act on it (feedback, something he made should
// change) or Talk it through (an idea, a conversation rather than a to-do); Drop is for junk, with an
// optional reason. Done closes a note, and Reopen undoes Done or Drop. Reply opens a drafted email in Gmail's
// compose window, as the address he signed in with, for him to edit and send: an idea's reply is offered at
// once, a feedback reply once the note is done. The data sits behind inbox-store.js.

import { TOPICS } from '../talk-topics.js';
import { Failed, SignedOut, change, list } from './inbox-store.js';

/**
 * @typedef {import('./inbox-store.js').Item} Item
 * @typedef {import('./inbox-store.js').Tab} Tab
 * @typedef {import('./inbox-store.js').Status} Status
 * @typedef {import('./inbox-store.js').Action} Action
 * @typedef {{ to: string, subject: string, body: string }} Draft
 */

/** @type {Record<Tab, string>} */
const TAB_NAMES = { look: 'To look at', act: 'To act on', discuss: 'To discuss', done: 'Done' };

/** Gmail's compose window; the link names the signed-in account so no other account sends. */
const GMAIL = 'https://mail.google.com/mail/';

/** The booking page an idea's reply offers. */
const BOOKING = 'https://cal.com/whysosuresh';

/** How much of a note a reply quotes. */
const QUOTE = 400;

/** @param {Status} status @returns {Tab} */
function tabOf(status) {
  if (status === 'received') return 'look';
  if (status === 'dropped') return 'done';
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
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString([], sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** @param {string | null} slug */
function topicLabel(slug) {
  return TOPICS.find((topic) => topic.slug === slug)?.label ?? 'No topic';
}

/** @param {string} text */
function quoted(text) {
  const cut = text.length > QUOTE ? `${text.slice(0, QUOTE).trimEnd()}…` : text;
  return cut.split('\n').map((line) => `> ${line}`).join('\n');
}

/**
 * The reply he starts from: an idea's offers a call, a feedback reply asks him to say what changed.
 * @param {Item} item
 * @returns {Draft}
 */
function draftReply(item) {
  const first = (item.name ?? '').trim().split(/\s+/)[0] || 'there';
  if (item.kind === 'idea') {
    return {
      to: item.email ?? '',
      subject: 'Your note',
      body: `Hi ${first},\n\nThanks for your note about ${topicLabel(item.topic)}:\n\n${quoted(item.body)}\n\nI'd like to talk it through. Book a time that suits you: ${BOOKING}\n\nSuresh`,
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
    /** Bumped on every tab load, so an answer for a tab no longer shown is dropped. */
    this.loading = 0;
    this.tabs = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[role="tab"]')]);
    this.panel = find(root, '[role="tabpanel"]', HTMLElement);
    this.cards = find(root, '[data-cards]', HTMLElement);
    this.older = find(root, '[data-older]', HTMLButtonElement);
    this.problem = find(root, '[data-problem]', HTMLElement);
    this.live = find(root, '[data-live]', HTMLElement);
    this.replyDialog = find(document, '[data-reply]', HTMLDialogElement);
    /** @type {Item | null} */
    this.replyingTo = null;

    for (const tab of this.tabs) {
      tab.addEventListener('click', () => void this.select(/** @type {Tab} */ (tab.dataset.tab), false));
      tab.addEventListener('keydown', (event) => this.onTabKey(event));
    }
    this.older.addEventListener('click', () => void this.loadOlder());
    this.wireReply();
  }

  /** @param {KeyboardEvent} event */
  onTabKey(event) {
    const at = this.tabs.findIndex((tab) => tab.dataset.tab === this.tab);
    const last = this.tabs.length - 1;
    /** @type {Record<string, number>} */
    const moves = { ArrowRight: at === last ? 0 : at + 1, ArrowLeft: at === 0 ? last : at - 1, Home: 0, End: last };
    const to = moves[event.key];
    if (to === undefined) return;
    event.preventDefault();
    void this.select(/** @type {Tab} */ (this.tabs[to]?.dataset.tab), true);
  }

  /** @param {Tab} tab @param {boolean} focusTab */
  async select(tab, focusTab) {
    this.tab = tab;
    this.items = [];
    this.next = null;
    this.cards.setAttribute('aria-busy', 'true');
    this.render();
    if (focusTab) this.tabs.find((t) => t.dataset.tab === tab)?.focus();
    await this.load();
  }

  async load() {
    const ticket = ++this.loading;
    this.cards.setAttribute('aria-busy', 'true');
    try {
      const page = await list(this.tab, null);
      if (ticket !== this.loading) return;
      this.items = page.items;
      this.next = page.next;
      this.counts = page.counts;
      this.me = page.me ?? '';
      this.say('');
      this.render();
    } catch (error) {
      if (ticket === this.loading) this.fail(error, "The inbox didn't load.");
    } finally {
      if (ticket === this.loading) this.cards.removeAttribute('aria-busy');
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

  /**
   * Shows why something failed: an ended sign-in gets a way back in.
   * @param {unknown} error
   * @param {string} what
   */
  fail(error, what) {
    if (error instanceof SignedOut) {
      const again = el('a', { href: '/inbox/' }, ['Sign in again']);
      this.problem.replaceChildren('Your sign-in ended. ', again);
    } else {
      this.problem.replaceChildren(`${what} Check your connection and try again.`);
      if (!(error instanceof Failed)) console.error(error);
    }
    this.problem.hidden = false;
  }

  /** @param {string} text */
  say(text) {
    this.problem.hidden = true;
    this.live.textContent = text;
  }

  render() {
    for (const tab of this.tabs) {
      const name = /** @type {Tab} */ (tab.dataset.tab);
      const selected = name === this.tab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      find(tab, '.tab-count', HTMLElement).textContent = String(this.counts[name]);
      if (selected) this.panel.setAttribute('aria-labelledby', tab.id);
    }
    const shown = this.items.filter((item) => tabOf(item.status) === this.tab);
    this.cards.replaceChildren(...shown.map((item) => this.card(item)));
    if (!shown.length && !this.cards.hasAttribute('aria-busy')) {
      this.cards.append(el('li', { class: 'empty' }, [`Nothing in ${TAB_NAMES[this.tab]}.`]));
    }
    this.older.hidden = this.next === null;
    for (const note of this.cards.querySelectorAll('.note')) {
      const toggle = note.nextElementSibling;
      if (toggle instanceof HTMLElement && note instanceof HTMLElement) toggle.hidden = note.scrollHeight <= note.clientHeight + 2;
    }
  }

  /** @param {Item} item */
  card(item) {
    const name = item.name ?? '';
    const who = el('div', { class: 'who' }, [name || 'Someone']);
    if (item.email) who.append(' ', el('span', { class: 'email' }, [item.email]));
    const where = item.source === 'talk' ? 'From the site' : 'Told to Suresh';
    const top = el('div', { class: 'card-top' }, [who, el('span', { class: 'when' }, [`${where} · ${when(item.receivedAt)}`])]);

    const chips = el('div', { class: 'chips' }, [this.topicSelect(item)]);
    if (item.kind) chips.append(el('span', { class: 'tag' }, [item.kind === 'feedback' ? 'Feedback' : 'Idea']));
    if (item.status === 'dropped') chips.append(el('span', { class: 'tag' }, [item.dropReason ? `Dropped: ${item.dropReason}` : 'Dropped']));
    if (item.replyOpenedAt) chips.append(el('span', { class: 'tag' }, ['Reply opened']));

    const card = el('article', { class: 'card', 'aria-label': `${name || 'Someone'}, ${topicLabel(item.topic)}` }, [top, chips]);
    const note = el('p', { class: 'note', dir: 'auto' }, [item.body]);
    const more = el('button', { type: 'button', class: 'text-button', 'aria-expanded': 'false' }, ['Show all of it']);
    more.addEventListener('click', () => {
      const open = !note.hasAttribute('data-open');
      note.toggleAttribute('data-open', open);
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Fold it' : 'Show all of it';
    });
    card.append(note, more, this.actions(item));
    return el('li', { 'data-id': item.id }, [card]);
  }

  /** @param {Item} item */
  topicSelect(item) {
    const select = /** @type {HTMLSelectElement} */ (el('select', { class: 'chip-select', 'aria-label': 'Topic' }));
    if (item.topic === null || !TOPICS.some((topic) => topic.slug === item.topic)) {
      const none = /** @type {HTMLOptionElement} */ (el('option', { value: '' }, ['No topic']));
      none.disabled = true;
      none.selected = true;
      select.append(none);
    }
    for (const topic of TOPICS) {
      const option = /** @type {HTMLOptionElement} */ (el('option', { value: topic.slug }, [topic.label]));
      option.selected = topic.slug === item.topic;
      select.append(option);
    }
    select.addEventListener('change', () => void this.update(item, { action: 'topic', topic: select.value }, `Topic set to ${topicLabel(select.value)}.`));
    return select;
  }

  /** @param {Item} item */
  actions(item) {
    const row = el('div', { class: 'actions' });
    /** @param {string} label @param {() => void} run @param {boolean} [primary] */
    const button = (label, run, primary = false) => {
      const b = primary ? el('button', { type: 'button', class: 'primary' }, [label]) : el('button', { type: 'button' }, [label]);
      b.addEventListener('click', run);
      row.append(b);
    };
    const open = item.status === 'received' || item.status === 'act' || item.status === 'discuss';
    const canReply = Boolean(item.email) && (item.kind === 'idea' ? item.status !== 'dropped' : item.kind === 'feedback' && item.status === 'done');

    if (item.status === 'received') {
      button('Act on it', () => void this.update(item, { action: 'act' }, 'Moved to To act on.'), true);
      button('Talk it through', () => void this.update(item, { action: 'discuss' }, 'Moved to To discuss.'), true);
    }
    if (item.status === 'act' || item.status === 'discuss') {
      button('Done', () => void this.update(item, { action: 'done' }, 'Moved to Done.'), true);
    }
    if (canReply) button('Reply', () => this.openReply(item));
    if (open) button('Drop', () => this.askDrop(item, row));
    if (item.status === 'done' || item.status === 'dropped') {
      button('Reopen', () => void this.update(item, { action: 'reopen' }, 'Reopened.'));
    }
    return row;
  }

  /** @param {Item} item @param {HTMLElement} row */
  askDrop(item, row) {
    const id = `drop-${item.id}`;
    const input = el('input', { id, type: 'text', name: 'reason', maxlength: '120', placeholder: 'Junk, a test, said twice', autocomplete: 'off' });
    const form = el('form', { class: 'drop-form', novalidate: '' }, [
      el('div', { class: 'field' }, [el('label', { for: id }, ['Why drop it? ', el('span', { class: 'hint' }, ['(optional)'])]), input]),
    ]);
    const buttons = el('div', { class: 'actions' });
    buttons.append(el('button', { type: 'submit', class: 'primary' }, ['Drop it']));
    const keep = el('button', { type: 'button' }, ['Keep it']);
    buttons.append(keep);
    form.append(buttons);
    // The site's CSP allows no form to submit anywhere; this one never does, its script sends the move.
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const reason = input instanceof HTMLInputElement ? input.value.trim() : '';
      void this.update(item, { action: 'drop', reason }, 'Dropped.');
    });
    keep.addEventListener('click', () => this.render());
    row.replaceWith(form);
    input.focus();
  }

  /**
   * Makes one move, then shows the note where it now belongs. A failed move leaves the card as it was.
   * @param {Item} item
   * @param {Action} action
   * @param {string} said
   */
  async update(item, action, said) {
    /** @type {Item} */
    let updated;
    try {
      updated = await change(item.id, action);
    } catch (error) {
      this.render();
      this.fail(error, "That didn't save, so the note is where it was.");
      return;
    }
    const from = tabOf(item.status);
    const to = tabOf(updated.status);
    if (from !== to) {
      this.counts[from] = Math.max(0, this.counts[from] - 1);
      this.counts[to] += 1;
    }
    const at = this.items.findIndex((entry) => entry.id === item.id);
    this.items = this.items.map((entry) => (entry.id === item.id ? updated : entry));
    this.render();
    this.say(said);
    if (to !== this.tab) {
      const next = this.cards.children[Math.min(Math.max(at, 0), this.cards.children.length - 1)];
      const target = next?.querySelector('button, select') ?? this.tabs.find((tab) => tab.dataset.tab === this.tab);
      if (target instanceof HTMLElement) target.focus();
    }
    if (this.replyingTo?.id === item.id) this.replyingTo = updated;
  }

  wireReply() {
    const dialog = this.replyDialog;
    const to = find(dialog, '#reply-to', HTMLInputElement);
    const subject = find(dialog, '#reply-subject', HTMLInputElement);
    const body = find(dialog, '#reply-body', HTMLTextAreaElement);
    const open = find(dialog, '[data-open-gmail]', HTMLAnchorElement);
    const copied = find(dialog, '[data-copied]', HTMLElement);

    const refresh = () => {
      open.href = gmailLink({ to: to.value, subject: subject.value, body: body.value }, this.me);
    };
    subject.addEventListener('input', refresh);
    body.addEventListener('input', refresh);
    open.addEventListener('click', () => {
      const item = this.replyingTo;
      if (item) void this.update(item, { action: 'reply-opened' }, 'Reply opened in Gmail.');
    });
    find(dialog, '[data-copy]', HTMLButtonElement).addEventListener('click', () => {
      const text = `To: ${to.value}\nSubject: ${subject.value}\n\n${body.value}`;
      navigator.clipboard.writeText(text).then(
        () => {
          copied.textContent = 'Copied.';
        },
        () => {
          body.select();
          copied.textContent = 'Copy was refused here; the email is selected, so press Cmd+C.';
        },
      );
    });
    find(dialog, '[data-close-reply]', HTMLButtonElement).addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      this.replyingTo = null;
      copied.textContent = '';
    });
    /** @param {Draft} draft */
    this.fillReply = (draft) => {
      to.value = draft.to;
      subject.value = draft.subject;
      body.value = draft.body;
      refresh();
    };
  }

  /** @param {Item} item */
  openReply(item) {
    this.replyingTo = item;
    this.fillReply?.(draftReply(item));
    this.replyDialog.showModal();
    const body = find(this.replyDialog, '#reply-body', HTMLTextAreaElement);
    body.focus();
    body.setSelectionRange(0, 0);
    body.scrollTop = 0;
  }

  /** @type {((draft: Draft) => void) | undefined} */
  fillReply;
}

const root = document.querySelector('[data-inbox]');
if (root instanceof HTMLElement) void new Inbox(root).load();
