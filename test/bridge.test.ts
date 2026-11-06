// The bridge every saved page carries (frame/bridge.js), its pure parts, run on Node: importing it runs nothing,
// because its start runs only in a document. What it holds: quoted words are found again by their text either side,
// in a later version too, and are missing once a version cuts them; a selection's words keep their spaces and line
// breaks, with up to 64 characters either side, and a blank one or one over 500 is no quote; and a message from the
// thread is taken only as exactly one of its four kinds, in range, so nothing else the parent posts reaches the page:
// a hello is the signed-in thread's or a visitor's, and a save that failed may say why in one short line.

import { describe, expect, it } from "vitest";

/**
 * The bridge's pure parts, as the tests use them. The file is loaded by a computed path, so this project's type check
 * (Node, no browser) doesn't follow into its start; tsconfig.site.json checks the file itself against the browser.
 */
interface Quote {
  quote: string;
  prefix: string;
  suffix: string;
}
interface Bridge {
  KEY: string;
  MAX_CONTEXT: number;
  MAX_QUOTE: number;
  isId(value: unknown): boolean;
  locate(text: string, quote: Quote): number;
  quoteOf(text: string, start: number, end: number): Quote | null;
  readFromThread(data: unknown): unknown;
}
const where: string = new URL("../frame/bridge.js", import.meta.url).href;
const { KEY, MAX_CONTEXT, MAX_QUOTE, isId, locate, quoteOf, readFromThread } = (await import(where)) as Bridge;

const ID = "6f1c1d6e-3a1b-4a8e-9b1d-0c2f4e5a6b7c";

describe("finding quoted words again", () => {
  it("finds the one place the words appear", () => {
    const text = "Questions go to Suresh. The live app is shown only if someone asks.";
    expect(locate(text, { quote: "The live app", prefix: "Suresh. ", suffix: " is shown" })).toBe(text.indexOf("The live app"));
  });

  it("picks, of every place the words appear, the one whose context fits", () => {
    const text = "Dev opens. Then the demo. Asha opens the questions. Then the close.";
    const second = text.lastIndexOf("Then the");
    expect(locate(text, { quote: "Then the", prefix: "the questions. ", suffix: " close." })).toBe(second);
    expect(locate(text, { quote: "Then the", prefix: "Dev opens. ", suffix: " demo." })).toBe(text.indexOf("Then the"));
  });

  it("finds them in a later version whose text around them moved, and misses them once they are cut", () => {
    const quote = { quote: "twelve minutes of demo", prefix: "then ", suffix: ", then questions" };
    const later = "A new opening line. Dev opens, then twelve minutes of demo, then questions.";
    expect(locate(later, quote)).toBe(later.indexOf("twelve"));
    expect(locate("Dev opens, then a demo, then questions.", quote)).toBe(-1);
    expect(locate("anything", { quote: "", prefix: "", suffix: "" })).toBe(-1);
  });
});

describe("a selection's words", () => {
  it("keeps the words as selected, with up to 64 characters either side", () => {
    const text = `${"a".repeat(100)}  the words\n here ${"b".repeat(100)}`;
    const start = text.indexOf("the words");
    const quote = quoteOf(text, start, start + "the words\n here".length);
    expect(quote).toEqual({ quote: "the words\n here", prefix: `${"a".repeat(MAX_CONTEXT - 2)}  `, suffix: ` ${"b".repeat(MAX_CONTEXT - 1)}` });
    expect(quoteOf("abc", 0, 3)).toEqual({ quote: "abc", prefix: "", suffix: "" });
  });

  it("is no quote when blank or longer than one comment may quote", () => {
    expect(quoteOf("a   b", 1, 4)).toBeNull();
    const long = "w".repeat(MAX_QUOTE + 1);
    expect(quoteOf(long, 0, MAX_QUOTE + 1)).toBeNull();
    expect(quoteOf(long, 0, MAX_QUOTE)?.quote.length).toBe(MAX_QUOTE);
  });
});

describe("a message from the thread", () => {
  const answer = { question: "order", name: "Dev", body: "Fine as is.", at: "2026-11-09T21:14:00.000Z", mine: false };
  const anchor = { id: ID, quote: "The live app", prefix: "", suffix: " is shown" };

  it("is taken as exactly one of hello, discussion, focus and saved", () => {
    expect(readFromThread({ [KEY]: "hello" })).toEqual({ kind: "hello", visitor: false });
    expect(readFromThread({ [KEY]: "hello", visitor: true })).toEqual({ kind: "hello", visitor: true });
    expect(readFromThread({ [KEY]: "discussion", answers: [answer], anchors: [anchor, { ...anchor, id: "draft" }], active: ID })).toEqual({
      kind: "discussion",
      answers: [answer],
      anchors: [anchor, { ...anchor, id: "draft" }],
      active: ID,
    });
    expect(readFromThread({ [KEY]: "focus", id: ID, scroll: true })).toEqual({ kind: "focus", id: ID, scroll: true });
    expect(readFromThread({ [KEY]: "saved", question: "order", ok: false })).toEqual({ kind: "saved", question: "order", ok: false, problem: null });
    expect(readFromThread({ [KEY]: "saved", question: "order", ok: false, problem: "Add your name above the page first." })).toEqual({
      kind: "saved",
      question: "order",
      ok: false,
      problem: "Add your name above the page first.",
    });
  });

  it.each([
    ["the frame's old height", { whysosureshPageHeight: 400 }],
    ["an unknown kind", { [KEY]: "save", body: "x" }],
    ["hello with more", { [KEY]: "hello", name: "Meera" }],
    ["a visitor's hello that says no", { [KEY]: "hello", visitor: false }],
    ["a visitor's hello that isn't a yes", { [KEY]: "hello", visitor: "yes" }],
    ["a save's blank problem", { [KEY]: "saved", question: "order", ok: false, problem: "  " }],
    ["a save's problem too long to be a line", { [KEY]: "saved", question: "order", ok: false, problem: "x".repeat(201) }],
    ["a save's problem that isn't text", { [KEY]: "saved", question: "order", ok: false, problem: 7 }],
    ["an answer with an address", { [KEY]: "discussion", answers: [{ ...answer, email: "dev@example.com" }], anchors: [], active: null }],
    ["an answer to a malformed question", { [KEY]: "discussion", answers: [{ ...answer, question: "Order" }], anchors: [], active: null }],
    ["words with too much context", { [KEY]: "discussion", answers: [], anchors: [{ ...anchor, prefix: "p".repeat(MAX_CONTEXT + 1) }], active: null }],
    ["an anchor with no words", { [KEY]: "discussion", answers: [], anchors: [{ ...anchor, quote: "" }], active: null }],
    ["an id that isn't one", { [KEY]: "focus", id: "c1", scroll: false }],
    ["a list that isn't one", { [KEY]: "discussion", answers: "none", anchors: [], active: null }],
    ["an array", [{ [KEY]: "hello" }]],
    ["text", "hello"],
  ])("refuses %s", (_, data) => {
    expect(readFromThread(data)).toBeNull();
  });

  it("names comments by the store's ids, and the composer's own draft", () => {
    expect([isId(ID), isId("draft"), isId("DRAFT"), isId(`${ID}x`), isId(7)]).toEqual([true, true, false, false, false]);
  });
});
