// @ts-check
// Meetings, as the threads page says them (site/app/threads.js draws them): a thread's meeting is a day, its time not
// set yet, or an instant in UTC (the Worker's src/wire.ts), and every reader sees it in their own zone, with the
// zone named the way their own locale names it ("IST" for Indian English, "GMT+5:30" for US English, the same zone).
// These are the words the page uses: the when as one line, a row's short date, a room's lead, the card's two lines,
// who is in it, whether it is coming or past, and what the editor sends. Plain data and pure functions, the locale and
// zone given, so a test reads them in India and in Los Angeles without touching the machine's own zone.

/**
 * @typedef {{ when: string, minutes: number | null, where: string | null }} When
 * @typedef {{ number?: number, name: string | null, you?: boolean }} Attendee
 * @typedef {When & { attendees: Attendee[] }} Meeting
 * @typedef {string | undefined} Locale
 * @typedef {'soon' | 'later' | 'past'} State
 */

const DAY_MS = 24 * 3600 * 1000;
/** How long a meeting with no length is taken to last, for whether it is still on. */
const DEFAULT_MINUTES = 60;
/** A meeting's day: YYYY-MM-DD, with no time. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a meeting's when is a day, its time not set. @param {string} when */
export function isDay(when) {
  return DAY.test(when);
}

/** The calendar day a meeting is on for a reader in `zone`: a day is the same everywhere, a moment is the zone's own. @param {string} when @param {string} zone */
export function dayKey(when, zone) {
  if (isDay(when)) return when;
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(when));
}

/** Today in `zone`. @param {number} now @param {string} zone */
export function todayKey(now, zone) {
  return dayKey(new Date(now).toISOString(), zone);
}

/** A day `n` days after another. @param {string} key @param {number} n */
export function addDays(key, n) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** "Mon 9 Nov", for a day, in the reader's locale. @param {string} key @param {Locale} locale */
export function dayWords(key, locale) {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${key}T12:00:00Z`)).replace(',', '');
}

/** "3:00 pm IST", a moment's time with its zone named as the locale names it. @param {string} when @param {Locale} locale @param {string} zone */
export function timeWords(when, locale, zone) {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(when));
}

/** A moment's time alone, for a chip or a room's lead. @param {string} when @param {Locale} locale @param {string} zone */
function clockWords(when, locale, zone) {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(when));
}

/** "45 min", "1 hr", "1 hr 30 min"; empty when not said. @param {number | null} minutes */
export function lengthWords(minutes) {
  if (minutes === null) return '';
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0 ? `${minutes / 60} hr` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

/** "Today", "Tomorrow", "Yesterday", or the day itself. @param {string} key @param {number} now @param {Locale} locale @param {string} zone */
export function dayName(key, now, locale, zone) {
  const today = todayKey(now, zone);
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  return dayWords(key, locale);
}

/**
 * The when as one line: "Mon 9 Nov · time not set", "Today, 3:00 pm IST · 45 min · Google Meet".
 * @param {When} meeting @param {number} now @param {Locale} locale @param {string} zone
 */
export function whenLine(meeting, now, locale, zone) {
  const day = dayName(dayKey(meeting.when, zone), now, locale, zone);
  const time = isDay(meeting.when) ? `${day} · time not set` : `${day}, ${timeWords(meeting.when, locale, zone)}`;
  return [time, lengthWords(meeting.minutes), meeting.where ?? ''].filter((part) => part !== '').join(' · ');
}

/** The when alone, with no length or where: what a history line says. @param {string} when @param {number} now @param {Locale} locale @param {string} zone */
export function momentWords(when, now, locale, zone) {
  return whenLine({ when, minutes: null, where: null }, now, locale, zone);
}

/** A row's short date: "Today, 3:00 pm", "Mon 9 Nov". @param {When} meeting @param {number} now @param {Locale} locale @param {string} zone */
export function chipWords(meeting, now, locale, zone) {
  const day = dayName(dayKey(meeting.when, zone), now, locale, zone);
  return isDay(meeting.when) ? day : `${day}, ${clockWords(meeting.when, locale, zone)}`;
}

/** What leads a meeting's row in a room: its time when it is today, else its weekday. @param {When} meeting @param {number} now @param {Locale} locale @param {string} zone */
export function leadWords(meeting, now, locale, zone) {
  const key = dayKey(meeting.when, zone);
  const day = dayName(key, now, locale, zone);
  if (day === 'Today' && !isDay(meeting.when)) return clockWords(meeting.when, locale, zone);
  if (day === 'Today' || day === 'Tomorrow' || day === 'Yesterday') return day;
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${key}T12:00:00Z`));
}

/**
 * When a meeting begins, as a moment, for sorting: a moment as it is, a day from its start in the reader's zone.
 * @param {string} when @param {string} zone
 */
export function startOf(when, zone) {
  if (!isDay(when)) return Date.parse(when);
  // The zone's offset at noon that day, so the day's start lands on the right side of a daylight change.
  const noon = Date.parse(`${when}T12:00:00Z`);
  const shown = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(noon));
  const [hours = 12, minutes = 0] = shown.split(':').map(Number);
  return Date.parse(`${when}T00:00:00Z`) - ((hours - 12) * 60 + minutes) * 60000;
}

/**
 * Whether a meeting is soon (today or tomorrow for a day; within a day for a moment), later, or past (a day before
 * today; a moment whose length has run out, an hour when none was said).
 * @param {When} meeting @param {number} now @param {string} zone
 * @returns {State}
 */
export function stateOf(meeting, now, zone) {
  if (isDay(meeting.when)) {
    const key = meeting.when;
    const today = todayKey(now, zone);
    if (key < today) return 'past';
    return key <= addDays(today, 1) ? 'soon' : 'later';
  }
  const start = Date.parse(meeting.when);
  if (start + (meeting.minutes ?? DEFAULT_MINUTES) * 60000 < now) return 'past';
  return start - now < DAY_MS ? 'soon' : 'later';
}

/** "In 2 hours", "in 3 days", "now", for a moment ahead. @param {number} at @param {number} now */
export function relative(at, now) {
  const minutes = Math.round((at - now) / 60000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** Names joined as people say them: "Asha", "Asha and Dev", "Asha, Dev and Lin". @param {string[]} names */
function joined(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Who is in it, besides Suresh: "With you and Dev", "No one added yet". @param {readonly Attendee[]} attendees */
export function withLine(attendees) {
  if (attendees.length === 0) return 'No one added yet';
  const yours = attendees.some((one) => one.you === true);
  const others = attendees.filter((one) => one.you !== true).map((one) => one.name?.trim() || 'someone');
  return `With ${joined(yours ? ['you', ...others] : others)}`;
}

/**
 * The next meeting's card: "3:00 pm · Pricing call with Meera", then "in 2 hours · 45 min · Google Meet".
 * @param {When} meeting @param {string} title @param {number} now @param {Locale} locale @param {string} zone
 */
export function cardLines(meeting, title, now, locale, zone) {
  const day = dayName(dayKey(meeting.when, zone), now, locale, zone);
  if (isDay(meeting.when)) return { head: `${day} · ${title}`, rest: ['time not set', lengthWords(meeting.minutes), meeting.where ?? ''].filter((part) => part !== '').join(' · ') };
  const clock = clockWords(meeting.when, locale, zone);
  const head = day === 'Today' ? `${clock} · ${title}` : `${day}, ${clock} · ${title}`;
  return { head, rest: [relative(Date.parse(meeting.when), now), lengthWords(meeting.minutes), meeting.where ?? ''].filter((part) => part !== '').join(' · ') };
}

/**
 * The meetings coming (soonest first) and past (newest first), of the threads given, by `meetingOf`.
 * @template T
 * @param {readonly T[]} threads @param {(thread: T) => When | null} meetingOf @param {number} now @param {string} zone
 */
export function split(threads, meetingOf, now, zone) {
  /** @type {{ thread: T, meeting: When }[]} */
  const all = [];
  for (const thread of threads) {
    const meeting = meetingOf(thread);
    if (meeting) all.push({ thread, meeting });
  }
  const at = (/** @type {{ meeting: When }} */ one) => startOf(one.meeting.when, zone);
  const coming = all.filter((one) => stateOf(one.meeting, now, zone) !== 'past').sort((a, b) => at(a) - at(b));
  const past = all.filter((one) => stateOf(one.meeting, now, zone) === 'past').sort((a, b) => at(b) - at(a));
  return { coming: coming.map((one) => one.thread), past: past.map((one) => one.thread) };
}

/**
 * What the editor sends for a day and a time typed in the reader's own zone: the day alone when no time is given,
 * else the moment with the zone's offset that day (`offsetMinutes`, east of UTC positive), so the Worker keeps it in
 * UTC. Null for a day or a time that isn't one.
 * @param {string} day @param {string} time @param {number} offsetMinutes
 */
export function whenOf(day, time, offsetMinutes) {
  if (!DAY.test(day)) return null;
  if (time.trim() === '') return day;
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const sign = offsetMinutes < 0 ? '-' : '+';
  const off = Math.abs(offsetMinutes);
  return `${day}T${time}${sign}${String(Math.floor(off / 60)).padStart(2, '0')}:${String(off % 60).padStart(2, '0')}`;
}

/**
 * The day and the time the editor opens with, in the reader's zone: a moment's own, a day with no time.
 * @param {string} when @param {string} zone
 */
export function partsOf(when, zone) {
  if (isDay(when)) return { day: when, time: '' };
  const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(when));
  return { day: dayKey(when, zone), time };
}

/**
 * Who the editor adds and takes off: the people chosen against the meeting's own, by number, and the new names typed.
 * @param {readonly number[]} before @param {readonly number[]} chosen @param {readonly string[]} named
 */
export function peopleChanges(before, chosen, named) {
  return {
    add: chosen.filter((number) => !before.includes(number)),
    remove: before.filter((number) => !chosen.includes(number)),
    named: named.map((name) => name.trim()).filter((name) => name !== ''),
  };
}
