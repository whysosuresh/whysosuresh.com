// The threads page's addresses, which the Worker answers because no file can sit at every thread's number: the
// rooms, each at the top level beside the others: /me (the door everyone signed in enters by: Today for the owner,
// their threads for an invited person), /meetings, /threads/ (the list, with its tab and space in the query), and the
// people pages, /people and /people/<n> with the person's name after it or not (/people/7-meera), which read nothing:
// the asks, /asks, which reads nothing either; an ask's own address, /ask/<slug>, which anyone opens to answer it;
// a person's address gets the plain shell whatever the number, so it never says whether that person exists; and a
// thread, /threads/<n>, with its title after the number or not (/threads/42-who-owns-what); and Suresh's journal, /journal with a day, a week or the storylines under it,
// which reads nothing either. People lived under
// /threads/ before the rooms were peers: /threads/people and every person's address there redirect to /people for
// good, and /people/ to /people, as /me/ does to /me. Each gets the one page, site/threads/index.html,
// handed over from the site's own files through the assets binding, so it carries site/_headers (the CSP among
// them) exactly as a file served straight from site/ would. The status is 200 whatever the number: the page asks
// the calls for the thread, and a missing thread, a thread this browser may not read and a signed-out visitor all
// see the same "Nothing here", so the address alone never tells whether a thread exists.
//
// A link preview (Slack, iMessage) reads only this HTML, so a public thread's address gets its own title and
// preview tags: at a thread's address the Worker reads the thread's row with one indexed query whatever the number
// (`publicPreview`), so a private, a missing and a public number cost the same, and only a public thread's answer
// differs. Its title, `og:` and `twitter:` tags are written as text or escaped attributes, never as markup; the
// description is plain text from the site's own Markdown reader (site/app/markdown.js): the living summary, else the
// first paragraph of the text when the text is what the thread shows. That answer is fetched without the browser's
// conditional headers and carries no ETag, because the shell's ETag would let a browser keep a stale title, or the
// plain shell, as a 304. Every other answer is the shell byte for byte. The `noindex` stays on every thread: a
// public thread is kept out of search results, and found by its link. Any other path under /threads/ is answered by
// the site's files as it would be without the Worker: the 404 page, or a clean-address redirect. The page's
// scripts live under /app/, outside the Worker's paths, so they cost no Worker request.
//
// An ask's address gets its preview the same way, read by its slug with one indexed query whatever the slug
// (`findAsk`), while the ask is open or closed: its title, which is written for strangers, and a fixed line, "A few
// questions from Suresh", never the thread's living summary, which is his private label, nor its number. A draft and a
// slug no thread has get the shell byte for byte.

import { parse, type Inline } from "../site/app/markdown.js";
import type { Bindings } from "./bindings.ts";
import { SLUG_SHAPE } from "./asks.ts";
import { findAsk, publicPreview, type PreviewRow } from "./store.ts";

/**
 * /me, the meetings, the asks, everyone and a person by their number, the list, a thread by its number with any title
 * after it, an ask by its slug, and the journal's (his alone, drawn only once the calls say he is the owner): the list,
 * a day or a week by its key, the storylines and one storyline by its name's slug. A key is matched by its shape, so an
 * impossible day gets the shell like any other and says "Nothing here" itself.
 */
const PAGE = /^(?:\/me|\/meetings|\/asks|\/journal(?:\/(?:\d{4}-\d{2}-\d{2}|\d{4}-W\d{2}|storylines(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?))?|\/people(?:\/[1-9]\d{0,8}(?:-[^/]*)?)?|\/threads\/(?:([1-9]\d{0,8})(?:-[^/]*)?)?|\/ask\/([^/]+))$/;

/** What an ask's preview says beside its title, the same for every ask. */
export const ASK_DESCRIPTION = "A few questions from Suresh";
/** An ask's title when its thread has none. */
const UNTITLED_ASK = "Questions from Suresh";

/** People's addresses from before the rooms, everyone and a person with anything after the number, and /people/. */
const OLD_PEOPLE = /^\/threads\/people(?:\/((?:[1-9]\d{0,8}(?:-[^/]*)?)?))?$|^\/people\/$/;
/** The journal's address with a slash after it, which the Worker sends to /journal as /people/ goes to /people. */
const JOURNAL_SLASH = "/journal/";

/** The page's own address among the site's files. */
const SHELL = "/threads/";

/** The longest preview description, in UTF-16 code units. */
export const MAX_DESCRIPTION = 200;

/** The headers a browser revalidates with, left off the request for a rewritten answer. */
export const CONDITIONAL = ["If-None-Match", "If-Modified-Since", "If-Match", "If-Unmodified-Since", "If-Range"];

export function isThreadsPage(pathname: string): boolean {
  return PAGE.test(pathname);
}

/** Inline runs as plain text: what a reader sees, without the marks. */
function plainRuns(runs: readonly Inline[]): string {
  return runs.map((run) => (run.type === "thread" ? `#${run.number}` : run.text)).join("");
}

/** A Markdown text as one line of plain text: every block's words when `whole`, else the first block's. */
export function plainText(source: string, whole: boolean): string {
  const blocks = parse(source);
  const read = (whole ? blocks : blocks.slice(0, 1)).map((block) => {
    if (block.type === "pre") return block.text;
    if (block.type === "rule") return "";
    if (block.type === "list") return block.items.map(plainRuns).join(" ");
    return plainRuns(block.inline);
  });
  return read.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * A text at most `max` code units long: as it is when it fits, else cut at the last space past half of it (anywhere,
 * when there is none) with an ellipsis, the ellipsis counted.
 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A preview's description: at most `MAX_DESCRIPTION` code units, cut at a space with an ellipsis when longer. */
export function description(row: Pick<PreviewRow, "summary" | "body" | "main">): string {
  const text = row.summary !== null && row.summary.trim() !== "" ? plainText(row.summary, true) : row.main === "text" ? plainText(row.body, false) : "";
  return clip(text, MAX_DESCRIPTION);
}

/** A value inside a double-quoted attribute, escaped so it can't end the attribute or start markup. */
export function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A public thread's title as a page and a preview show it: "#57 Its title · whysosuresh.com". */
export function titleOf(row: Pick<PreviewRow, "number" | "title">): string {
  return `#${row.number}${row.title === null ? "" : ` ${row.title}`} · whysosuresh.com`;
}

/** What a preview says: the page's title, its type, its address and a description (none when empty). */
interface Preview {
  readonly title: string;
  readonly type: string;
  readonly url: string;
  readonly description: string;
}

/** A public thread's preview. */
function threadPreview(row: PreviewRow, origin: string): Preview {
  return { title: titleOf(row), type: "article", url: `${origin}/threads/${row.number}`, description: description(row) };
}

/** The shell with a preview's title and tags. */
function rewritten(shell: Response, preview: Preview): Response {
  const { title, description: said } = preview;
  const tags = [
    ["property", "og:title", title],
    ["property", "og:type", preview.type],
    ["property", "og:url", preview.url],
    ...(said === "" ? [] : [["property", "og:description", said]]),
    ["name", "twitter:card", "summary"],
  ]
    .map(([kind = "", name = "", content = ""]) => `<meta ${kind}="${attribute(name)}" content="${attribute(content)}">`)
    .join("");
  const transformed = new HTMLRewriter()
    .on("title", { element: (element) => void element.setInnerContent(title, { html: false }) })
    .on("head", { element: (element) => void element.append(tags, { html: true }) })
    .transform(shell);
  const headers = new Headers(transformed.headers);
  headers.delete("ETag");
  headers.delete("Last-Modified");
  return new Response(transformed.body, { status: transformed.status, headers });
}

/** Answers a room's address, and a path under /threads/ that isn't one of the threads' calls. */
export async function handlePage(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url);
  const moved = OLD_PEOPLE.exec(url.pathname);
  if (moved !== null && (request.method === "GET" || request.method === "HEAD")) {
    const person = moved[1] === undefined || moved[1] === "" ? "" : `/${moved[1]}`;
    return new Response(null, { status: 301, headers: { Location: `/people${person}${url.search}` } });
  }
  if (url.pathname === JOURNAL_SLASH && (request.method === "GET" || request.method === "HEAD")) {
    return new Response(null, { status: 301, headers: { Location: `/journal${url.search}` } });
  }
  const page = PAGE.exec(url.pathname);
  if (page === null || (request.method !== "GET" && request.method !== "HEAD")) return env.ASSETS.fetch(request);
  const [, number, slug] = page;
  if (slug !== undefined && !SLUG_SHAPE.test(slug)) return env.ASSETS.fetch(request);
  const shell = new URL(SHELL, url.origin);
  let preview: Preview | null = null;
  try {
    preview = number !== undefined ? await threadOf(env, Number(number), url.origin) : slug !== undefined ? await askOf(env, slug, url.origin) : null;
  } catch {
    preview = null;
  }
  if (preview === null) return env.ASSETS.fetch(new Request(shell, { method: request.method, headers: request.headers }));
  const headers = new Headers(request.headers);
  for (const name of CONDITIONAL) headers.delete(name);
  const plain = await env.ASSETS.fetch(new Request(shell, { method: request.method, headers }));
  return plain.status === 200 ? rewritten(plain, preview) : plain;
}

/** A thread's preview when it is public, else null. */
async function threadOf(env: Bindings, number: number, origin: string): Promise<Preview | null> {
  const row = await publicPreview(env.DB, number);
  return row === null || row.public !== 1 ? null : threadPreview(row, origin);
}

/** An ask's preview while it is open or closed, else null: its title and the fixed line, never its summary. */
async function askOf(env: Bindings, slug: string, origin: string): Promise<Preview | null> {
  const ask = await findAsk(env.DB, slug);
  if (ask === null || ask.state === "draft") return null;
  return { title: `${ask.title ?? UNTITLED_ASK} · whysosuresh.com`, type: "website", url: `${origin}/ask/${slug}`, description: ASK_DESCRIPTION };
}
