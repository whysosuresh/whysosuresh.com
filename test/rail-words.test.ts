// What the menu down the left lays out and says (site/app/rail.js). What it holds: his rooms in two groups, Today,
// Threads and Distribution first, Distribution's waiting count a pill and never a grey number, and none at 0; his five
// spaces and his pinned collections with All collections at the end, which is where he is in a collection he hasn't
// pinned; Meetings always his, an invited person's only while they have one or are on it; an invited person's open
// threads only, each with its status's mark and its title with no number; a section with nothing in it not drawn; a
// folded section still showing the row the reader is on; the row the reader is on for every view; the foot's name,
// role and initial; what a browser kept of its folds read safely; and the phone's More rooms in the menu's order, which
// the keyboard sheet's note names.

import { describe, expect, it } from "vitest";
import {
  MORE_ROOMS,
  RAIL_WORDS,
  SECTIONS,
  memberRail,
  ownerRail,
  phoneNote,
  readFolded,
  toggled,
  type Here,
  type MemberInput,
  type OwnerInput,
  type Rail,
  type Row,
} from "../site/app/rail.js";

const HERE: Here = { view: "today", number: null, space: null };

function owner(given: Partial<OwnerInput> = {}): OwnerInput {
  return {
    here: HERE,
    tab: "pending",
    only: null,
    today: 7,
    waiting: 3,
    meetings: 1,
    asks: 2,
    people: 12,
    collections: 44,
    spaces: { stigmer: 23, company: 4 },
    pinned: [
      { number: 1, name: "Every screen", threads: 6, href: "/collections/1-every-screen" },
      { number: 2, name: "Launch week", threads: 9, href: "/collections/2-launch-week" },
    ],
    folded: [],
    ...given,
  };
}

function member(given: Partial<MemberInput> = {}): MemberInput {
  return {
    here: HERE,
    name: "Meera",
    email: "meera@example.com",
    shared: 5,
    meetings: 0,
    collections: [{ number: 1, name: "Every screen", threads: 6, href: "/collections/1-every-screen" }],
    threads: [
      { number: 17, status: "act", title: "The pricing tiers, drafted", href: "/threads/17-the-pricing-tiers-drafted" },
      { number: 45, status: "discuss", title: "Who owns what", href: "/threads/45-who-owns-what" },
      { number: 18, status: "dropped", title: "A second pricing call", href: "/threads/18-a-second-pricing-call" },
      { number: 39, status: "received", title: "A name for the plan", href: "/threads/39-a-name-for-the-plan" },
      { number: 38, status: "done", title: "Old business", href: "/threads/38-old-business" },
    ],
    folded: [],
    ...given,
  };
}

const labels = (rows: readonly Row[]): string[] => rows.map((row) => row.label);
const current = (rail: Rail): string[] => [...rail.groups.flat(), ...rail.sections.flatMap((section) => section.rows)].filter((row) => row.current).map((row) => row.label);
const sectionOf = (rail: Rail, id: string) => rail.sections.find((section) => section.id === id);

describe("his menu", () => {
  it("puts Today, Threads and Distribution first, then Meetings, Asks, People and Journal", () => {
    const rail = ownerRail(owner());
    expect(rail.groups.map(labels)).toEqual([
      ["Today", "Threads", "Distribution"],
      ["Meetings", "Asks", "People", "Journal"],
    ]);
  });

  it("draws Distribution's waiting count as a pill, never a grey number, and nothing at 0", () => {
    const distribution = (waiting: number) => ownerRail(owner({ waiting })).groups[0]?.[2];
    expect(distribution(3)).toMatchObject({ count: null, badge: { count: 3, words: "3 waiting on you" } });
    expect(distribution(0)).toMatchObject({ count: null, badge: null });
    // Today's number mixes new, folded and waiting items, so it stays a count.
    expect(ownerRail(owner()).groups[0]?.[0]).toMatchObject({ count: 7, badge: null });
  });

  it("counts every room but Threads and Journal, and keeps Meetings at 0", () => {
    const rail = ownerRail(owner({ meetings: 0 }));
    expect(rail.groups.flat().map((row) => [row.label, row.count])).toEqual([
      ["Today", 7],
      ["Threads", null],
      ["Distribution", null],
      ["Meetings", 0],
      ["Asks", 2],
      ["People", 12],
      ["Journal", null],
    ]);
  });

  it("lists the five spaces with their open counts, each a filter on the Threads room's tab", () => {
    const spaces = sectionOf(ownerRail(owner({ tab: "done" })), "spaces");
    expect(spaces?.label).toBe("Spaces");
    expect(spaces?.rows.map((row) => [row.kind, row.id, row.label, row.count, row.href])).toEqual([
      ["space", "stigmer", "Stigmer", 23, "/threads/?tab=done&space=stigmer"],
      ["space", "company", "Company", 4, "/threads/?tab=done&space=company"],
      ["space", "videos", "My videos", 0, "/threads/?tab=done&space=videos"],
      ["space", "capsjump", "CapsJump", 0, "/threads/?tab=done&space=capsjump"],
      ["space", "other", "Something else", 0, "/threads/?tab=done&space=other"],
    ]);
  });

  it("lists only his pinned collections, then All collections with how many he has", () => {
    const collections = sectionOf(ownerRail(owner()), "collections");
    expect(collections?.rows.map((row) => [row.label, row.count, row.icon, row.href])).toEqual([
      ["Every screen", 6, "stack", "/collections/1-every-screen"],
      ["Launch week", 9, "stack", "/collections/2-launch-week"],
      [RAIL_WORDS.allCollections, 44, null, "/collections"],
    ]);
    expect(labels(sectionOf(ownerRail(owner({ pinned: [] })), "collections")?.rows ?? [])).toEqual(["All collections"]);
  });

  it("marks the row he is on, for every view", () => {
    const on = (here: Partial<Here>) => current(ownerRail(owner({ here: { ...HERE, ...here } })));
    expect(on({ view: "today" })).toEqual(["Today"]);
    expect(on({ view: "list" })).toEqual(["Threads"]);
    expect(on({ view: "list", space: "company" })).toEqual(["Company"]);
    expect(on({ view: "distribution" })).toEqual(["Distribution"]);
    expect(on({ view: "meetings" })).toEqual(["Meetings"]);
    expect(on({ view: "asks" })).toEqual(["Asks"]);
    expect(on({ view: "people" })).toEqual(["People"]);
    expect(on({ view: "person", number: 4 })).toEqual(["People"]);
    expect(on({ view: "journal" })).toEqual(["Journal"]);
    expect(on({ view: "collections" })).toEqual(["All collections"]);
    expect(on({ view: "collection", number: 2 })).toEqual(["Launch week"]);
    // A collection he hasn't pinned has no row of its own, so he is in All collections.
    expect(on({ view: "collection", number: 9 })).toEqual(["All collections"]);
    expect(on({ view: "thread", number: 2 })).toEqual([]);
  });

  it("names him at the foot as the owner", () => {
    expect(ownerRail(owner()).foot).toEqual({ name: "Suresh", role: "Owner", detail: "Owner of whysosuresh.com", initial: "S" });
  });
});

describe("an invited person's menu", () => {
  it("is Shared with you, then the collections he shared with them, then their open threads", () => {
    const rail = memberRail(member());
    expect(rail.groups.map(labels)).toEqual([["Shared with you"]]);
    expect(rail.groups[0]?.[0]).toMatchObject({ id: "today", icon: "inbox", count: 5, href: "/" });
    expect(rail.sections.map((section) => [section.id, section.label])).toEqual([
      ["collections", "Collections"],
      ["threads", "Open threads"],
    ]);
    expect(rail.sections[0]?.rows.map((row) => [row.kind, row.id, row.label, row.count])).toEqual([["collection", 1, "Every screen", 6]]);
  });

  it("lists only open threads, in the order given, each with its status's mark and no number", () => {
    const threads = sectionOf(memberRail(member()), "threads")?.rows ?? [];
    expect(threads.map((row) => [row.id, row.label, row.mark, row.count])).toEqual([
      [17, "The pricing tiers, drafted", { status: "act", words: "To do" }, null],
      [45, "Who owns what", { status: "discuss", words: "To discuss" }, null],
      [39, "A name for the plan", { status: "received", words: "New" }, null],
    ]);
    for (const row of threads) expect(row.label).not.toMatch(/#\d/);
  });

  it("shows Meetings only while they have one, or are on it", () => {
    expect(labels(memberRail(member({ meetings: 0 })).groups.flat())).toEqual(["Shared with you"]);
    expect(labels(memberRail(member({ meetings: 2 })).groups.flat())).toEqual(["Shared with you", "Meetings"]);
    expect(memberRail(member({ meetings: 2 })).groups[0]?.[1]).toMatchObject({ count: 2, current: false });
    expect(memberRail(member({ meetings: 0, here: { ...HERE, view: "meetings" } })).groups[0]?.[1]).toMatchObject({ label: "Meetings", count: 0, current: true });
  });

  it("draws no section that has nothing in it", () => {
    const open = member().threads.filter((thread) => thread.status === "act");
    expect(memberRail(member({ collections: [] })).sections.map((section) => section.id)).toEqual(["threads"]);
    expect(memberRail(member({ threads: member().threads.filter((thread) => thread.status === "dropped") })).sections.map((section) => section.id)).toEqual(["collections"]);
    expect(memberRail(member({ collections: [], threads: [] })).sections).toEqual([]);
    expect(memberRail(member({ collections: [], threads: open })).sections.map((section) => section.id)).toEqual(["threads"]);
  });

  it("marks the row they are on: their door, a meeting, a collection or a thread", () => {
    const on = (here: Partial<Here>) => current(memberRail(member({ meetings: 1, here: { ...HERE, ...here } })));
    expect(on({ view: "today" })).toEqual(["Shared with you"]);
    expect(on({ view: "meetings" })).toEqual(["Meetings"]);
    expect(on({ view: "collection", number: 1 })).toEqual(["Every screen"]);
    expect(on({ view: "thread", number: 45 })).toEqual(["Who owns what"]);
    // A dropped thread is on their door, not in the menu, so nothing in the menu is current.
    expect(on({ view: "thread", number: 18 })).toEqual([]);
  });

  it("names them as he named them, Guest of Suresh, with their address in the account menu", () => {
    expect(memberRail(member()).foot).toEqual({ name: "Meera", role: "Guest of Suresh", detail: "meera@example.com · guest of Suresh", initial: "M" });
  });

  it("names them by their address when he gave no name, and never says it twice", () => {
    for (const name of [null, "", "  "]) {
      expect(memberRail(member({ name })).foot).toEqual({ name: "meera@example.com", role: "Guest of Suresh", detail: "Guest of Suresh", initial: "M" });
    }
  });
});

describe("folding", () => {
  it("hides a folded section's rows but the one the reader is on", () => {
    const rail = ownerRail(owner({ folded: ["spaces"], here: { ...HERE, view: "list", space: "videos" } }));
    expect(sectionOf(rail, "spaces")).toMatchObject({ folded: true });
    expect(labels(sectionOf(rail, "spaces")?.rows ?? [])).toEqual(["My videos"]);
    expect(sectionOf(rail, "collections")).toMatchObject({ folded: false });
    expect(labels(sectionOf(ownerRail(owner({ folded: ["spaces"] })), "spaces")?.rows ?? [])).toEqual([]);
    const theirs = memberRail(member({ folded: ["threads", "collections"], here: { ...HERE, view: "thread", number: 39 } }));
    expect(theirs.sections.map((section) => [section.id, section.folded, labels(section.rows)])).toEqual([
      ["collections", true, []],
      ["threads", true, ["A name for the plan"]],
    ]);
  });

  it("reads what a browser kept as a list of known sections, and anything else as none folded", () => {
    expect(readFolded(null)).toEqual([]);
    expect(readFolded('["spaces","threads"]')).toEqual(["spaces", "threads"]);
    expect(readFolded('["spaces","spaces","nope",3,null]')).toEqual(["spaces"]);
    expect(readFolded('{"spaces":true}')).toEqual([]);
    expect(readFolded("not json")).toEqual([]);
    expect(readFolded('["__proto__","toString"]')).toEqual([]);
  });

  it("folds a section and opens it again", () => {
    expect(toggled([], "spaces")).toEqual(["spaces"]);
    expect(toggled(["spaces", "collections"], "spaces")).toEqual(["collections"]);
  });

  it("names every section a fold is kept under", () => {
    expect(SECTIONS).toEqual({ spaces: "Spaces", collections: "Collections", threads: "Open threads" });
  });
});

describe("the phone's More", () => {
  it("lists the rooms under More in the menu's order, and the keyboard sheet's note names the same", () => {
    expect(MORE_ROOMS.map((room) => [room.go, room.label, room.href])).toEqual([
      ["distribution", "Distribution", "/distribution"],
      ["meetings", "Meetings", "/meetings"],
      ["asks", "Asks", "/asks"],
      ["people", "People", "/people"],
      ["journal", "Journal", "/journal"],
      ["collections", "Collections", "/collections"],
    ]);
    expect(phoneNote(false)).toBe(
      "Phones have no keys: every move is a button on the thread, and the bar along the bottom holds Today, Threads, Find, New and More (Distribution, Meetings, Asks, People, Journal, Collections).",
    );
    expect(phoneNote(true)).toBe("Phones have no keys: the bar along the bottom holds your threads, your meetings and Find.");
  });

  it("puts every room of his menu but Today and Threads under More", () => {
    const rooms = ownerRail(owner()).groups.flat().filter((row) => row.kind === "room").map((row) => row.id);
    expect(new Set(MORE_ROOMS.map((room) => room.go))).toEqual(new Set([...rooms.filter((id) => id !== "today" && id !== "list"), "collections"]));
  });
});
