// The site's checks: what is served, that every page is valid HTML with the head a shared link needs, that
// every internal link reaches a file without a redirect, that nothing loads from elsewhere but the allowed
// player and the scripts' allowed resources, that the headers match the pages and the scripts, that the
// stylesheet carries no dead rules, that the "Send a note" doors open the note flow, that the topic list
// the Worker shares is plain data and reads page addresses right, that the spaces the Worker shares are plain
// data and hold every topic, that the journal's reader the Worker shares is plain data that reads no clock, that the threads page is never indexed or shared and reaches only its own calls,
// that /inbox, the threads' old address, redirects to /threads/ and nothing else is redirected, that no file names
// the owner's email address, and that the Worker's config routes the one domain to the code only under /api/ and
// /threads/ (test/routing.test.ts sends the requests). `wrangler deploy --dry-run` does not read
// site/_headers or site/_redirects, so this file parses them. The Worker itself is the Worker tests'.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HtmlValidate, Parser, type HtmlElement } from "html-validate";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const siteDir = join(root, "site");

/** Every file the Worker serves. A file not listed here fails the suite, so nothing ships by accident. */
const SERVED = [
  "404.html",
  "_headers",
  "_redirects",
  "app/asks.js",
  "app/journal.js",
  "app/keys.js",
  "app/markdown.js",
  "app/page-talk.js",
  "app/people.js",
  "app/meetings.js",
  "app/share.js",
  "app/threads-store.js",
  "app/threads.js",
  "feedback.html",
  "img/apple-touch-icon.png",
  "img/avatar.webp",
  "img/icon-192.png",
  "img/share.jpg",
  "index.html",
  "robots.txt",
  "spaces.js",
  "style.css",
  "talk-send.js",
  "talk-topics.js",
  "talk.js",
  "threads/index.html",
];

/** The only resources a page may load from another origin. */
const EXTERNAL_RESOURCES = ["https://www.youtube-nocookie.com/embed/videoseries?list=UUkdfCh9gN60s_h_nfTYEwyg"];

/**
 * The only addresses on another origin a site script names. A resource a script loads is invisible to
 * the page checks, so it is allowed here instead. Turnstile's script also opens its own frame.
 */
const SCRIPT_RESOURCES = ["https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"];

/** The only addresses on another origin a site script links to. A link loads nothing, so the CSP leaves it out. */
const SCRIPT_LINKS = ["https://cal.com/whysosuresh", "https://mail.google.com/mail/", "https://github.com/"];

const originsOf = (urls: string[]): string => [...new Set(urls.map((url) => new URL(url).origin))].join(" ");

/** The pages a link can be shared to, which carry a description and a preview picture. */
const SHARED_PAGES = ["index.html", "feedback.html"];

const ORIGIN = "https://whysosuresh.com";

const EXPECTED_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'none'",
    `script-src 'self' ${originsOf(SCRIPT_RESOURCES)}`,
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    // The site's own frames are the pages saved into threads, each sealed by its own answer's CSP (src/page.ts).
    `frame-src 'self' ${originsOf([...EXTERNAL_RESOURCES, ...SCRIPT_RESOURCES])}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000",
};

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [relative(siteDir, path).split(sep).join("/")];
  });
}

const served = listFiles(siteDir).sort();

function listFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFilesUnder(path) : [path];
  });
}
const pages = served.filter((file) => file.endsWith(".html"));
const scripts = served.filter((file) => file.endsWith(".js"));
const read = (file: string): string => readFileSync(join(siteDir, file), "utf8");

const validator = new HtmlValidate({
  extends: ["html-validate:recommended", "html-validate:document"],
  rules: {
    // A hash on the site's own stylesheet would guard nothing the CSP doesn't; anything loaded from
    // another origin still needs one.
    "require-sri": ["error", { target: "crossorigin" }],
  },
});

async function parse(file: string): Promise<HtmlElement> {
  const config = await validator.getConfigFor(join(siteDir, file));
  return new Parser(config).parseHtml(read(file));
}

function attr(element: HtmlElement, name: string): string {
  const value = element.getAttributeValue(name);
  if (value === null) throw new Error(`<${element.tagName}> has no ${name}`);
  return value;
}

/**
 * Where an internal path lands under assets' `auto-trailing-slash` handling, or why it would cost a
 * redirect or miss. `/` serves index.html, `/name` serves name.html, a file with another extension
 * serves itself; `/name.html`, `/index.html` and a trailing slash on a file all answer a 307.
 */
function resolveInternal(path: string): { file: string } | { error: string } {
  if (!path.startsWith("/")) return { error: "is not root-absolute" };
  if (path.endsWith(".html")) return { error: "names an .html file, which redirects to its clean address" };
  if (path.endsWith("/")) {
    const index = `${path.slice(1)}index.html`;
    return served.includes(index) ? { file: index } : { error: "has no index.html under it" };
  }
  const exact = path.slice(1);
  if (served.includes(exact)) return { file: exact };
  if (served.includes(`${exact}.html`)) return { file: `${exact}.html` };
  return { error: "reaches no file" };
}

/** The headers set for each pattern in a Cloudflare `_headers` file. */
function parseHeaders(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      rules.set(line.trim(), current);
      continue;
    }
    const colon = line.indexOf(":");
    if (current === undefined || colon < 0) throw new Error(`unparsed _headers line: ${line}`);
    current.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return rules;
}

describe("the served folder", () => {
  it("holds exactly the allowlisted files", () => {
    expect(served).toEqual([...SERVED].sort());
  });

  it("carries no record shapes", () => {
    const text = served.filter((file) => !file.startsWith("img/")).map(read);
    for (const content of text) {
      expect(content).not.toMatch(/_projects|T0\d_|DD-\d/);
    }
  });
});

describe.each(pages)("%s", (page) => {
  it("is valid HTML under the recommended and document presets", async () => {
    const report = await validator.validateString(read(page), join(siteDir, page));
    const messages = report.results.flatMap((result) =>
      result.messages.map((m) => `${m.line}:${m.column} ${m.ruleId}: ${m.message}`),
    );
    expect(messages).toEqual([]);
  });

  it("opens with its intent comment", () => {
    expect(read(page)).toMatch(/^<!DOCTYPE html>\n<!-- \S/);
  });

  it("has a language, a viewport that reaches the screen's edges, and a title", async () => {
    const doc = await parse(page);
    const html = doc.querySelectorAll("html")[0];
    expect(html && attr(html, "lang")).toBe("en");
    const viewport = doc.querySelectorAll('meta[name="viewport"]')[0];
    expect(viewport && attr(viewport, "content")).toContain("viewport-fit=cover");
    expect(doc.querySelectorAll("title")[0]?.textContent.trim()).not.toBe("");
  });

  it("writes every internal link and resource as a clean, root-absolute address that reaches a file", async () => {
    const doc = await parse(page);
    const refs = [
      ...doc.querySelectorAll("a[href]").map((el) => attr(el, "href")),
      ...doc.querySelectorAll("link[href]").filter((el) => attr(el, "rel") !== "canonical").map((el) => attr(el, "href")),
      ...doc.querySelectorAll("img[src], iframe[src], script[src], source[src]").map((el) => attr(el, "src")),
    ];
    const misses = refs
      .filter((ref) => !/^[a-z]+:/i.test(ref))
      .map((ref) => ({ ref, result: resolveInternal(ref) }))
      .flatMap(({ ref, result }) => ("error" in result ? [`${ref} ${result.error}`] : []));
    expect(misses).toEqual([]);
  });

  it("loads nothing from another origin but the allowlisted resources", async () => {
    const doc = await parse(page);
    const loaded = [
      ...doc.querySelectorAll("link[href]")
        .filter((el) => !["canonical"].includes(attr(el, "rel")))
        .map((el) => attr(el, "href")),
      ...doc.querySelectorAll("img[src], iframe[src], script[src], source[src], video[src], audio[src], embed[src], object[data]")
        .map((el) => el.getAttributeValue("src") ?? attr(el, "data")),
    ];
    const foreign = loaded.filter((url) => /^[a-z]+:|^\/\//i.test(url) && !EXTERNAL_RESOURCES.includes(url));
    expect(foreign).toEqual([]);
  });

  it("never asks for no-referrer", () => {
    expect(read(page)).not.toMatch(/no-referrer"/);
  });
});

describe.each(scripts)("%s", (script) => {
  it("is type-checked and opens with its intent comment", () => {
    expect(read(script)).toMatch(/^\/\/ @ts-check\n\/\/ \S/);
  });

  it("names no address on another origin but the allowlisted resources and links", () => {
    const named = [...read(script).matchAll(/\b(?:https?:)?\/\/[^\s'"`)]+/g)].map((m) => m[0]);
    // The site's own origin is not another one: the journal's reader names it to open the site's own links in place.
    expect(named.filter((url) => url !== ORIGIN && !SCRIPT_RESOURCES.includes(url) && !SCRIPT_LINKS.includes(url))).toEqual([]);
  });

  it("imports only served files, and links only to clean root-absolute addresses", () => {
    const text = read(script);
    const imports = [...text.matchAll(/^import [^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? "");
    expect(imports.filter((path) => !served.includes(new URL(path, `${ORIGIN}/${script}`).pathname.slice(1)))).toEqual([]);
    const links = [...text.matchAll(/href="([^"$]+)"/g)].map((m) => m[1] ?? "");
    expect(links.flatMap((ref) => { const result = resolveInternal(ref); return "error" in result ? [`${ref} ${result.error}`] : []; })).toEqual([]);
  });
});

describe("the note flow", () => {
  it.each(["index.html", "feedback.html"])("is opened by the \"Send a note\" door on %s, first among its doors", async (page) => {
    const doc = await parse(page);
    const doors = doc.querySelectorAll(".doors > li > :first-child");
    expect(doors[0]?.hasAttribute("data-talk")).toBe(true);
    expect(doors[0]?.tagName.toLowerCase()).toBe("button");
    expect(doors[0]?.textContent.trim()).toBe("Send a note");
    expect(doc.querySelectorAll("[data-talk]")).toHaveLength(1);
  });

  it("is opened by no other page", async () => {
    for (const page of pages.filter((p) => !["index.html", "feedback.html"].includes(p))) {
      expect((await parse(page)).querySelectorAll("[data-talk]")).toEqual([]);
    }
  });

  it.each(["index.html", "feedback.html"])("is loaded by %s", async (page) => {
    const loaded = (await parse(page)).querySelectorAll('script[type="module"]').map((el) => attr(el, "src"));
    expect(loaded).toEqual(["/talk.js"]);
  });

  it("carries the production widget's site key", () => {
    expect(read("talk-send.js")).toMatch(/^const SITE_KEY = '0x[0-9A-Za-z_-]{20,}';$/m);
  });
});

interface Topic {
  slug: string;
  label: string;
  hint: string;
  questions: unknown[];
  ask?: unknown;
}
interface TopicsModule {
  TOPICS: Topic[];
  isTopic(slug: string): boolean;
  topicFromHash(hash: string): unknown;
}

function isTopicsModule(value: unknown): value is TopicsModule {
  if (typeof value !== "object" || value === null) return false;
  const module = value as Record<string, unknown>;
  return Array.isArray(module.TOPICS) && typeof module.isTopic === "function" && typeof module.topicFromHash === "function";
}

describe("talk-topics.js, which the Worker imports too", () => {
  // A computed address, so the type check doesn't follow it into a browser script; the shape is checked here.
  const loading = import(pathToFileURL(join(siteDir, "talk-topics.js")).href).then((loaded: unknown) => {
    if (!isTopicsModule(loaded)) throw new Error("talk-topics.js lacks TOPICS, isTopic or topicFromHash");
    return loaded;
  });

  it("is plain data and pure functions: it imports nothing, touches no page, and only declares exports", () => {
    const code = read("talk-topics.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/^import /m);
    expect(code).not.toMatch(/\b(document|window|location|navigator|globalThis|fetch|localStorage|sessionStorage|addEventListener|setTimeout)\b/);
    const topLevel = code.split("\n").filter((line) => /^\S/.test(line));
    expect(topLevel.filter((line) => !/^(export |\}|\]\);)/.test(line))).toEqual([]);
  });

  it("lists the four topics, each with a label, a hint and two or three questions", async () => {
    const { TOPICS } = await loading;
    expect(TOPICS.map((topic) => topic.slug)).toEqual(["stigmer", "videos", "capsjump", "other"]);
    for (const topic of TOPICS) {
      expect(topic.label).not.toBe("");
      expect(topic.hint).not.toBe("");
      expect(topic.questions.length).toBeGreaterThanOrEqual(2);
      expect(topic.questions.length).toBeLessThanOrEqual(3);
      for (const question of topic.questions) expect(typeof question === "string" && question !== "").toBe(true);
    }
  });

  it("names, for a topic that opens an ask, a slug an ask can have", async () => {
    const { TOPICS } = await loading;
    for (const topic of TOPICS) {
      if (topic.ask === undefined) continue;
      expect([topic.slug, topic.ask]).toEqual([topic.slug, expect.stringMatching(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/)]);
    }
    expect(read("talk-topics.js")).toMatch(/^ \*   ask\?: string,$/m);
  });

  it.each([
    ["#talk", { open: true, topic: null }],
    ["#talk/stigmer", { open: true, topic: "stigmer" }],
    ["#talk/other", { open: true, topic: "other" }],
    ["#talk/nope", { open: true, topic: null }],
    ["#talk/", { open: true, topic: null }],
    ["#talks", { open: false }],
    ["#other", { open: false }],
    ["", { open: false }],
  ])("reads %j as %j", async (hash, expected) => {
    const { topicFromHash } = await loading;
    expect(topicFromHash(hash)).toEqual(expected);
  });

  it("knows a topic only by its exact slug", async () => {
    const { isTopic } = await loading;
    expect(["stigmer", "videos", "capsjump", "other"].every((slug) => isTopic(slug))).toBe(true);
    expect(["Stigmer", "", "talk", "stigmer "].some((slug) => isTopic(slug))).toBe(false);
  });
});

interface SpacesModule {
  SPACES: { slug: string; label: string }[];
  isSpace(slug: string): boolean;
}

function isSpacesModule(value: unknown): value is SpacesModule {
  if (typeof value !== "object" || value === null) return false;
  const module = value as Record<string, unknown>;
  return Array.isArray(module.SPACES) && typeof module.isSpace === "function";
}

describe("spaces.js, which the Worker imports too", () => {
  const loading = Promise.all([
    import(pathToFileURL(join(siteDir, "spaces.js")).href),
    import(pathToFileURL(join(siteDir, "talk-topics.js")).href),
  ]).then(([spaces, topics]: unknown[]) => {
    if (!isSpacesModule(spaces)) throw new Error("spaces.js lacks SPACES or isSpace");
    if (!isTopicsModule(topics)) throw new Error("talk-topics.js lacks TOPICS, isTopic or topicFromHash");
    return { ...spaces, TOPICS: topics.TOPICS };
  });

  it("is plain data and pure functions: it imports nothing, touches no page, and only declares exports", () => {
    const code = read("spaces.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/^import /m);
    expect(code).not.toMatch(/\b(document|window|location|navigator|globalThis|fetch|localStorage|sessionStorage|addEventListener|setTimeout)\b/);
    const topLevel = code.split("\n").filter((line) => /^\S/.test(line));
    expect(topLevel.filter((line) => !/^(export |\}|\]\);)/.test(line))).toEqual([]);
  });

  it("holds every topic, under the topic's own label, and the company, each slug once with a label", async () => {
    const { SPACES, TOPICS } = await loading;
    for (const topic of TOPICS) expect(SPACES.find((space) => space.slug === topic.slug)?.label).toBe(topic.label);
    expect(SPACES.map((space) => space.slug)).toContain("company");
    expect(new Set(SPACES.map((space) => space.slug)).size).toBe(SPACES.length);
    for (const space of SPACES) expect(space.label).not.toBe("");
  });

  it("knows a space only by its exact slug", async () => {
    const { isSpace } = await loading;
    expect(["stigmer", "company", "videos", "capsjump", "other"].every((slug) => isSpace(slug))).toBe(true);
    expect(["Company", "", "inbox", "company "].some((slug) => isSpace(slug))).toBe(false);
  });
});

describe.each(SHARED_PAGES)("%s, as a shared link", (page) => {
  it("carries a description, a canonical address and a preview picture that exists", async () => {
    const doc = await parse(page);
    const description = doc.querySelectorAll('meta[name="description"]')[0];
    expect(description && attr(description, "content")).not.toBe("");
    const canonical = doc.querySelectorAll('link[rel="canonical"]')[0];
    const canonicalPath = new URL(canonical ? attr(canonical, "href") : "", ORIGIN);
    expect(canonicalPath.origin).toBe(ORIGIN);
    expect(resolveInternal(canonicalPath.pathname)).toEqual({ file: page });
    const image = doc.querySelectorAll('meta[property="og:image"]')[0];
    const imageUrl = new URL(image ? attr(image, "content") : "", ORIGIN);
    expect(imageUrl.origin).toBe(ORIGIN);
    expect(served).toContain(imageUrl.pathname.slice(1));
  });
});

describe("_headers", () => {
  const rules = parseHeaders(read("_headers"));

  it("sets exactly the expected headers on every path, the CSP allowing just the player's origin", () => {
    expect([...rules.keys()]).toEqual(["/*"]);
    expect(Object.fromEntries(rules.get("/*") ?? [])).toEqual(EXPECTED_HEADERS);
  });

  it("never asks for no-referrer", () => {
    const values = [...rules.values()].flatMap((headers) => [...headers.values()]);
    expect(values.filter((value) => value.includes("no-referrer"))).toEqual([]);
  });
});

describe("style.css", () => {
  const css = read("style.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const preludes = [...css.matchAll(/([^{}]+)\{/g)].map((m) => (m[1] ?? "").trim()).filter((p) => !p.startsWith("@"));

  it("has no class selector that no served page or script uses", async () => {
    const used = new Set<string>();
    for (const page of pages) {
      for (const el of (await parse(page)).querySelectorAll("[class]")) {
        for (const name of attr(el, "class").split(/\s+/)) used.add(name);
      }
    }
    // The note flow draws its sheet from a template in its script, and names the dialog's class there; the
    // threads build their elements with a helper that takes the class as an object key (`class: 't-row'`).
    for (const script of scripts) {
      for (const match of read(script).matchAll(/class(?:Name)?\s*[=:]\s*["']([^"'$]+)["']/g)) {
        for (const name of (match[1] ?? "").split(/\s+/)) used.add(name);
      }
    }
    const selected = new Set(preludes.flatMap((p) => [...p.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? "")));
    expect([...selected].filter((name) => !used.has(name))).toEqual([]);
  });

  it("has no custom property that nothing reads", () => {
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] ?? ""));
    const readProps = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? ""));
    expect([...defined].filter((name) => !readProps.has(name))).toEqual([]);
  });
});

describe("_redirects", () => {
  it("sends /inbox and everything under it to /threads/ for good, /me/, /meetings/ and /asks/ to their rooms, and nothing else", () => {
    const rules = read("_redirects")
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"))
      .map((line) => line.trim().split(/\s+/));
    expect(rules).toEqual([
      ["/inbox", "/threads/", "301"],
      ["/inbox/", "/threads/", "301"],
      ["/inbox/*", "/threads/", "301"],
      ["/me/", "/me", "301"],
      ["/meetings/", "/meetings", "301"],
      ["/asks/", "/asks", "301"],
    ]);
  });
});

describe("the threads page", () => {
  it("is never indexed, and carries nothing a shared link reads", async () => {
    const doc = await parse("threads/index.html");
    const robots = doc.querySelectorAll('meta[name="robots"]')[0];
    expect(robots && attr(robots, "content")).toBe("noindex");
    expect(doc.querySelectorAll('link[rel="canonical"], meta[property^="og:"], meta[name="description"]')).toEqual([]);
  });

  it("loads only its own script, whose calls reach the threads' calls and a public thread's, and nothing else of the site's", async () => {
    const loaded = (await parse("threads/index.html")).querySelectorAll('script[type="module"]').map((el) => attr(el, "src"));
    expect(loaded).toEqual(["/app/threads.js"]);
    const store = read("app/threads-store.js");
    expect(store).toContain("const API = '/threads/api';");
    const paths = [...store.matchAll(/`\$\{API\}(\/[^`?$]*)/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    // One fetch for the private calls, one for the public calls outside Access, which read a public thread
    // (src/public.ts) and an ask (src/asks.ts) and nothing else; a note or an answer is sent by the site's one note
    // sender (talk-send.js).
    expect(store.match(/fetch\(/g)).toHaveLength(2);
    expect(store).toContain("response = await fetch(path, { redirect: 'manual', credentials: 'omit'");
    expect([...store.matchAll(/readPublic\(`([^`]*)`/g)].map((m) => m[1])).toEqual(["/api/threads/${number}", "/api/asks/${encodeURIComponent(slug)}"]);
    for (const script of ["app/threads.js", "app/keys.js", "app/markdown.js"]) expect([script, read(script).includes("fetch(")]).toEqual([script, false]);
  });

  it("holds no form and no inline script or style, which the CSP would refuse", async () => {
    const doc = await parse("threads/index.html");
    expect(doc.querySelectorAll("form, [style]")).toEqual([]);
    expect(doc.querySelectorAll("script").filter((el) => !el.hasAttribute("src"))).toEqual([]);
  });
});

describe("the owner's email address", () => {
  // The repository is public, so address scrapers read it: the address lives in Planton and the GitHub
  // environment `production`, and the page learns it from the sign-in.
  const files = [
    ...served.filter((file) => !file.startsWith("img/")).map((file) => join(siteDir, file)),
    ...listFilesUnder(join(root, "src")),
    ...listFilesUnder(join(root, "tools")),
    ...listFilesUnder(join(root, "infrastructure")),
    join(root, "wrangler.jsonc"),
    join(root, "README.md"),
    join(root, "AGENTS.md"),
    join(root, ".github", "workflows", "site.yaml"),
  ];

  it.each(files.map((file) => relative(root, file)))("is not in %s", (file) => {
    expect(readFileSync(join(root, file), "utf8")).not.toMatch(/[\w.+-]+@gmail\.com/i);
  });
});

describe("wrangler.jsonc", () => {
  const text = readFileSync(join(root, "wrangler.jsonc"), "utf8");

  it("names the account by its 32-character id", () => {
    expect(text).toMatch(/"account_id": "[0-9a-f]{32}"/);
  });

  it("routes the apex, and only the apex, to the Worker", () => {
    expect(text).toContain('"routes": [{ "pattern": "whysosuresh.com/*", "zone_name": "whysosuresh.com" }]');
    expect(text.match(/"pattern"/g)).toHaveLength(1);
    expect(text).not.toContain("custom_domain");
  });

  it("runs the code only under /api/ and /threads/ and at the rooms (/me, /meetings, /people, /asks) and an ask's address, and every other page comes straight from site/", () => {
    expect(text).toContain('"run_worker_first": ["/api/*", "/threads/*", "/me", "/meetings", "/people", "/people/*", "/asks", "/ask/*"]');
    expect(text.match(/"run_worker_first"/g)).toHaveLength(1);
  });

  it("hands the threads page over through the assets binding the code names", () => {
    expect(text).toContain('"binding": "ASSETS"');
  });

  it("binds the database Planton created, by a real id", () => {
    const id = /"database_id": "([0-9a-f-]+)"/.exec(text)?.[1] ?? "";
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(id).not.toMatch(/^[0-]+$/);
  });

  it("keeps Cloudflare's automatic request records off", () => {
    expect(text).toContain('"observability": { "enabled": true, "logs": { "invocation_logs": false } }');
  });
});

describe("app/journal.js, which the Worker imports too", () => {
  it("is plain data and pure functions: it imports nothing, touches no page, reads no clock, and only declares exports", () => {
    const code = read("app/journal.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/^import /m);
    expect(code).not.toMatch(/\b(document|window|location|navigator|globalThis|fetch|localStorage|sessionStorage|addEventListener|setTimeout|performance)\b/);
    // Today is always given: the page makes it in the reader's zone, so the Worker never reckons a day by its own clock.
    expect(code).not.toMatch(/Date\.now|new Date\(\s*\)|Intl\./);
    const topLevel = code.split("\n").filter((line) => /^\S/.test(line));
    expect(topLevel.filter((line) => !/^(export |\}|\]\);)/.test(line))).toEqual([]);
  });
});
