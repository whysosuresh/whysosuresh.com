// How a thread's page is shown (site/app/page-view.js): a link to a thread whose main section is a page opens the page
// full screen, while a thread opened inside the app opens in the thread view. What it holds: a history entry's own
// choice wins over everything, `?full` and a page's main section open full screen when the entry made none, a text or
// link thread never opens full screen by itself, a state the site didn't write reads as no choice, and the Thread
// button counts notes in the home page's own word.

import { describe, expect, it } from "vitest";
import { pageFull, readPageState, threadLabel } from "../site/app/page-view.js";

describe("whether the page fills the window", () => {
  const mains = ["text", "page", "link", undefined] as const;

  it("follows an entry's own choice, whatever the address and the main section", () => {
    for (const main of mains) {
      for (const full of [true, false]) {
        expect(pageFull({ full, state: { page: "full" }, main })).toBe(true);
        expect(pageFull({ full, state: { page: "thread" }, main })).toBe(false);
        expect(pageFull({ full, state: { page: "thread", back: true }, main })).toBe(false);
      }
    }
  });

  it("opens a page thread full screen when the entry made no choice: an arrival by its link", () => {
    expect(pageFull({ full: false, state: null, main: "page" })).toBe(true);
    expect(pageFull({ full: true, state: null, main: "page" })).toBe(true);
  });

  it("opens any thread full screen at an old `?full` address, and a text or link thread never by itself", () => {
    expect(pageFull({ full: true, state: null, main: "text" })).toBe(true);
    expect(pageFull({ full: false, state: null, main: "text" })).toBe(false);
    expect(pageFull({ full: false, state: null, main: "link" })).toBe(false);
    expect(pageFull({ full: false, state: null, main: undefined })).toBe(false);
  });

  it("reads a state the site didn't write as no choice", () => {
    for (const junk of [null, undefined, 3, "full", [], {}, { page: "half" }, { page: true }, { other: "full" }]) {
      expect(readPageState(junk)).toBeNull();
      expect(pageFull({ full: false, state: readPageState(junk), main: "page" })).toBe(true);
    }
  });

  it("reads the site's own states, Back's mark only when it is set", () => {
    expect(readPageState({ page: "full" })).toEqual({ page: "full" });
    expect(readPageState({ page: "thread" })).toEqual({ page: "thread" });
    expect(readPageState({ page: "thread", back: true })).toEqual({ page: "thread", back: true });
    expect(readPageState({ page: "thread", back: "yes" })).toEqual({ page: "thread" });
  });
});

describe("the Thread button", () => {
  it("counts notes as the home page does, and says just Thread at none", () => {
    expect([threadLabel(0), threadLabel(1), threadLabel(4)]).toEqual(["Thread", "Thread · 1 note", "Thread · 4 notes"]);
  });
});
