// The threads page's addresses, which the Worker answers because no file can sit at every thread's number:
// /me (the door everyone signed in enters by: Today for the owner, their threads for an invited person),
// /threads/ (the list, with its tab and space in the query), /threads/<n>, with the thread's
// title after the number or not (/threads/42-who-owns-what), and the people pages, /threads/people and
// /threads/people/<n> with the person's name after it or not (/threads/people/7-meera), which read nothing: a
// person's address gets the plain shell whatever the number, so it never says whether that person exists. Each gets the one page, site/threads/index.html,
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

import { parse, type Inline } from "../site/app/markdown.js";
import type { Bindings } from "./bindings.ts";
import { publicPreview, type PreviewRow } from "./store.ts";

/** /me, the list, a thread by its number with any title after it, everyone, and a person by their number. */
const PAGE = /^(?:\/me|\/threads\/(?:([1-9]\d{0,8})(?:-[^/]*)?|people(?:\/(?:[1-9]\d{0,8}(?:-[^/]*)?)?)?)?)$/;

/** The page's own address among the site's files. */
const SHELL = "/threads/";

/** The longest preview description, in UTF-16 code units. */
export const MAX_DESCRIPTION = 200;

/** The headers a browser revalidates with, left off the request for a rewritten answer. */
const CONDITIONAL = ["If-None-Match", "If-Modified-Since", "If-Match", "If-Unmodified-Since", "If-Range"];

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

/** A preview's description: at most `MAX_DESCRIPTION` code units, cut at a space with an ellipsis when longer. */
export function description(row: Pick<PreviewRow, "summary" | "body" | "main">): string {
  const text = row.summary !== null && row.summary.trim() !== "" ? plainText(row.summary, true) : row.main === "text" ? plainText(row.body, false) : "";
  if (text.length <= MAX_DESCRIPTION) return text;
  const cut = text.slice(0, MAX_DESCRIPTION - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX_DESCRIPTION / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A value inside a double-quoted attribute, escaped so it can't end the attribute or start markup. */
function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A public thread's title as a page and a preview show it: "#57 Its title · whysosuresh.com". */
export function titleOf(row: Pick<PreviewRow, "number" | "title">): string {
  return `#${row.number}${row.title === null ? "" : ` ${row.title}`} · whysosuresh.com`;
}

/** The shell with a public thread's title and preview tags. */
function rewritten(shell: Response, row: PreviewRow, origin: string): Response {
  const title = titleOf(row);
  const said = description(row);
  const tags = [
    ["property", "og:title", title],
    ["property", "og:type", "article"],
    ["property", "og:url", `${origin}/threads/${row.number}`],
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

/** Answers a path under /threads/ that isn't one of the threads' calls. */
export async function handlePage(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url);
  const page = PAGE.exec(url.pathname);
  if (page === null || (request.method !== "GET" && request.method !== "HEAD")) return env.ASSETS.fetch(request);
  const shell = new URL(SHELL, url.origin);
  const number = page[1];
  let preview: PreviewRow | null = null;
  if (number !== undefined) {
    try {
      preview = await publicPreview(env.DB, Number(number));
    } catch {
      preview = null;
    }
  }
  if (preview === null || preview.public !== 1) return env.ASSETS.fetch(new Request(shell, { method: request.method, headers: request.headers }));
  const headers = new Headers(request.headers);
  for (const name of CONDITIONAL) headers.delete(name);
  const plain = await env.ASSETS.fetch(new Request(shell, { method: request.method, headers }));
  return plain.status === 200 ? rewritten(plain, preview, url.origin) : plain;
}
