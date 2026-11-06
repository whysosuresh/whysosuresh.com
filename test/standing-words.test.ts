// Where a thread stands (site/app/standing.js), the one map the threads page, the Worker and the command line share,
// and the words the page says for it. What it holds: every status sits in exactly one of the page's two tabs, Pending
// or Done; the lists the server answers are Pending, the three open statuses one by one, and Done; an old address's
// tab keeps its meaning (To look at opens Pending showing New only); an address the page writes is the new shape, and
// a filter rides only on Pending; Pending is newest number first, Done most recently closed first (when it last moved,
// or arrived when it never moved), the number breaking a tie; the counts line counts each open status; a row's tag
// says where the thread stands, Dropped with its reason, except where the list around it already says so.

import { describe, expect, it } from "vitest";
import {
  LISTS,
  OPEN,
  STATUS_NAMES,
  TABS,
  TAB_NAMES,
  breakdown,
  countWords,
  isList,
  listPath,
  ordered,
  routeTab,
  shows,
  tabOf,
  tagOf,
} from "../site/app/standing.js";

type Status = "received" | "act" | "discuss" | "done" | "dropped" | "filed";
const STATUSES: Status[] = ["received", "act", "discuss", "done", "dropped", "filed"];

type Made = { number: number; status: Status; createdAt: string; movedAt: string | null; dropReason: string | null };
const made = (number: number, status: Status, extra: Partial<Made> = {}): Made => ({
  number,
  status,
  createdAt: "2026-11-01T09:00:00.000Z",
  movedAt: null,
  dropReason: null,
  ...extra,
});

describe("the tabs", () => {
  it("are Pending and Done, and every status sits in exactly one", () => {
    expect(TABS).toEqual(["pending", "done"]);
    expect(TAB_NAMES).toEqual({ pending: "Pending", done: "Done" });
    for (const status of STATUSES) {
      const holding = TABS.filter((tab) => shows(tab, null, status));
      expect([status, holding]).toEqual([status, [tabOf(status)]]);
    }
    expect(OPEN.map(tabOf)).toEqual(["pending", "pending", "pending"]);
    expect(tabOf("filed")).toBe("done");
  });

  it("filters Pending by one open status, and nothing else", () => {
    expect(shows("pending", "act", "act")).toBe(true);
    expect(shows("pending", "act", "received")).toBe(false);
    expect(shows("pending", "act", "done")).toBe(false);
    expect(shows("done", "act", "dropped")).toBe(true);
  });
});

describe("the lists the server answers", () => {
  it("are Pending, each open status alone, and Done", () => {
    expect(LISTS).toEqual({
      pending: ["received", "act", "discuss"],
      look: ["received"],
      act: ["act"],
      discuss: ["discuss"],
      done: ["done", "dropped", "filed"],
    });
    for (const name of Object.keys(LISTS)) expect(isList(name)).toBe(true);
    for (const name of ["", "received", "Pending", "toString", "constructor"]) expect(isList(name)).toBe(false);
  });
});

describe("an address", () => {
  it.each([
    ["", { tab: "pending", only: null }],
    ["?tab=pending", { tab: "pending", only: null }],
    ["?tab=done", { tab: "done", only: null }],
    ["?only=received", { tab: "pending", only: "received" }],
    ["?only=discuss&space=company", { tab: "pending", only: "discuss" }],
    ["?tab=done&only=act", { tab: "done", only: null }],
    ["?only=done", { tab: "pending", only: null }],
    ["?tab=look", { tab: "pending", only: "received" }],
    ["?tab=act", { tab: "pending", only: "act" }],
    ["?tab=discuss&space=stigmer", { tab: "pending", only: "discuss" }],
    ["?tab=nonsense", { tab: "pending", only: null }],
  ])("%s opens %j", (search, route) => {
    expect(routeTab(new URLSearchParams(search))).toEqual(route);
  });

  it.each([
    ["pending", null, null, "/threads/"],
    ["pending", "discuss", null, "/threads/?only=discuss"],
    ["pending", null, "company", "/threads/?space=company"],
    ["pending", "received", "company", "/threads/?only=received&space=company"],
    ["done", null, null, "/threads/?tab=done"],
    ["done", "act", "stigmer", "/threads/?tab=done&space=stigmer"],
  ] as const)("is written for %s, %s, %s as %s", (tab, only, space, path) => {
    expect(listPath(tab, only, space)).toBe(path);
    const back = routeTab(new URL(path, "https://whysosuresh.com").searchParams);
    expect(back).toEqual({ tab, only: tab === "pending" ? only : null });
  });
});

describe("the order", () => {
  it("is newest number first on Pending", () => {
    const threads = [made(3, "act"), made(9, "received"), made(5, "discuss")];
    expect(ordered("pending", threads).map((thread) => thread.number)).toEqual([9, 5, 3]);
  });

  it("is most recently closed first on Done, by when it moved or else when it arrived, the number breaking a tie", () => {
    const threads = [
      made(1, "done", { movedAt: "2026-11-05T10:00:00.000Z" }),
      made(2, "dropped", { movedAt: "2026-11-02T10:00:00.000Z" }),
      made(3, "filed", { createdAt: "2026-11-04T10:00:00.000Z" }),
      made(4, "done", { movedAt: "2026-11-02T10:00:00.000Z" }),
      made(5, "done", { createdAt: "2026-10-01T10:00:00.000Z", movedAt: "2026-11-06T08:00:00.000Z" }),
    ];
    expect(ordered("done", threads).map((thread) => thread.number)).toEqual([5, 1, 3, 4, 2]);
  });

  it("leaves the list it was given as it was", () => {
    const threads = [made(1, "act"), made(2, "act")];
    ordered("pending", threads);
    expect(threads.map((thread) => thread.number)).toEqual([1, 2]);
  });
});

describe("the counts line", () => {
  it("counts each open status and ignores the closed ones", () => {
    const threads = [made(1, "received"), made(2, "received"), made(3, "act"), made(4, "discuss"), made(5, "done"), made(6, "dropped")];
    expect(breakdown(threads)).toEqual({ received: 2, act: 1, discuss: 1 });
    expect(breakdown([])).toEqual({ received: 0, act: 0, discuss: 0 });
  });

  it("says each count in the order sorting goes", () => {
    expect(countWords({ received: 2, act: 5, discuss: 3 })).toEqual([
      { status: "received", words: "2 new" },
      { status: "act", words: "5 to do" },
      { status: "discuss", words: "3 to discuss" },
    ]);
  });
});

describe("the words", () => {
  it("name every status the same way everywhere", () => {
    expect(STATUS_NAMES).toEqual({ received: "New", act: "To do", discuss: "To discuss", done: "Done", dropped: "Dropped", filed: "Filed" });
  });
});

describe("a row's tag", () => {
  it("says where the thread stands", () => {
    expect(tagOf(made(1, "received"))).toEqual({ status: "received", words: "New" });
    expect(tagOf(made(1, "act"))).toEqual({ status: "act", words: "To do" });
    expect(tagOf(made(1, "discuss"))).toEqual({ status: "discuss", words: "To discuss" });
    expect(tagOf(made(1, "done"))).toEqual({ status: "done", words: "Done" });
    expect(tagOf(made(1, "filed"))).toEqual({ status: "filed", words: "Filed" });
  });

  it("gives a dropped thread's reason when it has one", () => {
    expect(tagOf(made(1, "dropped", { dropReason: "Junk" }))).toEqual({ status: "dropped", words: "Dropped: Junk" });
    expect(tagOf(made(1, "dropped"))).toEqual({ status: "dropped", words: "Dropped" });
  });

  it("is quiet where the list around it already says it", () => {
    expect(tagOf(made(1, "received"), ["received"])).toBeNull();
    expect(tagOf(made(1, "done"), ["done"])).toBeNull();
    expect(tagOf(made(1, "act"), ["act", "discuss"])).toBeNull();
    expect(tagOf(made(1, "dropped", { dropReason: "Junk" }), ["done"])).toEqual({ status: "dropped", words: "Dropped: Junk" });
  });
});
