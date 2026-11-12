// The home page's feed (src/home.ts), run as production runs it: the Worker's bundle in workerd with a local D1, in
// front of site/ with the routing wrangler.jsonc declares (test/harness.ts). What it holds: posting a thread on the
// home page and taking it off are moves of the owner's alone, each with its event, only for a public thread (409
// `not-public`), and unpublishing takes a thread off; the home page shows the posted public threads newest first, the
// newest ten, with "All updates" under them only when there are more, each with its title or number, its first block as plain text, its day in his zone and its notes above
// zero, every value as text, and linked at its link, by its key, on the threads' host (hey.whysosuresh.com), or its
// `?full` link when its main section is a page, so a reader lands on the page full screen, its feed entry's id still
// the thread's number; a thread that isn't posted, isn't public or isn't his never shows, even when its row is
// changed by hand; the Now line shows and an empty newest line hides it; an item from outside alone (a video or a
// release, test/outside.test.ts) shows the list too; with nothing to show (no post, no outside item, no Now line), or
// a failing read, the page is site/index.html byte for byte, and a rewritten one carries the site's headers and no ETag; /feed.xml is an
// Atom feed of the same items, the newest twenty, escaped, and a valid empty one with nothing posted; /updates lists
// every item in the same markup, says "Nothing here yet." with none, and answers 503 with no list while the read fails; the Now line's call is the owner's
// alone, both ways, from his own page, one line of at most 140 characters, every line kept; and a stranger reading a
// posted thread never learns it is posted.

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SITE, THREADS, startHarness, type Harness } from "./harness.ts";

/** The most the home page and the feed show, and the longest Now line: the contract, stated here. */
const HOME_LIMIT = 10;
const FEED_LIMIT = 20;
const MAX_NOW = 140;
const MEERA = "meera@example.com";
const INDEX = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});
afterAll(async () => {
  await harness.dispose();
});
beforeEach(async () => {
  await harness.reset();
});

type Who = "owner" | "sync" | { readonly email: string };

function token(as: Who): string {
  if (as === "owner") return harness.access.token(harness.access.ownerClaims());
  if (as === "sync") return harness.access.token(harness.access.syncClaims());
  return harness.access.token(harness.access.memberClaims(as.email));
}

/** A private call under /threads/api/, by its path after that: a GET without a body, else a POST of it as JSON. */
async function call(path: string, request: { as?: Who; body?: unknown; raw?: string; origin?: string | null; method?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": token(request.as ?? "owner") };
  const text = request.raw ?? (request.body === undefined ? undefined : JSON.stringify(request.body));
  if (text === undefined) return harness.fetch(`${THREADS}/threads/api${path}`, { method: request.method ?? "GET", headers });
  headers["Content-Type"] = "application/json";
  if (request.origin !== null) headers.Origin = request.origin ?? THREADS;
  return harness.fetch(`${THREADS}/threads/api${path}`, { method: request.method ?? "POST", headers, body: new TextEncoder().encode(text) });
}

async function answer<T>(response: Response, status = 200): Promise<T> {
  const text = await response.text();
  expect([response.status, text]).toEqual([status, expect.any(String)]);
  return JSON.parse(text) as T;
}

async function reasonOf(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { reason: string }).reason];
}

let refs = 0;
/** A thread the sync adds: his own unless told otherwise. Answers its number. */
async function thread(fields: Record<string, unknown> = {}): Promise<number> {
  refs += 1;
  const body = { ref: `chat:home-${refs}`, source: "self", title: `Thread ${refs}`, body: `Body ${refs}`, space: "company", status: "act", ...fields };
  return (await answer<{ thread: { number: number } }>(await call("/threads", { as: "sync", body }), 201)).thread.number;
}

async function move(number: number, action: string, as: Who = "owner"): Promise<Response> {
  return call(`/threads/${number}`, { as, body: { action } });
}

interface Moved {
  thread: { publicAt: string | null; feedAt: string | null; status: string };
}

/** A thread of his own, made public and posted on the home page. Answers its number. */
/** A thread's link key, as the home page links it; empty for a thread never made public. */
async function keyOf(number: number | undefined): Promise<string> {
  const row = await (await harness.db()).prepare("SELECT share_key FROM threads WHERE number = ?1").bind(number ?? 0).first<{ share_key: string | null }>();
  return row?.share_key ?? "";
}

async function posted(fields: Record<string, unknown> = {}): Promise<number> {
  const n = await thread(fields);
  await answer(await move(n, "publish"));
  await answer(await move(n, "post"));
  return n;
}

/** A thread of his own whose main section is a small page the sync saved, made public and posted. Answers its number. */
async function postedPage(fields: Record<string, unknown> = {}): Promise<number> {
  const n = await thread(fields);
  const html = new TextEncoder().encode("<!doctype html><title>A story</title><h1>A story</h1><p>What happened.</p>");
  await answer(
    await harness.fetch(`${THREADS}/threads/api/threads/${n}/pages`, {
      method: "POST",
      headers: { "Content-Type": "text/html; charset=utf-8", "Cf-Access-Jwt-Assertion": token("sync") },
      body: html,
    }),
    201,
  );
  await answer(await move(n, "publish"));
  await answer(await move(n, "post"));
  return n;
}

/** `count` posted threads, "Post 0" oldest, a minute apart. Answers their numbers, oldest first. */
async function postedMany(count: number): Promise<number[]> {
  const numbers: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const n = await posted({ title: `Post ${i}` });
    await postedAt(n, new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString());
    numbers.push(n);
  }
  return numbers;
}

/** The titles of the newest `shown` of `count` posts `postedMany` made, newest first. */
function newestTitles(count: number, shown: number): string[] {
  return Array.from({ length: shown }, (_, i) => `Post ${count - 1 - i}`);
}

async function updates(init: RequestInit = {}): Promise<Response> {
  return harness.fetch(`${SITE}/updates`, init);
}

/** Sets a thread's posting time by hand, so the order and the day are the test's to choose. */
async function postedAt(number: number, at: string): Promise<void> {
  await (await harness.db()).prepare("UPDATE threads SET feed_at = ?1 WHERE number = ?2").bind(at, number).run();
}

async function home(init: RequestInit = {}): Promise<Response> {
  return harness.fetch(`${SITE}/`, init);
}

/** The home page's items, as the Worker wrote them: each `<li>`'s markup. */
function itemsOf(page: string): string[] {
  return [...page.matchAll(/<li class="item">([\s\S]*?)<\/li>/g)].map((match) => match[1] ?? "");
}

/** An item's title, as its heading's link holds it. */
function titleOf(item: string): string {
  return /<h3><a href="[^"]*">([\s\S]*?)<\/a><\/h3>/.exec(item)?.[1] ?? "";
}

async function setNow(text: string, as: Who = "owner"): Promise<Response> {
  return call("/now", { as, body: { text } });
}

describe("posting a thread on the home page", () => {
  it("is a move of his on a public thread, with its event, leaving its status and its public state alone, and taken back by unpost", async () => {
    const n = await thread();
    await answer(await move(n, "publish"));
    const made = await answer<Moved>(await move(n, "post"));
    expect(made.thread.feedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(made.thread.publicAt).not.toBeNull();
    expect(made.thread.status).toBe("act");
    const back = await answer<Moved>(await move(n, "unpost"));
    expect(back.thread.feedAt).toBeNull();
    expect(back.thread.publicAt).not.toBeNull();
    const view = await answer<{ events: { type: string; actor: string }[] }>(await call(`/threads/${n}`));
    expect(view.events.map((event) => [event.type, event.actor])).toEqual([
      ["created", "sync"],
      ["published", "owner"],
      ["posted", "owner"],
      ["unposted", "owner"],
    ]);
  });

  it("is refused to the sync and to an invited person before anything is read", async () => {
    const n = await thread();
    await answer(await move(n, "publish"));
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    expect(await reasonOf(await move(n, "post", "sync"))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await move(999, "post", "sync"))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await move(n, "post", { email: MEERA }))).toEqual([403, "owner-only"]);
    await answer(await move(n, "post"));
    expect(await reasonOf(await move(n, "unpost", "sync"))).toEqual([403, "owner-only"]);
    expect(await reasonOf(await move(n, "unpost", { email: MEERA }))).toEqual([403, "owner-only"]);
  });

  it("refuses a thread that isn't public with not-public, and a move from where it can't start with not-from-here, writing nothing", async () => {
    const n = await thread();
    expect(await reasonOf(await move(n, "post"))).toEqual([409, "not-public"]);
    const told = await thread({ source: "told", name: "Dev" });
    expect(await reasonOf(await move(told, "post"))).toEqual([409, "not-public"]);
    expect(await reasonOf(await move(n, "unpost"))).toEqual([409, "not-from-here"]);
    await answer(await move(n, "publish"));
    await answer(await move(n, "post"));
    expect(await reasonOf(await move(n, "post"))).toEqual([409, "not-from-here"]);
    expect(await reasonOf(await move(999, "post"))).toEqual([404, "no-thread"]);
    const view = await answer<{ events: { type: string }[] }>(await call(`/threads/${n}`));
    expect(view.events.map((event) => event.type)).toEqual(["created", "published", "posted"]);
  });

  it("ends when the thread stops being public, and doesn't come back when it is made public again", async () => {
    const n = await posted();
    const back = await answer<Moved>(await move(n, "unpublish"));
    expect(back.thread.feedAt).toBeNull();
    const again = await answer<Moved>(await move(n, "publish"));
    expect(again.thread.feedAt).toBeNull();
    expect(itemsOf(await (await home()).text())).toEqual([]);
  });

  it("is never told to a stranger reading the thread", async () => {
    const n = await posted();
    const read = await answer<{ thread: Record<string, unknown> }>(await harness.fetch(`${THREADS}/api/threads/${await keyOf(n)}`));
    expect(Object.keys(read.thread)).not.toContain("feedAt");
    expect(JSON.stringify(read)).not.toMatch(/feed/i);
  });
});

describe("the home page", () => {
  it("is site/index.html byte for byte, its ETag kept, while nothing is posted, nothing came from outside and there is no Now line", async () => {
    await thread();
    expect(await (await harness.db()).prepare("SELECT COUNT(*) AS n FROM outside_items").first<{ n: number }>()).toEqual({ n: 0 });
    const response = await home();
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).not.toBeNull();
    expect(await response.text()).toBe(INDEX);
  });

  it("shows an item from outside with nothing posted and no Now line, the list shown and the Now line still hidden", async () => {
    await (await harness.db())
      .prepare("INSERT INTO outside_items (id, kind, source, ref, title, url, published_at) VALUES ('release:stigmer/stigmer', 'release', 'stigmer/stigmer', 'v0.1.2', 'Stigmer 0.1.2', 'https://github.com/stigmer/stigmer/releases/tag/v0.1.2', '2026-11-06T23:43:27.000Z')")
      .run();
    const response = await home();
    expect(response.headers.get("etag")).toBeNull();
    const page = await response.text();
    expect(page).toMatch(/<section class="home-main" aria-labelledby="happening" data-feed>/);
    expect(page).toContain('<p class="now" data-now hidden>');
    expect(page).toContain('<li class="item item-release"><time class="when" datetime="2026-11-06T23:43:27.000Z">Nov 7</time>');
    expect(itemsOf(page)).toEqual([]);
  });

  it("shows the newest ten posted public threads, then All updates, the feed the newest twenty and /updates every one, with the site's headers and no ETag", async () => {
    const count = FEED_LIMIT + 1;
    const numbers = await postedMany(count);
    const response = await home();
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("last-modified")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain("style-src 'self'");
    const page = await response.text();
    const items = itemsOf(page);
    expect(items.map(titleOf)).toEqual(newestTitles(count, HOME_LIMIT));
    expect(items[0]).toContain(`href="${THREADS}/threads/${await keyOf(numbers[count - 1])}"`);
    expect(page).toMatch(/<section class="home-main" aria-labelledby="happening" data-feed>/);
    expect(page).toContain('<p class="more" data-feed-more><a href="/updates">All updates</a></p>');
    expect(page).not.toMatch(/style="/);

    const feed = await (await harness.fetch(`${SITE}/feed.xml`)).text();
    expect([...feed.matchAll(/<title>(Post \d+)<\/title>/g)].map((match) => match[1])).toEqual(newestTitles(count, FEED_LIMIT));

    const all = await updates();
    expect(all.status).toBe(200);
    expect(all.headers.get("etag")).toBeNull();
    expect(all.headers.get("content-security-policy")).toContain("style-src 'self'");
    const allPage = await all.text();
    expect(itemsOf(allPage).map(titleOf)).toEqual(newestTitles(count, count));
    expect(allPage).toContain('<p class="fine" data-updates-empty hidden>Nothing here yet.</p>');
  });

  it("leaves All updates hidden while everything listed fits on the page", async () => {
    await postedMany(HOME_LIMIT);
    const page = await (await home()).text();
    expect(itemsOf(page)).toHaveLength(HOME_LIMIT);
    expect(page).toContain('<p class="more" data-feed-more hidden><a href="/updates">All updates</a></p>');
  });

  it("links a posted page's title and Read to its full-screen address, and a posted text thread to its own, both on the threads' host", async () => {
    const story = await postedPage({ title: "A story" });
    await postedAt(story, "2026-11-06T09:00:00.000Z");
    const text = await posted({ title: "Plain" });
    await postedAt(text, "2026-11-05T09:00:00.000Z");
    const items = itemsOf(await (await home()).text());
    expect(items.map(titleOf)).toEqual(["A story", "Plain"]);
    const links = items.map((item) => [...item.matchAll(/<a href="([^"]*)">/g)].map((match) => match[1]));
    const [storyKey, textKey] = [await keyOf(story), await keyOf(text)];
    expect(links).toEqual([
      [`${THREADS}/threads/${storyKey}?full`, `${THREADS}/threads/${storyKey}?full`],
      [`${THREADS}/threads/${textKey}`, `${THREADS}/threads/${textKey}`],
    ]);
  });

  it("never shows a thread that isn't posted, isn't public or isn't his, even with its row changed by hand", async () => {
    await thread({ title: "Private" });
    const publicOnly = await thread({ title: "Public, not posted" });
    await answer(await move(publicOnly, "publish"));
    const invited = await thread({ title: "Invited only" });
    await answer(await call(`/threads/${invited}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    const told = await thread({ title: "Told", source: "told", name: "Dev" });
    const hand = await harness.db();
    await hand.prepare("UPDATE threads SET feed_at = '2026-11-06T00:00:00.000Z' WHERE number IN (?1, ?2)").bind(invited, told).run();
    // With a key and its number open, as the migration leaves a thread public before keys: still not his words.
    await hand.prepare("UPDATE threads SET public_at = '2026-11-06T00:00:00.000Z', share_key = printf('%032x', number), public_by_number = 1 WHERE number = ?1").bind(told).run();
    const shownOne = await posted({ title: "Shown" });
    const page = await (await home()).text();
    expect(itemsOf(page).map(titleOf)).toEqual(["Shown"]);
    expect(page).toContain(`${THREADS}/threads/${await keyOf(shownOne)}`);
  });

  it("writes every value as text: a title with markup and quotes, and a thread with no title as its number", async () => {
    await posted({ title: `<script>alert("x")</script> & 'quotes'`, body: "<img src=x onerror=alert(1)> **bold** and [a link](https://example.com)." });
    const untitled = await posted();
    await (await harness.db()).prepare("UPDATE threads SET title = NULL WHERE number = ?1").bind(untitled).run();
    const page = await (await home()).text();
    const items = itemsOf(page);
    expect(items.map(titleOf)).toEqual([`#${untitled}`, "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;"]);
    expect(page).not.toContain("<script>alert");
    expect(page).not.toContain("<img src=x");
    expect(items[1]).toContain("<p>&lt;img src=x onerror=alert(1)&gt; bold and a link.</p>");
  });

  it("shows the main text's first block as plain text, never the living summary, cut at a space past 280 characters", async () => {
    const long = `${"word ".repeat(80)}end`;
    const n = await posted({ body: `${long}\n\nThe second paragraph.` });
    await answer(await call(`/threads/${n}/text`, { body: { field: "summary", text: "**Decided:** private grid" } }));
    const [item = ""] = itemsOf(await (await home()).text());
    const excerpt = /<p>([^<]*)<\/p>/.exec(item)?.[1] ?? "";
    expect(excerpt.length).toBeLessThanOrEqual(280);
    expect(excerpt).toMatch(/^word word .* word…$/);
    expect(item).not.toContain("Decided");
    expect(item).not.toContain("second paragraph");
  });

  it("counts a stranger's notes under it, never an answer to its page or a reply, and says nothing at zero", async () => {
    const quiet = await posted({ title: "Quiet" });
    const busy = await posted({ title: "Busy" });
    await postedAt(quiet, "2026-11-01T00:00:00.000Z");
    const database = await harness.db();
    const id = (await database.prepare("SELECT id FROM threads WHERE number = ?1").bind(busy).first<{ id: string }>())?.id;
    const comment = (cid: string, extra: string, values: string): Promise<unknown> =>
      database.prepare(`INSERT INTO comments (id, thread_id, author, body, created_at, audience, state${extra}) VALUES (?1, ?2, 'visitor', 'Hi', '2026-11-06T00:00:00.000Z', ${values})`).bind(cid, id).run();
    await comment("n1", "", "'public', 'shown'");
    await comment("n2", "", "'public', 'shown'");
    await comment("n3", "", "'public', 'dropped'");
    await comment("n4", "", "'thread', 'shown'");
    await comment("n5", ", parent_id", "'public', 'shown', 'n1'");
    await comment("n6", ", question", "'public', 'shown', 'q1'");
    const items = itemsOf(await (await home()).text());
    expect(items.map(titleOf)).toEqual(["Busy", "Quiet"]);
    expect(items[0]).toContain("<span>2 notes</span>");
    expect(items[1]).not.toMatch(/note/);
  });

  it("dates each item by the day in his zone, with the year only when it isn't this one", async () => {
    const evening = await posted({ title: "Evening in California" });
    await postedAt(evening, "2026-11-06T20:00:00.000Z");
    const old = await posted({ title: "Last year" });
    await postedAt(old, "2025-03-02T12:00:00.000Z");
    const items = itemsOf(await (await home()).text());
    expect(items[0]).toContain('<time class="when" datetime="2026-11-06T20:00:00.000Z">Nov 7</time>');
    expect(items[1]).toContain('<time class="when" datetime="2025-03-02T12:00:00.000Z">Mar 2, 2025</time>');
  });

  it("shows the Now line as text, alone when nothing is posted, and hides it again when the newest line is empty", async () => {
    await answer(await setNow(`Getting <b>Stigmer</b> 0.1 into teams' hands`));
    const page = await (await home()).text();
    expect(page).toContain(`<p class="now" data-now><b>Now</b> <span data-now-text>Getting &lt;b&gt;Stigmer&lt;/b&gt; 0.1 into teams' hands</span></p>`);
    expect(page).toMatch(/<section class="home-main" aria-labelledby="happening" data-feed hidden>/);
    await answer(await setNow(""));
    expect(await (await home()).text()).toBe(INDEX);
  });

  it("answers a HEAD as it answers a GET, with no body", async () => {
    await posted();
    const head = await home({ method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toContain("text/html");
    expect(head.headers.get("etag")).toBeNull();
    expect(await head.text()).toBe("");
  });

  it("is site/index.html byte for byte when the read fails", async () => {
    await posted();
    const database = await harness.db();
    await database.prepare("ALTER TABLE now_lines RENAME TO now_lines_aside").run();
    try {
      const response = await home();
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(INDEX);
      expect((await harness.fetch(`${SITE}/feed.xml`)).status).toBe(503);
    } finally {
      await database.prepare("ALTER TABLE now_lines_aside RENAME TO now_lines").run();
    }
  });
});

describe("/updates", () => {
  it("says there is nothing yet while nothing is listed, with no list", async () => {
    const response = await updates();
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(itemsOf(page)).toEqual([]);
    expect(page).toContain('<p class="fine" data-updates-empty>Nothing here yet.</p>');
  });

  it("lists every item in the home page's markup, every value as text", async () => {
    const n = await posted({ title: `<b>"Bold" & 'quoted'</b>` });
    await postedAt(n, "2026-11-06T09:00:00.000Z");
    const homeItems = itemsOf(await (await home()).text());
    const items = itemsOf(await (await updates()).text());
    expect(items).toEqual(homeItems);
    expect(items[0]).toContain("&lt;b&gt;&quot;Bold&quot; &amp; &#39;quoted&#39;&lt;/b&gt;");
  });

  it("answers 503 with no list and no claim that nothing is there while the read fails, kept by nobody", async () => {
    await posted();
    const database = await harness.db();
    await database.prepare("ALTER TABLE now_lines RENAME TO now_lines_aside").run();
    try {
      const response = await updates();
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("300");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const page = await response.text();
      expect(itemsOf(page)).toEqual([]);
      expect(page).toContain('<p class="fine" data-updates-empty hidden>Nothing here yet.</p>');
    } finally {
      await database.prepare("ALTER TABLE now_lines_aside RENAME TO now_lines").run();
    }
  });

  it("answers a HEAD as it answers a GET, with no body", async () => {
    await posted();
    const response = await updates({ method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});

describe("/feed.xml", () => {
  it("is a valid empty Atom feed while nothing is posted, cached five minutes and kept out of search", async () => {
    const response = await harness.fetch(`${SITE}/feed.xml`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/atom+xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    const feed = await response.text();
    expect(feed).toMatch(/^<\?xml version="1\.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">\n/);
    for (const element of ["title", "id", "updated", "author"]) expect(feed).toContain(`<${element}>`);
    expect(feed).toContain(`<link rel="self" type="application/atom+xml" href="${SITE}/feed.xml"/>`);
    expect(feed).not.toContain("<entry>");
  });

  it("carries the home page's items, newest first, each with a lasting id, its address, its day and its excerpt, escaped", async () => {
    const first = await posted({ title: "First", body: "Plain words." });
    await postedAt(first, "2026-11-05T09:00:00.000Z");
    const second = await posted({ title: `Fish & <chips> "today"`, body: "A < b & c." });
    await postedAt(second, "2026-11-06T09:00:00.000Z");
    const feed = await (await harness.fetch(`${SITE}/feed.xml`)).text();
    const entries = [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1] ?? "");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain(`<id>tag:whysosuresh.com,2026:thread-${second}</id>`);
    expect(entries[0]).toContain("<title>Fish &amp; &lt;chips&gt; &quot;today&quot;</title>");
    expect(entries[0]).toContain("<summary>A &lt; b &amp; c.</summary>");
    expect(entries[0]).toContain(`<link rel="alternate" type="text/html" href="${THREADS}/threads/${await keyOf(second)}"/>`);
    expect(entries[0]).toContain("<updated>2026-11-06T09:00:00.000Z</updated>");
    expect(entries[1]).toContain(`<id>tag:whysosuresh.com,2026:thread-${first}</id>`);
    expect(feed).toMatch(/<\/author>\n {2}<entry>/);
    expect(/<feed[^>]*>[\s\S]*?<updated>([^<]*)<\/updated>/.exec(feed)?.[1]).toBe("2026-11-06T09:00:00.000Z");
  });

  it("links a posted page's entry to its full-screen address, its id still the thread's, and a text entry to its own", async () => {
    const story = await postedPage({ title: "A story" });
    await postedAt(story, "2026-11-06T09:00:00.000Z");
    const text = await posted({ title: "Plain" });
    await postedAt(text, "2026-11-05T09:00:00.000Z");
    const feed = await (await harness.fetch(`${SITE}/feed.xml`)).text();
    const entries = [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1] ?? "");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain(`<id>tag:whysosuresh.com,2026:thread-${story}</id>`);
    expect(entries[0]).toContain(`<link rel="alternate" type="text/html" href="${THREADS}/threads/${await keyOf(story)}?full"/>`);
    expect(entries[1]).toContain(`<id>tag:whysosuresh.com,2026:thread-${text}</id>`);
    expect(entries[1]).toContain(`<link rel="alternate" type="text/html" href="${THREADS}/threads/${await keyOf(text)}"/>`);
  });

  it("answers only GET and HEAD", async () => {
    const response = await harness.fetch(`${SITE}/feed.xml`, { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    const head = await harness.fetch(`${SITE}/feed.xml`, { method: "HEAD" });
    expect([head.status, await head.text()]).toEqual([200, ""]);
  });
});

describe("the Now line's call", () => {
  it("is read and set by the owner from his page, trimmed, every line kept, and an empty one takes the line off", async () => {
    expect(await answer(await call("/now"))).toEqual({ now: null });
    const set = await answer<{ now: { text: string; setAt: string } }>(await setNow("  Shipping 0.1  "));
    expect(set.now.text).toBe("Shipping 0.1");
    expect(await answer(await call("/now"))).toEqual(set);
    await answer(await setNow("Getting it into teams' hands"));
    expect(await answer(await setNow(""))).toEqual({ now: null });
    expect(await answer(await call("/now"))).toEqual({ now: null });
    const kept = (await (await harness.db()).prepare("SELECT text FROM now_lines ORDER BY id").all<{ text: string }>()).results;
    expect(kept.map((row) => row.text)).toEqual(["Shipping 0.1", "Getting it into teams' hands", ""]);
  });

  it("is refused to the sync and to an invited person, both ways, before anything is read or written", async () => {
    const n = await thread();
    await answer(await call(`/threads/${n}/people`, { body: { add: { email: MEERA, name: "Meera" } } }));
    for (const as of ["sync", { email: MEERA }] as const) {
      expect(await reasonOf(await call("/now", { as }))).toEqual([403, "owner-only"]);
      expect(await reasonOf(await setNow("Not theirs", as))).toEqual([403, "owner-only"]);
    }
    expect((await (await harness.db()).prepare("SELECT COUNT(*) AS n FROM now_lines").first<{ n: number }>())?.n).toBe(0);
  });

  it("takes the owner's line only from his own page, as one line of at most 140 characters, and nothing else", async () => {
    expect(await reasonOf(await call("/now", { body: { text: "From elsewhere" }, origin: "https://example.com" }))).toEqual([403, "origin"]);
    expect(await reasonOf(await call("/now", { body: { text: "No origin" }, origin: null }))).toEqual([403, "origin"]);
    for (const body of [{ text: "x".repeat(MAX_NOW + 1) }, { text: "two\nlines" }, { text: 7 }, { text: "x", extra: 1 }, {}, ["x"]]) {
      expect([body, await reasonOf(await call("/now", { body }))]).toEqual([body, [400, "now"]]);
    }
    expect(await reasonOf(await call("/now", { raw: "{not json" }))).toEqual([400, "now"]);
    await answer(await setNow("x".repeat(MAX_NOW)));
    expect(await reasonOf(await call("/now", { body: { text: "x" }, method: "PUT" }))).toEqual([405, "method"]);
    expect((await (await harness.db()).prepare("SELECT COUNT(*) AS n FROM now_lines").first<{ n: number }>())?.n).toBe(1);
  });
});
