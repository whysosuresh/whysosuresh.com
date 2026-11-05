// The threads page's keys (site/app/keys.js), one map for the key handler and the keyboard sheet. What it holds:
// every key the sheet lists does what the sheet says, ⌘K and Ctrl+K find, the browser's own shortcuts stay its own,
// and a key the page doesn't use does nothing.

import { describe, expect, it } from "vitest";
import { SHEET, commandFor } from "../site/app/keys.js";

const press = (key: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe("the keys", () => {
  it.each([
    ["j", "next"],
    ["J", "next"],
    ["ArrowDown", "next"],
    ["k", "prev"],
    ["Enter", "open"],
    ["Escape", "back"],
    ["1", "tab-look"],
    ["4", "tab-done"],
    ["a", "act"],
    ["t", "discuss"],
    ["d", "drop"],
    ["e", "done"],
    ["u", "reopen"],
    ["c", "space"],
    ["z", "undo"],
    ["m", "comment"],
    ["w", "edit"],
    ["r", "reply"],
    ["n", "new"],
    ["?", "keys"],
  ])("reads %s as %s", (key, command) => {
    expect(commandFor(press(key))).toBe(command);
  });

  it("finds with ⌘K and Ctrl+K, and leaves every other shortcut to the browser", () => {
    expect(commandFor(press("k", { metaKey: true }))).toBe("find");
    expect(commandFor(press("K", { ctrlKey: true }))).toBe("find");
    for (const key of ["r", "w", "n", "z", "1"]) {
      expect(commandFor(press(key, { metaKey: true }))).toBeNull();
      expect(commandFor(press(key, { altKey: true }))).toBeNull();
    }
    expect(commandFor(press("k", { metaKey: true, altKey: true }))).toBeNull();
  });

  it("does nothing for a key the page doesn't use", () => {
    for (const key of ["x", "5", " ", "Tab"]) expect(commandFor(press(key))).toBeNull();
  });

  it("lists on the sheet only keys that do something", () => {
    const listed = SHEET.flatMap((group) => group.rows.map((row) => row.keys));
    const single = listed.filter((keys) => /^[A-Z?]$/.test(keys));
    for (const key of single) expect([key, commandFor(press(key === "?" ? "?" : key.toLowerCase()))]).not.toEqual([key, null]);
    expect(single.length).toBeGreaterThan(10);
  });
});
