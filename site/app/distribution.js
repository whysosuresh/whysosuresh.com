// @ts-check
// Distribution, as the threads page says it (site/app/threads.js draws the room at /distribution and
// /distribution/capsjump, and Today's row): where telling people about Stigmer and CapsJump stands, from the records
// the recorder sync's runs write (the Worker's src/distribution.ts). Everything the room shows is worked out here from
// those records, and nothing of it is stored: the next moves (someone waiting on a reply, a day reached, a week's pace
// short, a platform gone quiet, the strategy's check date), the goal against today, a row per platform, the work in the
// Distribution collection split into what waits on a condition and what is his to do, the people met in public, and
// the log. Plain data and pure functions with no clock: today and now are always given, made by the page in his zone,
// so a test can read them without a page.
//
// The goal's target and dates, and the pace a platform is kept to, are copies of the strategy the distribution runs
// follow; when it changes, the runs set each platform's pace again and these constants change in a commit.

import { weekOf } from './journal.js';
import { summaryLines } from './markdown.js';

/**
 * @typedef {'stigmer' | 'capsjump'} Product
 * @typedef {{ number: number, name: string | null }} Named
 * @typedef {{ id: string, ref: string, at: string, product: string, platform: string, kind: string, audience: string | null,
 *   url: string | null, conversation: string | null, person: Named | null, line: string, createdAt: string, voidedAt: string | null }} Act
 * @typedef {{ platform: string, state: string, note: string | null, until: string | null, pace: number | null, changedAt: string }} Platform
 * @typedef {{ metric: string, week: string, value: number, readAt: string }} Reading
 * @typedef {{ number: number, title: string | null, summary: string | null, status: string }} WorkThread
 * @typedef {{ product: string, since: string, platforms: Platform[], acts: Act[], truncated: boolean, readings: Reading[],
 *   work: { collection: number | null, threads: WorkThread[] }, log: { number: number, title: string | null } | null }} Room
 * @typedef {{ sev: 'hot' | 'due', kind: string, what: string, why: string, platform: string | null, url: string | null }} Move
 */

/** The room's address: Stigmer's at the room itself, CapsJump's under it. */
export const DISTRIBUTION_PATH = '/distribution';
export const DISTRIBUTION_ROUTE = /^\/distribution(?:\/(capsjump))?$/;

/** The products with a distribution, in the switch's order. */
export const PRODUCTS = /** @type {const} */ (['stigmer', 'capsjump']);
export const PRODUCT_NAMES = { stigmer: 'Stigmer', capsjump: 'CapsJump' };

/** A product's room address. @param {Product} product */
export function distributionPath(product) {
  return product === 'stigmer' ? DISTRIBUTION_PATH : `${DISTRIBUTION_PATH}/${product}`;
}

/** The goal Stigmer's distribution runs toward: about ten teams trying it and talking to us, by 15 January. */
export const GOAL_TEAMS = 10;
export const GOAL_START = '2026-11-13';
export const GOAL_DAY = '2027-01-15';
/** The day the strategy is looked at again if no buyer has written to us by then. */
export const CHECK_DAY = '2026-12-13';

/**
 * How far back the room reads: from the goal's start, so its counts see every act since, but never less than five
 * weeks (the pace and a quiet spell need last week whole) and never more than the Worker's 90 days.
 * @param {string} today
 */
export function sinceFor(today) {
  const fiveWeeks = addDays(today, -35);
  const furthest = addDays(today, -89);
  const since = GOAL_START < fiveWeeks ? GOAL_START : fiveWeeks;
  return since < furthest ? furthest : since;
}

/** The platforms the runs write, by slug, as the room names them; any other slug is shown as it is. */
export const PLATFORM_NAMES = {
  linkedin: 'LinkedIn',
  'linkedin-page': 'Company page',
  bluesky: 'Bluesky',
  x: 'X',
  hn: 'Hacker News',
  reddit: 'Reddit',
  github: 'GitHub',
  whysosuresh: 'whysosuresh.com',
  directories: 'Directories',
};

/** A platform's name. @param {string} slug */
export function platformName(slug) {
  return slug in PLATFORM_NAMES ? PLATFORM_NAMES[/** @type {keyof typeof PLATFORM_NAMES} */ (slug)] : slug;
}

/** Where a platform stands, in words, and the order the rows take. */
export const STATE_WORDS = { active: 'Active', warming: 'Warming up', hold: 'On hold', later: 'Later' };
const STATE_ORDER = ['active', 'warming', 'hold', 'later'];

/** A state's words; a platform with no row yet is "Not set". @param {string | null} state */
export function stateWords(state) {
  return state !== null && state in STATE_WORDS ? STATE_WORDS[/** @type {keyof typeof STATE_WORDS} */ (state)] : 'Not set';
}

/** What each kind of act is called on a row. */
export const KIND_WORDS = {
  post: 'post',
  reply: 'reply',
  comment: 'comment',
  follow: 'follow',
  briefing: 'briefing',
  handoff: 'handoff',
  in: 'wrote to us',
  left: 'left',
  skipped: 'skipped',
  event: 'event',
};

/** A kind's words. @param {string} kind */
export function kindWords(kind) {
  return kind in KIND_WORDS ? KIND_WORDS[/** @type {keyof typeof KIND_WORDS} */ (kind)] : kind;
}

/** Acts of ours. */
const OURS = new Set(['post', 'reply', 'comment', 'follow', 'briefing', 'handoff']);
/** Acts of ours that count toward a platform's weekly pace: what others see us say. */
const PACED = new Set(['post', 'reply', 'comment']);
/** What ends someone's wait: an act of ours in the same conversation, or a decision about it. */
const ANSWERS = new Set([...OURS, 'left', 'skipped']);

const DAY_MS = 24 * 3600 * 1000;

/** A day moved by whole days. @param {string} day @param {number} days */
export function addDays(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from one day to another. @param {string} from @param {string} to */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The day a moment falls on in a zone, `YYYY-MM-DD`. @param {string} at @param {string} zone */
export function dayIn(at, zone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

/** Days left in a day's ISO week, the day itself counted: 7 on a Monday, 1 on a Sunday. @param {string} day */
export function daysLeftInWeek(day) {
  return 7 - ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7);
}

/** "18 Nov". @param {string} day */
export function shortDay(day) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00Z`));
}

/** "1 day", "6 days". @param {number} n @param {string} one @param {string} [many] */
function count(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The thread of talk an act belongs to: its conversation's address, or its own. @param {Act} act */
function threadOf(act) {
  return act.conversation ?? act.url;
}

/** Everyone's acts but the team's, which every count leaves out. @param {readonly Act[]} acts */
export function outsideTeam(acts) {
  return acts.filter((act) => act.audience !== 'team');
}

/**
 * Someone who wrote to us and has had no answer: an `in`, not the team's, with no later act of ours, `left` or
 * `skipped` in the same conversation. Newest first.
 * @param {readonly Act[]} acts
 */
export function waitingActs(acts) {
  return acts
    .filter((act) => act.kind === 'in' && act.audience !== 'team')
    .filter((asked) => {
      const key = threadOf(asked);
      if (key === null) return true;
      return !acts.some((other) => other.at > asked.at && ANSWERS.has(other.kind) && (other.conversation === key || other.url === key));
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Today's row for a product with people waiting: "Distribution: 2 people waiting on you". @param {number} n @param {Product} product */
export function todayLine(n, product) {
  return `${PRODUCT_NAMES[product]} distribution: ${count(n, 'person', 'people')} waiting on you`;
}

/** Acts of ours on a platform in a day's ISO week that count toward its pace. @param {readonly Act[]} acts @param {string} platform @param {string} today @param {string} zone */
export function pacedThisWeek(acts, platform, today, zone) {
  const week = weekOf(today);
  return acts.filter((act) => act.platform === platform && PACED.has(act.kind) && weekOf(dayIn(act.at, zone)) === week).length;
}

/** The days a platform kept to a pace may go without an act of ours before it is quiet: twice its gap, rounded up. @param {number} pace */
export function quietAfter(pace) {
  return Math.ceil((7 / pace) * 2);
}

/** The newest act of ours on a platform. @param {readonly Act[]} acts @param {string} platform */
function lastOurs(acts, platform) {
  return acts.filter((act) => act.platform === platform && OURS.has(act.kind)).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

/** Whether a platform has a pace to keep: active or warming up, with one set. @param {Platform} platform */
function paced(platform) {
  return platform.pace !== null && (platform.state === 'active' || platform.state === 'warming');
}

/** A person's name, or who they are when the act names nobody. @param {Act} act */
function whoOf(act) {
  return act.person?.name ?? act.person?.number.toString() ?? 'Someone';
}

/**
 * The next moves, worked out from the records in this order: someone waiting on a reply; a platform's day to look
 * again reached; a week's pace short; a platform gone quiet (its pace row then left out); and, for Stigmer, no buyer
 * having written to us by the strategy's check day.
 * @param {Room} room
 * @param {string} today his day, `YYYY-MM-DD`
 * @param {string} zone his zone
 * @returns {Move[]}
 */
export function nextMoves(room, today, zone) {
  /** @type {Move[]} */
  const moves = [];
  for (const act of waitingActs(room.acts)) {
    const since = daysBetween(dayIn(act.at, zone), today);
    moves.push({
      sev: 'hot',
      kind: 'reply',
      what: `${whoOf(act)} wrote to you on ${platformName(act.platform)}`,
      why: `Waiting ${since === 0 ? 'since today' : `${count(since, 'day')}`}. ${act.line}`,
      platform: act.platform,
      url: act.url ?? act.conversation,
    });
  }
  for (const platform of room.platforms) {
    if (platform.until === null || platform.until > today) continue;
    moves.push({
      sev: 'due',
      kind: 'look again',
      what: `Look again at ${platformName(platform.platform)}`,
      why: `${platform.note ?? stateWords(platform.state)}. The day set was ${shortDay(platform.until)}.`,
      platform: platform.platform,
      url: null,
    });
  }
  const left = daysLeftInWeek(today);
  /** @type {Move[]} */
  const quiet = [];
  for (const platform of room.platforms) {
    if (!paced(platform) || platform.pace === null) continue;
    const last = lastOurs(room.acts, platform.platform);
    const gap = last === null ? null : daysBetween(dayIn(last.at, zone), today);
    if (platform.state === 'active' && (gap === null || gap >= quietAfter(platform.pace))) {
      quiet.push({
        sev: 'due',
        kind: 'quiet',
        what: gap === null ? `${platformName(platform.platform)} has had no act of ours` : `${platformName(platform.platform)} has been quiet ${count(gap, 'day')}`,
        why: `The pace is ${count(platform.pace, 'act')} a week.${last === null ? '' : ` The last: ${last.line}`}`,
        platform: platform.platform,
        url: null,
      });
      continue;
    }
    const done = pacedThisWeek(room.acts, platform.platform, today, zone);
    if (done >= platform.pace) continue;
    moves.push({
      sev: 'due',
      kind: 'pace',
      what: `${platformName(platform.platform)}: ${done} of ${platform.pace} this week`,
      why: `${count(platform.pace - done, 'more act', 'more acts')} to keep the pace, ${count(left, 'day')} left this week.`,
      platform: platform.platform,
      url: null,
    });
  }
  moves.push(...quiet);
  if (room.product === 'stigmer' && today >= CHECK_DAY && buyerConversations(room.acts) === 0) {
    moves.push({
      sev: 'hot',
      kind: 'goal',
      what: `No buyer has written to us by ${shortDay(CHECK_DAY)}`,
      why: 'The strategy is looked at again if this is still none.',
      platform: null,
      url: null,
    });
  }
  return moves;
}

/** Distinct conversations a buyer started or joined by writing to us. @param {readonly Act[]} acts */
export function buyerConversations(acts) {
  return new Set(acts.filter((act) => act.kind === 'in' && act.audience === 'buyer').map((act) => threadOf(act) ?? act.id)).size;
}

/** Peers who wrote to us in a day's ISO week. @param {readonly Act[]} acts @param {string} today @param {string} zone */
export function peerRepliesThisWeek(acts, today, zone) {
  const week = weekOf(today);
  return acts.filter((act) => act.kind === 'in' && act.audience === 'peer' && weekOf(dayIn(act.at, zone)) === week).length;
}

/**
 * A metric's newest reading and the week before it, when there is one.
 * @param {readonly Reading[]} readings
 * @param {string} metric
 * @returns {{ value: number, week: string, readAt: string, before: number | null } | null}
 */
export function newestReading(readings, metric) {
  const mine = readings.filter((reading) => reading.metric === metric).sort((a, b) => b.week.localeCompare(a.week));
  const newest = mine[0];
  if (newest === undefined) return null;
  return { value: newest.value, week: newest.week, readAt: newest.readAt, before: mine[1]?.value ?? null };
}

/** A change since the week before, said short: "+2 wk", "±0 wk", or nothing when there is no week before. @param {{ value: number, before: number | null }} reading */
export function deltaLine(reading) {
  if (reading.before === null) return '';
  const delta = reading.value - reading.before;
  return `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta)} wk`;
}

/**
 * Where the goal stands: how far through its time today is, from 0 to 1, and how many days are left.
 * @param {string} today
 */
export function goalTime(today) {
  const total = daysBetween(GOAL_START, GOAL_DAY);
  const used = Math.min(Math.max(daysBetween(GOAL_START, today), 0), total);
  return { used: used / total, left: total - used };
}

/**
 * One row per platform: every platform with a state, then any other the acts name, active first, each with its newest
 * act (an event only when nothing else happened there, the team's never), this week's acts of ours against its pace,
 * and who is waiting there.
 * @param {Room} room
 * @param {string} today
 * @param {string} zone
 */
export function platformRows(room, today, zone) {
  const waiting = waitingActs(room.acts);
  const named = new Map(room.platforms.map((platform) => [platform.platform, platform]));
  const slugs = [...new Set([...room.platforms.map((platform) => platform.platform), ...room.acts.map((act) => act.platform)])];
  const rows = slugs.map((slug) => {
    const platform = named.get(slug) ?? null;
    const acts = outsideTeam(room.acts.filter((act) => act.platform === slug)).sort((a, b) => b.at.localeCompare(a.at));
    return {
      slug,
      name: platformName(slug),
      state: platform?.state ?? null,
      note: platform?.note ?? null,
      until: platform?.until ?? null,
      pace: platform?.pace ?? null,
      // The newest act that is something done or said; a state change only when there is nothing else.
      last: acts.find((act) => act.kind !== 'event') ?? acts[0] ?? null,
      done: pacedThisWeek(room.acts, slug, today, zone),
      waiting: waiting.filter((act) => act.platform === slug).length,
      acts,
    };
  });
  const rank = (/** @type {string | null} */ state) => (state === null ? STATE_ORDER.length : STATE_ORDER.indexOf(state));
  return rows.sort((a, b) => rank(a.state) - rank(b.state) || a.name.localeCompare(b.name));
}

/** A platform row's pace line: "2 of 3 this week", "1 this week". @param {{ done: number, pace: number | null }} row */
export function paceLine(row) {
  return row.pace === null ? `${row.done} this week` : `${row.done} of ${row.pace} this week`;
}

/** A platform's note and day to look again, as one line. @param {{ note: string | null, until: string | null }} row */
export function noteLine(row) {
  const parts = [...(row.note === null ? [] : [row.note]), ...(row.until === null ? [] : [`look again ${shortDay(row.until)}`])];
  return parts.join(' · ');
}

/** Words of a thread's summary line, as text. @param {{ inline: { type: string, text?: string, number?: number }[] }} line */
function lineText(line) {
  return line.inline.map((run) => (run.type === 'thread' ? `#${run.number}` : (run.text ?? ''))).join('');
}

/** A `Waiting on:` that names him, or nothing: the thread is his to do. */
const HIS = /^(?:suresh|me|you|nothing|nobody|no one|none|-|—)\b/i;

/**
 * The open threads of the Distribution collection, split: those whose living summary waits on a condition (its
 * `Waiting on:` line names something other than Suresh or nothing), with that condition, and every other, his to do.
 * @template {WorkThread} T
 * @param {readonly T[]} threads
 * @returns {{ gated: { thread: T, on: string }[], todo: T[] }}
 */
export function splitWork(threads) {
  /** @type {{ thread: T, on: string }[]} */
  const gated = [];
  /** @type {T[]} */
  const todo = [];
  for (const thread of threads) {
    const lines = thread.summary === null ? null : summaryLines(thread.summary);
    const waiting = lines?.find((line) => line.label.toLowerCase() === 'waiting on');
    const on = waiting === undefined ? '' : lineText(waiting).trim();
    if (on !== '' && !HIS.test(on)) gated.push({ thread, on });
    else todo.push(thread);
  }
  return { gated, todo };
}

/**
 * The people met in public: everyone an act names but the team, newest first, with their newest act and how we know
 * them (the newest audience an act gives).
 * @param {readonly Act[]} acts
 */
export function peopleMet(acts) {
  /** @type {Map<number, { person: Named, last: Act, audience: string | null, acts: number }>} */
  const met = new Map();
  for (const act of [...outsideTeam(acts)].sort((a, b) => b.at.localeCompare(a.at))) {
    if (act.person === null) continue;
    const known = met.get(act.person.number);
    if (known === undefined) met.set(act.person.number, { person: act.person, last: act, audience: act.audience, acts: 1 });
    else {
      known.acts += 1;
      if (known.audience === null) known.audience = act.audience;
    }
  }
  return [...met.values()];
}

/** The log's line under the rows: the team's acts kept apart. @param {readonly Act[]} acts */
export function teamLine(acts) {
  const team = acts.filter((act) => act.audience === 'team').length;
  return team === 0 ? '' : `${count(team, 'team act')} in this time, kept apart and not counted.`;
}

/** The room's line under its title: when the newest act was written, and how far back it reads. @param {Room} room @param {string} zone */
export function asOfLine(room, zone) {
  const newest = [...room.acts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const since = `acts since ${shortDay(room.since)}`;
  return newest === undefined ? `No acts written yet · ${since}` : `As of the last run, ${shortDay(dayIn(newest.createdAt, zone))} · ${since}`;
}

/** The goal strip's empty number: a reading nobody has written yet. */
export const NOT_COUNTED = 'not counted yet';
