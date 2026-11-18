// What the collections' pages say (site/app/collections.js). What it holds: a collection's address is its number then
// its name in lower case, as a thread's and a person's are, and the page's pattern reads it back; a row says how many
// threads and its rule; "Show more" names the next page and what is left; a key move goes one place or to an end and
// never past one; the bar above a thread says where it is in the collection; the L picker lists the thread's own
// collections first, then the most recently changed up to six, and once words are typed the search's answer with its
// own first; a new name makes a collection only when no collection has it, ignoring case; a history line names the
// collection as it was and says when its rule kept the thread; and deleting says the threads stay.

import { describe, expect, it } from "vitest";
import {
  COLLECTION_PATH,
  RECENT_PICKS,
  collectionLine,
  collectionPath,
  deleteLine,
  keptToast,
  keptWords,
  makesNew,
  moreLabel,
  movedTo,
  nameProblem,
  pickList,
  ruleLine,
  threadsLine,
  walkLine,
} from "../site/app/collections.js";

const known = (number: number, name: string, threads = 0, rule: string | null = null) => ({ number, name, description: null, rule, pinned: false, changedAt: "2026-11-18T00:00:00.000Z", threads });

describe("a collection's address", () => {
  it("is its number, then its name in lower case, and the pattern reads the number back", () => {
    expect(collectionPath({ number: 3, name: "Every screen" })).toBe("/collections/3-every-screen");
    expect(collectionPath({ number: 4, name: "Café ideas, 2026!" })).toBe("/collections/4-cafe-ideas-2026");
    expect(collectionPath({ number: 5, name: "మీరా" })).toBe("/collections/5");
    for (const path of ["/collections/3-every-screen", "/collections/3", "/collections/999999999-x"]) expect(COLLECTION_PATH.exec(path)?.[1]).toBe(path.split("/")[2]?.split("-")[0]);
    for (const path of ["/collections/0", "/collections/03", "/collections/x", "/collections/3/threads"]) expect(COLLECTION_PATH.test(path)).toBe(false);
  });
});

describe("a collection's words", () => {
  it("counts threads and says its rule", () => {
    expect([threadsLine(0), threadsLine(1), threadsLine(6)]).toEqual(["No threads yet", "1 thread", "6 threads"]);
    expect(collectionLine(known(3, "Every screen", 6, "Design page:"))).toBe("6 threads · new “Design page:” threads join on their own");
    expect(collectionLine(known(4, "Talk", 1))).toBe("1 thread");
    expect(ruleLine("Design page:")).toBe("New threads titled “Design page: …” join at the end.");
    expect(ruleLine(null)).toBe("No rule. Threads join when you add them.");
  });

  it("names the next page and what is left, and nothing once all show", () => {
    expect(moreLabel(25, 44, 25)).toBe("Show 19 more · 19 left");
    expect(moreLabel(50, 180, 50)).toBe("Show 50 more · 130 left");
    expect(moreLabel(44, 44, 25)).toBe("");
  });

  it("says where a thread is in the collection it was opened from", () => {
    expect(walkLine(2, 6)).toBe("3 of 6");
  });

  it("tells keeping and taking out apart, by the collection's name as it was", () => {
    expect(keptWords("kept", { collection: 3, name: "Every screen" })).toBe("kept this in Every screen");
    expect(keptWords("kept", { collection: 3, name: "Every screen", rule: "Design page:" })).toBe("kept this in Every screen, by its rule");
    expect(keptWords("unkept", { collection: 3, name: "Every screen" })).toBe("took this out of Every screen");
    expect(keptWords("kept", {})).toBe("kept this in a collection");
    expect([keptToast(52, "Every screen", true), keptToast(52, "Every screen", false)]).toEqual(["#52 kept in Every screen.", "#52 taken out of Every screen."]);
  });

  it("says deleting takes the collection and leaves its threads", () => {
    expect(deleteLine("Every screen", 6)).toBe("Delete Every screen for good? Its 6 threads stay as they are, only no longer grouped here. This can't be undone.");
    expect(deleteLine("Empty", 0)).toBe("Delete Empty for good? It holds no threads. This can't be undone.");
    expect(deleteLine("Help", 1)).toBe("Delete Help for good? Its one thread stays as it is, only no longer grouped here. This can't be undone.");
    expect(nameProblem("name-taken")).toBe("Another collection has that name.");
  });
});

describe("moving a kept thread by key", () => {
  it("goes one place, or to the top or the bottom, and never past either end", () => {
    expect(movedTo(3, 6, "up", false)).toBe(2);
    expect(movedTo(3, 6, "down", false)).toBe(4);
    expect(movedTo(3, 6, "up", true)).toBe(1);
    expect(movedTo(3, 6, "down", true)).toBe(6);
    expect(movedTo(1, 6, "up", false)).toBe(null);
    expect(movedTo(6, 6, "down", false)).toBe(null);
    expect(movedTo(1, 6, "up", true)).toBe(null);
    expect(movedTo(1, 1, "down", true)).toBe(null);
  });
});

describe("the L picker", () => {
  const recent = Array.from({ length: 10 }, (_, i) => ({ number: i + 1, name: `Set ${i + 1}` }));

  it("lists the thread's own collections first, then the most recently changed others, up to six", () => {
    const list = pickList([{ number: 9, name: "Set 9" }], recent, null);
    expect(list.map((one) => [one.number, one.kept])).toEqual([[9, true], [1, false], [2, false], [3, false], [4, false], [5, false], [6, false]]);
    expect(list.filter((one) => !one.kept)).toHaveLength(RECENT_PICKS);
  });

  it("lists the search's answer once words are typed, the thread's own first", () => {
    const found = [{ number: 2, name: "Design notes" }, { number: 7, name: "Design pages" }];
    expect(pickList([{ number: 7, name: "Design pages" }], recent, found).map((one) => [one.number, one.kept])).toEqual([[7, true], [2, false]]);
    expect(pickList([], recent, [])).toEqual([]);
  });

  it("offers a new collection only for a name nobody has, ignoring case", () => {
    expect(makesNew("Every screen", [{ number: 1, name: "every SCREEN" }])).toBe(false);
    expect(makesNew("Every screens", [{ number: 1, name: "Every screen" }])).toBe(true);
    expect(makesNew("   ", [])).toBe(false);
    expect(makesNew("x".repeat(81), [])).toBe(false);
  });
});
