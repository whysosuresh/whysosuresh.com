// @ts-check
// Sharing a thread, as the owner's Share sheet says it (site/app/threads.js draws the sheet): the check an invitation
// passes before it is sent, the lines that tell him what an invited person will see and how many people have access,
// and the invitation itself, a draft his own Gmail opens for him to send; nothing is sent from the site. The link in
// it is the thread's own address with `?invite`, which takes a signed-out reader straight to Cloudflare's code page
// and back. Below the people, one switch makes the thread public: anyone with its link reads it with no sign-in, the
// link carrying the key the Worker gives it the first time and keeps for good, and only his own threads may be
// (`publicLines` says what the switch says, the link under it, why it is off for someone else's words, and, for a
// thread public before links had keys, that its number still opens it for anyone). The invitation keeps the number,
// which opens the thread for the person invited whether or not it is public. Under it, a second switch lists a public thread on his home page, under What's happening and in its feed
// (`feedLines`): public alone is readable by its link, never listed, so listing is its own act, and only a public thread
// can be listed. A visitor's note on a public thread is answered from his own Gmail too (`noteReply`). Plain data and
// pure functions, so a test can read them without a page.

import { shownAddress } from '../hosts.js';

/** How many people Cloudflare's free plan signs in. */
export const SEATS = 50;
/** The longest name, as the Worker takes it. */
const MAX_NAME = 80;
/**
 * An email address as an invitation takes it, the Worker's own shape: one `@`, a domain of two or more dot-separated
 * parts with none empty, and none of the characters that would split or quote it in a mail draft's recipients.
 */
const EMAIL_SHAPE = /^[^\s@,;:<>()"[\]\\]+@(?:[^\s@,;:<>()"[\]\\.]+\.)+[^\s@,;:<>()"[\]\\.]+$/;

/**
 * An address as typed, as the invitation sends it: trimmed, lower case, and without the full stop dictation leaves at
 * its end, which no address carries.
 * @param {string} email
 */
export function addressOf(email) {
  return email.trim().replace(/\.+$/, '').toLowerCase();
}

/**
 * Whether an address as typed is one the Worker takes, for an invitation or a person's page.
 * @param {string} email
 */
export function isAddress(email) {
  const address = addressOf(email);
  return EMAIL_SHAPE.test(address) && address.length <= 254;
}

/**
 * Why an invitation can't be sent yet, in words for the sheet, or null when it can.
 * @param {string} email the address as typed
 * @param {string} name the name as typed
 * @param {string} owner his own address
 * @param {readonly { email?: string }[]} people who the thread is shared with now
 * @returns {string | null}
 */
export function invitationProblem(email, name, owner, people) {
  const address = addressOf(email);
  if (!isAddress(email)) return "That isn't an email address.";
  if (owner !== '' && address === owner.trim().toLowerCase()) return "That's your own address. You're in every thread.";
  if (name.trim() === '') return 'Add their name. People in a thread see each other by name, never by address.';
  if (name.trim().length > MAX_NAME || /[\n\r]/.test(name)) return 'Keep the name to one short line.';
  if (people.some((person) => person.email === address)) return `${name.trim()} is already in this thread.`;
  return null;
}

/**
 * What an invited person will see of the thread, and what they never will.
 * @param {number} comments the comments everyone in the thread may read
 * @param {number} onlyMe the comments for him alone
 * @returns {{ sees: string, never: string }}
 */
export function seesLines(comments, onlyMe) {
  const said = comments === 0 ? 'no comments yet' : `${comments} comment${comments === 1 ? '' : 's'}`;
  return {
    sees: `the summary, the text and ${said}, the history without earlier versions, and everyone in the thread by name.`,
    never: `your Only me notes${onlyMe > 0 ? ` (${onlyMe} here)` : ''}, a visitor's email, or your other threads.`,
  };
}

/**
 * The line under the sheet: an invite opens one thread, and how many people have access to any of his threads.
 * @param {number} count
 */
export function seatsLine(count) {
  return `An invite opens this thread only. ${count} ${count === 1 ? 'person has' : 'people have'} access to your threads; Cloudflare signs in ${SEATS} free.`;
}

/**
 * The invitation, as a draft for his Gmail: to the person, about the thread, with its `?invite` link.
 * @param {{ number: number, title: string, path: string }} thread
 * @param {{ name: string, email: string }} person
 * @param {string} origin the site's own origin
 * @returns {{ to: string, subject: string, body: string }}
 */
export function invitation(thread, person, origin) {
  const first = person.name.trim().split(/\s+/)[0] || 'there';
  return {
    to: person.email,
    subject: `#${thread.number} ${thread.title}`,
    body: `Hi ${first},\n\nI've shared a thread with you on my site: ${thread.title}.\n\n${origin}${thread.path}?invite\n\nOpen the link and type this address. Cloudflare emails you a code to sign in; one code lasts a week on that device. You'll see this thread and can comment on it.\n\nSuresh`,
  };
}

/**
 * Names as a sentence: "Meera", "Meera and Dev", "Meera, Dev and Asha".
 * @param {readonly string[]} names
 */
export function listed(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** How much of a note a reply quotes. */
const QUOTE = 400;

/**
 * Who can see a thread, as the page names it: Public when he made it public, else Invited when it has people, else
 * Private.
 * @param {string | null} publicAt
 * @param {number} people
 * @returns {'Public' | 'Invited' | 'Private'}
 */
export function levelOf(publicAt, people) {
  if (publicAt !== null) return 'Public';
  return people > 0 ? 'Invited' : 'Private';
}

/**
 * What the Public switch says: its label, the line under it for where it stands, the link under it while it is on and
 * the Worker has given its key (null until then), and whether it can be turned on. Only his own threads can be public;
 * a site note's and a told thread's words are someone else's. A thread public before links had keys
 * (`publicByNumber`) says its number still opens it for anyone. A thread whose main section is a page says its link
 * opens on the page, full screen (site/app/page-view.js).
 * @param {string} origin the threads' own origin
 * @param {{ number: number, source: string, shareKey?: string | null, publicByNumber?: boolean, main?: string }} thread
 * @param {boolean} on
 * @returns {{ label: string, note: string, link: string | null, allowed: boolean }}
 */
export function publicLines(origin, thread, on) {
  const { number, source } = thread;
  const key = thread.shareKey ?? null;
  const label = 'Public: anyone with its link can read it';
  if (source !== 'self') {
    return {
      label,
      link: null,
      allowed: false,
      note:
        source === 'talk'
          ? "A note someone sent from the site can't be public: the words are theirs. Start a thread of your own and quote them, with their OK."
          : "Something someone told you can't be public: the words are theirs. Start a thread of your own and quote them, with their OK.",
    };
  }
  if (!on) {
    return {
      label,
      link: null,
      allowed: true,
      note: key === null ? 'Off: only you and the people above read it.' : 'Off: only you and the people above read it. Turn it on again and its link works again, the same link.',
    };
  }
  const byNumber = thread.publicByNumber
    ? `It was public before links had keys, so its number, #${number}, still opens it for anyone. Turn Public off and on again to make the link the only way in.`
    : `Its number, #${number}, opens it only for you and the people above.`;
  const opens = thread.main === 'page' ? ' The link opens on the page, full screen; the thread is one click away.' : '';
  return {
    label,
    link: key === null ? null : shownAddress(origin, `/threads/${key}`),
    allowed: true,
    note: `Anyone with the link reads the title, the summary, the text and the comments you write as Public, and with no sign-in can send you a note and answer its page's questions.${opens} What they write shows at once; you can drop it. Earlier comments, Only me notes, the people and the history stay yours. ${byNumber} Search engines are told not to list it.`,
  };
}

/**
 * A link as a toast says it once copied: the address as shown, a key cut to its first and last four characters, so
 * the line fits a phone ("hey.whysosuresh.com/threads/3f9a…c41e").
 * @param {string} origin
 * @param {string} path
 */
export function linkShown(origin, path) {
  return shownAddress(origin, path).replace(/\/threads\/([0-9a-f]{4})[0-9a-f]{24}([0-9a-f]{4})(?=$|\?)/, '/threads/$1…$2');
}

/**
 * What the home page switch says: its label, the line under it for where it stands, and whether it can be turned on.
 * Only a public thread can be on the home page; taking it back from public takes it off too.
 * @param {boolean} isPublic
 * @param {boolean} on
 * @returns {{ label: string, note: string, allowed: boolean }}
 */
export function feedLines(isPublic, on) {
  const label = "On the home page: listed under What's happening at whysosuresh.com";
  if (!isPublic) return { label, allowed: false, note: 'Make it public first: only a public thread can be on the home page.' };
  return {
    label,
    allowed: true,
    note: on
      ? 'Everyone who opens whysosuresh.com sees its title, its first lines, the day and how many notes it has, newest first, and so does anyone who subscribes to its feed. Turning Public off takes it off the home page too.'
      : 'Off: anyone with the link reads it, and it is listed nowhere.',
  };
}

/**
 * The reply to a visitor's note on a public thread, as a draft for his Gmail: to them, about the thread, the note
 * quoted.
 * @param {{ number: number, title: string }} thread
 * @param {{ name: string | null, email: string, body: string }} note
 * @returns {{ to: string, subject: string, body: string }}
 */
export function noteReply(thread, note) {
  const first = (note.name ?? '').trim().split(/\s+/)[0] || 'there';
  const cut = note.body.length > QUOTE ? `${note.body.slice(0, QUOTE).trimEnd()}…` : note.body;
  const quoted = cut.split('\n').map((line) => `> ${line}`).join('\n');
  return {
    to: note.email,
    subject: `Your note on #${thread.number} ${thread.title}`,
    body: `Hi ${first},\n\nThanks for your note on ${thread.title}:\n\n${quoted}\n\n[your answer]\n\nSuresh`,
  };
}
