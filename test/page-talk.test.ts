// The thread's half of what a page and its thread say to each other (site/app/page-talk.js). What it holds: a
// message from a page's frame is taken only as exactly one of its six kinds, in range, a selection's words with their
// spaces and an answer trimmed; a thread's comments sort into the four places a comment sits, replies under their
// parent; the page is told each person's newest answer, by name and never by address or number, and every
// discussion's words with the one being written; and cards beside the page sit level with their words, pushed down
// where two would overlap. The hello each reader's page is answered with is one of four shapes the bridge takes,
// and a public thread's and a signed-in reader's are the bytes they always were; a page told to be read takes no answer.

import { describe, expect, it } from "vitest";
import { DRAFT, KEY, MAX_ANSWER, MAX_QUOTE, discussionFor, helloFor, newestAnswers, placesOf, readPageMessage, stack, takesAnswers } from "../site/app/page-talk.js";

/** The bridge's reading of a hello, loaded by a computed path so this project's type check doesn't follow into it. */
const bridge: string = new URL("../frame/bridge.js", import.meta.url).href;
const { readFromThread } = (await import(bridge)) as { readFromThread(data: unknown): unknown };

/** A comment as the thread's call answers it (site/app/threads-store.js), with the fields these tests set. */
interface Comment {
  id: string;
  author: string;
  name: string | null;
  audience: string;
  state: string;
  body: string;
  createdAt: string;
  personNumber?: number;
  parent?: string | null;
  question?: string | null;
  quote?: { text: string; prefix: string; suffix: string; version: number } | null;
  mine?: boolean;
  visitor?: string;
}

const ID = "6f1c1d6e-3a1b-4a8e-9b1d-0c2f4e5a6b7c";
let made = 0;
function said(fields: Partial<Comment> = {}): Comment {
  made += 1;
  return {
    id: `00000000-0000-4000-8000-${String(made).padStart(12, "0")}`,
    author: "member",
    name: "Dev",
    audience: "thread",
    state: "shown",
    body: `Words ${made}.`,
    createdAt: `2026-11-09T10:${String(made).padStart(2, "0")}:00.000Z`,
    parent: null,
    question: null,
    quote: null,
    mine: false,
    ...fields,
  };
}

describe("a message from a page's frame", () => {
  it("is taken as exactly one of its six kinds", () => {
    expect(readPageMessage({ [KEY]: "height", height: 420 })).toEqual({ kind: "height", height: 420 });
    expect(readPageMessage({ [KEY]: "ready", questions: ["order", "missing", "order"] })).toEqual({ kind: "ready", questions: ["order", "missing"] });
    expect(readPageMessage({ [KEY]: "selected", quote: " the words\n", prefix: "", suffix: "x", top: 120 })).toEqual({ kind: "selected", quote: " the words\n", prefix: "", suffix: "x", top: 120 });
    expect(readPageMessage({ [KEY]: "answer", question: "order", body: "  Fine as is.  " })).toEqual({ kind: "answer", question: "order", body: "Fine as is." });
    expect(readPageMessage({ [KEY]: "anchors", anchors: [{ id: ID, top: 300 }, { id: DRAFT, missing: true }], questions: [{ id: "order", top: 900 }] })).toEqual({
      kind: "anchors",
      anchors: [
        { id: ID, top: 300 },
        { id: DRAFT, top: null },
      ],
      questions: [{ id: "order", top: 900 }],
    });
    expect(readPageMessage({ [KEY]: "open", id: ID })).toEqual({ kind: "open", id: ID });
  });

  it.each([
    ["the old height", { whysosureshPageHeight: 420 }],
    ["a height that isn't a number", { [KEY]: "height", height: "420" }],
    ["a malformed question", { [KEY]: "ready", questions: ["Order"] }],
    ["blank words", { [KEY]: "selected", quote: "  ", prefix: "", suffix: "", top: 0 }],
    ["words over 500", { [KEY]: "selected", quote: "w".repeat(MAX_QUOTE + 1), prefix: "", suffix: "", top: 0 }],
    ["words with no place", { [KEY]: "selected", quote: "w", prefix: "", suffix: "" }],
    ["words with a name", { [KEY]: "selected", quote: "w", prefix: "", suffix: "", top: 0, name: "Suresh" }],
    ["an answer that says who wrote it", { [KEY]: "answer", question: "order", body: "x", author: "owner" }],
    ["a blank answer", { [KEY]: "answer", question: "order", body: " " }],
    ["an answer over 32,000", { [KEY]: "answer", question: "order", body: "x".repeat(MAX_ANSWER + 1) }],
    ["an anchor that is neither placed nor missing", { [KEY]: "anchors", anchors: [{ id: ID }], questions: [] }],
    ["an anchor at no place", { [KEY]: "anchors", anchors: [{ id: ID, top: Number.NaN }], questions: [] }],
    ["opening the composer's draft", { [KEY]: "open", id: DRAFT }],
    ["a kind the page never sends", { [KEY]: "hello" }],
    ["nothing", null],
  ])("refuses %s", (_, data) => {
    expect(readPageMessage(data)).toBeNull();
  });
});

describe("where a thread's comments sit", () => {
  it("sorts them into general comments, answers, words and replies by parent, leaving dropped notes out", () => {
    const root = said();
    const words = said({ quote: { text: "the demo", prefix: "", suffix: "", version: 2 } });
    const answer = said({ question: "order" });
    const reply = said({ parent: root.id });
    const onWords = said({ parent: words.id });
    const dropped = said({ author: "visitor", state: "dropped" });
    const places = placesOf([root, words, answer, reply, onWords, dropped]);
    expect(places.general).toEqual([root]);
    expect(places.answers).toEqual([answer]);
    expect(places.words).toEqual([words]);
    expect(places.replies).toEqual(
      new Map([
        [root.id, [reply]],
        [words.id, [onWords]],
      ]),
    );
  });

  it("keeps each person's newest answer to each question, in the order they answered", () => {
    const first = said({ question: "order", body: "Fine as is." });
    const asha = said({ question: "order", name: "Asha" });
    const mine = said({ question: "order", author: "owner", name: null, mine: true });
    const changed = said({ question: "order", body: "Swap them." });
    const other = said({ question: "missing" });
    expect(newestAnswers([first, asha, mine, changed, other])).toEqual([asha, mine, changed, other]);
  });

  it("keeps two visitors who typed the same name apart, by their key, and a visitor's change in place of the last", () => {
    const sam = said({ question: "order", author: "visitor", name: "Sam", visitor: "aaaa1111aaaa1111", body: "One." });
    const otherSam = said({ question: "order", author: "visitor", name: "Sam", visitor: "bbbb2222bbbb2222", body: "Two." });
    const samAgain = said({ question: "order", author: "visitor", name: "Sam", visitor: "aaaa1111aaaa1111", body: "One, changed." });
    expect(newestAnswers([sam, otherSam, samAgain])).toEqual([otherSam, samAgain]);
  });
});

describe("what the page is told", () => {
  it("is each newest answer by name, the owner's as his, every discussion's words and the one being written", () => {
    const answer = said({ question: "order", body: "Fine as is.", personNumber: 4 });
    const his = said({ question: "order", author: "owner", name: null, body: "Agreed.", mine: true });
    const words = said({ quote: { text: "the demo", prefix: "then ", suffix: ", then", version: 1 } });
    const told = discussionFor(placesOf([answer, his, words]), { ownerName: "Suresh", draft: { quote: "Dev opens", prefix: "", suffix: " and" }, active: null });
    expect(told).toEqual({
      [KEY]: "discussion",
      answers: [
        { question: "order", name: "Dev", body: "Fine as is.", at: answer.createdAt, mine: false },
        { question: "order", name: "Suresh", body: "Agreed.", at: his.createdAt, mine: true },
      ],
      anchors: [
        { id: words.id, quote: "the demo", prefix: "then ", suffix: ", then" },
        { id: DRAFT, quote: "Dev opens", prefix: "", suffix: " and" },
      ],
      active: null,
    });
    expect(JSON.stringify(told)).not.toMatch(/personNumber|@|"4"/);
  });

  it("tells a public thread's answers as given, so two visitors named alike are both told", () => {
    const one = said({ question: "order", author: "visitor", name: "Sam", body: "One." });
    const two = said({ question: "order", author: "visitor", name: "Sam", body: "Two.", mine: true });
    const told = discussionFor(placesOf([one, two]), { ownerName: "Suresh", draft: null, active: null, asGiven: true });
    expect(told.answers.map((answer) => [answer.name, answer.body, answer.mine])).toEqual([
      ["Sam", "One.", false],
      ["Sam", "Two.", true],
    ]);
    expect(JSON.stringify(told)).not.toContain("visitor");
  });
});

describe("cards beside the page", () => {
  it("sit level with their words, pushed down where two would overlap", () => {
    const { placed, bottom } = stack(
      [
        { id: "b", want: 300, height: 120 },
        { id: "a", want: 100, height: 150 },
        { id: "c", want: 320, height: 60 },
      ],
      8,
    );
    expect(placed).toEqual(
      new Map([
        ["a", 100],
        ["b", 300],
        ["c", 428],
      ]),
    );
    expect(bottom).toBe(496);
  });
});

describe("the hello a page is answered with", () => {
  it("keeps a signed-in reader's and a public visitor's hello byte for byte", () => {
    expect(JSON.stringify(helloFor("member"))).toBe('{"whysosuresh":"hello"}');
    expect(JSON.stringify(helloFor("visitor"))).toBe('{"whysosuresh":"hello","visitor":true}');
  });

  it("tells an ask's visitor and the owner reading an ask apart, as the bridge reads them", () => {
    expect(helloFor("private")).toEqual({ [KEY]: "hello", mode: "private" });
    expect(helloFor("read")).toEqual({ [KEY]: "hello", mode: "read" });
    expect(readFromThread(helloFor("member"))).toEqual({ kind: "hello", visitor: false, mode: "answer" });
    expect(readFromThread(helloFor("visitor"))).toEqual({ kind: "hello", visitor: true, mode: "answer" });
    expect(readFromThread(helloFor("private"))).toEqual({ kind: "hello", visitor: true, mode: "private" });
    expect(readFromThread(helloFor("read"))).toEqual({ kind: "hello", visitor: false, mode: "read" });
  });
});

describe("which pages take answers", () => {
  it("takes them from every page but one he only reads, whatever a page script posts", () => {
    expect([takesAnswers("member"), takesAnswers("visitor"), takesAnswers("private"), takesAnswers("read")]).toEqual([true, true, true, false]);
  });
});
