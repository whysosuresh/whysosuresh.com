// What arrives on the home page from outside, with no act of his: his full YouTube episodes and the newest release of
// Stigmer and of CapsJump, each already public where it comes from. A cron trigger (wrangler.jsonc) runs
// `refreshOutside` every hour; it keeps what it reads in its own table (src/outside-store.ts), which the home page and
// its feed merge with his posts (src/home.ts). And `/thumbs/<id>.jpg`, a video's picture, copied by the run into the
// pages bucket and served from the site itself, so a visitor's browser asks nobody else for anything.
//
// Every source is fetched on its own, with a timeout and a bounded read, and a source that fails in any way (an error
// status, a timeout, a body over its cap, an answer that doesn't parse, or one holding entries none of which is valid)
// keeps its rows exactly as they were, so a flaky or changed source never empties the list; the others still run.
//
// - The channel's feed (no key) lists its newest 15 uploads. A Short, told apart only by its `/shorts/` link, is cut
//   from an episode and is never listed, but still counts toward the feed's window: a row the answer leaves out,
//   published at or after the oldest entry it holds, was taken down or unlisted and is dropped. An older one can't be
//   seen to go and stays. Every value is checked, every date stored with Z, and the watch address rebuilt from the id.
// - Each product's newest release is GitHub's `releases/latest` (neither a draft nor a pre-release), called without a
//   key. It is kept only when its tag is short and printable and its address is the one rebuilt from the tag in its own
//   repository; its title is the product's name and the tag ("Stigmer 0.1.2"), never the release's own name. A 404 (no
//   release any more) drops the row.
// - Pictures: up to `PICTURES_PER_RUN` episodes without one, newest first, get YouTube's 320×180 picture copied, one at
//   a time, kept only when it is a JPEG by its first bytes and at most `MAX_PICTURE_BYTES`. A failed copy leaves the
//   item without a picture until the next run. Last, the bucket is reconciled to the table: every picture whose video
//   has no row is deleted, so a taken-down video's picture is gone within the run.
//
// One run spends at most 30 of the 50 subrequests a run may make: three sources, ten pictures fetched and ten kept,
// one list, one delete, five database calls. Each source logs one JSON line with its name, numbers and a reason word;
// the log helper takes nothing else, so no title or address reaches a log line.
//
// The picture's address answers GET and HEAD for exactly `/thumbs/<11-character id>.jpg` whose object exists, with
// its query ignored (the page versions the address with `?v=`, so a changed picture gets a new one), and the same
// JSON 404 as an unknown path for anything else. It is public, as the home page is, and cached for good.

import type { Bindings } from "./bindings.ts";
import { json } from "./json.ts";
import { keepRelease, keepVideos, dropRelease, picturesKept, picturesWanted, type Episode, type Release, type WantedPicture } from "./outside-store.ts";

/** His channel: The Feed Said So. */
export const CHANNEL = "UCkdfCh9gN60s_h_nfTYEwyg";
const CHANNEL_FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`;
/** The products whose newest release is listed, by repository. */
export const PRODUCTS = [
  { repo: "stigmer/stigmer", name: "Stigmer" },
  { repo: "whysosuresh/capsjump", name: "CapsJump" },
] as const;
type Repo = (typeof PRODUCTS)[number]["repo"];

/** How long one outside request may take. */
const TIMEOUT_MS = 10_000;
/** The most a source's answer may be: the feed is about 25 KB, a release's JSON a few. */
const MAX_BODY_BYTES = 512 * 1024;
/** The most a picture may be: YouTube's 320×180 is about 10 KB. */
const MAX_PICTURE_BYTES = 200 * 1024;
/** The most pictures one run copies. */
export const PICTURES_PER_RUN = 10;
/** The longest title kept. */
const MAX_TITLE = 300;
/** GitHub refuses a request without a User-Agent; this one names the site and nothing else. */
const USER_AGENT = "whysosuresh.com";
/** A YouTube video id. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Where the pictures live in the pages bucket. */
const PICTURES = "outside/";
const JPEG = [0xff, 0xd8, 0xff];

/** What a log line may name: a source, and why it failed. Nothing else reaches a log line. */
type LogSource = "youtube" | "pictures" | "bucket" | Repo;
type Reason = number | "timeout" | "network" | "too-large" | "unparseable" | "no-valid-entry" | "not-jpeg" | "error";

function log(source: LogSource, counts: { readonly [name: string]: number }, failed?: Reason): void {
  console.log(JSON.stringify({ outside: source, ...counts, ...(failed === undefined ? {} : { failed }) }));
}

/** A source that failed, and why. */
class SourceFailure extends Error {
  constructor(readonly reason: Reason) {
    super(String(reason));
  }
}

/** Fetches one outside address with the run's timeout, its failures said as a reason. */
async function fetchOutside(url: string, headers: Record<string, string> = {}): Promise<Response> {
  try {
    return await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" });
  } catch (error) {
    throw new SourceFailure(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network");
  }
}

/**
 * The body read to at most `cap` bytes, or null past it: the stream is counted as it is read, so an answer with no
 * Content-Length is bounded too, and one that says it is larger is refused before a byte is read.
 */
export async function readCapped(response: Response, cap: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (declared > cap || response.body === null) {
    await response.body?.cancel();
    return response.body === null ? new Uint8Array(0) : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let next: ReadableStreamReadResult<Uint8Array>;
    try {
      next = await reader.read();
    } catch (error) {
      throw new SourceFailure(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network");
    }
    if (next.done) break;
    total += next.value.byteLength;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** A source's body as text: a 200 read within the cap, or the failure. */
async function textOf(response: Response): Promise<string> {
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new SourceFailure(response.status);
  }
  const bytes = await readCapped(response, MAX_BODY_BYTES);
  if (bytes === null) throw new SourceFailure("too-large");
  return new TextDecoder().decode(bytes);
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML text with its entities read: the five named ones and numeric ones; anything else stays as written. */
export function xmlText(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (whole, name: string) => {
    if (!name.startsWith("#")) return NAMED[name] ?? whole;
    const code = name[1] === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

/** A title fit to show: one line, its whitespace folded, no control character, at most `MAX_TITLE`. */
function titleOf(raw: string): string | null {
  const title = raw.replace(/\s+/g, " ").trim();
  // The C0 and C1 controls and DEL that the folding above leaves, because they aren't whitespace, refuse it.
  if (title === "" || title.length > MAX_TITLE || !title.isWellFormed() || /[\u0000-\u001f\u007f-\u009f]/.test(title)) return null;
  return title;
}

/** An ISO date with Z, or null: the text must read as a date and time, which Date.parse alone is lenient about. */
export function isoOf(text: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(text.trim())) return null;
  const at = Date.parse(text.trim());
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/** One element's text in an entry, or null. */
function element(entry: string, name: string): string | null {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(entry)?.[1] ?? null;
}

/** The channel's answer, read: its episodes, every video id it holds, and its oldest entry's date. */
export interface ChannelAnswer {
  readonly episodes: Episode[];
  /** Every video id the answer names, a Short's or a malformed entry's too, whose rows it therefore keeps. */
  readonly listed: string[];
  /** The oldest valid entry's date, Shorts included: how far back the answer reaches. */
  readonly oldest: string | null;
  /** How many entries the answer holds, and how many of them are valid. */
  readonly entries: number;
  readonly valid: number;
}

/** The channel's Atom feed, read. Pure: it reads only the text it is given. */
export function parseVideos(xml: string): ChannelAnswer {
  if (!/<feed[\s>]/.test(xml)) throw new SourceFailure("unparseable");
  const episodes: Episode[] = [];
  const listed: string[] = [];
  let oldest: string | null = null;
  let entries = 0;
  let valid = 0;
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    entries += 1;
    const entry = match[1] ?? "";
    const ref = element(entry, "yt:videoId");
    const rawTitle = element(entry, "title");
    const title = rawTitle === null ? null : titleOf(xmlText(rawTitle));
    const published = isoOf(element(entry, "published") ?? "");
    const updated = isoOf(element(entry, "updated") ?? "");
    const link = [...entry.matchAll(/<link\s([^>]*)\/?>/g)]
      .map((tag) => tag[1] ?? "")
      .filter((attributes) => /\brel="alternate"/.test(attributes))
      .map((attributes) => xmlText(/\bhref="([^"]*)"/.exec(attributes)?.[1] ?? ""))[0];
    if (ref === null || !VIDEO_ID.test(ref)) continue;
    listed.push(ref);
    if (title === null || published === null || updated === null || link === undefined || !link.startsWith("https://www.youtube.com/")) continue;
    valid += 1;
    if (oldest === null || published < oldest) oldest = published;
    if (link.startsWith("https://www.youtube.com/shorts/")) continue;
    episodes.push({ ref, title, url: `https://www.youtube.com/watch?v=${ref}`, publishedAt: published, updatedAt: updated });
  }
  return { episodes, listed, oldest, entries, valid };
}

/** A repository's `releases/latest` answer, read: the release, or null when it doesn't hold. Pure. */
export function parseRelease(repo: string, name: string, text: string): Release | null {
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof answer !== "object" || answer === null) return null;
  const { tag_name: tag, html_url: url, published_at: published } = answer as Record<string, unknown>;
  if (typeof tag !== "string" || !/^[\x21-\x7e]{1,100}$/.test(tag)) return null;
  const expected = `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;
  if (url !== expected || typeof published !== "string") return null;
  const publishedAt = isoOf(published);
  if (publishedAt === null) return null;
  return { repo, tag, title: `${name} ${tag.replace(/^v(?=\d)/, "")}`, url: expected, publishedAt };
}

async function refreshVideos(env: Bindings): Promise<void> {
  let answer: ChannelAnswer;
  try {
    answer = parseVideos(await textOf(await fetchOutside(CHANNEL_FEED)));
    if (answer.entries > 0 && answer.valid === 0) throw new SourceFailure("no-valid-entry");
  } catch (error) {
    if (!(error instanceof SourceFailure)) throw error;
    log("youtube", {}, error.reason);
    return;
  }
  if (answer.oldest !== null) await keepVideos(env.DB, CHANNEL, answer.episodes, answer.listed, answer.oldest);
  log("youtube", { kept: answer.episodes.length, skipped: answer.entries - answer.episodes.length });
}

async function refreshRelease(env: Bindings, product: (typeof PRODUCTS)[number]): Promise<void> {
  let response: Response;
  let release: Release | null;
  try {
    response = await fetchOutside(`https://api.github.com/repos/${product.repo}/releases/latest`, {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    if (response.status === 404) {
      await response.body?.cancel();
      await dropRelease(env.DB, product.repo);
      log(product.repo, { kept: 0, dropped: 1 });
      return;
    }
    release = parseRelease(product.repo, product.name, await textOf(response));
    if (release === null) throw new SourceFailure("unparseable");
  } catch (error) {
    if (!(error instanceof SourceFailure)) throw error;
    log(product.repo, {}, error.reason);
    return;
  }
  await keepRelease(env.DB, release);
  log(product.repo, { kept: 1 });
}

/** Copies one picture into the bucket: true when it was kept. */
async function copyPicture(env: Bindings, ref: string): Promise<boolean> {
  try {
    const response = await fetchOutside(`https://i.ytimg.com/vi/${ref}/mqdefault.jpg`);
    if (response.status !== 200) {
      await response.body?.cancel();
      return false;
    }
    const bytes = await readCapped(response, MAX_PICTURE_BYTES);
    if (bytes === null || !JPEG.every((byte, index) => bytes[index] === byte)) return false;
    await env.PAGES.put(`${PICTURES}${ref}.jpg`, bytes, { httpMetadata: { contentType: "image/jpeg" } });
    return true;
  } catch (error) {
    if (error instanceof SourceFailure) return false;
    throw error;
  }
}

/** Copies the pictures still wanted, then deletes every picture whose video has no row. */
async function refreshPictures(env: Bindings): Promise<void> {
  const { wanted, videos } = await picturesWanted(env.DB, PICTURES_PER_RUN);
  const kept: WantedPicture[] = [];
  for (const picture of wanted) if (await copyPicture(env, picture.ref)) kept.push(picture);
  await picturesKept(env.DB, kept);
  log("pictures", { kept: kept.length, missed: wanted.length - kept.length });

  const rows = new Set(videos);
  const listed = await env.PAGES.list({ prefix: PICTURES, limit: 1000 });
  const orphans = listed.objects
    .map((object) => object.key)
    .filter((key) => {
      const ref = key.slice(PICTURES.length).replace(/\.jpg$/, "");
      return !rows.has(ref);
    });
  if (orphans.length > 0) await env.PAGES.delete(orphans);
  log("bucket", { deleted: orphans.length });
}

/**
 * One hourly run: the videos, then their pictures, which need the rows, with the releases beside them. A source's
 * failure is logged and keeps its rows; anything else (the database or the bucket failing) fails the run, so
 * Cloudflare's record of the run says so.
 */
export async function refreshOutside(env: Bindings): Promise<void> {
  const parts: readonly LogSource[] = ["youtube", ...PRODUCTS.map((product) => product.repo)];
  const videos = refreshVideos(env).then(() => refreshPictures(env));
  const results = await Promise.allSettled([videos, ...PRODUCTS.map((product) => refreshRelease(env, product))]);
  const failed = parts.filter((_, index) => results[index]?.status === "rejected");
  for (const part of failed) log(part, {}, "error");
  if (failed.length > 0) throw new Error(`the outside refresh failed: ${failed.join(", ")}`);
}

const THUMB_PATH = /^\/thumbs\/([A-Za-z0-9_-]{11})\.jpg$/;

/** A picture's headers: public, cached for good, never sniffed or run as a page. */
function thumbHeaders(size: number): Record<string, string> {
  return {
    "Content-Type": "image/jpeg",
    "Content-Length": String(size),
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}

/** Answers `/thumbs/<id>.jpg`: a video's picture, public and cached for good, or the unknown path's 404. */
export async function handleThumb(request: Request, env: Bindings): Promise<Response> {
  const ref = THUMB_PATH.exec(new URL(request.url).pathname)?.[1];
  if ((request.method !== "GET" && request.method !== "HEAD") || ref === undefined) return json(404, { reason: "not-found" });
  const key = `${PICTURES}${ref}.jpg`;
  if (request.method === "HEAD") {
    const head = await env.PAGES.head(key);
    return head === null ? json(404, { reason: "not-found" }) : new Response(null, { status: 200, headers: thumbHeaders(head.size) });
  }
  const object = await env.PAGES.get(key);
  return object === null ? json(404, { reason: "not-found" }) : new Response(object.body, { status: 200, headers: thumbHeaders(object.size) });
}
