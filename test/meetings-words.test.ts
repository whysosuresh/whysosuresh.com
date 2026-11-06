// What a meeting says on the threads page (site/app/meetings.js), read in two zones and three locales without touching
// the machine's own. What it holds: a day reads the same for everyone with its time not set; a moment reads in the
// reader's own zone and their locale's order, its zone named as their locale names it ("IST" in Indian English,
// "GMT+5:30" in US English, "PST" in Los Angeles), and a moment early in India is the day before in Los Angeles; today, tomorrow and yesterday are
// named; a row's chip, a room's lead and the card say it short; a meeting is soon, later or past by its own day or by
// when its length runs out; the coming ones sort soonest first and the past newest first; who is in it reads as people
// say it, "you" first; the editor sends a day alone, or a moment with its zone's offset, and opens on the reader's own
// day and time; and its people changes are the difference by number, with new names apart.

import { describe, expect, it } from "vitest";
import {
  cardLines,
  chipWords,
  dayKey,
  leadWords,
  lengthWords,
  partsOf,
  peopleChanges,
  relative,
  split,
  startOf,
  stateOf,
  whenLine,
  whenOf,
  withLine,
} from "../site/app/meetings.js";

const INDIA = "Asia/Kolkata";
const LA = "America/Los_Angeles";
/** Friday 6 November 2026, 10:00 in India (04:30 UTC). */
const NOW = Date.parse("2026-11-06T04:30:00.000Z");
const at = (when: string, minutes: number | null = null, where: string | null = null) => ({ when, minutes, where });

describe("a meeting's when", () => {
  it("is a day for everyone, its time not set", () => {
    expect(whenLine(at("2026-11-09"), NOW, "en-IN", INDIA)).toBe("Mon 9 Nov · time not set");
    expect(whenLine(at("2026-11-09"), NOW, "en-IN", LA)).toBe("Mon 9 Nov · time not set");
    // Each reader's locale orders the day its own way.
    expect(whenLine(at("2026-11-09"), NOW, "en-US", LA)).toBe("Mon Nov 9 · time not set");
    expect(whenLine(at("2026-11-13", 45, "Asha's office"), NOW, "en-IN", INDIA)).toBe("Fri 13 Nov · time not set · 45 min · Asha's office");
  });

  it("is a moment in the reader's own zone, named as their locale names it", () => {
    const call = at("2026-11-09T09:30:00.000Z", 45, "Google Meet");
    expect(whenLine(call, NOW, "en-IN", INDIA)).toBe("Mon 9 Nov, 3:00 pm IST · 45 min · Google Meet");
    expect(whenLine(call, NOW, "en-US", INDIA)).toBe("Mon Nov 9, 3:00 PM GMT+5:30 · 45 min · Google Meet");
    expect(whenLine(call, NOW, "en-US", LA)).toBe("Mon Nov 9, 1:30 AM PST · 45 min · Google Meet");
  });

  it("falls on the reader's own day: early in India is the day before in Los Angeles", () => {
    const early = at("2026-11-10T03:00:00.000Z");
    expect(dayKey(early.when, INDIA)).toBe("2026-11-10");
    expect(dayKey(early.when, LA)).toBe("2026-11-09");
  });

  it("names today, tomorrow and yesterday", () => {
    expect(whenLine(at("2026-11-06T09:30:00.000Z"), NOW, "en-IN", INDIA)).toBe("Today, 3:00 pm IST");
    expect(whenLine(at("2026-11-07"), NOW, "en-IN", INDIA)).toBe("Tomorrow · time not set");
    expect(whenLine(at("2026-11-05"), NOW, "en-IN", INDIA)).toBe("Yesterday · time not set");
  });

  it.each([[null, ""], [30, "30 min"], [60, "1 hr"], [90, "1 hr 30 min"], [1440, "24 hr"]])("says a length of %j as %j", (minutes, words) => {
    expect(lengthWords(minutes)).toBe(words);
  });
});

describe("short forms", () => {
  it("chips a row with its day, and its time when it has one", () => {
    expect(chipWords(at("2026-11-06T09:30:00.000Z"), NOW, "en-IN", INDIA)).toBe("Today, 3:00 pm");
    expect(chipWords(at("2026-11-09"), NOW, "en-IN", INDIA)).toBe("Mon 9 Nov");
  });

  it("leads a room's row with today's time, else the day", () => {
    expect(leadWords(at("2026-11-06T09:30:00.000Z"), NOW, "en-IN", INDIA)).toBe("3:00 pm");
    expect(leadWords(at("2026-11-07"), NOW, "en-IN", INDIA)).toBe("Tomorrow");
    expect(leadWords(at("2026-11-11T09:30:00.000Z"), NOW, "en-IN", INDIA)).toBe("Wed");
  });

  it("puts the next meeting on a card in two lines", () => {
    expect(cardLines(at("2026-11-06T09:30:00.000Z", 45, "Google Meet"), "Pricing call", NOW, "en-IN", INDIA)).toEqual({
      head: "3:00 pm · Pricing call",
      rest: "in 5 hours · 45 min · Google Meet",
    });
    expect(cardLines(at("2026-11-13"), "Demo", NOW, "en-IN", INDIA)).toEqual({ head: "Fri 13 Nov · Demo", rest: "time not set" });
  });

  it.each([
    [NOW + 30 * 60000, "in 30 min"],
    [NOW + 90 * 60000, "in 2 hours"],
    [NOW + 50 * 3600000, "in 2 days"],
    [NOW - 60000, "now"],
  ])("says a moment ahead as %#", (moment, words) => {
    expect(relative(moment, NOW)).toBe(words);
  });
});

describe("coming and past", () => {
  it("is soon today and tomorrow, later after, and past once its day or its length is over", () => {
    expect(stateOf(at("2026-11-07"), NOW, INDIA)).toBe("soon");
    expect(stateOf(at("2026-11-09"), NOW, INDIA)).toBe("later");
    expect(stateOf(at("2026-11-06"), NOW, INDIA)).toBe("soon");
    expect(stateOf(at("2026-11-05"), NOW, INDIA)).toBe("past");
    // Started 30 minutes ago: on for a 45-minute meeting, over for a 15-minute one, on for one with no length.
    const started = new Date(NOW - 30 * 60000).toISOString();
    expect(stateOf(at(started, 45), NOW, INDIA)).toBe("soon");
    expect(stateOf(at(started, 15), NOW, INDIA)).toBe("past");
    expect(stateOf(at(started), NOW, INDIA)).toBe("soon");
  });

  it("sorts the coming soonest first and the past newest first, a day from its start in the zone", () => {
    const threads = [
      { n: 1, meeting: at("2026-11-09") },
      { n: 2, meeting: at("2026-11-06T09:30:00.000Z") },
      { n: 3, meeting: null },
      { n: 4, meeting: at("2026-11-02") },
      { n: 5, meeting: at("2026-11-04T05:00:00.000Z") },
      { n: 6, meeting: at("2026-11-08T20:00:00.000Z") },
    ];
    const { coming, past } = split(threads, (t) => t.meeting, NOW, INDIA);
    // The day of 9 November starts at its midnight in India (18:30 UTC on the 8th), before the call at 01:30 that night.
    expect(coming.map((t) => t.n)).toEqual([2, 1, 6]);
    expect(past.map((t) => t.n)).toEqual([5, 4]);
    expect(startOf("2026-11-09", INDIA)).toBe(Date.parse("2026-11-08T18:30:00.000Z"));
    expect(startOf("2026-11-09", LA)).toBe(Date.parse("2026-11-09T08:00:00.000Z"));
  });
});

describe("who is in it", () => {
  it("reads as people say it, you first", () => {
    expect(withLine([])).toBe("No one added yet");
    expect(withLine([{ name: "Asha" }])).toBe("With Asha");
    expect(withLine([{ name: "Asha" }, { name: "Dev" }, { name: "Lin" }])).toBe("With Asha, Dev and Lin");
    expect(withLine([{ name: "Dev" }, { name: "Asha", you: true }])).toBe("With you and Dev");
    expect(withLine([{ name: null }])).toBe("With someone");
  });
});

describe("the editor", () => {
  it("sends a day alone, or a moment with its zone's offset", () => {
    expect(whenOf("2026-11-09", "", 330)).toBe("2026-11-09");
    expect(whenOf("2026-11-09", "15:00", 330)).toBe("2026-11-09T15:00+05:30");
    expect(whenOf("2026-11-09", "09:30", -480)).toBe("2026-11-09T09:30-08:00");
    expect(whenOf("2026-11-09", "09:30", 0)).toBe("2026-11-09T09:30+00:00");
    expect(whenOf("9 Nov", "", 330)).toBeNull();
    expect(whenOf("2026-11-09", "3pm", 330)).toBeNull();
  });

  it("opens on the reader's own day and time", () => {
    expect(partsOf("2026-11-09", INDIA)).toEqual({ day: "2026-11-09", time: "" });
    expect(partsOf("2026-11-09T09:30:00.000Z", INDIA)).toEqual({ day: "2026-11-09", time: "15:00" });
    expect(partsOf("2026-11-10T03:00:00.000Z", LA)).toEqual({ day: "2026-11-09", time: "19:00" });
  });

  it("changes people by number, and keeps new names apart", () => {
    expect(peopleChanges([4, 5], [5, 7], ["  Asha's manager ", " "])).toEqual({ add: [7], remove: [4], named: ["Asha's manager"] });
  });
});
