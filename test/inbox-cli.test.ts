// The inbox's command line (tools/inbox/), driven through its logic with a played fetch: each verb's request to
// the threads' calls, by the thread's number, with the service token's two Access headers and the client id
// wrangler.jsonc names; everyone, and one person by their number, read through the people calls; a told thread's
// person passed through an add; a thread shown with each comment's place passed through whole; a list followed through every page; an add answered line by line; a comment (for everyone
// in the thread, or with --only-me for the owner alone) and an edit taking their words from stdin as they are; a page sent from a file as HTML, refused here past 16 MiB; a link set
// and cleared; a meeting set by a day or a moment and cleared, and its people changed one call per flag, stopping at
// the first refusal; every ask listed, a draft made from a thread under a slug, and an ask closed, with no verb that
// opens one; the journal read, written on the version it was built on (a stale save printing the newest version and
// exiting non-zero), a photo uploaded by its file's type and read back to a file byte for byte, a day's answers and the
// storylines; the Worker's refusals and the edge's passed through with a
// non-zero exit; usage errors; and the secret in no line it prints. One run of the real entry point as a child
// process proves Node runs the TypeScript as it is.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_PAGE_BYTES, MAX_PHOTO_BYTES, ORIGIN, SECRET_VARIABLE, USAGE, readClientId, run, type Io } from "../tools/inbox/run.ts";
import { INBOX_SYNC_CLIENT_ID } from "./harness.ts";

const SECRET = "played-secret-0123456789abcdef";

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  /** A body sent as bytes, such as a page. */
  bytes: Uint8Array | null;
  redirect: string | undefined;
}

type Reply = { status: number; body?: unknown; type?: string; text?: string };

/** A client whose fetch answers each request in turn with the replies given, and records what was sent. */
function client(replies: Reply[], options: { env?: Record<string, string>; stdin?: string; files?: Record<string, Uint8Array> } = {}) {
  const sent: Sent[] = [];
  const written: Record<string, Uint8Array> = {};
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    fetch: async (url, init) => {
      sent.push({
        url,
        method: init.method ?? "GET",
        headers: { ...(init.headers as Record<string, string>) },
        body: typeof init.body === "string" ? init.body : null,
        bytes: init.body instanceof Uint8Array ? init.body : null,
        redirect: init.redirect,
      });
      const reply = replies.shift() ?? { status: 599, text: "no reply played" };
      const text = reply.text ?? JSON.stringify(reply.body ?? {});
      return new Response(reply.status === 302 ? null : text, {
        status: reply.status,
        headers: { "Content-Type": reply.type ?? (reply.text === undefined ? "application/json; charset=utf-8" : "text/html") },
      });
    },
    env: options.env ?? { [SECRET_VARIABLE]: SECRET },
    stdin: async () => options.stdin ?? "",
    readFile: (path) => {
      const file = options.files?.[path];
      if (file === undefined) throw new Error("no such file");
      return file;
    },
    writeFile: (path, bytes) => {
      if (path.startsWith("/nowhere/")) throw new Error("can't write");
      written[path] = bytes;
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    clientId: INBOX_SYNC_CLIENT_ID,
  };
  return { io, sent, out, err, written };
}

const THREAD = { number: 42, id: "00000000-0000-4000-8000-000000000001", status: "discuss" };
const THREADS = `${ORIGIN}/threads/api/threads`;

describe("the client id", () => {
  it("is the one wrangler.jsonc names, which the Worker admits", () => {
    expect(readClientId(new URL("../wrangler.jsonc", import.meta.url))).toBe(INBOX_SYNC_CLIENT_ID);
  });
});

describe("list", () => {
  it("follows every page of a tab and prints one line per thread, sending both Access headers and following no redirect", async () => {
    const { io, sent, out } = client([
      { status: 200, body: { threads: [THREAD, { number: 41 }], counts: {}, next: 41 } },
      { status: 200, body: { threads: [{ number: 3 }], counts: {}, next: null } },
    ]);
    expect(await run(["list", "discuss"], io)).toBe(0);
    expect(sent.map((one) => one.url)).toEqual([`${THREADS}?tab=discuss`, `${THREADS}?tab=discuss&before=41`]);
    for (const one of sent) {
      expect(one.method).toBe("GET");
      expect(one.headers).toEqual({ "CF-Access-Client-Id": INBOX_SYNC_CLIENT_ID, "CF-Access-Client-Secret": SECRET });
      expect(one.redirect).toBe("manual");
    }
    expect(out.map((line) => JSON.parse(line))).toEqual([THREAD, { number: 41 }, { number: 3 }]);
  });

  it("passes each row's public time and whether it waits on him through whole", async () => {
    const row = { ...THREAD, publicAt: "2026-11-05T09:00:00.000Z", shared: 0, waiting: true };
    const { io, out } = client([{ status: 200, body: { threads: [row], counts: {}, next: null } }]);
    expect(await run(["list", "act"], io)).toBe(0);
    expect(out.map((line) => JSON.parse(line))).toEqual([row]);
  });

  it.each([
    ["the Worker's refusal", { status: 403, body: { reason: "caller" } }, "403 caller"],
    ["the edge's sign-in redirect, for no token", { status: 302 }, "302 sign-in"],
    ["the edge's 401 page, for a wrong secret", { status: 401, text: "<html>Forbidden</html>" }, "401 token"],
    ["an HTML error page", { status: 502, text: "<html>Bad gateway</html>" }, "502 http-502"],
  ])("passes on %s with exit 1", async (_, reply, said) => {
    const { io, out, err } = client([reply]);
    expect(await run(["list", "look"], io)).toBe(1);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain(said);
  });
});

describe("add", () => {
  it("sends each line of stdin as its own add, and reports each line's result", async () => {
    const lines = [JSON.stringify({ ref: "chat:a", source: "self" }), "", JSON.stringify({ ref: "chat:b", source: "self" }), "{ not json", JSON.stringify({ ref: "chat:c" })];
    const { io, sent, out } = client(
      [
        { status: 201, body: { thread: THREAD } },
        { status: 200, body: { thread: { number: 7 } } },
        { status: 400, body: { reason: "source" } },
      ],
      { stdin: `${lines.join("\n")}\n` },
    );
    expect(await run(["add"], io)).toBe(1);
    expect(sent.map((one) => [one.method, one.url, one.body, one.headers["Content-Type"]])).toEqual([
      ["POST", THREADS, lines[0], "application/json"],
      ["POST", THREADS, lines[2], "application/json"],
      ["POST", THREADS, lines[4], "application/json"],
    ]);
    expect(out.map((line) => JSON.parse(line))).toEqual([
      { line: 1, status: 201, thread: THREAD },
      { line: 3, status: 200, thread: { number: 7 } },
      { line: 4, status: 0, reason: "not-json" },
      { line: 5, status: 400, reason: "source" },
    ]);
  });

  it("exits 0 when every line is kept", async () => {
    const { io } = client([{ status: 201, body: { thread: THREAD } }], { stdin: '{"ref":"chat:a"}' });
    expect(await run(["add"], io)).toBe(0);
  });

  it("is a usage error with nothing on stdin", async () => {
    const { io, sent } = client([], { stdin: "\n\n" });
    expect(await run(["add"], io)).toBe(2);
    expect(sent).toEqual([]);
  });
});

describe("move", () => {
  it.each([
    [["act"], { action: "act" }],
    [["drop"], { action: "drop", reason: "" }],
    [["drop", "--reason", "not for now"], { action: "drop", reason: "not for now" }],
    [["space", "--space", "company"], { action: "space", space: "company" }],
    [["file", "--link", "https://github.com/example/notes/issues/1"], { action: "file", link: "https://github.com/example/notes/issues/1" }],
  ])("%j sends %j to the thread's number and prints the thread", async (args, change) => {
    const { io, sent, out } = client([{ status: 200, body: { thread: THREAD } }]);
    expect(await run(["move", "42", ...args], io)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${THREADS}/42`);
    expect(sent[0]?.method).toBe("POST");
    expect(JSON.parse(sent[0]?.body ?? "")).toEqual(change);
    expect(out).toEqual([JSON.stringify(THREAD)]);
  });

  it("passes on a refused move with exit 1", async () => {
    const { io, err } = client([{ status: 409, body: { reason: "not-from-here" } }]);
    expect(await run(["move", "42", "done"], io)).toBe(1);
    expect(err.join("\n")).toContain("409 not-from-here");
  });

  it.each([
    ["an unknown action", ["move", "42", "archive"]],
    ["the inbox's topic move", ["move", "42", "topic", "--topic", "videos"]],
    ["the owner's own move", ["move", "42", "reply-opened"]],
    ["an unknown flag", ["move", "42", "drop", "--why", "x"]],
    ["a flag with no value", ["move", "42", "drop", "--reason"]],
    ["an id for a number", ["move", THREAD.id, "done"]],
    ["a number with a leading zero", ["move", "042", "done"]],
    ["a number with a hash", ["move", "#42", "done"]],
    ["no number", ["move"]],
  ])("refuses %s as a usage error, sending nothing", async (_, argv) => {
    const { io, sent } = client([]);
    expect(await run(argv, io)).toBe(2);
    expect(sent).toEqual([]);
  });
});

describe("comment", () => {
  it("sends stdin as the comment, quotes and line breaks as they are, and prints the comment", async () => {
    const words = 'Meera said "yes".\n\n- releases need two people\n';
    const comment = { id: "c1", author: "sync", body: words.trim(), createdAt: "2026-11-05T10:00:00.000Z" };
    const { io, sent, out } = client([{ status: 201, body: { comment } }], { stdin: words });
    expect(await run(["comment", "42"], io)).toBe(0);
    expect(sent.map((one) => [one.method, one.url, JSON.parse(one.body ?? "")])).toEqual([["POST", `${THREADS}/42/comments`, { body: words }]]);
    expect(out).toEqual([JSON.stringify(comment)]);
  });

  it("with --only-me writes it for the owner alone", async () => {
    const comment = { id: "c2", author: "sync", audience: "owner", body: "Not for them.", createdAt: "2026-11-05T10:00:00.000Z" };
    const { io, sent } = client([{ status: 201, body: { comment } }], { stdin: "Not for them." });
    expect(await run(["comment", "42", "--only-me"], io)).toBe(0);
    expect(sent.map((one) => JSON.parse(one.body ?? ""))).toEqual([{ body: "Not for them.", audience: "owner" }]);
  });

  it("passes on a thread that isn't there with exit 1", async () => {
    const { io, err } = client([{ status: 404, body: { reason: "no-thread" } }], { stdin: "Hello" });
    expect(await run(["comment", "9"], io)).toBe(1);
    expect(err.join("\n")).toContain("404 no-thread");
  });

  it.each([
    ["nothing on stdin", ["comment", "42"], "  \n"],
    ["no number", ["comment"], "Hello"],
    ["more arguments", ["comment", "42", "Hello"], "Hello"],
    ["a flag it doesn't know", ["comment", "42", "--only-them"], "Hello"],
    ["--only-me twice", ["comment", "42", "--only-me", "--only-me"], "Hello"],
  ])("refuses %s as a usage error, sending nothing", async (_, argv, stdin) => {
    const { io, sent } = client([], { stdin });
    expect(await run(argv, io)).toBe(2);
    expect(sent).toEqual([]);
  });
});

describe("edit", () => {
  it.each([
    ["summary", "Decided: releases need two people.\nOpen: who owns pricing."],
    ["summary", ""],
    ["body", "## Who owns what\n\nThe second draft."],
  ])("replaces the %s with stdin as it is, and prints the thread", async (field, text) => {
    const { io, sent, out } = client([{ status: 200, body: { thread: THREAD } }], { stdin: text });
    expect(await run(["edit", "42", field], io)).toBe(0);
    expect(sent.map((one) => [one.method, one.url, JSON.parse(one.body ?? "")])).toEqual([["POST", `${THREADS}/42/text`, { field, text }]]);
    expect(out).toEqual([JSON.stringify(THREAD)]);
  });

  it("passes on a visitor's words, which are never rewritten, with exit 1", async () => {
    const { io, err } = client([{ status: 409, body: { reason: "visitor-words" } }], { stdin: "New words" });
    expect(await run(["edit", "3", "body"], io)).toBe(1);
    expect(err.join("\n")).toContain("409 visitor-words");
  });

  it.each([
    ["an empty main text", ["edit", "42", "body"], " "],
    ["a field that isn't one", ["edit", "42", "title"], "x"],
    ["no field", ["edit", "42"], "x"],
    ["no number", ["edit"], "x"],
  ])("refuses %s as a usage error, sending nothing", async (_, argv, stdin) => {
    const { io, sent } = client([], { stdin });
    expect(await run(argv, io)).toBe(2);
    expect(sent).toEqual([]);
  });
});

describe("show", () => {
  it("prints the thread with its comments and history as one line", async () => {
    const answer = { thread: THREAD, comments: [], events: [{ id: 1, type: "created" }], truncated: false };
    const { io, sent, out } = client([{ status: 200, body: answer }]);
    expect(await run(["show", "42"], io)).toBe(0);
    expect(sent.map((one) => [one.method, one.url])).toEqual([["GET", `${THREADS}/42`]]);
    expect(out.map((line) => JSON.parse(line))).toEqual([answer]);
  });

  it("passes a public thread's fields through whole: its public time, and each visitor's state, name, email, question and key", async () => {
    const note = { id: "c9", author: "visitor", name: "Tomás", audience: "public", state: "dropped", body: "Hi.", createdAt: "2026-11-05T10:00:00.000Z", senderEmail: "tomas@example.com" };
    const visitorAnswer = { id: "c10", author: "visitor", name: "Sam", audience: "public", state: "shown", body: "Yes.", createdAt: "2026-11-05T10:01:00.000Z", question: "would-you", visitor: "aaaa1111aaaa1111", senderEmail: null };
    const answer = { thread: { ...THREAD, publicAt: "2026-11-05T09:00:00.000Z" }, comments: [note, visitorAnswer], events: [], truncated: false };
    const { io, out } = client([{ status: 200, body: answer }]);
    expect(await run(["show", "42"], io)).toBe(0);
    expect(out.map((line) => JSON.parse(line))).toEqual([answer]);
  });

  it("passes each comment's place through whole: its parent, question, quoted words, and whose it is", async () => {
    const general = { id: "c1", author: "owner", name: null, audience: "thread", state: "shown", body: "Root.", createdAt: "2026-11-06T10:00:00.000Z", parent: null, question: null, quote: null, mine: false };
    const reply = { ...general, id: "c2", author: "member", name: "Meera", body: "Re.", parent: "c1", personNumber: 3 };
    const answered = { ...general, id: "c3", body: "Fine as is.", question: "order" };
    const words = { ...general, id: "c4", body: "Why?", quote: { text: "Who opens", prefix: "Plan ", suffix: " the meeting?", version: 2 } };
    const answer = { thread: THREAD, comments: [general, reply, answered, words], events: [], truncated: false };
    const { io, out } = client([{ status: 200, body: answer }]);
    expect(await run(["show", "42"], io)).toBe(0);
    expect(out.map((line) => JSON.parse(line))).toEqual([answer]);
  });

  it.each([[["show"]], [["show", "0"]], [["show", "42", "43"]]])("refuses %j as a usage error", async (argv) => {
    const { io, sent } = client([]);
    expect(await run(argv, io)).toBe(2);
    expect(sent).toEqual([]);
  });
});

describe("page", () => {
  const html = new TextEncoder().encode("<!doctype html><h1>Pricing</h1>");

  it("sends the file as HTML to the thread's pages, with the address it was read from, and prints the version", async () => {
    const { io, sent, out } = client([{ status: 201, body: { version: 2, thread: THREAD } }], { files: { "pricing.html": html } });
    expect(await run(["page", "42", "pricing.html", "--from", "https://claude.ai/artifact/Kq7"], io)).toBe(0);
    expect(sent).toEqual([
      {
        url: `${THREADS}/42/pages?from=https%3A%2F%2Fclaude.ai%2Fartifact%2FKq7`,
        method: "POST",
        headers: { "CF-Access-Client-Id": INBOX_SYNC_CLIENT_ID, "CF-Access-Client-Secret": SECRET, "Content-Type": "text/html; charset=utf-8" },
        body: null,
        bytes: html,
        redirect: "manual",
      },
    ]);
    expect(out).toEqual(["2"]);
  });

  it("refuses a file larger than the Worker keeps before sending anything", async () => {
    const { io, sent, err } = client([], { files: { "big.html": new Uint8Array(MAX_PAGE_BYTES + 1) } });
    expect(await run(["page", "42", "big.html"], io)).toBe(1);
    expect(sent).toEqual([]);
    expect(err.join("\n")).toContain("refused");
  });

  it("says so when the file can't be read, and passes the Worker's refusal through", async () => {
    const missing = client([]);
    expect(await run(["page", "42", "nowhere.html"], missing.io)).toBe(1);
    expect(missing.err.join("\n")).toContain("can't read nowhere.html");
    const refused = client([{ status: 400, body: { reason: "from" } }], { files: { "p.html": html } });
    expect(await run(["page", "42", "p.html", "--from", "https://example.com/"], refused.io)).toBe(1);
    expect(refused.err).toEqual(["inbox: page refused (400 from)"]);
  });

  it.each([[["page"]], [["page", "42"]], [["page", "x", "p.html"]], [["page", "42", "p.html", "--title", "x"]]])("is a usage error for %j", async (argv) => {
    const { io, sent } = client([]);
    expect(await run(argv, io)).toBe(2);
    expect(sent).toEqual([]);
  });
});

describe("link", () => {
  it("sets a claude.ai address with a title, and clears it", async () => {
    const { io, sent, out } = client([
      { status: 200, body: { thread: { ...THREAD, main: "link" } } },
      { status: 200, body: { thread: { ...THREAD, main: "text" } } },
    ]);
    expect(await run(["link", "42", "https://claude.ai/artifact/Ux3", "--title", "Launch talk slides"], io)).toBe(0);
    expect(await run(["link", "42", "--clear"], io)).toBe(0);
    expect(sent.map((one) => [one.url, one.headers["Content-Type"], one.body && JSON.parse(one.body)])).toEqual([
      [`${THREADS}/42/link`, "application/json", { url: "https://claude.ai/artifact/Ux3", title: "Launch talk slides" }],
      [`${THREADS}/42/link`, "application/json", { url: "", title: "" }],
    ]);
    expect(out.map((line) => JSON.parse(line).main)).toEqual(["link", "text"]);
  });

  it.each([[["link", "42"]], [["link", "42", "--clear", "x"]], [["link", "42", "https://claude.ai/x", "--from", "y"]]])("is a usage error for %j", async (argv) => {
    const { io, sent } = client([]);
    expect(await run(argv, io)).toBe(2);
    expect(sent).toEqual([]);
  });
});

describe("meeting", () => {
  const meeting = { when: "2026-11-09T09:30:00.000Z", minutes: 45, where: "Meet", attendees: [] };

  it("sets a day, a moment with its length and where, and clears it, printing the thread with its meeting", async () => {
    const { io, sent, out } = client([
      { status: 200, body: { thread: { ...THREAD, meeting: { ...meeting, when: "2026-11-09", minutes: null, where: null } } } },
      { status: 200, body: { thread: { ...THREAD, meeting } } },
      { status: 200, body: { thread: { ...THREAD, meeting: null } } },
    ]);
    expect(await run(["meeting", "42", "--when", "2026-11-09"], io)).toBe(0);
    expect(await run(["meeting", "42", "--where", "Meet", "--when", "2026-11-09T15:00+05:30", "--minutes", "45"], io)).toBe(0);
    expect(await run(["meeting", "42", "--clear"], io)).toBe(0);
    expect(sent.map((one) => [one.method, one.url, one.body && JSON.parse(one.body)])).toEqual([
      ["POST", `${THREADS}/42/meeting`, { when: "2026-11-09", minutes: null, where: null }],
      ["POST", `${THREADS}/42/meeting`, { when: "2026-11-09T15:00+05:30", minutes: 45, where: "Meet" }],
      ["POST", `${THREADS}/42/meeting`, { when: null, minutes: null, where: null }],
    ]);
    expect(out.map((line) => JSON.parse(line).meeting?.when ?? null)).toEqual(["2026-11-09", "2026-11-09T09:30:00.000Z", null]);
  });

  it("passes the Worker's refusal through with exit 1", async () => {
    const { io, err } = client([{ status: 400, body: { reason: "meeting" } }]);
    expect(await run(["meeting", "42", "--when", "2026-02-30"], io)).toBe(1);
    expect(err).toEqual(["inbox: meeting refused (400 meeting)"]);
  });

  it.each([
    [["meeting", "42"]],
    [["meeting", "42", "--minutes", "30"]],
    [["meeting", "42", "--when"]],
    [["meeting", "42", "--when", "2026-11-09", "--when", "2026-11-10"]],
    [["meeting", "42", "--when", "2026-11-09", "--minutes", "half an hour"]],
    [["meeting", "42", "--when", "2026-11-09", "--with", "5"]],
    [["meeting", "42", "--clear", "--when", "2026-11-09"]],
    [["meeting", "x", "--clear"]],
  ])("is a usage error for %j, sending nothing", async (argv) => {
    const { io, sent } = client([]);
    expect(await run(argv, io)).toBe(2);
    expect(sent).toEqual([]);
  });
});

describe("attendees", () => {
  it("sends one change per flag in the order given, and prints the thread after the last", async () => {
    const after = { ...THREAD, meeting: { when: "2026-11-09", minutes: null, where: null, attendees: [{ number: 4, name: "Dev" }, { number: 9, name: "Leela" }] } };
    const { io, sent, out } = client([{ status: 200, body: { thread: THREAD } }, { status: 200, body: { thread: THREAD } }, { status: 200, body: { thread: THREAD } }, { status: 200, body: { thread: after } }]);
    expect(await run(["attendees", "42", "--add", "5", "--add", "4", "--new", "Leela", "--remove", "5"], io)).toBe(0);
    expect(sent.map((one) => [one.url, one.body && JSON.parse(one.body)])).toEqual([
      [`${THREADS}/42/attendees`, { add: { person: 5 } }],
      [`${THREADS}/42/attendees`, { add: { person: 4 } }],
      [`${THREADS}/42/attendees`, { add: { name: "Leela" } }],
      [`${THREADS}/42/attendees`, { remove: 5 }],
    ]);
    expect(out.map((line) => JSON.parse(line))).toEqual([after]);
  });

  it("stops at the first refusal, saying which, and that the changes before it were kept", async () => {
    const { io, sent, out, err } = client([{ status: 200, body: { thread: THREAD } }, { status: 409, body: { reason: "not-attending" } }]);
    expect(await run(["attendees", "42", "--add", "5", "--remove", "7", "--add", "4"], io)).toBe(1);
    expect(sent).toHaveLength(2);
    expect(out).toEqual([]);
    expect(err).toEqual(["inbox: attendees refused at change 2 of 3 (409 not-attending); the changes before it were kept"]);
  });

  it.each([[["attendees", "42"]], [["attendees", "42", "--add"]], [["attendees", "42", "--add", "Asha"]], [["attendees", "42", "--remove", "05"]], [["attendees", "42", "--invite", "5"]]])(
    "is a usage error for %j, sending nothing",
    async (argv) => {
      const { io, sent } = client([]);
      expect(await run(argv, io)).toBe(2);
      expect(sent).toEqual([]);
    },
  );
});

describe("people", () => {
  it("prints everyone, one line each, as the Worker answers them", async () => {
    const asha = { number: 1, name: "Asha", email: "asha@example.com", dropped: false, counts: { sent: 2 } };
    const { io, sent, out, err } = client([{ status: 200, body: { people: [asha, { number: 2, name: "Dev", email: null }], truncated: false } }]);
    expect(await run(["people"], io)).toBe(0);
    expect(sent.map((one) => [one.method, one.url])).toEqual([["GET", `${ORIGIN}/threads/api/people`]]);
    expect(out.map((line) => JSON.parse(line))).toEqual([asha, { number: 2, name: "Dev", email: null }]);
    expect(err).toEqual([]);
  });

  it("says when there were more than the Worker answered", async () => {
    const { io, err } = client([{ status: 200, body: { people: [{ number: 1 }], truncated: true } }]);
    expect(await run(["people"], io)).toBe(0);
    expect(err).toEqual(["inbox: people answered only the people last in touch; there are more"]);
  });

  it("prints one person as one line, and passes a number nobody has through with exit 1", async () => {
    const one = { person: { number: 7, name: "Meera", note: "Prefers async." }, threads: [{ number: 16, roles: ["invited"] }], words: [], truncated: false };
    const found = client([{ status: 200, body: one }]);
    expect(await run(["person", "7"], found.io)).toBe(0);
    expect(found.sent.map((call) => call.url)).toEqual([`${ORIGIN}/threads/api/people/7`]);
    expect(found.out.map((line) => JSON.parse(line))).toEqual([one]);
    const missing = client([{ status: 404, body: { reason: "no-person" } }]);
    expect(await run(["person", "9"], missing.io)).toBe(1);
    expect(missing.err).toEqual(["inbox: person refused (404 no-person)"]);
  });

  it("are usage errors with anything else, sending nothing", async () => {
    for (const argv of [["people", "7"], ["person"], ["person", "07"], ["person", "7", "8"]]) {
      const { io, sent } = client([]);
      expect(await run(argv, io)).toBe(2);
      expect(sent).toEqual([]);
    }
  });
});

describe("add, naming a told thread's person", () => {
  it("passes the person's number through as given, and a refusal of a number nobody has, line by line", async () => {
    const told = { ref: "recorder:a:1", source: "told", name: "Noor", person: 7, title: "T", body: "B", space: null, status: "received" };
    const { io, sent, out } = client([{ status: 201, body: { thread: { number: 43, senderNumber: 7 } } }, { status: 404, body: { reason: "no-person" } }]);
    expect(await run(["add"], { ...io, stdin: async () => `${JSON.stringify(told)}\n${JSON.stringify({ ...told, ref: "recorder:a:2", person: 9 })}\n` })).toBe(1);
    expect(JSON.parse(sent[0]?.body ?? "{}")).toEqual(told);
    expect(out.map((line) => JSON.parse(line))).toEqual([
      { line: 1, status: 201, thread: { number: 43, senderNumber: 7 } },
      { line: 2, status: 404, reason: "no-person" },
    ]);
  });
});

describe("asks", () => {
  it("prints every ask, one line each, as the Worker answers them", async () => {
    const asks = [{ number: 7, slug: "demo", state: "draft" }, { number: 5, slug: "stigmer", state: "open" }];
    const { io, sent, out } = client([{ status: 200, body: { asks } }]);
    expect(await run(["asks"], io)).toBe(0);
    expect(sent.map((one) => [one.method, one.url])).toEqual([["GET", `${ORIGIN}/threads/api/asks`]]);
    expect(out.map((line) => JSON.parse(line))).toEqual(asks);
  });

  it("makes a draft under a slug, and closes one, printing the thread", async () => {
    const thread = { ...THREAD, ask: { slug: "demo-nov-10", state: "draft" } };
    const { io, sent, out } = client([{ status: 200, body: { thread } }, { status: 200, body: { thread } }]);
    expect(await run(["ask", "42", "--slug", "demo-nov-10"], io)).toBe(0);
    expect(await run(["ask", "42", "--close"], io)).toBe(0);
    expect(sent.map((one) => [one.method, one.url, one.body])).toEqual([
      ["POST", `${THREADS}/42/ask`, JSON.stringify({ slug: "demo-nov-10" })],
      ["POST", `${THREADS}/42/ask`, JSON.stringify({ action: "close" })],
    ]);
    expect(out.map((line) => JSON.parse(line))).toEqual([thread, thread]);
  });

  it("passes a taken slug through with exit 1", async () => {
    const { io, err } = client([{ status: 409, body: { reason: "slug-taken" } }]);
    expect(await run(["ask", "42", "--slug", "demo"], io)).toBe(1);
    expect(err).toEqual(["inbox: ask refused (409 slug-taken)"]);
  });

  it("has no verb that opens an ask, and refuses anything else as a usage error, sending nothing", async () => {
    for (const argv of [["ask", "42", "--open"], ["ask", "42"], ["ask", "42", "--slug"], ["ask", "x", "--close"], ["ask", "42", "--close", "--slug", "a"], ["asks", "more"]]) {
      const { io, sent } = client([]);
      expect([argv, await run(argv, io)]).toEqual([argv, 2]);
      expect(sent).toEqual([]);
    }
    expect(USAGE).not.toMatch(/--open/);
  });
});

describe("the command line", () => {
  it("refuses to run with no secret, sending nothing", async () => {
    const { io, sent, err } = client([], { env: {} });
    expect(await run(["list", "look"], io)).toBe(2);
    expect(sent).toEqual([]);
    expect(err.join("\n")).toContain(SECRET_VARIABLE);
  });

  it.each([[["list"]], [["list", "all"]], [["list", "look", "act"]], [["files"]], [[]]])("refuses %j as a usage error", async (argv) => {
    const { io, sent } = client([]);
    expect(await run(argv, io)).toBe(2);
    expect(sent).toEqual([]);
  });

  it("prints the secret in no line, whatever the answer", async () => {
    const answers: Reply[] = [
      { status: 200, body: { threads: [THREAD], next: null } },
      { status: 403, body: { reason: "caller" } },
      { status: 401, text: "denied" },
      { status: 201, body: { thread: THREAD } },
      { status: 500, body: { reason: "store" } },
      { status: 409, body: { reason: "not-from-here" } },
      { status: 201, body: { comment: {} } },
      { status: 409, body: { reason: "visitor-words" } },
      { status: 200, body: { thread: THREAD } },
    ];
    const { io, out, err } = client(answers, { stdin: '{"ref":"chat:a"}\n{"ref":"chat:b"}' });
    await run(["list", "look"], io);
    await run(["list", "act"], io);
    await run(["list", "done"], io);
    await run(["add"], io);
    await run(["move", "42", "done"], io);
    await run(["move", "x"], io);
    await run(["comment", "42"], io);
    await run(["edit", "42", "body"], io);
    await run(["show", "42"], io);
    expect([...out, ...err].join("\n")).not.toContain(SECRET);
  });

  it("runs as TypeScript under the Node in .nvmrc, as the sync runs it", () => {
    const entry = fileURLToPath(new URL("../tools/inbox/inbox.ts", import.meta.url));
    const help = execFileSync(process.execPath, [entry, "--help"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
    expect(help).toContain(USAGE.split("\n")[0]);
  });
});

describe("journal", () => {
  const JOURNAL = `${ORIGIN}/threads/api/journal`;
  const ENTRY = { key: "2026-03-03", kind: "day", version: 2, title: "A quiet start" };

  it("lists every entry, one line each, and reads one, an earlier version too", async () => {
    const { io, sent, out } = client([
      { status: 200, body: { entries: [ENTRY, { key: "2026-W10" }] } },
      { status: 200, body: { key: "2026-03-03", version: 1, text: "## A quiet start\n" } },
    ]);
    expect(await run(["journal", "list"], io)).toBe(0);
    expect(await run(["journal", "read", "2026-03-03", "--version", "1"], io)).toBe(0);
    expect(sent.map((one) => [one.method, one.url])).toEqual([
      ["GET", JOURNAL],
      ["GET", `${JOURNAL}/2026-03-03?version=1`],
    ]);
    expect(out.map((line) => JSON.parse(line))).toEqual([ENTRY, { key: "2026-W10" }, { key: "2026-03-03", version: 1, text: "## A quiet start\n" }]);
  });

  it("writes the page from stdin as it is, on the version it names", async () => {
    const text = "## A quiet start\n*Tuesday*\n\nIt \"rained\".\n";
    const { io, sent, out } = client([{ status: 201, body: { key: "2026-W10", version: 3 } }], { stdin: text });
    expect(await run(["journal", "write", "2026-W10", "--base", "2"], io)).toBe(0);
    expect(sent[0]?.url).toBe(`${JOURNAL}/2026-W10`);
    expect(sent[0]?.method).toBe("POST");
    expect(JSON.parse(sent[0]?.body ?? "")).toEqual({ text, base: 2 });
    expect(out.map((line) => JSON.parse(line))).toEqual([{ key: "2026-W10", version: 3 }]);
  });

  it("prints the newest version and exits 1 when the save was built on an older one", async () => {
    const { io, out, err } = client([{ status: 409, body: { reason: "stale", version: 4 } }], { stdin: "## T\n" });
    expect(await run(["journal", "write", "2026-03-03", "--base", "3"], io)).toBe(1);
    expect(out.map((line) => JSON.parse(line))).toEqual([{ reason: "stale", version: 4 }]);
    expect(err.join("\n")).toContain("409 stale");
  });

  it("uploads a photo by its file's type, refusing one too large here, and reads one back to a file byte for byte", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1]);
    const { io, sent, out, err, written } = client(
      [
        { status: 201, body: { id: "0b6f2c8e-1d1a-4c55-9a0e-6f0f8a1b2c3d", type: "image/jpeg", bytes: 4 } },
        { status: 200, text: "JPEGBYTES", type: "image/jpeg" },
        { status: 404, body: { reason: "no-photo" } },
      ],
      { files: { "a.JPG": jpeg, "b.png": new Uint8Array(MAX_PHOTO_BYTES + 1) } },
    );
    expect(await run(["journal", "photo", "a.JPG"], io)).toBe(0);
    expect(sent[0]?.headers["Content-Type"]).toBe("image/jpeg");
    expect(sent[0]?.bytes).toEqual(jpeg);
    expect(await run(["journal", "photo", "b.png"], io)).toBe(1);
    expect(err.join("\n")).toContain("the most is");
    expect(await run(["journal", "photo-read", "0b6f2c8e-1d1a-4c55-9a0e-6f0f8a1b2c3d", "out.jpg"], io)).toBe(0);
    expect(new TextDecoder().decode(written["out.jpg"])).toBe("JPEGBYTES");
    expect(await run(["journal", "photo-read", "0b6f2c8e-1d1a-4c55-9a0e-6f0f8a1b2c3d", "out2.jpg"], io)).toBe(1);
    expect(err.join("\n")).toContain("404 no-photo");
    expect(sent.map((one) => [one.method, one.url, one.headers["CF-Access-Client-Secret"] === SECRET])).toEqual([
      ["POST", `${JOURNAL}/photos`, true],
      ["GET", `${JOURNAL}/photos/0b6f2c8e-1d1a-4c55-9a0e-6f0f8a1b2c3d`, true],
      ["GET", `${JOURNAL}/photos/0b6f2c8e-1d1a-4c55-9a0e-6f0f8a1b2c3d`, true],
    ]);
    expect(out.concat(err).join("\n")).not.toContain(SECRET);
  });

  it("prints a day's answers and every storyline", async () => {
    const answers = [{ id: 1, body: "It did.", createdAt: "2026-03-04T07:00:00.000Z" }];
    const trail = { name: "The talk", first: "2026-03-03", last: "2026-03-03", state: "12 days to go.", mark: null, days: [] };
    const { io, sent, out } = client([
      { status: 200, body: { key: "2026-03-03", text: "## T\n", answers } },
      { status: 200, body: { storylines: [trail] } },
    ]);
    expect(await run(["journal", "answers", "2026-03-03"], io)).toBe(0);
    expect(await run(["journal", "storylines"], io)).toBe(0);
    expect(sent.map((one) => one.url)).toEqual([`${JOURNAL}/2026-03-03`, `${JOURNAL}/storylines`]);
    expect(out.map((line) => JSON.parse(line))).toEqual([{ key: "2026-03-03", answers }, trail]);
  });

  it.each([
    [["journal"]],
    [["journal", "nothing"]],
    [["journal", "list", "extra"]],
    [["journal", "read", "today"]],
    [["journal", "read", "2026-03-03", "--version"]],
    [["journal", "write", "2026-03-03"]],
    [["journal", "write", "2026-03-03", "--base", "-1"]],
    [["journal", "photo", "a.gif"]],
    [["journal", "photo-read", "nope", "out.jpg"]],
    [["journal", "answers", "2026-W10"]],
  ])("refuses %j as a usage error", async (argv) => {
    const { io, sent } = client([]);
    expect(await run(argv, io)).toBe(2);
    expect(sent).toEqual([]);
  });

  it("refuses a write with nothing on stdin before sending it", async () => {
    const { io, sent } = client([], { stdin: "  \n" });
    expect(await run(["journal", "write", "2026-03-03", "--base", "0"], io)).toBe(2);
    expect(sent).toEqual([]);
  });
});
