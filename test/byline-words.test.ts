// How a writer is named on the threads page (site/app/byline.js): what the recorder sync writes reads as Suresh's own,
// "You" on his own page and "Suresh" to a person he invited, with a quiet "via Claude" beside it, and the words of his
// photo sheet. What it holds: the owner and the sync are one writer by name, only the sync's words say via Claude, the
// line under a thread he said aloud credits Claude with writing it down, and each refusal of a photo is said plainly.

import { describe, expect, it } from "vitest";
import { VIA, photoProblem, startedLine, viaClaude, writerName } from "../site/app/byline.js";

describe("who wrote it", () => {
  it("names the sync's words as his own: You on his page, Suresh to a person he invited", () => {
    expect([writerName("owner", false), writerName("sync", false)]).toEqual(["You", "You"]);
    expect([writerName("owner", true), writerName("sync", true)]).toEqual(["Suresh", "Suresh"]);
  });

  it("names nobody else, so a person's or a visitor's own name stands", () => {
    expect([writerName("member", false), writerName("visitor", true), writerName("import", false)]).toEqual([null, null, null]);
  });

  it("says via Claude beside the sync's words alone", () => {
    expect(VIA).toBe("via Claude");
    expect([viaClaude("sync"), viaClaude("owner"), viaClaude("member"), viaClaude("visitor")]).toEqual([true, false, false, false]);
  });

  it("credits Claude with writing down what he said, and him with what he started", () => {
    expect(startedLine("owner", false)).toBe("You started this");
    expect(startedLine("owner", true)).toBe("Suresh started this");
    expect(startedLine("sync", false)).toBe("You said this; Claude wrote it down");
    expect(startedLine("sync", true)).toBe("Suresh said this; Claude wrote it down");
    expect(startedLine(undefined, false)).toBe("You said this; Claude wrote it down");
  });
});

describe("his photo's refusals", () => {
  it("says each plainly, and anything else as a try again", () => {
    expect(photoProblem("type")).toBe("That isn't a JPEG or PNG.");
    expect(photoProblem("too-large")).toBe("That photo is over 4 MB.");
    expect(photoProblem("network")).toBe("Your photo didn't save. Try again.");
  });
});
