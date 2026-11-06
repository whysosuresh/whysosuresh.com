// The owner's Share sheet's words and checks (site/app/share.js). What it holds: an invitation needs an address
// and a one-line name, never his own address and never someone already in the thread; the sheet's lines count
// comments and seats in plain words; and the invitation he sends from his own Gmail names the thread and carries its
// `?invite` link, with no one else's address in it. The Public switch: a thread is Public, Invited or Private; only his
// own threads may be public, and the switch says why not for a site note or a told thread; and a reply to a
// visitor's note on a public thread is a draft to them alone, about that thread, quoting their words.

import { describe, expect, it } from "vitest";
import { SEATS, addressOf, invitation, invitationProblem, isAddress, levelOf, listed, noteReply, publicLines, seatsLine, seesLines } from "../site/app/share.js";

describe("an invitation's check", () => {
  it("takes an address the Worker takes, for an invitation and a person's page alike", () => {
    expect(isAddress(" Meera@Example.com. ")).toBe(true);
    for (const typed of ["", "meera", "meera@example", "meera@example..com", "a@b.c, d@e.f"]) expect([typed, isAddress(typed)]).toEqual([typed, false]);
  });

  it("passes an address and a name, and a dictated address's closing full stop", () => {
    expect(invitationProblem(" Meera@Example.com ", "Meera", "owner@example.com", [])).toBeNull();
    expect(invitationProblem("meera@example.com.", "Meera", "owner@example.com", [])).toBeNull();
    expect(addressOf(" Meera@Example.com. ")).toBe("meera@example.com");
  });

  it.each([
    ["no address", "", "Meera", "That isn't an email address."],
    ["two addresses", "meera@example.com, dev@example.org", "Meera", "That isn't an email address."],
    ["an empty part in its domain", "meera@example..com", "Meera", "That isn't an email address."],
    ["a domain that starts with a dot", "meera@.example.com", "Meera", "That isn't an email address."],
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

describe("the Public switch", () => {
  it("names the level: Public when public, else Invited with people, else Private", () => {
    expect([levelOf("2026-11-05T00:00:00.000Z", 0), levelOf("2026-11-05T00:00:00.000Z", 2), levelOf(null, 2), levelOf(null, 0)]).toEqual(["Public", "Public", "Invited", "Private"]);
  });

  it("says anyone can read it at the thread's address, and what stays his", () => {
    const on = publicLines(57, "self", true);
    expect(on).toMatchObject({ label: "Public: anyone can read it at whysosuresh.com/threads/57", allowed: true });
    expect(on.note).toContain("Search engines are told not to list it.");
    expect(on.note).toContain("Only me notes");
    expect(publicLines(57, "self", false).note).toBe("Off: only you and the people above read it.");
  });

  it.each([
    ["a site note", "talk", "A note someone sent from the site"],
    ["a told thread", "told", "Something someone told you"],
  ])("is off for %s, and says why", (_, source, start) => {
    const said = publicLines(64, source, false);
    expect(said.allowed).toBe(false);
    expect(said.note.startsWith(start)).toBe(true);
    expect(said.note).toContain("the words are theirs");
  });
});

describe("a reply to a visitor's note", () => {
  it("is to them alone, about the thread, quoting their words", () => {
    const draft = noteReply({ number: 57, title: "Shipping 0.1.0" }, { name: "Tomás García", email: "tomas@example.com", body: "Loved it.\nWhen is Windows?" });
    expect(draft).toEqual({
      to: "tomas@example.com",
      subject: "Your note on #57 Shipping 0.1.0",
      body: "Hi Tomás,\n\nThanks for your note on Shipping 0.1.0:\n\n> Loved it.\n> When is Windows?\n\n[your answer]\n\nSuresh",
    });
  });

  it("greets someone who gave no name, and quotes at most 400 characters", () => {
    const draft = noteReply({ number: 57, title: "T" }, { name: null, email: "a@example.com", body: "x".repeat(500) });
    expect(draft.body.startsWith("Hi there,")).toBe(true);
    expect(draft.body).toContain(`> ${"x".repeat(400)}…`);
  });
});
