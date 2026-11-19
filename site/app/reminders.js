// @ts-check
// Reminders, as one meaning that the threads page (site/app/threads.js), the Worker (src/store.ts, src/threads.ts) and
// the inbox's command line (tools/inbox/run.ts) all read, so "due" never means two things. A thread may carry one
// reminder (migrations/0027_reminders.sql): a series, which is a day it counts from (`start`) and a repeat in days
// (`every`, 1 to 366, or null for once), and the next day it is due (`on`), which Later may move off the series for
// one time without moving the series itself. Due is a comparison of two days made on read, never stored: a reminder is
// due when its `on` is today or earlier and its thread isn't dropped. Every day here is a day in his zone (`ZONE`),
// not the reader's: a reminder is a day of his, so the page, the phone, the command line and the sync agree on today
// even while he travels. A meeting is an instant each reader sees in their own zone (site/app/meetings.js); a reminder
// is not. Plain data and pure functions with no clock: today, and the moment it is read from, are always given.

/**
 * @typedef {{ start: string, every: number | null }} Series
 * @typedef {Series & { on: string }} Reminder
 * @typedef {string | undefined} Locale
 */

/** His zone: the days every reminder is due in, and the home page's dates (src/home.ts). */
export const ZONE = 'Asia/Kolkata';
/** The longest repeat, in days: a year, leap day included. */
export const MAX_EVERY = 366;
/** A day: YYYY-MM-DD. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 3600 * 1000;

/** Whether a value is a day's shape, `YYYY-MM-DD`; whether it is on the calendar is the Worker's check. @param {unknown} value @returns {value is string} */
export function isDayShape(value) {
  return typeof value === 'string' && DAY.test(value);
}

/** Whether a repeat is one a reminder may have: a whole number of days from 1 to `MAX_EVERY`. @param {unknown} every @returns {every is number} */
export function isEvery(every) {
  return typeof every === 'number' && Number.isInteger(every) && every >= 1 && every <= MAX_EVERY;
}

/** The day it is in his zone at a moment. @param {number} now */
export function todayIn(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

/** A day `n` days after another. @param {string} day @param {number} n */
export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** How many days `to` is after `from` (negative when before). @param {string} from @param {string} to */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The later of two days. @param {string} a @param {string} b */
function later(a, b) {
  return a > b ? a : b;
}

/**
 * The series' first day on or after `day`: its start when that is not before `day`; else, for a repeat, the first day
 * on its rhythm from there, and for once, null, because a day gone by never comes again.
 * @param {Series} series @param {string} day
 */
export function firstOnOrAfter(series, day) {
  if (series.start >= day) return series.start;
  if (series.every === null) return null;
  const steps = Math.ceil(daysBetween(series.start, day) / series.every);
  return addDays(series.start, steps * series.every);
}

/** The series' first day after `day`, on its rhythm; null for once, which has no day after its own. @param {Series} series @param {string} day */
export function nextAfter(series, day) {
  return series.every === null ? null : firstOnOrAfter(series, addDays(day, 1));
}

/**
 * Where a reminder goes when he marks it done today: once, it ends (null); a repeat goes to its first day on its
 * rhythm after both today and the day it was due, so weeks he missed never pile up, and done before the day skips
 * that one. A Later that moved it off its rhythm is forgotten: it goes back on.
 * @param {Reminder} reminder @param {string} today
 */
export function afterDone(reminder, today) {
  return nextAfter(reminder, later(today, reminder.on));
}

/**
 * Whether a reminder is due today: its day is today or gone by, and its thread isn't dropped. A dropped thread's
 * reminder is kept and never due, as a dropped thread's meeting leaves every list; reopening it brings it back.
 * @param {Reminder | null} reminder @param {string} status @param {string} today
 */
export function isDue(reminder, status, today) {
  return reminder !== null && status !== 'dropped' && reminder.on <= today;
}

/** The day a due reminder has waited since, when that is before today; null when it is due today or isn't due. @param {Reminder | null} reminder @param {string} status @param {string} today */
export function dueSince(reminder, status, today) {
  return isDue(reminder, status, today) && reminder !== null && reminder.on < today ? reminder.on : null;
}

/**
 * Reminders in the order Today's Due shows them, oldest due first, then by number; the rows given are kept as they
 * are. @template {{ number: number, reminder?: Reminder | null }} T @param {readonly T[]} rows
 */
export function byDue(rows) {
  return [...rows].sort((a, b) => (a.reminder?.on ?? '').localeCompare(b.reminder?.on ?? '') || a.number - b.number);
}

/** "Mon 23 Nov", and "Mon 4 Jan 2027" outside today's year, in the reader's locale. @param {string} day @param {string} today @param {Locale} locale */
export function dayWords(day, today, locale) {
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  const options = /** @type {Intl.DateTimeFormatOptions} */ ({ timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  return new Intl.DateTimeFormat(locale, options).format(new Date(`${day}T12:00:00Z`)).replaceAll(',', '');
}

/** "Monday", the day of the week a day is on, in the reader's locale. @param {string} day @param {Locale} locale */
export function weekdayWords(day, locale) {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${day}T12:00:00Z`));
}

/** "Every day", "Every week", "Every 2 weeks", "Every 10 days", or "Once". @param {number | null} every */
export function everyWords(every) {
  if (every === null) return 'Once';
  if (every === 1) return 'Every day';
  if (every === 7) return 'Every week';
  if (every % 7 === 0) return `Every ${every / 7} weeks`;
  return `Every ${every} days`;
}

/** The series as one line: "Every week from Mon 23 Nov", or "Once, Tue 25 Nov" for once, by the day it is due. @param {Reminder} reminder @param {string} today @param {Locale} locale */
export function seriesWords(reminder, today, locale) {
  if (reminder.every === null) return `Once, ${dayWords(reminder.on, today, locale)}`;
  return `${everyWords(reminder.every)} from ${dayWords(reminder.start, today, locale)}`;
}

/**
 * When it is due, as a reader says it: "Due today", "Due since Mon 16 Nov", "Due tomorrow", "Next Mon 30 Nov"; a
 * dropped thread's reminder is "Paused while dropped".
 * @param {Reminder} reminder @param {string} status @param {string} today @param {Locale} locale
 */
export function dueWords(reminder, status, today, locale) {
  if (status === 'dropped') return 'Paused while dropped';
  if (reminder.on === today) return 'Due today';
  if (reminder.on < today) return `Due since ${dayWords(reminder.on, today, locale)}`;
  if (reminder.on === addDays(today, 1)) return 'Due tomorrow';
  return `Next ${dayWords(reminder.on, today, locale)}`;
}

/** The days Later offers: tomorrow, and the next Monday after today. @param {string} today */
export function laterDays(today) {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return { tomorrow: addDays(today, 1), monday: addDays(today, ((8 - weekday) % 7) || 7) };
}

/**
 * A reminder's line in a thread's history, after who did it: "set a reminder: every week from Mon 23 Nov",
 * "cleared the reminder", "moved the reminder to Tue 24 Nov", "marked the reminder done for Mon 23 Nov; next Mon 30
 * Nov", or, for once, "marked the reminder done for Wed 25 Nov". Null for an event that isn't a reminder's, or data
 * not in the shape the store writes.
 * @param {string} type @param {Record<string, unknown>} data @param {string} today @param {Locale} locale
 */
export function reminderEventWords(type, data, today, locale) {
  const day = (/** @type {unknown} */ value) => (isDayShape(value) ? dayWords(value, today, locale) : null);
  if (type === 'reminder-set') {
    const to = /** @type {Record<string, unknown> | null} */ (typeof data.to === 'object' ? data.to : null);
    const every = to?.every ?? null;
    const start = day(to?.start);
    if (start === null || (every !== null && !isEvery(every))) return null;
    return isEvery(every) ? `set a reminder: ${everyWords(every).toLowerCase()} from ${start}` : `set a reminder for ${start}`;
  }
  if (type === 'reminder-cleared') return 'cleared the reminder';
  if (type === 'reminder-snoozed') {
    const to = day(data.to);
    return to === null ? null : `moved the reminder to ${to}`;
  }
  if (type === 'reminder-done') {
    const done = day(data.day);
    if (done === null) return null;
    const next = day(data.next);
    return next === null ? `marked the reminder done for ${done}` : `marked the reminder done for ${done}; next ${next}`;
  }
  return null;
}

/**
 * The line under a reminder on its thread: what Done will do while it is due, when it comes back while it is ahead, and
 * that it waits while the thread is dropped.
 * @param {Reminder} reminder @param {string} status @param {string} today @param {Locale} locale
 */
export function stripLine(reminder, status, today, locale) {
  if (status === 'dropped') return 'Paused while the thread is dropped; reopening it brings it back.';
  if (!isDue(reminder, status, today)) return "It comes back under Due on Today that morning, India's day.";
  const next = afterDone(reminder, today);
  return next === null ? 'Done ends it. It never changes where the thread stands.' : `Done sends it to ${dayWords(next, today, locale)}. It never changes where the thread stands.`;
}

/** Later's note under its days: only this time moves, and a repeat keeps its day; none for once. @param {Reminder} reminder @param {Locale} locale */
export function laterNote(reminder, locale) {
  if (reminder.every === null) return null;
  return reminder.every % 7 === 0 ? `Only this time; it stays on ${weekdayWords(reminder.start, locale)}s.` : 'Only this time; its rhythm stays.';
}

/** What Done said: "Done for Mon 16 Nov. Next: Mon 23 Nov.", or, when it ended, "It won't come back." @param {Reminder} reminder @param {string | null} next @param {string} today @param {Locale} locale */
export function doneWords(reminder, next, today, locale) {
  const was = dayWords(reminder.on, today, locale);
  return next === null ? `Done for ${was}. It won't come back.` : `Done for ${was}. Next: ${dayWords(next, today, locale)}.`;
}

/** What Later said: "Later: Fri 20 Nov, then back on Mondays." @param {Reminder} reminder @param {string} day @param {string} today @param {Locale} locale */
export function laterWords(reminder, day, today, locale) {
  const back = reminder.every !== null && reminder.every % 7 === 0 ? `, then back on ${weekdayWords(reminder.start, locale)}s` : '';
  return `Later: ${dayWords(day, today, locale)}${back}.`;
}

/**
 * What the editor says a series will do before it is saved: the problem with it, or a line in three parts, the day in
 * the middle to stand out ("Next: " "Mon 23 Nov" ", then every Monday. …"; "Comes back under Due on Today " "on Wed 25
 * Nov" ", once.").
 * @param {Series} series @param {string} today @param {Locale} locale
 * @returns {{ problem: string } | { lead: string, day: string, rest: string }}
 */
export function previewWords(series, today, locale) {
  const next = firstOnOrAfter(series, today);
  if (next === null) return { problem: 'That day has gone by. Pick today or a day after.' };
  const every = series.every;
  if (every === null) return { lead: 'Comes back under Due on Today ', day: next === today ? 'today' : `on ${dayWords(next, today, locale)}`, rest: ', once.' };
  const weekday = weekdayWords(next, locale);
  const then = every === 1 ? 'every day' : every === 7 ? `every ${weekday}` : every % 7 === 0 ? `every ${every / 7} weeks on ${weekday}s` : `every ${every} days`;
  return { lead: 'Next: ', day: next === today ? 'today' : dayWords(next, today, locale), rest: `, then ${then}. Due by India's day wherever you are.` };
}
