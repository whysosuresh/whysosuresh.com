// Which paths reach the Worker's code and which are the site's own files, on each of the site's two hosts
// (site/hosts.js), sent through the same routing the deploy uses: the harness serves site/ with wrangler.jsonc's
// `run_worker_first`, `html_handling` and `not_found_handling`, and the assets binding the code hands files over
// through (test/harness.ts). What it holds: the Worker splits by host first. The home page's host (whysosuresh.com)
// answers its home page, /, every update's page, /updates, its feed, /feed.xml, and its videos' pictures under /thumbs/
// from the code (test/home.test.ts and test/outside.test.ts hold what they say), and the note flow's send, /api/talk;
// every address of the threads' (/threads/, the rooms, the journal, an ask's, and the calls under /threads/api/,
// /api/threads/, /api/asks/ and /api/access/) answers the code's JSON 404 there, so the threads' old addresses lead
// nowhere. The threads' host (hey.whysosuresh.com) answers the two doors' JSON (/threads/api/, and the public threads'
// and the asks' calls under /api/), and its root, Today, the door everyone signed in enters by, the rooms (/meetings,
// /asks, /threads/ and the people pages, /people and /people/<n>, and the journal's /journal, a day, a week, the
// storylines and a storyline), every thread's address and every ask's (/ask/<slug>) with the threads page, the site's
// headers (its CSP among them) and status 200, whatever the number, with no sign-in, because Access guards only the
// threads' calls, never a thread's page; the home page's addresses answer the code's JSON 404 there. /me, Today's
// old address, and /inbox, the threads' older one, lead nowhere on either host: no redirect, the site's 404 page. A
// page's .html address redirects to its clean one, /meetings/ to /meetings and /asks/ to /asks; the people pages' old
// addresses under /threads/, and /people/, redirect to /people for good; and any other path under /threads/ is what
// the site's files make of it. `"/"` in `run_worker_first` names the root alone: every file beside it, the
// stylesheet, a picture, a script and the other pages, still comes straight from site/ with no code in its path, and
// /index.html keeps its redirect to /.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SITE, THREADS, startHarness, type Harness } from "./harness.ts";

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
    [SITE, "/api/talk", 405],
    [SITE, "/thumbs/x.jpg", 404],
    [SITE, "/thumbs/AAAAAAAAAAA.jpg", 404],
    [THREADS, "/api/threads/1", 404],
    [THREADS, "/api/threads/1/notes", 405],
    [THREADS, "/api/asks/demo", 404],
    [THREADS, "/api/asks/demo/answers", 405],
    [THREADS, "/threads/api/threads", 401],
    [THREADS, "/threads/api/anything", 401],
  ])("answers %s%s with its own JSON (%i)", async (origin, path, status) => {
    const response = await harness.fetch(`${origin}${path}`);
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("each host answers only its own addresses", () => {
  it.each([
    "/threads/api/me",
    "/threads/api/threads",
    "/threads/api/journal",
    "/threads/",
    "/threads/42",
    "/threads/0123456789abcdef0123456789abcdef",
    "/meetings",
    "/people",
    "/people/7",
    "/asks",
    "/ask/stigmer",
    "/journal",
    "/journal/2026-11-06",
    "/api/threads/1",
    "/api/threads/0123456789abcdef0123456789abcdef",
    "/api/asks/demo",
    "/api/access/keys",
  ])("the home page's host answers the threads' %s with the code's JSON 404", async (path) => {
    const response = await harness.fetch(`${SITE}${path}`, { redirect: "manual" });
    expect([path, response.status]).toEqual([path, 404]);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ reason: "not-found" });
  });

  it("the home page's host refuses the threads' writes with the same 404", async () => {
    for (const path of ["/api/access/evaluate", "/api/threads/1/notes", "/api/asks/demo/answers", "/threads/api/threads"]) {
      const response = await harness.fetch(`${SITE}${path}`, { method: "POST", body: "{}" });
      expect([path, response.status]).toEqual([path, 404]);
      expect(await response.json()).toEqual({ reason: "not-found" });
    }
  });

  it.each(["/feed.xml", "/updates", "/thumbs/x.jpg", "/api/talk"])("the threads' host answers the home page's %s with the code's JSON 404", async (path) => {
    const response = await harness.fetch(`${THREADS}${path}`, { redirect: "manual" });
    expect([path, response.status]).toEqual([path, 404]);
    expect(await response.json()).toEqual({ reason: "not-found" });
    const sent = await harness.fetch(`${THREADS}${path}`, { method: "POST", body: "{}" });
    expect([path, sent.status]).toEqual([path, 404]);
  });

  it.each([SITE, THREADS])("%s answers the old addresses /me and /inbox with the site's 404 page, and sends them nowhere", async (origin) => {
    for (const path of ["/me", "/me/", "/me/42", "/inbox", "/inbox/", "/inbox/api/items?tab=look", "/inbox/anything/else"]) {
      const response = await harness.fetch(`${origin}${path}`, { redirect: "manual" });
      expect([path, response.status, response.headers.get("location")]).toEqual([path, 404, null]);
      expect(await response.text()).toContain(`<title>${titleOf("404.html")}</title>`);
    }
  });
});

describe("the home page and its feed", () => {
  it("answers /feed.xml from the code, as an Atom feed", async () => {
    const response = await harness.fetch(`${SITE}/feed.xml`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/atom+xml; charset=utf-8");
  });

  it("answers /updates from the code (its empty line shown, which the file hides), and redirects /updates.html to it", async () => {
    const page = await harness.fetch(`${SITE}/updates`, { redirect: "manual" });
    expect(page.status).toBe(200);
    const text = await page.text();
    expect(text).toContain(`<title>${titleOf("updates.html")}</title>`);
    expect(text).toContain("<p class=\"fine\" data-updates-empty>Nothing here yet.</p>");
    const moved = await harness.fetch(`${SITE}/updates.html`, { redirect: "manual" });
    expect(moved.status).toBe(307);
    expect(new URL(moved.headers.get("location") ?? "", SITE).pathname).toBe("/updates");
  });

  it("serves / as the home page, and redirects /index.html to it", async () => {
    const page = await harness.fetch(`${SITE}/`, { redirect: "manual" });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`<title>${titleOf("index.html")}</title>`);
    const moved = await harness.fetch(`${SITE}/index.html`, { redirect: "manual" });
    expect(moved.status).toBe(307);
    expect(new URL(moved.headers.get("location") ?? "", SITE).pathname).toBe("/");
  });

  it.each([
    ["/style.css", "text/css"],
    ["/img/avatar.webp", "image/webp"],
    ["/talk.js", "javascript"],
    ["/robots.txt", "text/plain"],
    ["/feedback", "text/html"],
  ])("still serves %s as a file: \"/\" names the root alone, never everything under it", async (path, type) => {
    const response = await harness.fetch(`${SITE}${path}`, { redirect: "manual" });
    expect([path, response.status]).toEqual([path, 200]);
    expect(response.headers.get("content-type")).toContain(type);
    expect(response.headers.get("cache-control")).not.toBe("no-store");
  });

  it("answers a path no file has with the site's 404 page, not the code's JSON", async () => {
    const response = await harness.fetch(`${SITE}/nothing-here`, { redirect: "manual" });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});

describe("the site's own files", () => {
  it.each([["/feedback", "feedback.html"]])("serve %s from site/%s, with no code in its path", async (path, file) => {
    const response = await harness.fetch(`${SITE}${path}`, { redirect: "manual" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain(`<title>${titleOf(file)}</title>`);
  });

  it("redirect a page's .html address to its clean one", async () => {
    const response = await harness.fetch(`${SITE}/feedback.html`, { redirect: "manual" });
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "", SITE).pathname).toBe("/feedback");
  });

  it.each([
    "/",
    "/threads/",
    "/threads/?tab=act&space=company",
    "/threads/42",
    "/threads/42-who-owns-what",
    "/threads/999999999",
    "/threads/0123456789abcdef0123456789abcdef",
    "/meetings",
    "/people",
    "/people/7",
    "/people/7-meera",
    "/people/999999999",
    "/asks",
    "/ask/stigmer",
    "/ask/demo-nov-10",
    "/journal",
    "/journal/2026-11-06",
    "/journal/2026-W44",
    "/journal/storylines",
    "/journal/storylines/the-demo",
  ])(
    "answer %s on the threads' host with the threads page and the site's headers, with no sign-in",
    async (path) => {
      const response = await harness.fetch(`${THREADS}${path}`, { redirect: "manual" });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      for (const [name, value] of Object.entries(SITE_HEADERS)) expect([name, response.headers.get(name)]).toEqual([name, value]);
      expect(await response.text()).toContain(`<title>${titleOf("threads/index.html")}</title>`);
    },
  );

  it("redirect /meetings/ to /meetings for good", async () => {
    const response = await harness.fetch(`${THREADS}/meetings/`, { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(new URL(response.headers.get("location") ?? "", THREADS).pathname).toBe("/meetings");
  });

  it("redirect /asks/ to /asks for good", async () => {
    const response = await harness.fetch(`${THREADS}/asks/`, { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(new URL(response.headers.get("location") ?? "", THREADS).pathname).toBe("/asks");
  });

  it.each([
    ["/threads/people", "/people"],
    ["/threads/people/", "/people"],
    ["/threads/people/7", "/people/7"],
    ["/threads/people/7-meera", "/people/7-meera"],
    ["/people/", "/people"],
  ])("redirect %s, people's address before the rooms, to %s for good", async (path, to) => {
    const response = await harness.fetch(`${THREADS}${path}`, { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(new URL(response.headers.get("location") ?? "", THREADS).pathname).toBe(to);
  });

  it("redirect /journal/ to /journal for good", async () => {
    const response = await harness.fetch(`${THREADS}/journal/?x=1`, { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/journal?x=1");
  });

  it("redirect /threads to /threads/", async () => {
    const response = await harness.fetch(`${THREADS}/threads`, { redirect: "manual" });
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "", THREADS).pathname).toBe("/threads/");
  });

  it.each(["/threads/042", "/threads/42/comments", "/threads/0123456789abcdef0123456789abcdef-title", "/threads/0123456789abcdef0123456789abcdef/x", "/threads/0123456789ABCDEF0123456789ABCDEF", "/threads/0", "/threads/nope", "/threads/people/07", "/threads/people/7/threads", "/threads/peoples", "/mex", "/people/07", "/people/7/threads", "/peoples", "/meetings/7", "/meetingsx", "/ask", "/ask/", "/askx", "/asksx", "/asks/7", "/ask/Upper", "/ask/-lead", "/ask/demo/7", "/journalx", "/journal/today", "/journal/2026-11-6", "/journal/2026-w44", "/journal/2026-11-06/edit", "/journal/storylines/", "/journal/storylines/The-Demo", "/journal/storylines/a/b"])("answer %s on the threads' host with the site's 404 page", async (path) => {
    const response = await harness.fetch(`${THREADS}${path}`, { redirect: "manual" });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain(`<title>${titleOf("404.html")}</title>`);
  });

  it("serve the threads page's scripts as files", async () => {
    for (const path of ["/app/threads.js", "/app/threads-store.js", "/app/keys.js", "/app/markdown.js", "/app/people.js", "/app/meetings.js"]) {
      const response = await harness.fetch(`${THREADS}${path}`);
      expect([path, response.status]).toEqual([path, 200]);
      expect(response.headers.get("content-type")).toContain("javascript");
    }
  });
});
