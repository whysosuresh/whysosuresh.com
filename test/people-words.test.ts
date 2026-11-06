// What people's pages say (site/app/people.js). What it holds: a person is called by their name, else the address
// they typed, else their number, with up to two initials; their page's address is their number then their name in
// lower case, as a thread's is, and the page's patterns read it back; the line under a name says how he knows them in
// plain counts (the meetings they are in among them), and a thread's line how they are in it (in its meeting too); an address they typed with no invitation behind it says so;
// Everyone keeps its order and folds away those only in dropped threads; and an address another person holds says
// whose it is; and their answers to one of his asks say they answered it.

import { describe, expect, it } from "vitest";
import { PEOPLE_PATH, PERSON_PATH, addressLine, folded, howLine, initials, nameOf, personPath, roleLine, saidOn, takenLine } from "../site/app/people.js";

const NONE = { sent: 0, told: 0, invited: 0, removed: 0, commented: 0, noted: 0 };

describe("a person's name and address", () => {
  it("is their name, else the address they typed, else their number", () => {
    expect(nameOf({ number: 7, name: "  Meera K. ", email: "meera@example.com" })).toBe("Meera K.");
    expect(nameOf({ number: 8, name: null, email: "lin@example.net" })).toBe("lin@example.net");
    expect(nameOf({ number: 9, name: " ", email: null })).toBe("Person #9");
  });

  it.each([
    ["Meera K.", "MK"],
    ["Dev K.", "DK"],
    ["tomás", "T"],
    ["lin@example.net", "L"],
    ["మీరా", "మ"],
    ["!!", "?"],
  ])("gives %s the initials %s", (name, letters) => {
    expect(initials(name)).toBe(letters);
  });

  it("is a page at their number and name, which the page's patterns read back", () => {
    expect(personPath({ number: 7, name: "Meera K.", email: null })).toBe("/people/7-meera-k");
    expect(personPath({ number: 8, name: null, email: "Lin.Wu@example.net" })).toBe("/people/8-lin-wu");
    expect(personPath({ number: 9, name: "మీరా", email: null })).toBe("/people/9");
    expect(personPath({ number: 5, name: "Tomás Núñez", email: null })).toBe("/people/5-tomas-nunez");
    expect(PERSON_PATH.exec("/people/7-meera-k")?.[1]).toBe("7");
    expect(PERSON_PATH.exec("/people/9")?.[1]).toBe("9");
    expect(PEOPLE_PATH.test("/people")).toBe(true);
    // The addresses from before the rooms redirect at the Worker, so the page never reads them.
    for (const path of ["/people/", "/people/07", "/people/7/x", "/peoples", "/threads/people", "/threads/people/7", "/threads/7"]) expect([path, PERSON_PATH.test(path) || PEOPLE_PATH.test(path)]).toEqual([path, false]);
  });
});

describe("how he knows them", () => {
  it("counts each way in plain words, one or many, in a fixed order", () => {
    expect(howLine({ ...NONE, sent: 2, invited: 1 })).toBe("2 notes from the site · in 1 thread you shared");
    expect(howLine({ ...NONE, told: 1 })).toBe("Told you 1 thing");
    expect(howLine({ ...NONE, told: 3, commented: 1, noted: 2 })).toBe("Told you 3 things · 1 comment · 2 notes on public threads");
    expect(howLine({ ...NONE, removed: 1, noted: 1 })).toBe("Invitation taken back on 1 thread · 1 note on a public thread");
    expect(howLine(NONE)).toBe("Nothing from them yet");
    expect(howLine({ ...NONE, invited: 1, met: 1 })).toBe("In 1 thread you shared · in 1 meeting");
    expect(howLine({ ...NONE, met: 3 })).toBe("In 3 meetings");
  });

  it("says how they are in a thread", () => {
    expect(roleLine(["sent", "invited"])).toBe("Sent this from the site · invited");
    expect(roleLine(["told"])).toBe("Told you this");
    expect(roleLine(["removed", "wrote"])).toBe("Invitation taken back · wrote here");
    expect(roleLine([])).toBe("");
    expect(roleLine(["invited", "met"])).toBe("Invited · in the meeting");
    expect(roleLine(["met"])).toBe("In the meeting");
  });

  it("marks an address they typed themselves when no invitation stands behind it", () => {
    const known = { number: 5, name: "Tomás", dropped: false };
    expect(addressLine({ ...known, email: "tomas@example.com", invited: false, counts: { ...NONE, noted: 1 } })).toBe("tomas@example.com · typed on the site");
    expect(addressLine({ ...known, email: "tomas@example.com", invited: true, counts: { ...NONE, sent: 1 } })).toBe("tomas@example.com");
    expect(addressLine({ ...known, email: "dev@example.org", invited: false, counts: { ...NONE, told: 2 } })).toBe("dev@example.org");
    expect(addressLine({ ...known, email: null, invited: false, counts: { ...NONE, told: 1 } })).toBe("No address yet");
  });
});

describe("Everyone", () => {
  it("keeps its order and folds away those only ever in dropped threads", () => {
    const people = [
      { number: 5, dropped: false },
      { number: 4, dropped: true },
      { number: 2, dropped: false },
    ];
    expect(folded(people)).toEqual({ live: [people[0], people[2]], dropped: [people[1]] });
  });

  it("says whose an address is when another person holds it", () => {
    expect(takenLine("asha@example.com", { number: 3, name: "Asha", email: "asha@example.com" })).toBe("asha@example.com is Asha's (#3). One address belongs to one person.");
    expect(takenLine("x@example.com", null)).toBe("x@example.com already belongs to someone. One address belongs to one person.");
  });
});

describe("what a person said, by the thread it is on", () => {
  it("is an answer to one of his asks, or words on a thread", () => {
    expect([saidOn("answer"), saidOn("note"), saidOn("comment"), saidOn("public-note")]).toEqual(["answered ", "on ", "on ", "on "]);
  });
});
