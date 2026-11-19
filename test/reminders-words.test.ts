// What a reminder means and says (site/app/reminders.js), read without a page and without the machine's own clock or
// zone. What it holds: today is his day in India whatever the moment's zone, turning at his midnight; a series' first
// day on or after a day, and its next after one, stay on its rhythm across a month's and a year's turn, and a reminder
// for once has none after its day; Done after a missed fortnight lands on the next day after today, never on a missed
// one, Done early skips that time, and a Monday reminder moved to Tuesday finishes onto the next Monday; due is today
// or earlier and never on a dropped thread; Today orders the due oldest first; Later offers tomorrow and the next
// Monday; the repeat, the series, when it is due and each history line read as he says them, the year named only
// outside today's.

import { describe, expect, it } from "vitest";
import {
  addDays,
  afterDone,
  byDue,
  daysBetween,
  dayWords,
  dueSince,
  dueWords,
  everyWords,
  firstOnOrAfter,
  isDayShape,
  isDue,
  isEvery,
  doneWords,
  laterDays,
  laterNote,
  laterWords,
  nextAfter,
  previewWords,
  reminderEventWords,
  seriesWords,
  stripLine,
  todayIn,
  weekdayWords,
  ZONE,
} from "../site/app/reminders.js";

const GB = "en-GB";
/** Monday 23 November 2026, the first weekly onboarding turn. */
const MONDAY = "2026-11-23";
const weekly = (start: string, on = start) => ({ start, on, every: 7 });

describe("today, in his zone", () => {
  it("is India's day, turning at his midnight, whatever zone the moment is written in", () => {
    expect(ZONE).toBe("Asia/Kolkata");
    expect(todayIn(Date.parse("2026-11-22T18:29:59Z"))).toBe("2026-11-22");
    expect(todayIn(Date.parse("2026-11-22T18:30:00Z"))).toBe(MONDAY);
    expect(todayIn(Date.parse("2026-11-23T06:00:00-08:00"))).toBe("2026-11-23");
    expect(todayIn(Date.parse("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
  });

  it("counts days across a month's and a year's turn", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-12-28", "2027-01-04")).toBe(7);
    expect(daysBetween(MONDAY, "2026-11-16")).toBe(-7);
  });
});

describe("a series", () => {
  it("finds its first day on or after a day, on its rhythm", () => {
    const series = { start: MONDAY, every: 7 };
    expect(firstOnOrAfter(series, "2026-11-20")).toBe(MONDAY);
    expect(firstOnOrAfter(series, MONDAY)).toBe(MONDAY);
    expect(firstOnOrAfter(series, "2026-11-24")).toBe("2026-11-30");
    expect(firstOnOrAfter(series, "2026-12-01")).toBe("2026-12-07");
    expect(firstOnOrAfter({ start: "2026-12-28", every: 7 }, "2027-01-01")).toBe("2027-01-04");
    expect(firstOnOrAfter({ start: MONDAY, every: 1 }, "2026-12-03")).toBe("2026-12-03");
    expect(firstOnOrAfter({ start: MONDAY, every: 10 }, "2026-11-24")).toBe("2026-12-03");
  });

  it("for once, is its day until that day goes by, and has no next", () => {
    const once = { start: "2026-11-25", every: null };
    expect(firstOnOrAfter(once, MONDAY)).toBe("2026-11-25");
    expect(firstOnOrAfter(once, "2026-11-25")).toBe("2026-11-25");
    expect(firstOnOrAfter(once, "2026-11-26")).toBeNull();
    expect(nextAfter(once, MONDAY)).toBeNull();
  });

  it("finds its next day after a day, never the day itself", () => {
    expect(nextAfter({ start: MONDAY, every: 7 }, MONDAY)).toBe("2026-11-30");
    expect(nextAfter({ start: MONDAY, every: 14 }, MONDAY)).toBe("2026-12-07");
    expect(nextAfter({ start: MONDAY, every: 7 }, "2026-11-20")).toBe(MONDAY);
  });
});

describe("Done", () => {
  it("after a missed fortnight lands on the next day after today, never a missed one", () => {
    expect(afterDone(weekly("2026-11-02", "2026-11-09"), MONDAY)).toBe("2026-11-30");
    expect(afterDone(weekly("2026-11-02", "2026-11-09"), "2026-11-25")).toBe("2026-11-30");
  });

  it("on the day goes to the next time, and early skips that time", () => {
    expect(afterDone(weekly(MONDAY), MONDAY)).toBe("2026-11-30");
    expect(afterDone(weekly(MONDAY, "2026-11-30"), "2026-11-25")).toBe("2026-12-07");
  });

  it("finishes a Monday reminder moved to Tuesday onto the next Monday", () => {
    expect(afterDone(weekly(MONDAY, "2026-11-24"), "2026-11-24")).toBe("2026-11-30");
    expect(afterDone(weekly(MONDAY, "2026-11-24"), "2026-11-26")).toBe("2026-11-30");
  });

  it("across the year's turn stays on its day", () => {
    expect(afterDone(weekly("2026-12-28"), "2026-12-28")).toBe("2027-01-04");
  });

  it("ends a reminder for once", () => {
    expect(afterDone({ start: "2026-11-25", on: "2026-11-25", every: null }, "2026-11-25")).toBeNull();
    expect(afterDone({ start: "2026-11-25", on: "2026-11-27", every: null }, "2026-11-30")).toBeNull();
  });
});

describe("due", () => {
  it("is today or earlier, and never on a dropped thread", () => {
    expect(isDue(weekly(MONDAY), "act", MONDAY)).toBe(true);
    expect(isDue(weekly("2026-11-16"), "done", MONDAY)).toBe(true);
    expect(isDue(weekly("2026-11-30"), "act", MONDAY)).toBe(false);
    expect(isDue(weekly("2026-11-16"), "dropped", MONDAY)).toBe(false);
    expect(isDue(null, "act", MONDAY)).toBe(false);
    expect(dueSince(weekly("2026-11-16"), "act", MONDAY)).toBe("2026-11-16");
    expect(dueSince(weekly(MONDAY), "act", MONDAY)).toBeNull();
    expect(dueSince(weekly("2026-11-16"), "dropped", MONDAY)).toBeNull();
  });

  it("orders Today's due oldest first, then by number", () => {
    const rows = [
      { number: 3, reminder: weekly(MONDAY) },
      { number: 9, reminder: weekly("2026-11-09") },
      { number: 2, reminder: weekly(MONDAY) },
    ];
    expect(byDue(rows).map((row) => row.number)).toEqual([9, 2, 3]);
    expect(rows.map((row) => row.number)).toEqual([3, 9, 2]);
  });

  it("offers Later tomorrow and the next Monday after today", () => {
    expect(laterDays(MONDAY)).toEqual({ tomorrow: "2026-11-24", monday: "2026-11-30" });
    expect(laterDays("2026-11-29")).toEqual({ tomorrow: "2026-11-30", monday: "2026-11-30" });
    expect(laterDays("2026-12-31")).toEqual({ tomorrow: "2027-01-01", monday: "2027-01-04" });
  });
});

describe("words", () => {
  it("say the repeat as he says it", () => {
    expect([null, 1, 7, 14, 21, 10, 366].map(everyWords)).toEqual(["Once", "Every day", "Every week", "Every 2 weeks", "Every 3 weeks", "Every 10 days", "Every 366 days"]);
  });

  it("name the day, and the year only outside today's", () => {
    expect(dayWords(MONDAY, MONDAY, GB)).toBe("Mon 23 Nov");
    expect(dayWords("2027-01-04", MONDAY, GB)).toBe("Mon 4 Jan 2027");
    expect(dayWords(MONDAY, MONDAY, "en-US")).toBe("Mon Nov 23");
  });

  it("say the series and when it is due", () => {
    expect(seriesWords(weekly(MONDAY), MONDAY, GB)).toBe("Every week from Mon 23 Nov");
    expect(seriesWords({ start: "2026-11-25", on: "2026-11-25", every: null }, MONDAY, GB)).toBe("Once, Wed 25 Nov");
    expect(seriesWords({ start: "2026-11-25", on: "2026-11-27", every: null }, MONDAY, GB)).toBe("Once, Fri 27 Nov");
    expect(dueWords(weekly(MONDAY), "act", MONDAY, GB)).toBe("Due today");
    expect(dueWords(weekly("2026-11-16"), "act", MONDAY, GB)).toBe("Due since Mon 16 Nov");
    expect(dueWords(weekly("2026-11-24"), "act", MONDAY, GB)).toBe("Due tomorrow");
    expect(dueWords(weekly("2026-11-30"), "act", MONDAY, GB)).toBe("Next Mon 30 Nov");
    expect(dueWords(weekly("2026-11-16"), "dropped", MONDAY, GB)).toBe("Paused while dropped");
  });

  it("say each history line, and nothing for data not in the store's shape", () => {
    const say = (type: string, data: Record<string, unknown>) => reminderEventWords(type, data, MONDAY, GB);
    expect(say("reminder-set", { from: null, to: { start: MONDAY, on: MONDAY, every: 7 } })).toBe("set a reminder: every week from Mon 23 Nov");
    expect(say("reminder-set", { from: null, to: { start: "2026-11-25", on: "2026-11-25", every: null } })).toBe("set a reminder for Wed 25 Nov");
    expect(say("reminder-cleared", { from: null })).toBe("cleared the reminder");
    expect(say("reminder-snoozed", { from: MONDAY, to: "2026-11-24" })).toBe("moved the reminder to Tue 24 Nov");
    expect(say("reminder-done", { day: MONDAY, next: "2026-11-30" })).toBe("marked the reminder done for Mon 23 Nov; next Mon 30 Nov");
    expect(say("reminder-done", { day: "2026-11-25", next: null })).toBe("marked the reminder done for Wed 25 Nov");
    expect(say("reminder-set", { to: { start: "soon", every: 7 } })).toBeNull();
    expect(say("reminder-set", { to: { start: MONDAY, every: 0 } })).toBeNull();
    expect(say("reminder-done", {})).toBeNull();
    expect(say("meeting-set", {})).toBeNull();
  });

  it("check a day's shape and a repeat's range", () => {
    expect([MONDAY, "2026-11-3", "23 Nov", 20261123, null].map(isDayShape)).toEqual([true, false, false, false, false]);
    expect([1, 7, 366, 0, 367, 1.5, "7", null].map(isEvery)).toEqual([true, true, true, false, false, false, false, false]);
  });

  it("say what Done and Later did, and what Later keeps", () => {
    expect(doneWords(weekly("2026-11-16"), "2026-11-30", MONDAY, GB)).toBe("Done for Mon 16 Nov. Next: Mon 30 Nov.");
    expect(doneWords({ start: "2026-11-25", on: "2026-11-25", every: null }, null, MONDAY, GB)).toBe("Done for Wed 25 Nov. It won't come back.");
    expect(laterWords(weekly(MONDAY), "2026-11-24", MONDAY, GB)).toBe("Later: Tue 24 Nov, then back on Mondays.");
    expect(laterWords({ start: MONDAY, on: MONDAY, every: 10 }, "2026-11-24", MONDAY, GB)).toBe("Later: Tue 24 Nov.");
    expect(laterNote(weekly(MONDAY), GB)).toBe("Only this time; it stays on Mondays.");
    expect(laterNote({ start: MONDAY, on: MONDAY, every: 3 }, GB)).toBe("Only this time; its rhythm stays.");
    expect(laterNote({ start: MONDAY, on: MONDAY, every: null }, GB)).toBeNull();
    expect(weekdayWords("2026-11-26", GB)).toBe("Thursday");
  });

  it("say on the thread what Done will do, when it comes back, and that a dropped thread's waits", () => {
    expect(stripLine(weekly(MONDAY), "act", MONDAY, GB)).toBe("Done sends it to Mon 30 Nov. It never changes where the thread stands.");
    expect(stripLine({ start: MONDAY, on: MONDAY, every: null }, "act", MONDAY, GB)).toBe("Done ends it. It never changes where the thread stands.");
    expect(stripLine(weekly("2026-11-30"), "act", MONDAY, GB)).toBe("It comes back under Due on Today that morning, India's day.");
    expect(stripLine(weekly(MONDAY), "dropped", MONDAY, GB)).toBe("Paused while the thread is dropped; reopening it brings it back.");
  });

  it("preview a series before it is saved, and refuse once on a day gone by", () => {
    const THURSDAY = "2026-11-19";
    const rest = (then: string) => `, then ${then}. Due by India's day wherever you are.`;
    expect(previewWords({ start: MONDAY, every: 7 }, THURSDAY, GB)).toEqual({ lead: "Next: ", day: "Mon 23 Nov", rest: rest("every Monday") });
    expect(previewWords({ start: "2026-11-16", every: 7 }, THURSDAY, GB)).toEqual({ lead: "Next: ", day: "Mon 23 Nov", rest: rest("every Monday") });
    expect(previewWords({ start: THURSDAY, every: 1 }, THURSDAY, GB)).toEqual({ lead: "Next: ", day: "today", rest: rest("every day") });
    expect(previewWords({ start: MONDAY, every: 14 }, THURSDAY, GB)).toEqual({ lead: "Next: ", day: "Mon 23 Nov", rest: rest("every 2 weeks on Mondays") });
    expect(previewWords({ start: MONDAY, every: 10 }, THURSDAY, GB)).toEqual({ lead: "Next: ", day: "Mon 23 Nov", rest: rest("every 10 days") });
    expect(previewWords({ start: "2026-11-25", every: null }, THURSDAY, GB)).toEqual({ lead: "Comes back under Due on Today ", day: "on Wed 25 Nov", rest: ", once." });
    expect(previewWords({ start: THURSDAY, every: null }, THURSDAY, GB)).toEqual({ lead: "Comes back under Due on Today ", day: "today", rest: ", once." });
    expect(previewWords({ start: "2026-11-18", every: null }, THURSDAY, GB)).toEqual({ problem: "That day has gone by. Pick today or a day after." });
  });
});
