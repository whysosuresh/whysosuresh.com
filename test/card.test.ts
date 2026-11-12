// A public thread's preview card as his page lays it out (site/app/card.js), run in Node with a counting measure in
// place of a canvas: every glyph is half its font size wide. What it holds: the number sits small above the title and
// his face and the domain at the bottom; a short title is one line at the largest size; a long one wraps within the
// margins in at most three lines, at a smaller size when that fits it whole, else ending in an ellipsis at a word; a
// script with no spaces wraps between its graphemes, never inside one; a thread with no title shows its number large;
// no number is the site's own card, his face large with his name; no line enters the face's row but the domain. The
// stamp is the SHA-256 of what the card shows (the layout's version, the number, the title and his photo), so it
// changes with each of those and with nothing else.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CARD_HEIGHT, CARD_LAYOUT, CARD_NAME, CARD_WIDTH, cardStamp, layoutCard } from "../site/app/card.js";

const STYLE = { family: "system-ui", name: CARD_NAME };
const MARGIN = 80;
/** Where his face's row starts, 88 px above the bottom margin, and the 40 px kept clear above it. */
const FACE_TOP = CARD_HEIGHT - MARGIN - 88;
const TEXT_BOTTOM = FACE_TOP - 40;

/** A font's size in px, from the CSS font string the layout writes. */
function sizeOf(font: string): number {
  return Number(/(\d+)px/.exec(font)?.[1] ?? "0");
}

/** Every grapheme half its font size wide. */
const measure = (text: string, font: string): number => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length * sizeOf(font) * 0.5;

function graphemes(text: string): string[] {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (one) => one.segment);
}

/** The title's lines: every 700-weight line but a bare number. */
function titleLines(card: { number: number | null; title: string | null }) {
  return layoutCard(card, STYLE, measure).lines.filter((line) => line.font.startsWith("700 ") && line.tone === "ink");
}

describe("a thread's card", () => {
  it("puts the number small at the top, the title under it, and his face and the domain at the bottom", () => {
    const layout = layoutCard({ number: 41, title: "Stigmer T-shirts" }, STYLE, measure);
    expect([layout.width, layout.height, CARD_WIDTH, CARD_HEIGHT]).toEqual([1200, 630, 1200, 630]);
    expect(layout.background).toBe("#0a0a0a");
    expect(layout.lines.map((line) => [line.text, line.font, line.tone])).toEqual([
      ["hey.whysosuresh.com", "400 40px system-ui", "muted"],
      ["#41", "500 44px system-ui", "muted"],
      ["Stigmer T-shirts", "700 76px system-ui", "ink"],
    ]);
    expect(layout.face).toMatchObject({ x: MARGIN, y: FACE_TOP, size: 88 });
    expect(layout.face.initial.text).toBe("S");
  });

  it("wraps a long title within the margins in at most three lines, at the largest size that fits it whole", () => {
    // #39's title, 74 characters.
    const title = "Stigmer's launch video: the script, the shots, and the cut for the release";
    expect(title.length).toBe(74);
    const lines = titleLines({ number: 39, title });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) expect(measure(line.text, line.font)).toBeLessThanOrEqual(CARD_WIDTH - 2 * MARGIN);
    expect(lines.map((line) => line.text).join(" ")).toBe(title);
    expect(sizeOf(lines[0]?.font ?? "")).toBe(76);
  });

  it("ends a title too long for three lines with an ellipsis after a whole word, at the smallest size", () => {
    const words = Array.from({ length: 40 }, (_, at) => `word${at}`);
    const lines = titleLines({ number: 12, title: words.join(" ") });
    expect(lines.length).toBe(3);
    expect(lines.every((line) => sizeOf(line.font) === 56)).toBe(true);
    const last = lines[2]?.text ?? "";
    expect(last.endsWith("…")).toBe(true);
    for (const line of lines) expect(measure(line.text, line.font)).toBeLessThanOrEqual(CARD_WIDTH - 2 * MARGIN);
    // Every word shown is whole: what precedes the ellipsis ends where a word of the title ends.
    const shown = lines.map((line) => line.text).join(" ").slice(0, -1).split(" ");
    expect(shown).toEqual(words.slice(0, shown.length));
  });

  it("wraps Telugu between graphemes, never inside one, and a title with no spaces the same way", () => {
    const telugu = "స్టిగ్మర్‌తోకలిసిపనిచేసేవారికోసంఒకచిన్నపరిచయంమరియుమొదటిఅడుగులు";
    for (const title of [telugu, "x".repeat(60)]) {
      const lines = titleLines({ number: 5, title });
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.length).toBeLessThanOrEqual(3);
      for (const line of lines) expect(measure(line.text, line.font)).toBeLessThanOrEqual(CARD_WIDTH - 2 * MARGIN);
      const drawn = lines.flatMap((line) => graphemes(line.text.replace(/…$/, "")));
      expect(drawn).toEqual(graphemes(title).slice(0, drawn.length));
    }
  });

  it("shows the number alone, large, when the thread has no title", () => {
    for (const title of [null, "", "   "]) {
      const layout = layoutCard({ number: 7, title }, STYLE, measure);
      expect(layout.lines.map((line) => [line.text, line.font])).toEqual([
        ["hey.whysosuresh.com", "400 40px system-ui"],
        ["#7", "700 160px system-ui"],
      ]);
    }
  });

  it("keeps every line but the domain out of his face's row", () => {
    for (const title of ["Short", "word ".repeat(60), "x".repeat(200), null]) {
      const layout = layoutCard({ number: 999999, title }, STYLE, measure);
      for (const line of layout.lines.filter((one) => one.text !== "hey.whysosuresh.com")) expect([line.text, line.y <= TEXT_BOTTOM]).toEqual([line.text, true]);
      const domain = layout.lines.find((one) => one.text === "hey.whysosuresh.com");
      expect(domain && domain.y > FACE_TOP && domain.y < FACE_TOP + 88).toBe(true);
    }
  });
});

describe("the site's card", () => {
  it("is his face large with his name and the domain, and no number", () => {
    const layout = layoutCard({ number: null, title: null }, STYLE, measure);
    expect(layout.lines.map((line) => [line.text, line.font])).toEqual([
      ["Suresh Attaluri", "700 76px system-ui"],
      ["hey.whysosuresh.com", "400 40px system-ui"],
    ]);
    expect(layout.face).toMatchObject({ x: MARGIN, y: (CARD_HEIGHT - 200) / 2, size: 200 });
  });
});

describe("a card's stamp", () => {
  it("is the SHA-256 of the layout's version, the number, the title and his photo, as 64 lowercase hex", async () => {
    const stamp = await cardStamp({ number: 41, title: "Stigmer T-shirts" }, "photo-1");
    expect(stamp).toMatch(/^[0-9a-f]{64}$/);
    expect(stamp).toBe(createHash("sha256").update(JSON.stringify([CARD_LAYOUT, 41, "Stigmer T-shirts", "photo-1"])).digest("hex"));
  });

  it("changes with the title, the number and his photo, and with nothing else", async () => {
    const base = await cardStamp({ number: 41, title: "Stigmer T-shirts" }, "photo-1");
    expect(await cardStamp({ number: 41, title: "Stigmer T-shirts" }, "photo-1")).toBe(base);
    const others = [
      await cardStamp({ number: 41, title: "Stigmer T-shirts, black" }, "photo-1"),
      await cardStamp({ number: 42, title: "Stigmer T-shirts" }, "photo-1"),
      await cardStamp({ number: 41, title: "Stigmer T-shirts" }, "photo-2"),
      await cardStamp({ number: 41, title: "Stigmer T-shirts" }, null),
      await cardStamp({ number: 41, title: null }, "photo-1"),
    ];
    expect(new Set([base, ...others]).size).toBe(others.length + 1);
    // What the card doesn't show (the summary the sync rewrites most) never makes it stale.
    const withSummary = { number: 41, title: "Stigmer T-shirts", summary: "Decided: black." };
    expect(await cardStamp(withSummary, "photo-1")).toBe(base);
  });
});
