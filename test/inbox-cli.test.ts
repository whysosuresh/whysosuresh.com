// The inbox's command line (tools/inbox/), driven through its logic with a played fetch: each verb's request,
// with the service token's two Access headers and the client id wrangler.jsonc names; a list followed through
// every page; an add answered line by line; the Worker's refusals and the edge's passed through with a
// non-zero exit; usage errors; and the secret in no line it prints. One run of the real entry point as a child
// process proves Node runs the TypeScript as it is.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ORIGIN, SECRET_VARIABLE, USAGE, readClientId, run, type Io } from "../tools/inbox/run.ts";
import { INBOX_SYNC_CLIENT_ID } from "./harness.ts";

const SECRET = "played-secret-0123456789abcdef";

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  redirect: string | undefined;
}

type Reply = { status: number; body?: unknown; type?: string; text?: string };

/** A client whose fetch answers each request in turn with the replies given, and records what was sent. */
function client(replies: Reply[], options: { env?: Record<string, string>; stdin?: string } = {}) {
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
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    clientId: INBOX_SYNC_CLIENT_ID,
  };
  return { io, sent, out, err };
}

const ITEM = { id: "00000000-0000-4000-8000-000000000001", status: "discuss" };

describe("the client id", () => {
  it("is the one wrangler.jsonc names, which the Worker admits", () => {
    expect(readClientId(new URL("../wrangler.jsonc", import.meta.url))).toBe(INBOX_SYNC_CLIENT_ID);
  });
});

describe("list", () => {
  it("follows every page of a tab and prints one line per item, sending both Access headers and following no redirect", async () => {
    const { io, sent, out } = client([
      { status: 200, body: { items: [ITEM, { id: "b" }], counts: {}, next: "2026-11-04T09:00:00.000Z~b", me: null } },
      { status: 200, body: { items: [{ id: "c" }], counts: {}, next: null, me: null } },
    ]);
    expect(await run(["list", "discuss"], io)).toBe(0);
    expect(sent.map((one) => one.url)).toEqual([
      `${ORIGIN}/inbox/api/items?tab=discuss`,
      `${ORIGIN}/inbox/api/items?tab=discuss&before=${encodeURIComponent("2026-11-04T09:00:00.000Z~b")}`,
    ]);
    for (const one of sent) {
      expect(one.method).toBe("GET");
      expect(one.headers).toEqual({ "CF-Access-Client-Id": INBOX_SYNC_CLIENT_ID, "CF-Access-Client-Secret": SECRET });
      expect(one.redirect).toBe("manual");
    }
    expect(out.map((line) => JSON.parse(line))).toEqual([ITEM, { id: "b" }, { id: "c" }]);
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
        { status: 201, body: { item: ITEM } },
        { status: 200, body: { item: { id: "b" } } },
        { status: 400, body: { reason: "source" } },
      ],
      { stdin: `${lines.join("\n")}\n` },
    );
    expect(await run(["add"], io)).toBe(1);
    expect(sent.map((one) => [one.method, one.url, one.body, one.headers["Content-Type"]])).toEqual([
      ["POST", `${ORIGIN}/inbox/api/items`, lines[0], "application/json"],
      ["POST", `${ORIGIN}/inbox/api/items`, lines[2], "application/json"],
      ["POST", `${ORIGIN}/inbox/api/items`, lines[4], "application/json"],
    ]);
    expect(out.map((line) => JSON.parse(line))).toEqual([
      { line: 1, status: 201, item: ITEM },
      { line: 3, status: 200, item: { id: "b" } },
      { line: 4, status: 0, reason: "not-json" },
      { line: 5, status: 400, reason: "source" },
    ]);
  });

  it("exits 0 when every line is kept", async () => {
    const { io } = client([{ status: 201, body: { item: ITEM } }], { stdin: '{"ref":"chat:a"}' });
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
    [["topic", "--topic", "videos"], { action: "topic", topic: "videos" }],
    [["file", "--link", "https://github.com/stigmer/stigmer-cloud/issues/1"], { action: "file", link: "https://github.com/stigmer/stigmer-cloud/issues/1" }],
  ])("%j sends %j and prints the item", async (args, change) => {
    const { io, sent, out } = client([{ status: 200, body: { item: ITEM } }]);
    expect(await run(["move", ITEM.id, ...args], io)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${ORIGIN}/inbox/api/items/${ITEM.id}`);
    expect(sent[0]?.method).toBe("POST");
    expect(JSON.parse(sent[0]?.body ?? "")).toEqual(change);
    expect(out).toEqual([JSON.stringify(ITEM)]);
  });

  it("passes on a refused move with exit 1", async () => {
    const { io, err } = client([{ status: 409, body: { reason: "not-from-here" } }]);
    expect(await run(["move", ITEM.id, "done"], io)).toBe(1);
    expect(err.join("\n")).toContain("409 not-from-here");
  });

  it.each([
    ["an unknown action", ["move", ITEM.id, "archive"]],
    ["the owner's own move", ["move", ITEM.id, "reply-opened"]],
    ["an unknown flag", ["move", ITEM.id, "drop", "--why", "x"]],
    ["a flag with no value", ["move", ITEM.id, "drop", "--reason"]],
    ["no id", ["move"]],
  ])("refuses %s as a usage error, sending nothing", async (_, argv) => {
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
      { status: 200, body: { items: [ITEM], next: null } },
      { status: 403, body: { reason: "caller" } },
      { status: 401, text: "denied" },
      { status: 201, body: { item: ITEM } },
      { status: 500, body: { reason: "store" } },
      { status: 409, body: { reason: "not-from-here" } },
    ];
    const { io, out, err } = client(answers, { stdin: '{"ref":"chat:a"}\n{"ref":"chat:b"}' });
    await run(["list", "look"], io);
    await run(["list", "act"], io);
    await run(["list", "done"], io);
    await run(["add"], io);
    await run(["move", ITEM.id, "done"], io);
    await run(["move", "x"], io);
    expect([...out, ...err].join("\n")).not.toContain(SECRET);
  });

  it("runs as TypeScript under the Node in .nvmrc, as the sync runs it", () => {
    const entry = fileURLToPath(new URL("../tools/inbox/inbox.ts", import.meta.url));
    const help = execFileSync(process.execPath, [entry, "--help"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
    expect(help).toContain(USAGE.split("\n")[0]);
  });
});
