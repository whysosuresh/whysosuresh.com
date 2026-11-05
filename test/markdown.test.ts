// The threads' Markdown reader (site/app/markdown.js), which turns what the recorder sync and Suresh write into
// blocks and inline runs the pages build with DOM calls. What it holds: each block it knows, a table kept as
// typed, a moved issue's shape (a body, a rule, a comment's byline), inline code, bold, italic, http(s) links and
// a thread's number, a living summary read as labelled lines only when every line is one, and that anything else
// (HTML, a script link, a stray star, a number glued to a word) stays plain text, never markup.

import { describe, expect, it } from "vitest";
import { inline, parse, summaryLines } from "../site/app/markdown.js";

describe("blocks", () => {
  it("reads headings, paragraphs with their line breaks, quotes, rules and fenced code", () => {
    expect(parse("## What changes\n\nOne line\nand the next.\n\n> said once\n> said twice\n\n---\n\n```\nnpm ci\n**not bold**\n```")).toEqual([
      { type: "h", inline: [{ type: "text", text: "What changes" }] },
      { type: "p", inline: [{ type: "text", text: "One line\nand the next." }] },
      { type: "quote", inline: [{ type: "text", text: "said once\nsaid twice" }] },
      { type: "rule" },
      { type: "pre", text: "npm ci\n**not bold**" },
    ]);
  });

  it("reads bullet and numbered lists, task boxes and lines indented under an item", () => {
    expect(parse("- [ ] slides\n- [x] topic\n  approved Monday\n\n1. first\n2. second")).toEqual([
      {
        type: "list",
        ordered: false,
        items: [[{ type: "text", text: "☐ slides" }], [{ type: "text", text: "☑ topic\napproved Monday" }]],
      },
      { type: "list", ordered: true, items: [[{ type: "text", text: "first" }], [{ type: "text", text: "second" }]] },
    ]);
  });

  it("keeps a table as preformatted rows", () => {
    expect(parse("| a | b |\n|---|---|\n| 1 | 2 |")).toEqual([{ type: "pre", text: "| a | b |\n|---|---|\n| 1 | 2 |" }]);
  });

  it("reads a moved issue: its body, then each comment under a rule and a bold byline", () => {
    const blocks = parse("The talk.\n\n---\n\n**someone · 2026-11-01**\n\nTopic approved.");
    expect(blocks.map((block) => block.type)).toEqual(["p", "rule", "p", "p"]);
    expect(blocks[2]).toEqual({ type: "p", inline: [{ type: "strong", text: "someone · 2026-11-01" }] });
  });

  it("starts a list or heading straight after a paragraph line", () => {
    expect(parse("Steps:\n- one\n## Next").map((block) => block.type)).toEqual(["p", "list", "h"]);
  });
});

describe("inline runs", () => {
  it("reads code, bold, italic and links to http(s) addresses", () => {
    expect(inline("Run `npm ci`, **then** *check* [the PR](https://example.com/pull/1).")).toEqual([
      { type: "text", text: "Run " },
      { type: "code", text: "npm ci" },
      { type: "text", text: ", " },
      { type: "strong", text: "then" },
      { type: "text", text: " " },
      { type: "em", text: "check" },
      { type: "text", text: " " },
      { type: "link", text: "the PR", href: "https://example.com/pull/1" },
      { type: "text", text: "." },
    ]);
  });

  it("reads a thread's number at the start, after a space and in brackets", () => {
    expect(inline("#59, see #7 (and #12)")).toEqual([
      { type: "thread", number: 59 },
      { type: "text", text: ", see " },
      { type: "thread", number: 7 },
      { type: "text", text: " (and " },
      { type: "thread", number: 12 },
      { type: "text", text: ")" },
    ]);
  });

  it.each([
    ["HTML", "<img src=x onerror=alert(1)>"],
    ["a script link", "[click](javascript:alert(1))"],
    ["a stray star", "2 * 3 = 6"],
    ["snake_case", "a_b_c"],
    ["a number glued to a word", "issue#12 and #12a and #0 and #1234567890"],
    ["a number inside a link's address", "https://example.com/#42"],
  ])("leaves %s as plain text", (_, text) => {
    expect(inline(text)).toEqual([{ type: "text", text }]);
  });

  it("keeps a number inside code as code", () => {
    expect(inline("`#42`")).toEqual([{ type: "code", text: "#42" }]);
  });
});

describe("a living summary", () => {
  it("is read as labelled lines when every line is one, blank lines aside", () => {
    expect(summaryLines("Decided: a release needs two people.\n\nOpen: who owns **pricing**.\nWaiting on: you.\nNext: see #42.")).toEqual([
      { label: "Decided", inline: [{ type: "text", text: "a release needs two people." }] },
      { label: "Open", inline: [{ type: "text", text: "who owns " }, { type: "strong", text: "pricing" }, { type: "text", text: "." }] },
      { label: "Waiting on", inline: [{ type: "text", text: "you." }] },
      { label: "Next", inline: [{ type: "text", text: "see " }, { type: "thread", number: 42 }, { type: "text", text: "." }] },
    ]);
  });

  it("takes a bold label as GitHub writes it", () => {
    expect(summaryLines("**Decided:** yes")).toEqual([{ label: "Decided", inline: [{ type: "text", text: "yes" }] }]);
  });

  it.each([
    ["a paragraph", "We talked it through and nothing is decided yet."],
    ["one line that isn't labelled", "Decided: yes.\nThe rest is open."],
    ["a lower-case label", "decided: yes"],
    ["a label too long to be one", "This label runs far too long: yes"],
    ["nothing", " \n "],
  ])("is drawn as Markdown for %s", (_, text) => {
    expect(summaryLines(text)).toBeNull();
  });
});
