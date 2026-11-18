// The owner's Share sheet's words and checks (site/app/share.js). What it holds: an invitation needs an address
// and a one-line name, never his own address and never someone already in the thread; the sheet's lines count
// comments and seats in plain words; and the invitation he sends from his own Gmail names the thread and carries its
// `?invite` link, with no one else's address in it. The Public switch: a thread is Public, Invited or Private; only his
// own threads may be public, and the switch says why not for a site note or a told thread; on, it shows the link by
// its key once the thread has one and says its number opens it only for him and the people above, or, for a thread
// public before links had keys, that its number still opens it for anyone until Public goes off; off, it says a link
// it had comes back the same; a copied link's toast cuts the key to fit; and a reply to a
// visitor's note on a public thread is a draft to them alone, about that thread, quoting their words. The home page
// switch: only a public thread can be listed, and it says what everyone sees once it is.

import { describe, expect, it } from "vitest";
import { SEATS, addressOf, collectionInvitation, collectionPublicLines, collectionSeatsLine, collectionSeesLines, feedLines, invitation, invitationProblem, isAddress, levelOf, linkShown, listed, noteReply, publicLines, seatsLine, seesLines } from "../site/app/share.js";

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
    const draft = invitation({ number: 42, title: "Who owns what", path: "/threads/42-who-owns-what" }, { name: "Meera K.", email: "meera@example.com" }, "https://hey.whysosuresh.com");
    expect(draft.to).toBe("meera@example.com");
    expect(draft.subject).toBe("#42 Who owns what");
    expect(draft.body).toContain("Hi Meera,");
    expect(draft.body).toContain("https://hey.whysosuresh.com/threads/42-who-owns-what?invite");
    expect(draft.body.match(/@/g)).toBeNull();
  });
});

describe("the Public switch", () => {
  it("names the level: Public when public, else Invited with people, else Private", () => {
    expect([levelOf("2026-11-05T00:00:00.000Z", 0), levelOf("2026-11-05T00:00:00.000Z", 2), levelOf(null, 2), levelOf(null, 0)]).toEqual(["Public", "Public", "Invited", "Private"]);
  });

  const ORIGIN = "https://hey.whysosuresh.com";
  const KEY = "3f9a07c2e1b84d6a9c5f20e7b13dc41e";

  it("says anyone with its link can read it, shows the link by its key, and what stays his", () => {
    const on = publicLines(ORIGIN, { number: 57, source: "self", shareKey: KEY, publicByNumber: false }, true);
    expect(on).toMatchObject({ label: "Public: anyone with its link can read it", link: `hey.whysosuresh.com/threads/${KEY}`, allowed: true });
    expect(on.note).toContain("Anyone with the link reads");
    expect(on.note).toContain("Its number, #57, opens it only for you and the people above.");
    expect(on.note).toContain("Search engines are told not to list it.");
    expect(on.note).toContain("Only me notes");
    expect(on.note).not.toContain("tries the number");
  });

  it("says a page thread's link opens on the page, full screen, and says nothing of it for a text thread", () => {
    const page = publicLines(ORIGIN, { number: 41, source: "self", shareKey: KEY, main: "page" }, true);
    expect(page.note).toContain("The link opens on the page, full screen; the thread is one click away.");
    const text = publicLines(ORIGIN, { number: 57, source: "self", shareKey: KEY, main: "text" }, true);
    expect(text.note).not.toContain("full screen");
    expect(publicLines(ORIGIN, { number: 41, source: "self", shareKey: KEY, main: "page" }, false).note).not.toContain("full screen");
  });

  it("shows no link until the Worker has given the key, on a first publish", () => {
    expect(publicLines(ORIGIN, { number: 57, source: "self", shareKey: null }, true).link).toBeNull();
  });

  it("says an old thread's number still opens it for anyone, until Public goes off", () => {
    const on = publicLines(ORIGIN, { number: 41, source: "self", shareKey: KEY, publicByNumber: true }, true);
    expect(on.note).toContain("It was public before links had keys, so its number, #41, still opens it for anyone. Turn Public off and on again to make the link the only way in.");
    expect(on.note).not.toContain("opens it only for you");
  });

  it("says off, and that a link it had comes back the same", () => {
    expect(publicLines(ORIGIN, { number: 57, source: "self" }, false)).toMatchObject({ note: "Off: only you and the people above read it.", link: null });
    expect(publicLines(ORIGIN, { number: 57, source: "self", shareKey: KEY }, false)).toMatchObject({
      note: "Off: only you and the people above read it. Turn it on again and its link works again, the same link.",
      link: null,
    });
  });

  it("cuts a key in a copied link's toast to its first and last four, and leaves a number's alone", () => {
    expect(linkShown(ORIGIN, `/threads/${KEY}`)).toBe("hey.whysosuresh.com/threads/3f9a…c41e");
    expect(linkShown(ORIGIN, `/threads/${KEY}?full`)).toBe("hey.whysosuresh.com/threads/3f9a…c41e?full");
    expect(linkShown(ORIGIN, "/threads/57-a-title")).toBe("hey.whysosuresh.com/threads/57-a-title");
  });

  it.each([
    ["a site note", "talk", "A note someone sent from the site"],
    ["a told thread", "told", "Something someone told you"],
  ])("is off for %s, and says why", (_, source, start) => {
    const said = publicLines("https://hey.whysosuresh.com", { number: 64, source, shareKey: null }, false);
    expect(said.allowed).toBe(false);
    expect(said.note.startsWith(start)).toBe(true);
    expect(said.note).toContain("the words are theirs");
  });
});

describe("the home page switch", () => {
  it("is off until the thread is public, and says so", () => {
    const said = feedLines(false, false);
    expect(said).toMatchObject({ label: "On the home page: listed under What's happening at whysosuresh.com", allowed: false });
    expect(said.note).toBe("Make it public first: only a public thread can be on the home page.");
  });

  it("says what everyone sees once it is on, and that a public thread off it is listed nowhere", () => {
    const on = feedLines(true, true);
    expect(on.allowed).toBe(true);
    expect(on.note).toContain("Everyone who opens whysosuresh.com sees its title");
    expect(on.note).toContain("Turning Public off takes it off the home page too.");
    expect(feedLines(true, false).note).toBe("Off: anyone with the link reads it, and it is listed nowhere.");
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

describe("sharing a collection", () => {
  it("says an invite opens every thread in it, as it changes, and never who else it is shared with", () => {
    expect(collectionSeesLines(6).sees).toBe("every thread in it (6 threads now) and every one you add later, each as an invited person reads a thread, and can comment on each.");
    expect(collectionSeesLines(1).sees).toContain("(1 thread now)");
    expect(collectionSeesLines(0).sees).toContain("(no threads yet)");
    expect(collectionSeesLines(6).never).toContain("who else it is shared with");
    expect(collectionSeatsLine(1)).toBe(`An invite opens every thread in this collection, now and as it changes. 1 person has access to your threads; Cloudflare signs in ${SEATS} free.`);
  });

  it("drafts the invitation with the collection's own link and ?invite", () => {
    const draft = collectionInvitation({ name: "Every screen", path: "/collections/1-every-screen" }, { name: "Meera K.", email: "meera@example.com" }, "https://hey.whysosuresh.com");
    expect([draft.to, draft.subject]).toEqual(["meera@example.com", "Every screen"]);
    expect(draft.body).toContain("Hi Meera,");
    expect(draft.body).toContain("https://hey.whysosuresh.com/collections/1-every-screen?invite");
    expect(draft.body).toContain("the ones I add later too");
  });
});

describe("a collection's Public switch", () => {
  it("says how many threads strangers read and how many they won't, and gives the link only while on", () => {
    const on = collectionPublicLines("https://hey.whysosuresh.com", { threads: 6, hidden: 2, shareKey: "a".repeat(32) }, true);
    expect(on.note).toBe("Anyone with the link reads 4 threads of your own words in it, and the ones you add later, read only. 2 threads they won't see: someone else's words or an ask.");
    expect(on.link).toBe(`https://hey.whysosuresh.com/collections/${"a".repeat(32)}`);
    const off = collectionPublicLines("https://hey.whysosuresh.com", { threads: 1, hidden: 0, shareKey: "a".repeat(32) }, false);
    expect([off.link, off.note.startsWith("Off:")]).toEqual([null, true]);
    expect(collectionPublicLines("https://x", { threads: 1, hidden: 0 }, true).note).toContain("reads 1 thread of");
  });
});
