// The inbox's command line (tools/inbox/), driven through its logic with a played fetch: each verb's request to
// the threads' calls, by the thread's number, with the service token's two Access headers and the client id
// wrangler.jsonc names; a list followed through every page; an add answered line by line; a comment and an edit
// taking their words from stdin as they are; a page sent from a file as HTML, refused here past 16 MiB; a link set
// and cleared; the Worker's refusals and the edge's passed through with a
// non-zero exit; usage errors; and the secret in no line it prints. One run of the real entry point as a child
// process proves Node runs the TypeScript as it is.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_PAGE_BYTES, ORIGIN, SECRET_VARIABLE, USAGE, readClientId, run, type Io } from "../tools/inbox/run.ts";
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
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    clientId: INBOX_SYNC_CLIENT_ID,
  };
  return { io, sent, out, err };
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

  it("passes on a thread that isn't there with exit 1", async () => {
    const { io, err } = client([{ status: 404, body: { reason: "no-thread" } }], { stdin: "Hello" });
    expect(await run(["comment", "9"], io)).toBe(1);
    expect(err.join("\n")).toContain("404 no-thread");
  });

  it.each([
    ["nothing on stdin", ["comment", "42"], "  \n"],
    ["no number", ["comment"], "Hello"],
    ["more arguments", ["comment", "42", "Hello"], "Hello"],
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
