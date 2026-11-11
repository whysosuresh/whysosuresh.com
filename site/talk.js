// @ts-check
// The note flow behind every "Send a note" button: a native dialog where a visitor picks what the note
// is about, sees two or three questions for that thing, types in one box, may leave a name and email,
// and sends. Someone who would rather speak uses their keyboard's microphone or a dictation app, which
// types into the box, so they see the words before sending. Closing never throws a note away: the note
// lives here, not in the screen, until it is sent or the page is reloaded, and nothing is kept in the
// browser's storage. The bot check and the upload sit behind talk-send.js's two calls. Opening the page
// at #talk opens the flow, and #talk/<topic> opens it on that topic, so a video description, a doc or a
// page with no button can link straight to it. In the picker, a topic that names an ask (talk-topics.js) is a link
// to that ask's questions page on the threads' host (hey.whysosuresh.com/ask/<slug>, site/hosts.js) rather than a
// choice that opens the note.

import { threadsOrigin } from './hosts.js';
import { TOPICS, topicFromHash } from './talk-topics.js';
import { prepare, send } from './talk-send.js';

/** The longest note, in UTF-16 code units of the trimmed text, as the server counts it; it checks too. */
const MAX_BODY = 4000;

/** The count under the box appears from here, so short notes never see it. */
const COUNT_FROM = 3500;

/** The booking page, offered where a call may be quicker than a note. */
const CALL = 'https://cal.com/whysosuresh';

/**
 * @typedef {'topic' | 'compose' | 'sending' | 'thanks' | 'limit'} State
 * @typedef {import('./talk-topics.js').Topic} Topic
 */

const PRIVACY = 'Only Suresh reads your note. Your email is used only to reply to you.';

const SHEET = `
  <div class="talk-sheet">
    <div class="sheet-top">
      <span class="sheet-name">A note to Suresh</span>
      <button type="button" class="close-button" data-close aria-label="Close">&times;</button>
    </div>
    <p class="visually-hidden" aria-live="polite" data-live></p>

    <section class="state" data-state="topic" aria-labelledby="talk-h-topic">
      <h2 id="talk-h-topic" tabindex="-1">What's it about?</h2>
      <ul class="topics" data-topics></ul>
    </section>

    <section class="state" data-state="compose" aria-labelledby="talk-h-compose" hidden>
      <p class="chip"><span>About <strong data-topic-label></strong></span><button type="button" class="text-button" data-change>Change</button></p>
      <h2 id="talk-h-compose" tabindex="-1">Any of these helps me most</h2>
      <ul class="questions" id="talk-questions" data-questions></ul>
      <p class="fine" data-call hidden>Something to talk through? A call may be quicker: <a href="${CALL}">book a call</a>.</p>
      <p class="notice" data-failed hidden>That didn't send. Check your connection and press Send again; your note is still here.</p>
      <form class="state" data-form novalidate>
        <div class="field">
          <label for="talk-body">Your note</label>
          <textarea id="talk-body" name="body" rows="7" dir="auto" aria-describedby="talk-questions talk-body-status"></textarea>
          <div class="under">
            <p class="fine">Rather say it? Your keyboard's microphone, or a dictation app, types as you talk.</p>
            <p id="talk-body-status" class="fine count" data-count></p>
          </div>
        </div>
        <div class="field">
          <label for="talk-name">Your name <span class="hint">(optional)</span></label>
          <input id="talk-name" name="name" autocomplete="name" maxlength="80">
        </div>
        <div class="field">
          <label for="talk-email">Your email <span class="hint">(optional: leave it if you'd like to hear back)</span></label>
          <input id="talk-email" name="email" type="email" autocomplete="email" maxlength="200" aria-describedby="talk-email-error">
          <p id="talk-email-error" class="fine" data-email-error hidden>That email doesn't look complete. Fix it, or leave it empty.</p>
        </div>
        <p class="fine">${PRIVACY}</p>
        <button type="submit" class="talk-button big">Send to Suresh</button>
      </form>
    </section>

    <section class="state" data-state="sending" aria-labelledby="talk-h-sending" hidden>
      <h2 id="talk-h-sending" tabindex="-1">Sending</h2>
      <p>This takes a few seconds.</p>
    </section>

    <section class="state" data-state="thanks" aria-labelledby="talk-h-thanks" hidden>
      <h2 id="talk-h-thanks" tabindex="-1">Thank you</h2>
      <p data-thanks-line></p>
      <div class="actions">
        <button type="button" class="ghost-button" data-close>Close</button>
      </div>
    </section>

    <section class="state" data-state="limit" aria-labelledby="talk-h-limit" hidden>
      <h2 id="talk-h-limit" tabindex="-1">Lots of people wrote to Suresh today</h2>
      <p>Try again tomorrow; your note is still here.</p>
      <div class="actions">
        <button type="button" class="ghost-button" data-copy>Copy your note</button>
        <a class="ghost-button" href="${CALL}">Book a call</a>
      </div>
      <div class="field" data-copy-box hidden>
        <label for="talk-copy">Your note, selected: copy it with your keyboard</label>
        <textarea id="talk-copy" rows="5" readonly></textarea>
      </div>
    </section>
  </div>`;

/**
 * @template {Element} T
 * @param {ParentNode} root
 * @param {string} selector
 * @param {new () => T} kind
 * @returns {T}
 */
function find(root, selector, kind) {
  const el = root.querySelector(selector);
  if (!(el instanceof kind)) throw new Error(`talk: missing ${selector}`);
  return el;
}

/** @param {unknown} err */
function reasonOf(err) {
  return err instanceof Error && 'reason' in err ? String(err.reason) : 'failed';
}

/** @param {number} n */
function count(n) {
  return n.toLocaleString('en-US');
}

class TalkFlow {
  constructor() {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'talk-dialog';
    this.dialog.setAttribute('aria-label', 'A note to Suresh');
    this.dialog.innerHTML = SHEET;
    document.body.append(this.dialog);

    /** @type {State} */
    this.state = 'topic';
    /** @type {Topic | null} */
    this.topic = null;
    /** Set when Send was pressed on an empty box, until something is typed. */
    this.askedForWords = false;

    this.live = find(this.dialog, '[data-live]', HTMLElement);
    this.form = find(this.dialog, '[data-form]', HTMLFormElement);
    this.bodyInput = find(this.dialog, '#talk-body', HTMLTextAreaElement);
    this.nameInput = find(this.dialog, '#talk-name', HTMLInputElement);
    this.emailInput = find(this.dialog, '#talk-email', HTMLInputElement);
    this.countEl = find(this.dialog, '[data-count]', HTMLElement);
    this.failedEl = find(this.dialog, '[data-failed]', HTMLElement);
    this.copyButton = find(this.dialog, '[data-copy]', HTMLButtonElement);
    this.copyBox = find(this.dialog, '[data-copy-box]', HTMLElement);
    this.copyArea = find(this.dialog, '#talk-copy', HTMLTextAreaElement);

    const list = find(this.dialog, '[data-topics]', HTMLElement);
    for (const topic of TOPICS) {
      const label = document.createElement('strong');
      label.textContent = topic.label;
      const hint = document.createElement('span');
      hint.textContent = topic.hint;
      const item = document.createElement('li');
      if (topic.ask === undefined) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'topic';
        button.dataset.topic = topic.slug;
        button.append(label, hint);
        item.append(button);
      } else {
        // A topic that names an ask opens its questions page, on the threads' host, instead of the note; #talk/<topic>
        // still opens the note.
        const link = document.createElement('a');
        link.className = 'topic';
        link.href = `${threadsOrigin(location.origin)}/ask/${topic.ask}`;
        const go = document.createElement('em');
        go.textContent = 'A few questions →';
        link.append(label, hint, go);
        item.append(link);
      }
      list.append(item);
    }

    this.dialog.addEventListener('click', (event) => this.onClick(event));
    this.dialog.addEventListener('close', () => this.onClose());
    this.bodyInput.addEventListener('input', () => {
      if (this.bodyInput.value.trim()) this.askedForWords = false;
      this.renderCount();
    });
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.sendNote();
    });
  }

  /**
   * Opens the sheet where the visitor left it: on their note if it has a topic, else on the picker. A
   * topic from a link replaces the note's topic and keeps its words.
   * @param {string | null} slug
   */
  open(slug) {
    if (slug) this.setTopic(slug);
    if (this.dialog.open) {
      if (slug && this.state !== 'sending') this.show('compose');
      return;
    }
    if (this.state !== 'sending') this.show(this.topic ? 'compose' : 'topic');
    this.dialog.showModal();
    this.focusHeading();
  }

  /** @param {MouseEvent} event */
  onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    // A click on the backdrop closes the sheet; the note stays for the next open.
    if (target === this.dialog || target.closest('[data-close]')) {
      this.dialog.close();
      return;
    }
    const topic = target.closest('[data-topic]');
    if (topic instanceof HTMLElement && topic.dataset.topic) {
      this.setTopic(topic.dataset.topic);
      this.show('compose');
    } else if (target.closest('[data-change]')) this.show('topic');
    else if (target.closest('[data-copy]')) void this.copyNote();
  }

  /** Closing keeps the note. A finished send's thank-you is not shown again. */
  onClose() {
    if (this.state === 'thanks') this.state = 'topic';
    this.copyBox.hidden = true;
    if (topicFromHash(location.hash).open) {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch {
        // Some frames refuse history changes; the hash then stays, which is harmless.
      }
    }
  }

  /** @param {State} state */
  show(state) {
    this.state = state;
    for (const section of this.dialog.querySelectorAll('[data-state]')) {
      if (section instanceof HTMLElement) section.hidden = section.dataset.state !== state;
    }
    // The bot check gets ready while the visitor writes, so Send doesn't wait for it.
    if (state === 'compose') prepare();
    if (state === 'limit') {
      this.copyButton.textContent = 'Copy your note';
      this.copyBox.hidden = true;
    }
    if (this.dialog.open) this.focusHeading();
  }

  focusHeading() {
    const heading = this.dialog.querySelector(`[data-state="${this.state}"] h2`);
    if (heading instanceof HTMLElement) heading.focus();
  }

  /** @param {string} text */
  announce(text) {
    this.live.textContent = text;
  }

  /** @param {string} slug */
  setTopic(slug) {
    const topic = TOPICS.find((t) => t.slug === slug);
    if (!topic) return;
    this.topic = topic;
    find(this.dialog, '[data-topic-label]', HTMLElement).textContent = topic.label;
    const questions = find(this.dialog, '[data-questions]', HTMLElement);
    questions.replaceChildren(
      ...topic.questions.map((question) => {
        const item = document.createElement('li');
        item.textContent = question;
        return item;
      }),
    );
    find(this.dialog, '[data-call]', HTMLElement).hidden = !topic.offersCall;
  }

  /** The line under the box: a count near the limit, or what stops a send. Nothing is ever cut. */
  renderCount() {
    const n = this.bodyInput.value.trim().length;
    /** @type {string} */
    let text = '';
    let wrong = false;
    if (n > MAX_BODY) {
      text = `${count(n)} of ${count(MAX_BODY)}: trim a little to send`;
      wrong = true;
    } else if (n === 0 && this.askedForWords) {
      text = 'Write something first';
      wrong = true;
    } else if (n >= COUNT_FROM) {
      text = `${count(n)} of ${count(MAX_BODY)}`;
    }
    this.countEl.textContent = text;
    this.countEl.hidden = text === '';
    this.countEl.toggleAttribute('data-wrong', wrong);
    this.bodyInput.setAttribute('aria-invalid', String(wrong));
  }

  async sendNote() {
    const topic = this.topic;
    if (!topic) {
      this.show('topic');
      return;
    }
    const body = this.bodyInput.value.trim();
    if (body.length === 0 || body.length > MAX_BODY) {
      this.askedForWords = body.length === 0;
      this.renderCount();
      this.bodyInput.focus();
      return;
    }
    const email = this.emailInput.value.trim();
    const emailError = find(this.dialog, '[data-email-error]', HTMLElement);
    const emailOk = email === '' || this.emailInput.checkValidity();
    emailError.hidden = emailOk;
    this.emailInput.setAttribute('aria-invalid', String(!emailOk));
    if (!emailOk) {
      this.emailInput.focus();
      return;
    }
    const name = this.nameInput.value.trim();
    this.failedEl.hidden = true;
    this.show('sending');
    try {
      await send({ topic: topic.slug, body, name, email });
    } catch (err) {
      if (reasonOf(err) === 'limit') {
        this.show('limit');
      } else {
        this.failedEl.hidden = false;
        this.show('compose');
        this.announce("That didn't send. Your note is still here.");
      }
      return;
    }
    const greeting = name ? `Thanks, ${name}. ` : '';
    find(this.dialog, '[data-thanks-line]', HTMLElement).textContent = email
      ? `${greeting}Suresh will read it, and he'll write to you at ${email}.`
      : `${greeting}Suresh will read it. You didn't leave an email, so he can't write back, and that's fine.`;
    this.clearNote();
    this.show('thanks');
  }

  /** Copies the note from the press itself; where the clipboard is refused, the text is selected instead. */
  async copyNote() {
    const text = this.bodyInput.value;
    try {
      await navigator.clipboard.writeText(text);
      this.copyButton.textContent = 'Copied';
      this.announce('Your note is copied.');
    } catch {
      this.copyArea.value = text;
      this.copyBox.hidden = false;
      this.copyArea.focus();
      this.copyArea.select();
    }
  }

  /** Only a successful send clears the note. */
  clearNote() {
    this.form.reset();
    this.topic = null;
    this.askedForWords = false;
    this.failedEl.hidden = true;
    this.renderCount();
  }
}

/** @type {TalkFlow | null} */
let flow = null;

/** @param {string | null} slug */
function openTalk(slug) {
  flow ??= new TalkFlow();
  flow.open(slug);
}

for (const button of document.querySelectorAll('[data-talk]')) {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    openTalk(null);
  });
}

function openFromHash() {
  const link = topicFromHash(location.hash);
  if (link.open) openTalk(link.topic);
}
window.addEventListener('hashchange', openFromHash);
openFromHash();
