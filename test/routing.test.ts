// Which paths reach the Worker's code and which are the site's own files, sent through the same routing the deploy
// uses: the harness serves site/ with wrangler.jsonc's `run_worker_first`, `html_handling` and
// `not_found_handling` (test/harness.ts). What it holds: the three doors (/api/, /inbox/api/, /threads/api/)
// answer the Worker's JSON; the pages come from site/; a page's .html address redirects to its clean one; and
// /threads and a thread's address answer the site's 404 page, because nothing serves them yet and Access guards
// only the threads' calls, never a thread's page.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SITE, startHarness, type Harness } from "./harness.ts";

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
    ["/inbox/api/items", 401],
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
    ["/inbox/", "inbox/index.html"],
  ])("serve %s from site/%s, with no code in its path", async (path, file) => {
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

  it.each(["/threads", "/threads/", "/threads/42", "/threads/42-who-owns-what"])("answer %s with the site's 404 page", async (path) => {
    const response = await harness.fetch(`${SITE}${path}`, { redirect: "manual" });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain(`<title>${titleOf("404.html")}</title>`);
  });
});
