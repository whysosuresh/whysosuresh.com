// What distribution's room works out and says (site/app/distribution.js). What it holds: someone who wrote to us
// waits until an act of ours, a `left` or a `skipped` comes later in the same conversation, never on the team's
// words; the next moves come in their order (waiting, a day reached, a week's pace short, a platform gone quiet, then
// Stigmer's check day), a quiet platform's pace row left out, a platform on hold or for later never nagged about its
// pace; the pace counts only acts of ours others see, in his ISO week and zone; the goal's buyer conversations count
// each conversation once and the week's peer replies only this week; a reading's newest value and its change since
// the week before; the goal's time from its start to its day; one row per platform, those with a state first, then
// any other an act names; the Distribution collection's threads split by their summary's `Waiting on:`; the people
// met in public, the team left out; the team's acts kept apart; how far back the room reads; and the room's
// addresses.

import { describe, expect, it } from "vitest";
import {
  CHECK_DAY,
  DISTRIBUTION_ROUTE,
  GOAL_DAY,
  GOAL_START,
  addDays,
  buyerConversations,
  daysLeftInWeek,
  deltaLine,
  distributionPath,
  goalTime,
  newestReading,
  nextMoves,
  noteLine,
  pacedThisWeek,
  paceLine,
  peerRepliesThisWeek,
  peopleMet,
  platformName,
  platformRows,
  quietAfter,
  sinceFor,
  splitWork,
  teamLine,
  todayLine,
  waitingActs,
  type Act,
  type Platform,
  type Room,
} from "../site/app/distribution.js";

const ZONE = "Asia/Kolkata";
/** A Wednesday. */
const TODAY = "2026-11-18";

let ids = 0;
function act(fields: Partial<Act> = {}): Act {
  ids += 1;
  return {
    id: `a${ids}`,
    ref: `engage:${ids}`,
    at: "2026-11-18T04:00:00.000Z",
    product: "stigmer",
    platform: "bluesky",
    kind: "reply",
    audience: null,
    url: null,
    conversation: null,
    person: null,
    line: `Act ${ids}.`,
    createdAt: "2026-11-18T05:00:00.000Z",
    voidedAt: null,
    ...fields,
  };
}

function platform(fields: Partial<Platform> = {}): Platform {
  return { platform: "bluesky", state: "active", note: null, until: null, pace: null, changedAt: "2026-11-12T00:00:00.000Z", ...fields };
}

function room(fields: Partial<Room> = {}): Room {
  return { product: "stigmer", since: GOAL_START, platforms: [], acts: [], truncated: false, readings: [], work: { collection: 1, threads: [] }, log: null, ...fields };
}

const THREAD = "https://bsky.app/profile/someone/post/1";

describe("who is waiting", () => {
  it("is someone who wrote to us, until an act of ours, a left or a skipped comes later in the same conversation", () => {
    const asked = act({ kind: "in", conversation: THREAD, at: "2026-11-17T04:00:00.000Z", person: { number: 4, name: "Kiran" } });
    expect(waitingActs([asked])).toEqual([asked]);
    expect(waitingActs([asked, act({ kind: "reply", conversation: THREAD, at: "2026-11-17T05:00:00.000Z" })])).toEqual([]);
    expect(waitingActs([asked, act({ kind: "left", conversation: THREAD, at: "2026-11-17T05:00:00.000Z" })])).toEqual([]);
    expect(waitingActs([asked, act({ kind: "comment", url: THREAD, at: "2026-11-17T05:00:00.000Z" })])).toEqual([]);
    // An answer before they wrote, or in another conversation, answers nothing.
    expect(waitingActs([asked, act({ kind: "reply", conversation: THREAD, at: "2026-11-17T03:00:00.000Z" })])).toEqual([asked]);
    expect(waitingActs([asked, act({ kind: "reply", conversation: "https://elsewhere.example/1", at: "2026-11-17T05:00:00.000Z" })])).toEqual([asked]);
    // Another `in` in the conversation is not an answer.
    expect(waitingActs([asked, act({ kind: "in", conversation: THREAD, at: "2026-11-17T05:00:00.000Z" })])).toHaveLength(2);
  });

  it("never counts the team", () => {
    expect(waitingActs([act({ kind: "in", audience: "team", conversation: THREAD })])).toEqual([]);
  });

  it("says Today's line by product", () => {
    expect([todayLine(1, "stigmer"), todayLine(2, "capsjump")]).toEqual(["Stigmer distribution: 1 person waiting on you", "CapsJump distribution: 2 people waiting on you"]);
  });
});

describe("the pace", () => {
  it("counts only acts of ours others see, on that platform, in his ISO week and zone", () => {
    const acts = [
      act({ kind: "post", at: "2026-11-16T00:00:00.000Z" }),
      act({ kind: "reply", at: "2026-11-17T00:00:00.000Z" }),
      act({ kind: "follow", at: "2026-11-17T00:00:00.000Z" }),
      act({ kind: "in", at: "2026-11-17T00:00:00.000Z" }),
      act({ kind: "comment", platform: "linkedin", at: "2026-11-17T00:00:00.000Z" }),
      // Sunday 23:00 in UTC is Monday 04:30 in his zone: this week. Sunday 15 Nov 17:00 UTC is still last week there.
      act({ kind: "comment", at: "2026-11-15T23:00:00.000Z" }),
      act({ kind: "comment", at: "2026-11-15T17:00:00.000Z" }),
    ];
    expect(pacedThisWeek(acts, "bluesky", TODAY, ZONE)).toBe(3);
  });

  it("says the days left in the week, the day itself counted, and when a platform turns quiet", () => {
    expect([daysLeftInWeek("2026-11-16"), daysLeftInWeek(TODAY), daysLeftInWeek("2026-11-22")]).toEqual([7, 5, 1]);
    expect([quietAfter(1), quietAfter(3), quietAfter(7)]).toEqual([14, 5, 2]);
    expect([paceLine({ done: 1, pace: 3 }), paceLine({ done: 2, pace: null })]).toEqual(["1 of 3 this week", "2 this week"]);
  });
});

describe("the next moves", () => {
  it("come in order: waiting, a day reached, a pace short, a platform quiet, then the check day", () => {
    const moves = nextMoves(
      room({
        platforms: [
          platform({ platform: "reddit", state: "hold", note: "Posts held back", until: "2026-11-18", pace: 3 }),
          platform({ platform: "bluesky", pace: 3 }),
          platform({ platform: "linkedin", pace: 2 }),
        ],
        acts: [
          act({ kind: "in", platform: "bluesky", conversation: THREAD, person: { number: 4, name: "Kiran" }, at: "2026-11-17T04:00:00.000Z", line: "Asked how sandboxes sleep." }),
          act({ kind: "post", platform: "bluesky", at: "2026-11-16T04:00:00.000Z" }),
          act({ kind: "post", platform: "linkedin", at: "2026-11-01T04:00:00.000Z", line: "A post." }),
        ],
      }),
      TODAY,
      ZONE,
    );
    expect(moves.map((move) => [move.sev, move.kind, move.what])).toEqual([
      ["hot", "reply", "Kiran wrote to you on Bluesky"],
      ["due", "look again", "Look again at Reddit"],
      ["due", "pace", "Bluesky: 1 of 3 this week"],
      ["due", "quiet", "LinkedIn has been quiet 17 days"],
    ]);
    expect(moves[0]?.why).toBe("Waiting 1 day. Asked how sandboxes sleep.");
    expect(moves[1]?.why).toBe("Posts held back. The day set was 18 Nov.");
    expect(moves[2]?.why).toBe("2 more acts to keep the pace, 5 days left this week.");
    expect(moves[3]?.why).toBe("The pace is 2 acts a week. The last: A post.");
  });

  it("never nags a platform on hold or for later about its pace, nor one whose pace is kept", () => {
    const acts = [1, 2, 3].map((n) => act({ kind: "post", at: `2026-11-1${5 + n}T04:00:00.000Z` }));
    expect(nextMoves(room({ platforms: [platform({ pace: 3 }), platform({ platform: "reddit", state: "hold", pace: 3 }), platform({ platform: "x", state: "later", pace: 2 })], acts }), TODAY, ZONE)).toEqual([]);
  });

  it("says a warming platform's pace but never calls it quiet, and a platform with no act of ours yet", () => {
    const moves = nextMoves(room({ platforms: [platform({ platform: "hn", state: "warming", pace: 1 }), platform({ platform: "linkedin-page", pace: 1 })] }), TODAY, ZONE);
    expect(moves.map((move) => move.what)).toEqual(["Hacker News: 0 of 1 this week", "Company page has had no act of ours"]);
  });

  it("asks Stigmer's question on the check day when no buyer has written, and never for CapsJump", () => {
    const after = addDays(CHECK_DAY, 1);
    expect(nextMoves(room(), addDays(CHECK_DAY, -1), ZONE)).toEqual([]);
    expect(nextMoves(room(), after, ZONE).map((move) => [move.sev, move.what])).toEqual([["hot", "No buyer has written to us by 13 Dec"]]);
    expect(nextMoves(room({ acts: [act({ kind: "in", audience: "buyer", conversation: THREAD, at: "2026-11-20T00:00:00.000Z" }), act({ kind: "reply", conversation: THREAD, at: "2026-11-21T00:00:00.000Z" })] }), after, ZONE)).toEqual([]);
    expect(nextMoves(room({ product: "capsjump" }), after, ZONE)).toEqual([]);
  });
});

describe("the goal", () => {
  it("counts each buyer conversation once, and only this week's peer replies", () => {
    const acts = [
      act({ kind: "in", audience: "buyer", conversation: THREAD }),
      act({ kind: "in", audience: "buyer", conversation: THREAD }),
      act({ kind: "in", audience: "buyer", url: "https://elsewhere.example/2" }),
      act({ kind: "reply", audience: "buyer", conversation: "https://elsewhere.example/3" }),
      act({ kind: "in", audience: "peer", at: "2026-11-17T00:00:00.000Z" }),
      act({ kind: "in", audience: "peer", at: "2026-11-10T00:00:00.000Z" }),
    ];
    expect([buyerConversations(acts), peerRepliesThisWeek(acts, TODAY, ZONE)]).toEqual([2, 1]);
  });

  it("reads a metric's newest value with the week before, and says the change", () => {
    const readings = [
      { metric: "outside_stars", week: "2026-W46", value: 7, readAt: "2026-11-09T04:00:00.000Z" },
      { metric: "outside_stars", week: "2026-W47", value: 9, readAt: "2026-11-16T04:00:00.000Z" },
      { metric: "downloads", week: "2026-W47", value: 57, readAt: "2026-11-16T04:00:00.000Z" },
    ];
    const stars = newestReading(readings, "outside_stars");
    expect(stars).toEqual({ value: 9, week: "2026-W47", readAt: "2026-11-16T04:00:00.000Z", before: 7 });
    expect(newestReading(readings, "teams_trying")).toBeNull();
    expect([deltaLine({ value: 9, before: 7 }), deltaLine({ value: 7, before: 9 }), deltaLine({ value: 3, before: 3 }), deltaLine({ value: 3, before: null })]).toEqual(["+2 wk", "−2 wk", "±0 wk", ""]);
  });

  it("runs its time from its start to its day", () => {
    expect(goalTime(GOAL_START)).toEqual({ used: 0, left: 63 });
    expect(goalTime(GOAL_DAY)).toEqual({ used: 1, left: 0 });
    expect(goalTime("2027-03-01").left).toBe(0);
    expect(goalTime(TODAY).left).toBe(58);
  });
});

describe("the platform rows", () => {
  it("lists those with a state first, active first, then any other an act names, each with its newest act and who waits", () => {
    const rows = platformRows(
      room({
        platforms: [platform({ platform: "reddit", state: "hold" }), platform({ platform: "linkedin", pace: 3 })],
        acts: [
          act({ platform: "linkedin", kind: "comment", at: "2026-11-17T00:00:00.000Z", line: "Older." }),
          act({ platform: "linkedin", kind: "post", at: "2026-11-18T00:00:00.000Z", line: "Newer." }),
          act({ platform: "github", kind: "event" }),
          act({ platform: "linkedin", kind: "in", conversation: THREAD, line: "They asked." }),
        ],
      }),
      TODAY,
      ZONE,
    );
    expect(rows.map((row) => [row.slug, row.name, row.state, row.done, row.waiting])).toEqual([
      ["linkedin", "LinkedIn", "active", 2, 1],
      ["reddit", "Reddit", "hold", 0, 0],
      ["github", "GitHub", null, 0, 0],
    ]);
    expect(rows[0]?.last?.line).toBe("They asked.");
  });

  it("names a slug it knows and shows any other as it is, and says a note with its day", () => {
    expect([platformName("linkedin-page"), platformName("hn"), platformName("mastodon")]).toEqual(["Company page", "Hacker News", "mastodon"]);
    expect([noteLine({ note: "Posts held back", until: "2026-12-05" }), noteLine({ note: null, until: null })]).toEqual(["Posts held back · look again 5 Dec", ""]);
  });
});

describe("the work", () => {
  const thread = (number: number, summary: string | null) => ({ number, title: `Thread ${number}`, summary, status: "act" });

  it("splits the Distribution collection by what each summary waits on", () => {
    const split = splitWork([
      thread(1, "Decided: a launch post.\nWaiting on: onboarding shipping\nNext: draft it."),
      thread(2, "Waiting on: Suresh, to record it"),
      thread(3, "Waiting on: nothing"),
      thread(4, null),
      thread(5, "A summary in prose, with no lines."),
      thread(6, "Waiting on: 100 stars on the repository"),
    ]);
    expect(split.gated.map((one) => [one.thread.number, one.on])).toEqual([
      [1, "onboarding shipping"],
      [6, "100 stars on the repository"],
    ]);
    expect(split.todo.map((one) => one.number)).toEqual([2, 3, 4, 5]);
  });
});

describe("the people and the log", () => {
  it("lists everyone met in public but the team, newest first, once each", () => {
    const met = peopleMet([
      act({ person: { number: 4, name: "Kiran" }, audience: "peer", at: "2026-11-17T00:00:00.000Z" }),
      act({ person: { number: 4, name: "Kiran" }, audience: null, at: "2026-11-18T00:00:00.000Z", line: "Newest." }),
      act({ person: { number: 5, name: "Noor" }, audience: "team" }),
      act({ person: null }),
    ]);
    expect(met.map((one) => [one.person.name, one.last.line, one.audience, one.acts])).toEqual([["Kiran", "Newest.", "peer", 2]]);
  });

  it("keeps the team's acts apart", () => {
    expect([teamLine([act({ audience: "team" }), act({ audience: "team" }), act()]), teamLine([act()])]).toEqual(["2 team acts in this time, kept apart and not counted.", ""]);
  });
});

describe("the room's reach and addresses", () => {
  it("reads from the goal's start, at least five weeks and at most 90 days back", () => {
    expect(sinceFor(TODAY)).toBe("2026-10-14");
    expect(sinceFor("2026-12-30")).toBe(GOAL_START);
    expect(sinceFor("2027-03-01")).toBe("2026-12-02");
  });

  it("is /distribution for Stigmer and /distribution/capsjump for CapsJump", () => {
    expect([distributionPath("stigmer"), distributionPath("capsjump")]).toEqual(["/distribution", "/distribution/capsjump"]);
    expect([DISTRIBUTION_ROUTE.exec("/distribution")?.[1], DISTRIBUTION_ROUTE.exec("/distribution/capsjump")?.[1], DISTRIBUTION_ROUTE.exec("/distribution/stigmer")]).toEqual([undefined, "capsjump", null]);
  });
});
