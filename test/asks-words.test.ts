// What the asks' pages say (site/app/asks.js). What it holds: an ask's link and its room's address read back by their
// patterns; a row says who can answer or how many did and when; Answered by puts new answers first and then the
// newest, and finds a name or a number; its head counts the people and the new ones; Today folds several new answers
// to one ask into a row that names two and counts the others; a closed ask's Send a note goes to its topic's note
// when a topic opens it; and every ask event has its history words.

import { describe, expect, it } from "vitest";
import {
  ASK_PATH,
  agoWords,
  answeredHead,
  answererName,
  answerersShown,
  askEventWords,
  askLink,
  askShown,
  countLine,
  foldedTitle,
  foldedWho,
  markedWords,
  savedLine,
  stateWords,
  talkLinkFor,
  topicLine,
  visitorHint,
} from "../site/app/asks.js";

describe("an ask's link", () => {
  it("is /ask/<slug>, shown without its scheme, and read back only for a slug of the Worker's shape", () => {
    expect(askShown("demo-nov-10")).toBe("whysosuresh.com/ask/demo-nov-10");
    expect(askLink("https://whysosuresh.com", "stigmer")).toBe("https://whysosuresh.com/ask/stigmer");
    expect(ASK_PATH.exec("/ask/demo-nov-10")?.[1]).toBe("demo-nov-10");
    for (const path of ["/ask/", "/ask/Demo", "/ask/-x", "/ask/x-", "/ask/a/b", "/asks", `/ask/${"a".repeat(41)}`]) expect([path, ASK_PATH.test(path)]).toEqual([path, false]);
  });
});

describe("an ask's row", () => {
  it("says who can answer, or how many did and when the last did", () => {
    expect(countLine({ state: "draft", answered: 0 }, null)).toBe("Nobody can answer yet");
    expect(countLine({ state: "open", answered: 0 }, null)).toBe("Nobody has answered yet");
    expect(countLine({ state: "open", answered: 4 }, "2 h")).toBe("4 answered · last 2 h ago");
    expect(countLine({ state: "closed", answered: 200 }, "3 d")).toBe("200 answered · last 3 d ago");
    expect(countLine({ state: "open", answered: 1 }, "now")).toBe("1 answered · last just now");
    expect([agoWords("now"), agoWords("5 min")]).toEqual(["just now", "5 min ago"]);
    expect([stateWords("draft"), stateWords("open"), stateWords("closed")]).toEqual(["Draft", "Open", "Closed"]);
  });

  it("names the Send a note topic that opens it, and none for a topic that isn't one", () => {
    expect(topicLine("stigmer")).toBe("on Send a note · Stigmer");
    expect(topicLine(null)).toBeNull();
    expect(topicLine("nope")).toBeNull();
  });

  it("sends a closed ask's Send a note to the picker when no topic opens it", () => {
    expect(talkLinkFor("demo-nov-10")).toBe("/#talk");
  });
});

describe("Answered by", () => {
  const one = (number: number, name: string | null, at: string, waiting: boolean) => ({ number, name, at, waiting });
  const answered = [
    one(41, "Ravi", "2026-11-10T09:00:00.000Z", false),
    one(42, "Priya", "2026-11-10T10:00:00.000Z", true),
    one(43, null, "2026-11-10T11:00:00.000Z", false),
    one(44, "Ravi S.", "2026-11-10T08:00:00.000Z", true),
  ];

  it("puts the new answers first, then the newest", () => {
    expect(answerersShown(answered, "").map((a) => a.number)).toEqual([42, 44, 43, 41]);
  });

  it("finds a name, any case, or a number", () => {
    expect(answerersShown(answered, "ravi").map((a) => a.number)).toEqual([44, 41]);
    expect(answerersShown(answered, "#43").map((a) => a.number)).toEqual([43]);
    expect(answerersShown(answered, "someone").map((a) => a.number)).toEqual([43]);
    expect(answerersShown(answered, "zed")).toEqual([]);
  });

  it("counts the people and the new ones", () => {
    expect(answeredHead(answered)).toBe("4 people · 2 new");
    expect(answeredHead([one(1, "A", "2026-11-10T08:00:00.000Z", false)])).toBe("1 person");
    expect(answeredHead([])).toBe("nobody yet");
    expect(answererName({ name: "  " })).toBe("Someone");
  });
});

describe("Today's folded row", () => {
  it("names the first two who gave a name and counts the others", () => {
    expect(foldedWho([{ name: "Ravi" }, { name: "Priya" }, { name: null }, { name: "Mei" }])).toBe("Ravi, Priya and 2 others");
    expect(foldedWho([{ name: "Ravi" }, { name: "Priya" }])).toBe("Ravi and Priya");
    expect(foldedWho([{ name: "Ravi" }, { name: null }])).toBe("Ravi and 1 other");
    expect(foldedWho([{ name: null }, { name: " " }])).toBe("2 people");
    expect(foldedTitle("Tuesday demo", 3)).toBe("Tuesday demo · 3 new answers");
    expect([markedWords(1), markedWords(9)]).toEqual(["Marked 1 answer read", "Marked 9 answers read"]);
  });
});

describe("a visitor's lines and the history's", () => {
  it("says both fields are optional, and says so when the browser keeps nothing", () => {
    expect(visitorHint(true)).toBe("Both optional. Suresh reads every answer, and writes back if you leave your email.");
    expect(visitorHint(false)).toContain("This browser won't keep your answers");
    expect(savedLine(true)).toBe("Come back on this browser to change it.");
  });

  it("words every ask event, and no other", () => {
    expect(askEventWords("ask-drafted", "demo")).toBe("made this an ask, a draft at /ask/demo");
    expect(askEventWords("ask-opened", "demo")).toBe("opened the ask at /ask/demo to anyone with the link");
    expect(askEventWords("ask-closed", "demo")).toBe("closed the ask");
    expect(askEventWords("ask-read", null)).toBe("marked the answers read");
    expect(askEventWords("moved", null)).toBeNull();
  });
});
