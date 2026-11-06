// Which paths reach the Worker's code and which are the site's own files, sent through the same routing the deploy
// uses: the harness serves site/ with wrangler.jsonc's `run_worker_first`, `html_handling` and
// `not_found_handling`, and the assets binding the code hands files over through (test/harness.ts). What it
// holds: the two doors (/api/, /threads/api/) answer the Worker's JSON, the public threads' calls under
// /api/threads/ and the asks' under /api/asks/ among them; the pages come from site/; /inbox, the
// threads' old address, and everything under it, its old calls included, redirect for good to /threads/;
// a page's .html address redirects to its clean one, /me/ to /me, /meetings/ to /meetings and /asks/ to /asks; the
// rooms (/me, the door everyone signed in enters by, /meetings, /asks, /threads/ and the people pages, /people and
// /people/<n>), every thread's address and every ask's (/ask/<slug>) answer the threads page with the site's headers (its CSP among them) and status 200, whatever the number,
// with no sign-in; the people pages' old addresses under /threads/, and /people/, redirect to /people for good; because
// Access guards only the threads' calls, never a thread's page; and any other path under /threads/ is what the
// site's files make of it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SITE, startHarness, type Harness } from "./harness.ts";

/** The headers site/_headers sets on every file, as `name: value` lines under `/*`. */
const SITE_HEADERS = Object.fromEntries(
  readFileSync(fileURLToPath(new URL("../site/_headers", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => /^\s+\S/.test(line))
    .map((line) => [line.slice(0, line.indexOf(":")).trim().toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]),
);

const siteDir = fileURLToPath(new URL("../site", import.meta.url));
const titleOf = (file: string): string => /<title>([^<]*)<\/title>/.exec(readFileSync(join(siteDir, file), "utf8"))?.[1] ?? "";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});
afterAll(async () => {
  await harness.dispose();
});

describe("the Worker's code", () => {
  it.each([
    ["/api/talk", 405],
    ["/api/threads/1", 404],
    ["/api/threads/1/notes", 405],
    ["/api/asks/demo", 404],
    ["/api/asks/demo/answers", 405],
    ["/threads/api/threads", 401],
    ["/threads/api/anything", 401],
  ])("answers %s with its own JSON (%i)", async (path, status) => {
    const response = await harness.fetch(`${SITE}${path}`);
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("the site's own files", () => {
  it.each([
    ["/", "index.html"],
    ["/feedback", "feedback.html"],
  ])("serve %s from site/%s, with no code in its path", async (path, file) => {
    const response = await harness.fetch(`${SITE}${path}`, { redirect: "manual" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain(`<title>${titleOf(file)}</title>`);
  });

  it.each(["/inbox", "/inbox/", "/inbox/api/items?tab=look", "/inbox/anything/else"])("redirect %s to /threads/ for good", async (path) => {
    const response = await harness.fetch(`${SITE}${path}`, { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(new URL(response.headers.get("location") ?? "", SITE).pathname).toBe("/threads/");
  });

  it("redirect a page's .html address to its clean one", async () => {
    const response = await harness.fetch(`${SITE}/feedback.html`, { redirect: "manual" });
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "", SITE).pathname).toBe("/feedback");
  });

  it.each([
    "/me",
    "/threads/",
    "/threads/?tab=act&space=company",
    "/threads/42",
    "/threads/42-who-owns-what",
    "/threads/999999999",
    "/meetings",
    "/people",
    "/people/7",
    "/people/7-meera",
    "/people/999999999",
    "/asks",
    "/ask/stigmer",
    "/ask/demo-nov-10",
  ])(
    "answer %s with the threads page and the site's headers, with no sign-in",
    async (path) => {
      const response = await harness.fetch(`${SITE}${path}`, { redirect: "manual" });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      for (const [name, value] of Object.entries(SITE_HEADERS)) expect([name, response.headers.get(name)]).toEqual([name, value]);
      expect(await response.text()).toContain(`<title>${titleOf("threads/index.html")}</title>`);
    },
  );

  it("redirect /me/ to /me for good", async () => {
    const response = await harness.fetch(`${SITE}/me/`, { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(new URL(response.headers.get("location") ?? "", SITE).pathname).toBe("/me");
  });

  it("redirect /meetings/ to /meetings for good", async () => {
    const response = await harness.fetch(`${SITE}/meetings/`, { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(new URL(response.headers.get("location") ?? "", SITE).pathname).toBe("/meetings");
  });

  it("redirect /asks/ to /asks for good", async () => {
    const response = await harness.fetch(`${SITE}/asks/`, { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(new URL(response.headers.get("location") ?? "", SITE).pathname).toBe("/asks");
  });

  it.each([
    ["/threads/people", "/people"],
    ["/threads/people/", "/people"],
    ["/threads/people/7", "/people/7"],
    ["/threads/people/7-meera", "/people/7-meera"],
    ["/people/", "/people"],
  ])("redirect %s, people's address before the rooms, to %s for good", async (path, to) => {
    const response = await harness.fetch(`${SITE}${path}`, { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(new URL(response.headers.get("location") ?? "", SITE).pathname).toBe(to);
  });

  it("redirect /threads to /threads/", async () => {
    const response = await harness.fetch(`${SITE}/threads`, { redirect: "manual" });
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "", SITE).pathname).toBe("/threads/");
  });

  it.each(["/threads/042", "/threads/42/comments", "/threads/0", "/threads/nope", "/threads/people/07", "/threads/people/7/threads", "/threads/peoples", "/me/42", "/mex", "/people/07", "/people/7/threads", "/peoples", "/meetings/7", "/meetingsx", "/ask", "/ask/", "/askx", "/asksx", "/asks/7", "/ask/Upper", "/ask/-lead", "/ask/demo/7"])("answer %s with the site's 404 page", async (path) => {
    const response = await harness.fetch(`${SITE}${path}`, { redirect: "manual" });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain(`<title>${titleOf("404.html")}</title>`);
  });

  it("serve the threads page's scripts as files", async () => {
    for (const path of ["/app/threads.js", "/app/threads-store.js", "/app/keys.js", "/app/markdown.js", "/app/people.js", "/app/meetings.js"]) {
      const response = await harness.fetch(`${SITE}${path}`);
      expect([path, response.status]).toEqual([path, 200]);
      expect(response.headers.get("content-type")).toContain("javascript");
    }
  });
});
