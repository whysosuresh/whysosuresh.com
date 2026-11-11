// How the journal's page text is read (site/app/journal.js), the one reader the page and the Worker share, on made-up
// pages in the recorder sync's grammar. What it holds: a day's card (title, subtitle, one line, contents, people, wins,
// storylines with their new and closed marks wherever the line puts them), each story with its title, when and blocks
// (paragraphs, a quote, a photo, a list), a one-story day with no story title, and its close (sitting with, the
// question, still asking, the arrows and the note); a week's chapter prose, its quiet and week-ahead lines, and its
// storylines; a page with no title is none; every unknown margin label is kept; a photo is only ever `photo:<id>`, any
// other source its caption alone; a link to the site opens in place and any other address only when it is http(s);
// the keys are real days and real ISO weeks (53-week years included); the journal's order puts a week just before its
// Sunday; a storyline's countdown is reckoned from the day its line was written, so a later day still counts right,
// moves when a later line moves it, ends when it closes, and is gone once its day has passed.

import { describe, expect, it } from "vitest";
import {
  countdownOn,
  countdownTarget,
  daysBetween,
  endOf,
  entryPath,
  inline,
  isDayKey,
  isWeekKey,
  kindOf,
  leftWords,
  newestFirst,
  parse,
  photosOf,
  storylinePath,
  storylineSlug,
  weekDays,
  weekOf,
} from "../site/app/journal.js";

const PHOTO = "0b6f2c8e-1d1a-4c55-9a0e-6f0f8a1b2c3d";

/** A made-up two-story day, written as the sync writes one. */
const DAY = `## A quiet start
*Tuesday, 3 March · two stories*

**In one line:** Tea first, then the long walk.

- **Morning** · Tea on the step
- **The evening** · The long walk

**People:** Ada, Grace
**Wins:** tea · a walk · *ten* pages
**Storyline · The talk:** 12 days to go. Slides half done.
**Storyline · The garden (new):** seeds in the ground.
**Storyline · Old habit:** let go (closed)

· · ·

### Tea on the step
*6:40 am, the back step*

The kettle took its time.

> Slow is a speed too.

![The step at dawn](photo:${PHOTO})

· · ·

### The long walk
*7 pm, along the river*

Ada called halfway. See [#22](https://hey.whysosuresh.com/threads/22) and [the notes](https://example.com/notes).

![An old one](data:image/jpeg;base64,AAAA)

· · ·

**Sitting with:** small things, kept daily.

**Still asking:** Did the seeds come up?

**Tomorrow's question:** What will the talk open with?

→ [#24](https://hey.whysosuresh.com/threads/24) · The talk's opening
→ To-do · Water the garden

*From two recordings.*
`;

const WEEK = `## Week 10 · Small steps
*Monday 2 March – Sunday 8 March*

The week opened slowly.

> Slow is a speed too.

**People:** Ada, Grace
**Wins:** tea · a walk
**Storyline · The talk:** 9 days to go.
**Quiet:** the bike
**The week ahead:** What does the talk need first?
`;

describe("a day", () => {
  const day = parse(DAY);

  it("reads its card", () => {
    expect(day).not.toBeNull();
    expect(day?.title).toBe("A quiet start");
    expect(day?.subtitle).toBe("Tuesday, 3 March · two stories");
    expect(day?.oneLine).toBe("Tea first, then the long walk.");
    expect(day?.contents).toEqual([
      { when: "Morning", title: "Tea on the step" },
      { when: "The evening", title: "The long walk" },
    ]);
    expect(day?.people).toEqual(["Ada", "Grace"]);
    expect(day?.wins).toEqual(["tea", "a walk", "*ten* pages"]);
  });

  it("reads each storyline once with its mark, wherever the line puts it", () => {
    expect(day?.storylines).toEqual([
      { name: "The talk", state: "12 days to go. Slides half done.", mark: null },
      { name: "The garden", state: "seeds in the ground.", mark: "new" },
      { name: "Old habit", state: "let go (closed)", mark: "closed" },
    ]);
  });

  it("reads its stories with their titles, whens and blocks", () => {
    expect(day?.stories.map((story) => [story.title, story.when, story.blocks.map((block) => block.type)])).toEqual([
      ["Tea on the step", "6:40 am, the back step", ["p", "quote", "photo"]],
      ["The long walk", "7 pm, along the river", ["p", "photo"]],
    ]);
    expect(day?.stories[0]?.blocks[1]).toEqual({ type: "quote", inline: [{ type: "text", text: "Slow is a speed too." }] });
  });

  it("reads its close", () => {
    expect(day?.sittingWith).toBe("small things, kept daily.");
    expect(day?.stillAsking).toBe("Did the seeds come up?");
    expect(day?.question).toBe("What will the talk open with?");
    expect(day?.arrows).toEqual([
      [{ type: "site", text: "#24", path: "/threads/24" }, { type: "text", text: " · The talk's opening" }],
      [{ type: "text", text: "To-do · Water the garden" }],
    ]);
    expect(day?.note).toBe("From two recordings.");
    expect(day?.notes).toEqual([]);
  });

  it("shows only a photo the sync uploaded; any other source is its caption alone", () => {
    expect(day?.stories[0]?.blocks[2]).toEqual({ type: "photo", id: PHOTO, caption: [{ type: "text", text: "The step at dawn" }] });
    expect(day?.stories[1]?.blocks[1]).toEqual({ type: "photo", id: null, caption: [{ type: "text", text: "An old one" }] });
    expect(day === null ? [] : photosOf(day)).toEqual([PHOTO]);
    const elsewhere = parse("## T\n\n· · ·\n\n![x](https://example.com/a.jpg)\n\n![y](photo:not-an-id)");
    expect(elsewhere?.stories[0]?.blocks).toEqual([
      { type: "photo", id: null, caption: [{ type: "text", text: "x" }] },
      { type: "photo", id: null, caption: [{ type: "text", text: "y" }] },
    ]);
  });

  it("keeps a one-story day's prose with no story title, and a day with no close as all stories", () => {
    const one = parse("## One thing\n*Wednesday, 4 March · 7 am*\n\n**In one line:** Just one.\n\n· · ·\n\nIt rained.\n\nThen it stopped.\n\n· · ·\n\n**Sitting with:** rain.");
    expect(one?.stories).toEqual([{ title: null, when: null, blocks: [{ type: "p", inline: [{ type: "text", text: "It rained." }] }, { type: "p", inline: [{ type: "text", text: "Then it stopped." }] }] }]);
    expect(one?.sittingWith).toBe("rain.");
    const open = parse("## No close\n\n· · ·\n\nOnly a story.");
    expect(open?.stories).toHaveLength(1);
    expect(open?.sittingWith).toBeNull();
  });

  it("keeps a margin label it doesn't know, and is none without a title first", () => {
    expect(parse("## T\n\n**Mood:** bright")?.notes).toEqual([{ label: "Mood", text: "bright" }]);
    expect(parse("Just words.\n\n## Late title")).toBeNull();
    expect(parse("")).toBeNull();
    expect(parse("##  \n\nwords")).toBeNull();
  });

  it("reads the question with a curly apostrophe too", () => {
    expect(parse("## T\n\n· · ·\n\n**Tomorrow’s question:** Why?")?.question).toBe("Why?");
  });
});

describe("a week", () => {
  const week = parse(WEEK);

  it("reads its chapter as prose, with its own margin", () => {
    expect(week?.title).toBe("Week 10 · Small steps");
    expect(week?.subtitle).toBe("Monday 2 March – Sunday 8 March");
    expect(week?.body.map((block) => block.type)).toEqual(["p", "quote"]);
    expect(week?.stories).toEqual([]);
    expect(week?.quiet).toBe("the bike");
    expect(week?.weekAhead).toBe("What does the talk need first?");
    expect(week?.storylines.map((line) => line.name)).toEqual(["The talk"]);
  });
});

describe("inline runs", () => {
  it("reads bold, italic and links, opening the site's own addresses in place", () => {
    expect(inline("a **b** *c* [d](https://hey.whysosuresh.com/threads/22) [e](https://github.com/x/y/issues/1) [f](javascript:alert(1)) [g](/me)")).toEqual([
      { type: "text", text: "a " },
      { type: "strong", text: "b" },
      { type: "text", text: " " },
      { type: "em", text: "c" },
      { type: "text", text: " " },
      { type: "site", text: "d", path: "/threads/22" },
      { type: "text", text: " " },
      { type: "link", text: "e", href: "https://github.com/x/y/issues/1" },
      { type: "text", text: " " },
      { type: "text", text: "f" },
      { type: "text", text: ") " },
      { type: "text", text: "g" },
    ]);
  });

  it("opens in place only a path on the site itself, never one that leaves it", () => {
    expect(inline("[a](https://hey.whysosuresh.com//evil.com) [b](https://hey.whysosuresh.com/\\evil.com) [c](https://hey.whysosuresh.com)")).toEqual([
      { type: "link", text: "a", href: "https://hey.whysosuresh.com//evil.com" },
      { type: "text", text: " " },
      { type: "link", text: "b", href: "https://hey.whysosuresh.com/\\evil.com" },
      { type: "text", text: " " },
      { type: "site", text: "c", path: "/" },
    ]);
    // The home page lives on another host now, so a link to it, or to a thread's old address there, opens out.
    expect(inline("[h](https://whysosuresh.com) [t](https://whysosuresh.com/threads/22)")).toEqual([
      { type: "link", text: "h", href: "https://whysosuresh.com" },
      { type: "text", text: " " },
      { type: "link", text: "t", href: "https://whysosuresh.com/threads/22" },
    ]);
  });

  it("reads a long run of openers in linear time", () => {
    for (const run of [" **x", "[a", " *x", "**"]) {
      const line = run.repeat(Math.floor(64_000 / run.length));
      const started = performance.now();
      inline(line);
      expect([run, performance.now() - started < 250]).toEqual([run, true]);
    }
  });

  it("never reads a lone star or a star inside a word as italic", () => {
    expect(inline("2 * 3 and a*b*c")).toEqual([{ type: "text", text: "2 * 3 and a*b*c" }]);
  });
});

describe("keys", () => {
  it("knows a real day from a malformed or impossible one", () => {
    expect(["2026-11-06", "2024-02-29"].map(isDayKey)).toEqual([true, true]);
    expect(["2026-02-29", "2026-13-01", "2026-11-6", "2026-11-06 ", "20261106"].map(isDayKey)).toEqual([false, false, false, false, false]);
  });

  it("knows the ISO weeks, a 53-week year's included", () => {
    expect(weekOf("2026-10-26")).toBe("2026-W44");
    expect(weekOf("2026-11-01")).toBe("2026-W44");
    expect(weekOf("2026-11-02")).toBe("2026-W45");
    expect(weekOf("2026-12-31")).toBe("2026-W53");
    expect(weekOf("2027-01-03")).toBe("2026-W53");
    expect(weekOf("2027-01-04")).toBe("2027-W01");
    expect(weekOf("2024-12-30")).toBe("2025-W01");
    expect(["2026-W53", "2026-W01", "2027-W52"].map(isWeekKey)).toEqual([true, true, true]);
    expect(["2027-W53", "2026-W00", "2026-W54", "2026-w44"].map(isWeekKey)).toEqual([false, false, false, false]);
    expect(weekDays("2026-W44")).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(weekDays("2026-W53")[6]).toBe("2027-01-03");
  });

  it("says what a key names", () => {
    expect([kindOf("2026-11-06"), kindOf("2026-W44"), kindOf("storylines"), kindOf("2026-W60")]).toEqual(["day", "week", null, null]);
  });

  it("orders the journal newest first, a week just before its own Sunday", () => {
    const keys = ["2026-10-31", "2026-11-02", "2026-W44", "2026-11-01", "2026-W45"].map((key) => ({ key }));
    expect(newestFirst(keys).map((entry) => entry.key)).toEqual(["2026-W45", "2026-11-02", "2026-W44", "2026-11-01", "2026-10-31"]);
    expect(endOf("2026-W44")).toBe("2026-11-01");
  });

  it("gives each entry and storyline its address", () => {
    expect(entryPath("2026-W44")).toBe("/journal/2026-W44");
    expect(storylinePath("The demo")).toBe("/journal/storylines/the-demo");
    expect(storylineSlug("whysosuresh.com")).toBe("whysosuresh-com");
    expect(storylineSlug("Café 100")).toBe("cafe-100");
    expect(storylineSlug("తెలుగు")).toMatch(/^u-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(storylineSlug("తెలుగు")).not.toBe(storylineSlug("హిందీ"));
    expect(storylineSlug(`${"a".repeat(79)} b`)).toBe("a".repeat(79));
    for (const name of ["తెలుగు", "x".repeat(200), `${"a".repeat(79)} b`, "!!"]) expect(storylineSlug(name)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe("countdowns", () => {
  it("points at the day the line was written plus its days, wherever the words sit in the line", () => {
    expect(countdownTarget("12 days to go. Slides half done.", "2026-03-03")).toBe("2026-03-15");
    expect(countdownTarget("25 days to go, a topic due Wednesday.", "2026-11-02")).toBe("2026-11-27");
    expect(countdownTarget("moved to 13 November. 7 days to go.", "2026-11-06")).toBe("2026-11-13");
    expect(countdownTarget("1 day to go", "2026-11-12")).toBe("2026-11-13");
    expect(countdownTarget("seeds in the ground.", "2026-03-03")).toBeNull();
  });

  it("counts from today, across a day boundary, from yesterday's page", () => {
    const touches = [{ key: "2026-11-06", state: "7 days to go.", mark: null }] as const;
    expect(countdownOn(touches, "2026-11-06")).toEqual({ target: "2026-11-13", left: 7 });
    expect(countdownOn(touches, "2026-11-07")).toEqual({ target: "2026-11-13", left: 6 });
    expect(countdownOn(touches, "2026-11-13")).toEqual({ target: "2026-11-13", left: 0 });
    expect(countdownOn(touches, "2026-11-14")).toBeNull();
  });

  it("moves with a later line, keeps its target through a line that counts nothing, and ends when it closes", () => {
    const moved = [
      { key: "2026-11-01", state: "8 days to go.", mark: null },
      { key: "2026-11-06", state: "moved. 7 days to go.", mark: null },
      { key: "2026-11-04", state: "rehearsal again.", mark: null },
    ] as const;
    expect(countdownOn(moved, "2026-11-08")?.target).toBe("2026-11-13");
    expect(countdownOn([{ key: "2026-11-01", state: "8 days to go.", mark: null }, { key: "2026-11-03", state: "quiet.", mark: null }], "2026-11-04")?.target).toBe("2026-11-09");
    expect(countdownOn([{ key: "2026-11-01", state: "8 days to go.", mark: null }, { key: "2026-11-09", state: "done.", mark: "closed" }], "2026-11-09")).toBeNull();
  });

  it("says the days left as a person would", () => {
    expect([leftWords(0), leftWords(1), leftWords(7)]).toEqual(["Today", "1 day to go", "7 days to go"]);
    expect(daysBetween("2026-11-06", "2026-11-13")).toBe(7);
  });
});
