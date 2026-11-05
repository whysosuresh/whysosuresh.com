// @ts-check
// Sharing a thread, as the owner's Share sheet says it (site/app/threads.js draws the sheet): the check an invitation
// passes before it is sent, the lines that tell him what an invited person will see and how many people have access,
// and the invitation itself, a draft his own Gmail opens for him to send; nothing is sent from the site. The link in
// it is the thread's own address with `?invite`, which takes a signed-out reader straight to Cloudflare's code page
// and back. Plain data and pure functions, so a test can read them without a page.

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
 * Why an invitation can't be sent yet, in words for the sheet, or null when it can.
 * @param {string} email the address as typed
 * @param {string} name the name as typed
 * @param {string} owner his own address
 * @param {readonly { email?: string }[]} people who the thread is shared with now
 * @returns {string | null}
 */
export function invitationProblem(email, name, owner, people) {
  const address = addressOf(email);
  if (!EMAIL_SHAPE.test(address) || address.length > 254) return "That isn't an email address.";
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
