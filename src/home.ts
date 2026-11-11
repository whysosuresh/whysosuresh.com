// The home page's feed: what Suresh posts, and what arrives from outside on its own (his full YouTube episodes and the
// newest Stigmer and CapsJump releases, src/outside.ts), written into the site's own home page as one newest-first
// list, and the same items as an Atom feed at /feed.xml; and his Now line, the one line under his greeting, which he
// sets from Today through a private call.
//
// `/` is site/index.html, handed over from the site's own files through the assets binding, so it carries
// site/_headers (the CSP among them) exactly as the file served straight from site/ would. The Worker reads the
// newest posted threads, the newest outside items and the Now line in one batch (`homeFeed`, src/store.ts), merges
// the two lists by date (`merged`), and writes them in with `HTMLRewriter`: the Now line as text into
// `[data-now-text]`, and each item as markup built here, in which every value (title, excerpt, date, address, count)
// goes through `attribute`, which escapes all five characters, so it is safe as text and inside an attribute alike.
// The items carry classes only, never a `style` attribute, which the CSP's `style-src 'self'` would refuse. The
// sections the feed fills are `hidden` in the file, and the rewrite shows each one only when it has something to show;
// with no post, no outside item and no Now line, or when the read fails, the answer is the file byte for byte, its
// ETag included, so a deploy before anything is listed changes nothing anyone sees. A rewritten
// answer is fetched without the browser's conditional headers and answered without an ETag, as a public thread's
// preview is (src/pages.ts), so no browser keeps a home page from before a post.
//
// An item is a posted thread: its title (`#<n>` when it has none), its first block as plain text read with the site's
// own Markdown reader (never the living summary, which is his private grid of what is decided and open), the day he
// posted it in his own zone, how many notes a stranger reads under it (shown only above zero), and its address: the
// thread's, or its `?full` address when its main section is a page, so a reader lands on the page full screen. Only
// public threads are ever posted, and the feed's query holds that in its own SQL, so strangers read here only what
// they could read at the thread's own address. A video is its title, its day, "Watch on YouTube" and, once the hourly
// run copied it, its picture from the site's own `/thumbs/<id>.jpg`, versioned by the video's `updated` so a changed
// picture gets a new address; the picture links where the title does, out of the tab and reading order, so a keyboard
// or screen-reader user meets each video once. A release is "Stigmer 0.1.2", its day and "Release notes", with no
// excerpt, because release notes open with an install block or a list of pull requests.
//
// /feed.xml is the same items as an Atom feed, with a fixed id per item (`tag:whysosuresh.com,2026:thread-<n>`,
// `…:video/<id>`, `…:release/<owner>/<repo>/<tag>`, so a new release is a new entry though the page keeps one row per
// product), so a reader never sees one item twice, everything escaped as XML text, kept out of search results like the
// threads themselves (`X-Robots-Tag: noindex`), and cacheable for five minutes. With nothing listed it is a valid
// empty feed.
//
// The Now line's call, /threads/api/now, is the owner's alone, both ways: `GET` reads the line, `POST {"text"}` sets
// it, only from his own page (src/request.ts). The sync and an invited person are refused with 403 `owner-only`
// before anything is read, as the people calls refuse invited people. The text is one line of at most 140 characters
// (`readNowLine`, src/wire.ts; 400 `now` otherwise), and an empty one takes the line off the home page. Every line is
// kept (migrations/0018_feed.sql).

import type { Caller } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { json } from "./json.ts";
import { CONDITIONAL, attribute, clip, plainText } from "./pages.ts";
import { sameOrigin } from "./request.ts";
import type { OutsideRow } from "./outside-store.ts";
import { homeFeed, nowLine, setNowLine, type FeedRow, type NowRow } from "./store.ts";
import { MAX_CHANGE_BYTES, lengthRefusal, readJson, readNowLine, refuse } from "./wire.ts";

/** The most items the home page and the feed show. */
export const FEED_LIMIT = 20;
/** The longest excerpt under an item's title, in UTF-16 code units. */
export const MAX_EXCERPT = 280;
/** The zone the dates are his days in: the feed is his diary of what happened, so his day is the one it shows. */
const ZONE = "Asia/Kolkata";
/** When the feed began: the empty feed's `updated`, which Atom requires even with no entry. */
const FEED_BEGAN = "2026-11-06T00:00:00.000Z";
/** The feed's own address. */
export const FEED_PATH = "/feed.xml";

const MONTH_DAY = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric" });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric", year: "numeric" });
const YEAR = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric" });

/** A posted thread, as both the page and the feed say it. */
interface Post {
  readonly kind: "post";
  readonly number: number;
  readonly title: string;
  readonly excerpt: string;
  /** When he posted it. */
  readonly at: string;
  readonly notes: number;
  /** Where the title, Read and the feed's link lead, decided by `postPath`. */
  readonly path: string;
}

/** A full episode on his channel. */
interface Video {
  readonly kind: "video";
  readonly id: string;
  readonly ref: string;
  readonly title: string;
  /** Its watch address, rebuilt from its id by the run. */
  readonly url: string;
  /** When it was published. */
  readonly at: string;
  /** Its picture's address on the site, versioned, or null while the run hasn't copied it. */
  readonly picture: string | null;
}

/** A product's newest release. */
interface Release {
  readonly kind: "release";
  readonly id: string;
  /** `<owner>/<repo>`. */
  readonly source: string;
  /** Its tag. */
  readonly ref: string;
  readonly title: string;
  readonly url: string;
  /** When it was published. */
  readonly at: string;
}

/** An item as both the page and the feed say it. */
type Item = Post | Video | Release;

/**
 * Where a posted thread is read: a page opens full screen at the thread's `?full` address, the one Share hands out
 * for answering (`fullLinkOf`, site/app/threads.js), and anything else at the thread's own address. Decided from the
 * main section as it now stands, so a thread whose main section changes after he posted it links right on the next
 * read.
 */
export function postPath(row: Pick<FeedRow, "number" | "main">): string {
  return row.main === "page" ? `/threads/${row.number}?full` : `/threads/${row.number}`;
}

function postOf(row: FeedRow): Post {
  return {
    kind: "post",
    number: row.number,
    title: row.title ?? `#${row.number}`,
    excerpt: clip(plainText(row.body, false), MAX_EXCERPT),
    at: row.feed_at,
    notes: row.notes,
    path: postPath(row),
  };
}

/** An outside item as the page and the feed say it. */
function outsideOf(row: OutsideRow): Video | Release {
  if (row.kind === "release") return { kind: "release", id: row.id, source: row.source, ref: row.ref, title: row.title, url: row.url, at: row.published_at };
  const version = Math.floor(Date.parse(row.updated_at ?? row.published_at) / 1000);
  return {
    kind: "video",
    id: row.id,
    ref: row.ref,
    title: row.title,
    url: row.url,
    at: row.published_at,
    picture: row.thumb === 1 ? `/thumbs/${row.ref}.jpg?v=${version}` : null,
  };
}

/**
 * His posts and the outside items as one list, newest first, at most `limit`: by date, a post before an outside item
 * of the same moment, outside items of one moment by id, and posts of one moment in the order their read gave them.
 */
export function merged(posts: readonly FeedRow[], outside: readonly OutsideRow[], limit: number): Item[] {
  const items: Item[] = [...posts.map(postOf), ...outside.map(outsideOf)];
  return items
    .sort((a, b) => {
      if (a.at !== b.at) return a.at < b.at ? 1 : -1;
      if (a.kind === "post" || b.kind === "post") return (a.kind === "post" ? 0 : 1) - (b.kind === "post" ? 0 : 1);
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, limit);
}

/** The day an item was posted, in his zone: "Nov 6" this year, "Nov 6, 2025" before it. */
export function dayOf(at: string, today: Date): string {
  const when = new Date(at);
  return YEAR.format(when) === YEAR.format(today) ? MONTH_DAY.format(when) : MONTH_DAY_YEAR.format(when);
}

/** "1 note", "4 notes". */
function notesOf(count: number): string {
  return `${count} ${count === 1 ? "note" : "notes"}`;
}

/** An item's day, as the list's first column. */
function whenMarkup(item: Item, today: Date): string {
  return `<time class="when" datetime="${attribute(item.at)}">${attribute(dayOf(item.at, today))}</time>`;
}

/** One item as the home page's markup, every value escaped, its classes written out whole for the site test to find. */
function itemMarkup(item: Item, today: Date): string {
  if (item.kind === "video") {
    const href = attribute(item.url);
    const picture =
      item.picture === null
        ? ""
        : `<a class="thumb" href="${href}" tabindex="-1" aria-hidden="true"><img src="${attribute(item.picture)}" width="320" height="180" alt="" loading="lazy" decoding="async"></a>`;
    return (
      `<li class="item item-video">${whenMarkup(item, today)}<div class="what">${picture}` +
      `<h3><a href="${href}">${attribute(item.title)}</a></h3>` +
      `<p class="meta"><span>Video</span><a href="${href}">Watch on YouTube</a></p></div></li>`
    );
  }
  if (item.kind === "release") {
    const href = attribute(item.url);
    return (
      `<li class="item item-release">${whenMarkup(item, today)}<div class="what">` +
      `<h3><a href="${href}">${attribute(item.title)}</a></h3>` +
      `<p class="meta"><span>Release</span><a href="${href}">Release notes</a></p></div></li>`
    );
  }
  const href = attribute(item.path);
  const excerpt = item.excerpt === "" ? "" : `<p>${attribute(item.excerpt)}</p>`;
  const notes = item.notes > 0 ? `<span>${attribute(notesOf(item.notes))}</span>` : "";
  return (
    `<li class="item">${whenMarkup(item, today)}` +
    `<div class="what"><h3><a href="${href}">${attribute(item.title)}</a></h3>${excerpt}` +
    `<p class="meta"><a href="${href}">Read</a>${notes}</p></div></li>`
  );
}

/** The home page with the feed and the Now line written in: each section shown only when it has something. */
function rewritten(page: Response, items: readonly Item[], now: string | null): Response {
  const today = new Date();
  const list = items.map((item) => itemMarkup(item, today)).join("");
  let rewriter = new HTMLRewriter();
  if (now !== null) {
    rewriter = rewriter
      .on("[data-now]", { element: (element) => void element.removeAttribute("hidden") })
      .on("[data-now-text]", { element: (element) => void element.setInnerContent(now, { html: false }) });
  }
  if (items.length > 0) {
    rewriter = rewriter
      .on("[data-feed]", { element: (element) => void element.removeAttribute("hidden") })
      .on("[data-feed-list]", { element: (element) => void element.setInnerContent(list, { html: true }) });
  }
  const transformed = rewriter.transform(page);
  const headers = new Headers(transformed.headers);
  headers.delete("ETag");
  headers.delete("Last-Modified");
  return new Response(transformed.body, { status: transformed.status, headers });
}

/** The Now line to show, or null: none set, or the newest set empty. */
function shown(now: NowRow | null): string | null {
  return now === null || now.text === "" ? null : now.text;
}

/** Answers `/`: the site's home page, with what is listed and his Now line written in when there is any. */
export async function handleHome(request: Request, env: Bindings): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);
  let items: Item[];
  let now: string | null;
  try {
    const feed = await homeFeed(env.DB, FEED_LIMIT);
    items = merged(feed.items, feed.outside, FEED_LIMIT);
    now = shown(feed.now);
  } catch {
    return env.ASSETS.fetch(request);
  }
  if (items.length === 0 && now === null) return env.ASSETS.fetch(request);
  const headers = new Headers(request.headers);
  for (const name of CONDITIONAL) headers.delete(name);
  const page = await env.ASSETS.fetch(new Request(request.url, { method: request.method, headers }));
  return page.status === 200 ? rewritten(page, items, now) : page;
}

/** A value as XML text or inside a double-quoted attribute: `attribute` escapes every character XML needs. */
const xml = attribute;

/** An item's lasting id in the feed. */
function entryId(item: Item): string {
  if (item.kind === "post") return `tag:whysosuresh.com,2026:thread-${item.number}`;
  if (item.kind === "video") return `tag:whysosuresh.com,2026:video/${item.ref}`;
  return `tag:whysosuresh.com,2026:release/${item.source}/${item.ref}`;
}

/** The Atom feed of the listed items, newest first. */
export function atom(items: readonly Item[], origin: string): string {
  const updated = items[0]?.at ?? FEED_BEGAN;
  const entries = items.map(
    (item) =>
      `  <entry>\n` +
      `    <id>${xml(entryId(item))}</id>\n` +
      `    <title>${xml(item.title)}</title>\n` +
      `    <link rel="alternate" type="text/html" href="${xml(item.kind === "post" ? `${origin}${item.path}` : item.url)}"/>\n` +
      `    <updated>${xml(item.at)}</updated>\n` +
      (item.kind !== "post" || item.excerpt === "" ? "" : `    <summary>${xml(item.excerpt)}</summary>\n`) +
      `  </entry>\n`,
  );
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<feed xmlns="http://www.w3.org/2005/Atom">\n` +
    `  <title>Suresh Attaluri</title>\n` +
    `  <subtitle>What's happening</subtitle>\n` +
    `  <id>tag:whysosuresh.com,2026:feed</id>\n` +
    `  <link rel="self" type="application/atom+xml" href="${xml(`${origin}${FEED_PATH}`)}"/>\n` +
    `  <link rel="alternate" type="text/html" href="${xml(`${origin}/`)}"/>\n` +
    `  <updated>${xml(updated)}</updated>\n` +
    `  <author><name>Suresh Attaluri</name><uri>${xml(`${origin}/`)}</uri></author>\n` +
    entries.join("") +
    `</feed>\n`
  );
}

/** Answers `/feed.xml`: the Atom feed, or 503 while the read fails, so a reader keeps what it had. */
export async function handleFeed(request: Request, env: Bindings): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return json(405, { reason: "method" }, { Allow: "GET" });
  let items: Item[];
  try {
    const feed = await homeFeed(env.DB, FEED_LIMIT);
    items = merged(feed.items, feed.outside, FEED_LIMIT);
  } catch {
    return json(503, { reason: "unavailable" }, { "Retry-After": "300" });
  }
  const body = atom(items, new URL(request.url).origin);
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

/** The Now line as the owner's page reads it: its text and when he set it, or null when there is no line. */
function nowView(now: NowRow | null): { readonly now: { readonly text: string; readonly setAt: string } | null } {
  return { now: now === null || now.text === "" ? null : { text: now.text, setAt: now.set_at } };
}

/** Answers /threads/api/now, once the door has named the caller: the owner's alone, both ways. */
export async function handleNow(request: Request, env: Bindings, who: Caller): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return json(405, { reason: "method" }, { Allow: "GET, POST" });
  if (who.caller !== "owner") return refuse(403, "owner-only");
  if (request.method === "GET") return json(200, nowView(await nowLine(env.DB)));
  if (!sameOrigin(request)) return refuse(403, "origin");
  const length = lengthRefusal(request, MAX_CHANGE_BYTES);
  if (length !== null) return length;
  const text = readNowLine(await readJson(request));
  if (text === null) return refuse(400, "now");
  return json(200, nowView(await setNowLine(env.DB, text)));
}
