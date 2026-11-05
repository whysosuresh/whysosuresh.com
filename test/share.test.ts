// The owner's Share sheet's words and checks (site/app/share.js). What it holds: an invitation needs an address
// and a one-line name, never his own address and never someone already in the thread; the sheet's lines count
// comments and seats in plain words; and the invitation he sends from his own Gmail names the thread and carries its
// `?invite` link, with no one else's address in it.

import { describe, expect, it } from "vitest";
import { SEATS, invitation, invitationProblem, listed, seatsLine, seesLines } from "../site/app/share.js";

describe("an invitation's check", () => {
  it("passes an address and a name", () => {
    expect(invitationProblem(" Meera@Example.com ", "Meera", "owner@example.com", [])).toBeNull();
  });

  it.each([
    ["no address", "", "Meera", "That isn't an email address."],
    ["two addresses", "meera@example.com, dev@example.org", "Meera", "That isn't an email address."],
    ["his own address in any case", "OWNER@example.com", "Me", "That's your own address. You're in every thread."],
    ["no name", "meera@example.com", "  ", "Add their name. People in a thread see each other by name, never by address."],
    ["a name on two lines", "meera@example.com", "Meera\nK.", "Keep the name to one short line."],
    ["a name past 80", "meera@example.com", "M".repeat(81), "Keep the name to one short line."],
  ])("refuses %s", (_, email, name, said) => {
    expect(invitationProblem(email, name, "owner@example.com", [])).toBe(said);
  });

  it("refuses someone already in the thread", () => {
    expect(invitationProblem("meera@example.com", "Meera", "owner@example.com", [{ email: "meera@example.com" }])).toBe("Meera is already in this thread.");
  });
});

describe("the sheet's lines", () => {
  it("count comments and Only me notes in words", () => {
    expect(seesLines(0, 0)).toEqual({
      sees: "the summary, the text and no comments yet, the history without earlier versions, and everyone in the thread by name.",
      never: "your Only me notes, a visitor's email, or your other threads.",
    });
    expect(seesLines(1, 2).sees).toContain("and 1 comment,");
    expect(seesLines(3, 2).never).toContain("(2 here)");
  });

  it("say how many people have access, against the free plan's seats", () => {
    expect(seatsLine(1)).toBe(`An invite opens this thread only. 1 person has access to your threads; Cloudflare signs in ${SEATS} free.`);
    expect(seatsLine(12)).toContain("12 people have access");
  });

  it("join names as a sentence", () => {
    expect([listed([]), listed(["Meera"]), listed(["Meera", "Dev"]), listed(["Meera", "Dev", "Asha"])]).toEqual(["", "Meera", "Meera and Dev", "Meera, Dev and Asha"]);
  });
});

describe("the invitation", () => {
  it("names the thread and carries its ?invite link, to the person alone", () => {
    const draft = invitation({ number: 42, title: "Who owns what", path: "/threads/42-who-owns-what" }, { name: "Meera K.", email: "meera@example.com" }, "https://whysosuresh.com");
    expect(draft.to).toBe("meera@example.com");
    expect(draft.subject).toBe("#42 Who owns what");
    expect(draft.body).toContain("Hi Meera,");
    expect(draft.body).toContain("https://whysosuresh.com/threads/42-who-owns-what?invite");
    expect(draft.body.match(/@/g)).toBeNull();
  });
});
