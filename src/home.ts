// The home page's feed: what Suresh posts, written into the site's own home page, and the same items as an Atom feed
// at /feed.xml; and his Now line, the one line under his greeting, which he sets from Today through a private call.
//
// `/` is site/index.html, handed over from the site's own files through the assets binding, so it carries
// site/_headers (the CSP among them) exactly as the file served straight from site/ would. The Worker reads the
// newest posted threads and the Now line in one batch (`homeFeed`, src/store.ts) and writes them in with
// `HTMLRewriter`: the Now line as text into `[data-now-text]`, and each item as markup built here, in which every
// value (title, excerpt, date, address, count) goes through `attribute`, which escapes all five characters, so it is
// safe as text and inside an attribute alike. The items carry classes only, never a `style` attribute, which the CSP's
// `style-src 'self'` would refuse. The sections the feed fills are `hidden` in the file, and the rewrite shows each one
// only when it has something to show; with nothing posted and no Now line, or when the read fails, the answer is the
// file byte for byte, its ETag included, so a deploy before his first post changes nothing anyone sees. A rewritten
// answer is fetched without the browser's conditional headers and answered without an ETag, as a public thread's
// preview is (src/pages.ts), so no browser keeps a home page from before a post.
//
// An item is a posted thread: its title (`#<n>` when it has none), its first block as plain text read with the site's
// own Markdown reader (never the living summary, which is his private grid of what is decided and open), the day he
// posted it in his own zone, how many notes a stranger reads under it (shown only above zero), and its address: the
// thread's, or its `?full` address when its main section is a page, so a reader lands on the page full screen. Only
// public threads are ever posted, and the feed's query holds that in its own SQL, so strangers read here only what
// they could read at the thread's own address.
//
// /feed.xml is the same items as an Atom feed, with a fixed id per thread (`tag:whysosuresh.com,2026:thread-<n>`), so
// a reader never sees one post twice, everything escaped as XML text, kept out of search results like the threads
// themselves (`X-Robots-Tag: noindex`), and cacheable for five minutes. With nothing posted it is a valid empty feed.
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

/** An item as both the page and the feed say it. */
interface Item {
  readonly number: number;
  readonly title: string;
  readonly excerpt: string;
  readonly at: string;
  readonly notes: number;
  /** Where the title, Read and the feed's link lead, decided by `postPath`. */
  readonly path: string;
}

/**
 * Where a posted thread is read: a page opens full screen at the thread's `?full` address, the one Share hands out
 * for answering (`fullLinkOf`, site/app/threads.js), and anything else at the thread's own address. Decided from the
 * main section as it now stands, so a thread whose main section changes after he posted it links right on the next
 * read.
 */
export function postPath(row: Pick<FeedRow, "number" | "main">): string {
  return row.main === "page" ? `/threads/${row.number}?full` : `/threads/${row.number}`;
}

function itemOf(row: FeedRow): Item {
  return {
    number: row.number,
    title: row.title ?? `#${row.number}`,
    excerpt: clip(plainText(row.body, false), MAX_EXCERPT),
    at: row.feed_at,
    notes: row.notes,
    path: postPath(row),
  };
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

/** One item as the home page's markup, every value escaped. */
function itemMarkup(item: Item, today: Date): string {
  const href = attribute(item.path);
  const excerpt = item.excerpt === "" ? "" : `<p>${attribute(item.excerpt)}</p>`;
  const notes = item.notes > 0 ? `<span>${attribute(notesOf(item.notes))}</span>` : "";
  return (
    `<li class="item"><time class="when" datetime="${attribute(item.at)}">${attribute(dayOf(item.at, today))}</time>` +
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

/** Answers `/`: the site's home page, with what he posted and his Now line written in when there is any. */
export async function handleHome(request: Request, env: Bindings): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);
  let feed: { items: FeedRow[]; now: NowRow | null };
  try {
    feed = await homeFeed(env.DB, FEED_LIMIT);
  } catch {
    return env.ASSETS.fetch(request);
  }
  const now = shown(feed.now);
  if (feed.items.length === 0 && now === null) return env.ASSETS.fetch(request);
  const headers = new Headers(request.headers);
  for (const name of CONDITIONAL) headers.delete(name);
  const page = await env.ASSETS.fetch(new Request(request.url, { method: request.method, headers }));
  return page.status === 200 ? rewritten(page, feed.items.map(itemOf), now) : page;
}

/** A value as XML text or inside a double-quoted attribute: `attribute` escapes every character XML needs. */
const xml = attribute;

/** The Atom feed of the posted threads, newest first. */
export function atom(items: readonly Item[], origin: string): string {
  const updated = items[0]?.at ?? FEED_BEGAN;
  const entries = items.map(
    (item) =>
      `  <entry>\n` +
      `    <id>tag:whysosuresh.com,2026:thread-${item.number}</id>\n` +
      `    <title>${xml(item.title)}</title>\n` +
      `    <link rel="alternate" type="text/html" href="${xml(`${origin}${item.path}`)}"/>\n` +
      `    <updated>${xml(item.at)}</updated>\n` +
      (item.excerpt === "" ? "" : `    <summary>${xml(item.excerpt)}</summary>\n`) +
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
  let rows: FeedRow[];
  try {
    rows = (await homeFeed(env.DB, FEED_LIMIT)).items;
  } catch {
    return json(503, { reason: "unavailable" }, { "Retry-After": "300" });
  }
  const body = atom(rows.map(itemOf), new URL(request.url).origin);
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
