// What arrives on the home page from outside (src/outside.ts, src/outside-store.ts), run as production runs it: the
// Worker's bundle in workerd with a local D1 and R2, its hourly run fired through Miniflare's trigger path, and every
// outside source played (test/harness.ts, the channel's feed made up in test/fixtures/youtube-feed.xml). What it
// holds: a run lists his full episodes, never a Short, and the newest release of each product, on the home page and in
// /feed.xml, merged by date with what he posted; every date is stored with Z and orders against a post's; every value
// is escaped and the watch address rebuilt from the id; a source that fails in any way (an error status, a hang, a
// body over its cap with or without a length, an answer that doesn't parse, entries none of which is valid, a release
// whose address leaves its repository) keeps its rows exactly, and the others still run; an episode the feed leaves
// out within its window leaves the list and the bucket, and an older one stays; a newer release replaces the older
// in place and is a new feed entry; a 404 for a release drops it; a release gives way to his post about it (a thread
// whose origin names its repository and tag) while that post is on the home page, and only then; pictures are copied once, again when the video's
// `updated` moves (a new address on the page), never when they aren't a JPEG or are too big, at most ten a run, and a
// picture with no row is deleted by the next run; `/thumbs/<id>.jpg` answers the picture with its headers and anything
// else the unknown path's 404; the run reaches only its three hosts; and a database that fails fails the run.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RELEASES, SITE, THUMB, YOUTUBE_FEED, releaseAnswer, startHarness, type Harness } from "./harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness({ triggers: true });
});
afterAll(async () => {
  await harness.dispose();
});
beforeEach(async () => {
  await harness.reset();
});

interface Row {
  id: string;
  kind: string;
  source: string;
  ref: string;
  title: string;
  url: string;
  published_at: string;
  updated_at: string | null;
  thumb: number;
}

async function rows(): Promise<Row[]> {
  return (await (await harness.db()).prepare("SELECT * FROM outside_items ORDER BY id").all<Row>()).results;
}

/** Fires the hourly run and expects it to end well. */
async function run(): Promise<void> {
  expect(await harness.scheduled()).toBe("ok");
}

/** The pictures in the bucket, by key. */
async function pictures(): Promise<string[]> {
  return (await (await harness.pages()).list({ prefix: "outside/" })).objects.map((object) => object.key).sort();
}

/** The picture addresses the run asked for, in order. */
function picturesAsked(): string[] {
  return harness.outside.asked.filter((asked) => asked.startsWith("picture:"));
}

/** The feed with one entry taken out, by its video id. */
function feedWithout(ref: string): string {
  return YOUTUBE_FEED.replace(new RegExp(`\\s*<entry>\\s*<id>yt:video:${ref}</id>[\\s\\S]*?</entry>`), "");
}

/** The home page's items, with each one's class. */
async function homeItems(): Promise<{ kind: string; markup: string; title: string }[]> {
  const page = await (await harness.fetch(`${SITE}/`)).text();
  return [...page.matchAll(/<li class="(item[^"]*)">([\s\S]*?)<\/li>/g)].map((match) => ({
    kind: match[1] ?? "",
    markup: match[2] ?? "",
    title: /<h3><a href="[^"]*">([\s\S]*?)<\/a><\/h3>/.exec(match[2] ?? "")?.[1] ?? "",
  }));
}

async function feedEntries(): Promise<string[]> {
  const feed = await (await harness.fetch(`${SITE}/feed.xml`)).text();
  return [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1] ?? "");
}

let posts = 0;

/** A call on the threads' private API, as the sync or the owner. */
async function send(path: string, as: "sync" | "owner", body: unknown): Promise<Record<string, unknown>> {
  const claims = as === "sync" ? harness.access.syncClaims() : harness.access.ownerClaims();
  const response = await harness.fetch(`${SITE}/threads/api/threads${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": harness.access.token(claims), Origin: SITE },
    body: new TextEncoder().encode(JSON.stringify(body)),
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

/** A private thread of his the sync drafts, with its origin. Answers its number. */
async function drafted(title: string, ref: string): Promise<number> {
  const made = await send("", "sync", { ref, source: "self", title, body: "Words.", space: "company", status: "act" });
  return (made.thread as { number: number }).number;
}

/** A thread of his own, made public and posted at `at`, as the owner does from Share. */
async function postedAt(title: string, at: string, ref?: string): Promise<number> {
  posts += 1;
  const number = await drafted(title, ref ?? `chat:outside-${posts}`);
  await send(`/${number}`, "owner", { action: "publish" });
  await send(`/${number}`, "owner", { action: "post" });
  await (await harness.db()).prepare("UPDATE threads SET feed_at = ?1 WHERE number = ?2").bind(at, number).run();
  return number;
}

/** The home page's titles, newest first. */
async function homeTitles(): Promise<string[]> {
  return (await homeItems()).map((item) => item.title);
}

/** The feed's entry ids, newest first. */
async function feedIds(): Promise<string[]> {
  return (await feedEntries()).map((entry) => /<id>([^<]*)<\/id>/.exec(entry)?.[1] ?? "");
}

describe("a run", () => {
  it("lists the full episodes, never the Shorts, and one release per product, on / and in /feed.xml, merged by date with his posts", async () => {
    const post = await postedAt("A post of his", "2026-11-02T00:00:00.000Z");
    await run();
    const items = await homeItems();
    expect(items.map((item) => [item.kind, item.title])).toEqual([
      ["item item-release", "Stigmer 0.1.2"],
      ["item item-video", "Fish &amp; chips: &#39;what&#39; &lt;b&gt;the feed&lt;/b&gt; said &quot;today&quot;"],
      ["item", "A post of his"],
      ["item item-video", "Episode three: the week in agents"],
      ["item item-video", "Episode two: what shipped"],
      ["item item-video", "Episode one: the pilot"],
      ["item item-release", "CapsJump 0.9.10"],
    ]);
    expect(items.map((item) => item.markup).join("")).not.toMatch(/SHORTCLIP|thirty seconds/i);
    expect(items[0]?.markup).toContain('<time class="when" datetime="2026-11-06T23:43:27.000Z">Nov 7</time>');
    expect(items[0]?.markup).toContain('<p class="meta"><span>Release</span><a href="https://github.com/stigmer/stigmer/releases/tag/v0.1.2">Release notes</a></p>');
    expect(items[1]?.markup).toContain('<p class="meta"><span>Video</span><a href="https://www.youtube.com/watch?v=EPISODE0004">Watch on YouTube</a></p>');

    const entries = await feedEntries();
    expect(entries.map((entry) => /<id>([^<]*)<\/id>/.exec(entry)?.[1])).toEqual([
      "tag:whysosuresh.com,2026:release/stigmer/stigmer/v0.1.2",
      "tag:whysosuresh.com,2026:video/EPISODE0004",
      `tag:whysosuresh.com,2026:thread-${post}`,
      "tag:whysosuresh.com,2026:video/EPISODE0003",
      "tag:whysosuresh.com,2026:video/EPISODE0002",
      "tag:whysosuresh.com,2026:video/EPISODE0001",
      "tag:whysosuresh.com,2026:release/whysosuresh/capsjump/v0.9.10",
    ]);
    expect(entries[1]).toContain('<link rel="alternate" type="text/html" href="https://www.youtube.com/watch?v=EPISODE0004"/>');
    expect(entries[1]).toContain("<title>Fish &amp; chips: &#39;what&#39; &lt;b&gt;the feed&lt;/b&gt; said &quot;today&quot;</title>");
    expect(entries[1]).not.toContain("<summary>");
    const feed = await (await harness.fetch(`${SITE}/feed.xml`)).text();
    expect(/<feed[^>]*>[\s\S]*?<updated>([^<]*)<\/updated>/.exec(feed)?.[1]).toBe("2026-11-06T23:43:27.000Z");
  });

  it("stores every date with Z, so a +00:00 date orders against a post's", async () => {
    await run();
    const episode = (await rows()).find((row) => row.ref === "EPISODE0004");
    expect([episode?.published_at, episode?.updated_at]).toEqual(["2026-11-03T14:00:05.000Z", "2026-11-04T02:11:40.000Z"]);
    await postedAt("Same day, later", "2026-11-03T14:00:06.000Z");
    expect((await homeItems()).slice(1, 3).map((item) => item.kind)).toEqual(["item", "item item-video"]);
  });

  it("writes every value as text and rebuilds the watch address from the id, never the feed's", async () => {
    harness.outside.youtube = { body: YOUTUBE_FEED.replace('href="https://www.youtube.com/watch?v=EPISODE0004"', 'href="https://www.youtube.com/watch?v=EPISODE0004&amp;x=&quot;&gt;&lt;script&gt;"') };
    await run();
    const page = await (await harness.fetch(`${SITE}/`)).text();
    expect(page).not.toContain("<b>the feed");
    expect(page).not.toContain("<script>");
    expect((await rows()).find((row) => row.ref === "EPISODE0004")?.url).toBe("https://www.youtube.com/watch?v=EPISODE0004");
  });

  it("names the site in its User-Agent, which GitHub requires, and reaches only its three hosts", async () => {
    await run();
    expect((await rows()).filter((row) => row.kind === "release").map((row) => row.title)).toEqual(["Stigmer 0.1.2", "CapsJump 0.9.10"]);
    expect([...harness.outboundHosts].sort()).toEqual(["api.github.com", "i.ytimg.com", "www.youtube.com"]);
  });

  it("ends well with every source failing, and fails when its database does", async () => {
    harness.outside.youtube = { status: 500 };
    harness.outside.releases.set("stigmer/stigmer", { status: 500 });
    harness.outside.releases.set("whysosuresh/capsjump", { status: 403 });
    await run();
    expect(await rows()).toEqual([]);
    const database = await harness.db();
    await database.prepare("ALTER TABLE outside_items RENAME TO outside_items_aside").run();
    try {
      harness.outside.reset();
      expect(await harness.scheduled()).not.toBe("ok");
    } finally {
      await database.prepare("ALTER TABLE outside_items_aside RENAME TO outside_items").run();
    }
  });
});

describe("a source that fails", () => {
  const big = `${YOUTUBE_FEED.replace("</feed>", "")}${"<!-- padding -->".repeat(40_000)}</feed>`;

  it.each([
    ["a 404", { status: 404 }],
    ["a 500", { status: 500 }],
    ["an answer that isn't a feed", { body: "<html><body>Something went wrong</body></html>" }],
    ["a feed whose entries are none of them valid", { body: YOUTUBE_FEED.replace(/<yt:videoId>[^<]*<\/yt:videoId>/g, "<yt:videoId>bad</yt:videoId>") }],
    ["a body over its cap", { body: big }],
    ["a body over its cap with no length", { body: big, stream: true }],
  ])("keeps the channel's rows exactly on %s, and the releases still run", async (_, failure) => {
    await run();
    const before = await rows();
    harness.outside.youtube = failure;
    harness.outside.releases.set("whysosuresh/capsjump", { body: releaseAnswer("whysosuresh/capsjump", "v0.9.11", "2026-11-10T08:00:00Z") });
    await run();
    const after = await rows();
    expect(after.filter((row) => row.kind === "video")).toEqual(before.filter((row) => row.kind === "video"));
    expect(after.find((row) => row.source === "whysosuresh/capsjump")?.title).toBe("CapsJump 0.9.11");
  });

  it("keeps the channel's rows when it hangs past the run's timeout", async () => {
    await run();
    const before = await rows();
    harness.outside.youtube = { hang: true };
    harness.outside.releases.set("stigmer/stigmer", { body: releaseAnswer("stigmer/stigmer", "v0.1.3", "2026-11-10T08:00:00Z") });
    await run();
    const after = await rows();
    expect(after.filter((row) => row.kind === "video")).toEqual(before.filter((row) => row.kind === "video"));
    expect(after.find((row) => row.source === "stigmer/stigmer")?.title).toBe("Stigmer 0.1.3");
  }, 30_000);

  it.each([
    ["a 500", { status: 500 }],
    ["GitHub's refusal", { status: 403, body: '{"message":"API rate limit exceeded"}' }],
    ["an answer that isn't JSON", { body: "<html>busy</html>" }],
    ["a release whose address leaves its repository", { body: releaseAnswer("stigmer/stigmer", "v0.1.3", "2026-11-10T08:00:00Z", { html_url: "https://github.com/someone-else/stigmer/releases/tag/v0.1.3" }) }],
    ["a tag that isn't printable", { body: releaseAnswer("stigmer/stigmer", "v0.1.3 <b>", "2026-11-10T08:00:00Z", { html_url: "https://github.com/stigmer/stigmer/releases/tag/v0.1.3%20%3Cb%3E" }) }],
    ["a release with no date", { body: releaseAnswer("stigmer/stigmer", "v0.1.3", "2026-11-10T08:00:00Z", { published_at: null }) }],
    ["a body over its cap", { body: `${RELEASES["stigmer/stigmer"]}${" ".repeat(600 * 1024)}`, stream: true }],
  ])("keeps a release's row exactly on %s, and the channel still runs", async (_, failure) => {
    await run();
    const before = await rows();
    harness.outside.releases.set("stigmer/stigmer", failure);
    harness.outside.youtube = { body: YOUTUBE_FEED.replace("Episode two: what shipped", "Episode two, retitled") };
    await run();
    const after = await rows();
    expect(after.find((row) => row.source === "stigmer/stigmer")).toEqual(before.find((row) => row.source === "stigmer/stigmer"));
    expect(after.find((row) => row.ref === "EPISODE0002")?.title).toBe("Episode two, retitled");
  });
});

describe("the mirror", () => {
  it("drops an episode the feed leaves out within its window, from the list and the bucket, and keeps an older one", async () => {
    await run();
    const database = await harness.db();
    await database
      .prepare("INSERT INTO outside_items (id, kind, source, ref, title, url, published_at, updated_at, thumb) VALUES ('video:OLDEPISODE1', 'video', 'UCkdfCh9gN60s_h_nfTYEwyg', 'OLDEPISODE1', 'An older episode', 'https://www.youtube.com/watch?v=OLDEPISODE1', '2026-10-01T14:00:00.000Z', '2026-10-01T14:00:00.000Z', 1)")
      .run();
    await (await harness.pages()).put("outside/OLDEPISODE1.jpg", THUMB, { httpMetadata: { contentType: "image/jpeg" } });
    harness.outside.youtube = { body: feedWithout("EPISODE0002") };
    await run();
    expect((await rows()).filter((row) => row.kind === "video").map((row) => row.ref)).toEqual(["EPISODE0001", "EPISODE0003", "EPISODE0004", "OLDEPISODE1"]);
    expect(await pictures()).toEqual(["outside/EPISODE0001.jpg", "outside/EPISODE0003.jpg", "outside/EPISODE0004.jpg", "outside/OLDEPISODE1.jpg"]);
    expect((await homeItems()).map((item) => item.title)).not.toContain("Episode two: what shipped");
  });

  it("keeps every row when the channel answers with no entry at all", async () => {
    await run();
    const before = await rows();
    harness.outside.youtube = { body: YOUTUBE_FEED.replace(/\s*<entry>[\s\S]*<\/entry>/, "") };
    await run();
    expect(await rows()).toEqual(before);
  });

  it("replaces a product's release with its newer one in place, a new entry in the feed", async () => {
    await run();
    harness.outside.releases.set("stigmer/stigmer", { body: releaseAnswer("stigmer/stigmer", "v0.1.3", "2026-11-10T08:00:00Z") });
    await run();
    const releases = (await rows()).filter((row) => row.source === "stigmer/stigmer");
    expect(releases.map((row) => [row.id, row.ref, row.title, row.url])).toEqual([["release:stigmer/stigmer", "v0.1.3", "Stigmer 0.1.3", "https://github.com/stigmer/stigmer/releases/tag/v0.1.3"]]);
    const ids = (await feedEntries()).map((entry) => /<id>([^<]*)<\/id>/.exec(entry)?.[1]);
    expect(ids).toContain("tag:whysosuresh.com,2026:release/stigmer/stigmer/v0.1.3");
    expect(ids).not.toContain("tag:whysosuresh.com,2026:release/stigmer/stigmer/v0.1.2");
  });

  it("drops a product's release when its repository has none any more", async () => {
    await run();
    harness.outside.releases.set("whysosuresh/capsjump", { status: 404, body: '{"message":"Not Found"}' });
    await run();
    expect((await rows()).filter((row) => row.kind === "release").map((row) => row.source)).toEqual(["stigmer/stigmer"]);
  });
});

describe("a release's post", () => {
  it("takes the release's place: once he posts a thread whose origin is the release, its row leaves / and the feed, and the other product's stays", async () => {
    await run();
    const post = await postedAt("Stigmer 0.1.2: what changed", "2026-11-07T09:00:00.000Z", "release:stigmer/stigmer/v0.1.2");
    expect(await homeTitles()).toEqual([
      "Stigmer 0.1.2: what changed",
      "Fish &amp; chips: &#39;what&#39; &lt;b&gt;the feed&lt;/b&gt; said &quot;today&quot;",
      "Episode three: the week in agents",
      "Episode two: what shipped",
      "Episode one: the pilot",
      "CapsJump 0.9.10",
    ]);
    const ids = await feedIds();
    expect(ids).toContain(`tag:whysosuresh.com,2026:thread-${post}`);
    expect(ids).not.toContain("tag:whysosuresh.com,2026:release/stigmer/stigmer/v0.1.2");
    expect(ids).toContain("tag:whysosuresh.com,2026:release/whysosuresh/capsjump/v0.9.10");
    // The mirror itself is untouched: only the read gives way.
    expect((await rows()).filter((row) => row.kind === "release").map((row) => row.ref)).toEqual(["v0.1.2", "v0.9.10"]);
  });

  it("gives way only while the post is listed: never for a draft or a public thread he hasn't posted, and again once he takes it off", async () => {
    await run();
    const number = await drafted("Stigmer 0.1.2: what changed", "release:stigmer/stigmer/v0.1.2");
    expect(await homeTitles()).toContain("Stigmer 0.1.2");
    await send(`/${number}`, "owner", { action: "publish" });
    expect(await homeTitles()).toContain("Stigmer 0.1.2");
    await send(`/${number}`, "owner", { action: "post" });
    expect(await homeTitles()).not.toContain("Stigmer 0.1.2");
    await send(`/${number}`, "owner", { action: "unpost" });
    expect(await homeTitles()).toContain("Stigmer 0.1.2");
    expect(await feedIds()).toContain("tag:whysosuresh.com,2026:release/stigmer/stigmer/v0.1.2");
  });

  it("names one release exactly: a post about an older tag or another product's never hides it", async () => {
    await run();
    await postedAt("Stigmer 0.1.1", "2026-11-06T12:00:00.000Z", "release:stigmer/stigmer/v0.1.1");
    await postedAt("CapsJump, the same tag", "2026-11-06T13:00:00.000Z", "release:whysosuresh/capsjump/v0.1.2");
    const titles = await homeTitles();
    expect(titles).toContain("Stigmer 0.1.2");
    expect(titles).toContain("CapsJump 0.9.10");
  });

  it("follows the newest release: a post about the release a newer one replaced hides nothing", async () => {
    await run();
    await postedAt("Stigmer 0.1.2: what changed", "2026-11-07T09:00:00.000Z", "release:stigmer/stigmer/v0.1.2");
    harness.outside.releases.set("stigmer/stigmer", { body: releaseAnswer("stigmer/stigmer", "v0.1.3", "2026-11-10T08:00:00Z") });
    await run();
    const titles = await homeTitles();
    expect(titles.slice(0, 2)).toEqual(["Stigmer 0.1.3", "Stigmer 0.1.2: what changed"]);
  });
});

describe("pictures", () => {
  it("are copied once into the bucket, as the JPEG they were, and drawn beside their video", async () => {
    await run();
    expect(picturesAsked().sort()).toEqual(["picture:EPISODE0001", "picture:EPISODE0002", "picture:EPISODE0003", "picture:EPISODE0004"]);
    expect(await pictures()).toEqual(["outside/EPISODE0001.jpg", "outside/EPISODE0002.jpg", "outside/EPISODE0003.jpg", "outside/EPISODE0004.jpg"]);
    const object = await (await harness.pages()).get("outside/EPISODE0004.jpg");
    expect(new Uint8Array((await object?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(THUMB);
    expect(object?.httpMetadata?.contentType).toBe("image/jpeg");
    const version = Math.floor(Date.parse("2026-11-04T02:11:40Z") / 1000);
    expect((await homeItems()).find((item) => item.kind === "item item-video")?.markup).toContain(
      `<a class="thumb" href="https://www.youtube.com/watch?v=EPISODE0004" tabindex="-1" aria-hidden="true"><img src="/thumbs/EPISODE0004.jpg?v=${version}" width="320" height="180" alt="" loading="lazy" decoding="async"></a>`,
    );
    harness.outside.asked.length = 0;
    await run();
    expect(picturesAsked()).toEqual([]);
  });

  it("are copied again when the video's updated moves, under a new address", async () => {
    await run();
    const before = (await homeItems()).find((item) => item.title.startsWith("Episode three"))?.markup ?? "";
    harness.outside.asked.length = 0;
    harness.outside.youtube = { body: YOUTUBE_FEED.replace("<updated>2026-11-01T20:00:00+00:00</updated>", "<updated>2026-11-05T08:00:00+00:00</updated>") };
    await run();
    expect(picturesAsked()).toEqual(["picture:EPISODE0003"]);
    const after = (await homeItems()).find((item) => item.title.startsWith("Episode three"))?.markup ?? "";
    expect(before).toContain(`/thumbs/EPISODE0003.jpg?v=${Math.floor(Date.parse("2026-11-01T20:00:00Z") / 1000)}`);
    expect(after).toContain(`/thumbs/EPISODE0003.jpg?v=${Math.floor(Date.parse("2026-11-05T08:00:00Z") / 1000)}`);
  });

  it("aren't kept when they aren't a JPEG, are too big or aren't there; the item shows without one, and the next run tries again", async () => {
    harness.outside.pictures.set("EPISODE0004", { body: "<html>not a picture</html>" });
    harness.outside.pictures.set("EPISODE0003", { body: new Uint8Array([0xff, 0xd8, 0xff, ...new Uint8Array(300 * 1024)]), stream: true });
    harness.outside.pictures.set("EPISODE0002", { status: 404 });
    await run();
    expect(await pictures()).toEqual(["outside/EPISODE0001.jpg"]);
    expect((await rows()).filter((row) => row.kind === "video").map((row) => [row.ref, row.thumb])).toEqual([
      ["EPISODE0001", 1],
      ["EPISODE0002", 0],
      ["EPISODE0003", 0],
      ["EPISODE0004", 0],
    ]);
    const shown = (await homeItems()).find((item) => item.kind === "item item-video");
    expect(shown?.markup).not.toContain('class="thumb"');
    expect(shown?.markup).not.toContain("<img");
    harness.outside.pictures.clear();
    harness.outside.asked.length = 0;
    await run();
    expect(picturesAsked().sort()).toEqual(["picture:EPISODE0002", "picture:EPISODE0003", "picture:EPISODE0004"]);
    expect((await pictures()).length).toBe(4);
  });

  it("are copied at most ten a run, newest first", async () => {
    const entry = /\s*<entry>\s*<id>yt:video:EPISODE0001<\/id>[\s\S]*?<\/entry>/.exec(YOUTUBE_FEED)?.[0] ?? "";
    const more = Array.from({ length: 8 }, (_, i) => {
      const ref = `EXTRAEPI${String(i).padStart(3, "0")}`;
      return entry.replaceAll("EPISODE0001", ref).replaceAll("2026-10-29T", `2026-10-${String(10 + i).padStart(2, "0")}T`);
    }).join("");
    harness.outside.youtube = { body: YOUTUBE_FEED.replace("</feed>", `${more}\n</feed>`) };
    await run();
    expect(picturesAsked()).toHaveLength(10);
    expect(picturesAsked().slice(0, 4).sort()).toEqual(["picture:EPISODE0001", "picture:EPISODE0002", "picture:EPISODE0003", "picture:EPISODE0004"]);
    harness.outside.asked.length = 0;
    await run();
    expect(picturesAsked()).toEqual(["picture:EXTRAEPI001", "picture:EXTRAEPI000"]);
  });

  it("with no row are deleted by the next run", async () => {
    await (await harness.pages()).put("outside/ORPHANVIDEO.jpg", THUMB, { httpMetadata: { contentType: "image/jpeg" } });
    await (await harness.pages()).put("journal/kept.jpg", THUMB, { httpMetadata: { contentType: "image/jpeg" } });
    await run();
    expect(await pictures()).not.toContain("outside/ORPHANVIDEO.jpg");
    expect((await (await harness.pages()).list()).objects.map((object) => object.key)).toContain("journal/kept.jpg");
  });
});

describe("/thumbs/<id>.jpg", () => {
  it("answers a copied picture's bytes, public and cached for good, with or without its version", async () => {
    await run();
    for (const path of ["/thumbs/EPISODE0004.jpg", "/thumbs/EPISODE0004.jpg?v=1762222300"]) {
      const response = await harness.fetch(`${SITE}${path}`);
      expect(response.status).toBe(200);
      expect(Object.fromEntries(["content-type", "content-length", "cache-control", "x-content-type-options", "content-security-policy"].map((name) => [name, response.headers.get(name)]))).toEqual({
        "content-type": "image/jpeg",
        "content-length": String(THUMB.byteLength),
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      });
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(THUMB);
    }
    const head = await harness.fetch(`${SITE}/thumbs/EPISODE0004.jpg`, { method: "HEAD" });
    expect([head.status, head.headers.get("content-length"), await head.text()]).toEqual([200, String(THUMB.byteLength), ""]);
  });

  it.each([
    ["an id of the wrong shape", "GET", "/thumbs/short.jpg"],
    ["a picture never copied", "GET", "/thumbs/AAAAAAAAAAA.jpg"],
    ["a nested path", "GET", "/thumbs/x/EPISODE0004.jpg"],
    ["another extension", "GET", "/thumbs/EPISODE0004.png"],
    ["a POST", "POST", "/thumbs/EPISODE0004.jpg"],
  ])("answers %s with the unknown path's 404", async (_, method, path) => {
    await run();
    const response = await harness.fetch(`${SITE}${path}`, { method });
    expect([response.status, response.headers.get("cache-control"), await response.text()]).toEqual([404, "no-store", '{"reason":"not-found"}']);
  });
});
