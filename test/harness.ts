// The Worker in Cloudflare's own runtime, for the Worker tests (test/talk.test.ts, test/threads-door.test.ts,
// test/threads.test.ts, test/members.test.ts, test/evaluate.test.ts, test/routing.test.ts, test/migrations.test.ts)
// and the signed-in local site (test/dev-signed-in.ts): Miniflare (pinned to the version the
// pinned wrangler itself runs, so the runtime and compatibility date are production's) runs the exact bundle
// `wrangler deploy --dry-run --outdir dist` writes, in front of the site's own files with the routing
// wrangler.jsonc declares (which paths reach the code, how the rest are served, and the binding the code hands
// files over through, which applies site/_redirects and site/_headers as the deploy does), with a real local D1 holding
// migrations/, all of them or up to the one a test names, so a test can stage a table as an earlier one left
// it and then apply the rest, and a real local R2 bucket for the pages saved into threads. Turnstile's
// verification is played here: a token of `pass` passes for the host the test last asked (the home page's or the
// threads'), `wrong-host` passes for
// another host, `wrong-action` for another action, `unreachable` answers as a check that is down, and
// anything else fails; under Cloudflare's test secret every token passes, as Cloudflare answers it. Cloudflare
// Access is played too: the team's certs address (wrangler.jsonc's `ACCESS_TEAM_DOMAIN`) serves the harness's
// own RSA keys, and `access.token` signs an application token with them as Access would, for the threads'
// application: the owner's, the sync's, or an invited person's (`memberClaims`). `access.evaluationClaims` are what
// Access sends the site's evaluation door at sign-in (src/evaluate.ts), signed the same way, and the Worker gets
// its own evaluation key (`EVALUATION_KEY`, whose public half the tests verify the answers with). The home page's
// outside sources are played as well (`outside`): his channel's feed (test/fixtures/youtube-feed.xml, made up),
// each product's newest release on GitHub's API, and a video's picture (test/fixtures/thumb.jpg), each of which a test
// may switch to another status, a hang, a malformed or oversized body. `startHarness({ triggers: true })` lets a test
// fire the Worker's hourly run (`scheduled`) through Miniflare's trigger path. Every other host the Worker tries is
// refused and recorded.

import { createPublicKey, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, Response as RuntimeResponse, type Request as RuntimeRequest } from "miniflare";

const root = fileURLToPath(new URL("..", import.meta.url));

const WRANGLER = readFileSync(join(root, "wrangler.jsonc"), "utf8");
/** wrangler.jsonc's date, read rather than copied, so the tests can't drift from it. */
const COMPATIBILITY_DATE = /"compatibility_date": "(\d{4}-\d{2}-\d{2})"/.exec(WRANGLER)?.[1];

/** One of wrangler.jsonc's `assets` settings, read rather than copied, so the tests route as the deploy does. */
function wranglerAsset(name: string): string {
  const value = new RegExp(`"${name}": "([^"]+)"`).exec(WRANGLER)?.[1];
  if (value === undefined) throw new Error(`wrangler.jsonc names no ${name}`);
  return value;
}
/** The paths that reach the code, as wrangler.jsonc lists them. */
const RUN_WORKER_FIRST = JSON.parse(/"run_worker_first": (\[[^\]]*\])/.exec(WRANGLER)?.[1] ?? "null") as unknown;
if (!Array.isArray(RUN_WORKER_FIRST) || !RUN_WORKER_FIRST.every((path) => typeof path === "string")) throw new Error("wrangler.jsonc names no run_worker_first list");
const HTML_HANDLING = wranglerAsset("html_handling");
/** The binding the code reads the site's files through. */
const ASSETS_BINDING = wranglerAsset("binding");
const NOT_FOUND_HANDLING = wranglerAsset("not_found_handling");
if (HTML_HANDLING !== "auto-trailing-slash" || NOT_FOUND_HANDLING !== "404-page") throw new Error("the harness doesn't know wrangler.jsonc's asset handling");

/** One of wrangler.jsonc's `vars`, read rather than copied, so the tests run the deployed settings. */
function wranglerVar(name: string): string {
  const value = new RegExp(`"${name}": "([^"]+)"`).exec(WRANGLER)?.[1];
  if (value === undefined) throw new Error(`wrangler.jsonc names no ${name}`);
  return value;
}
export const ACCESS_TEAM_DOMAIN = wranglerVar("ACCESS_TEAM_DOMAIN");
export const THREADS_ACCESS_AUD = wranglerVar("THREADS_ACCESS_AUD");
export const INBOX_SYNC_CLIENT_ID = wranglerVar("INBOX_SYNC_CLIENT_ID");
/** The owner's address in the harness; production's comes from the deploy and is in no file. */
export const OWNER = "owner@example.com";

const WORKER = "whysosuresh-com";
/** The home page's host, and the threads' one label below it (site/hosts.js), where everything behind the door lives. */
export const SITE = "https://whysosuresh.com";
export const THREADS = "https://hey.whysosuresh.com";
export const TURNSTILE_HOST = "challenges.cloudflare.com";
/** The bot check's secret in the harness; the played Turnstile refuses any other. */
export const SECRET = "turnstile-secret-for-the-harness";
/** Cloudflare's public always-pass test secret, which `npm run dev` gives the Worker. */
export const TEST_SECRET = "1x0000000000000000000000000000000AA";

/**
 * The parts of the local D1 the tests use. Miniflare types its bindings against Cloudflare's runtime
 * types, which the tests (on Node) don't load, so these say what the tests rely on.
 */
export interface Statement {
  bind(...values: unknown[]): Statement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}
/** The parts of the local R2 bucket the tests use. */
export interface Bucket {
  list(options?: { prefix?: string }): Promise<{ objects: { key: string; size: number }[] }>;
  get(key: string): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  put(key: string, value: Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}

/** The claims of an application token, as Cloudflare Access signs them; a key set to undefined is left out. */
export type Claims = Record<string, unknown>;


/** How a played token is made beyond its claims. */
export interface TokenOptions {
  /** The key id the header names; the served key's by default. */
  kid?: string;
  /** The header's algorithm; RS256 by default. */
  alg?: string;
  /** Signs with a key the certs address doesn't serve. */
  foreignKey?: boolean;
  /** Spoils the signature after signing. */
  badSignature?: boolean;
}

/** Cloudflare Access, as the harness plays it. */
export interface PlayedAccess {
  /** A signed application token: the owner's by default; `claims` change or (as undefined) remove claims. */
  token(claims?: Claims, options?: TokenOptions): string;
  /** The owner's claims and the sync's claims, for the threads' application, to build on. */
  ownerClaims(): Claims;
  syncClaims(): Claims;
  /** An invited person's claims for the threads' application: the owner's, with another address. */
  memberClaims(email: string): Claims;
  /**
   * What Access sends the evaluation door at sign-in, by the claim names it sent on 2026-11-05: `aud`, `exp`, `iat`,
   * the address that asked for a code (`identity.email`), a `nonce` and `request_url`, and no issuer or type.
   * Passed to `token`, it replaces every application claim.
   */
  evaluationClaims(email: string, nonce?: string): Claims;
  /** How many times the Worker fetched the certs. */
  readonly fetches: number;
  /** Serves a second key as well, as Cloudflare does while it rotates; returns its key id. */
  rotate(): string;
  /** Makes the certs address answer 503. */
  setDown(down: boolean): void;
}

/** How a played outside address answers: a status and a body, or a hang that never answers. */
export interface Played {
  readonly status?: number;
  readonly body?: string | Uint8Array;
  /** Sends the body as a stream, so the answer carries no Content-Length. */
  readonly stream?: boolean;
  /** Never answers, so the Worker's own timeout ends the request. */
  readonly hang?: boolean;
}

/** The made-up answers the home page's outside sources give, which a test switches per source. */
export interface PlayedOutside {
  /** The channel's feed: test/fixtures/youtube-feed.xml by default. */
  youtube: Played;
  /** Each repository's `releases/latest`, by `<owner>/<repo>`: a made-up newest release by default. */
  readonly releases: Map<string, Played>;
  /** A video's picture, by its id: test/fixtures/thumb.jpg by default. */
  readonly pictures: Map<string, Played>;
  /** Every outside address asked, in order: `youtube`, `release:<owner>/<repo>` or `picture:<id>`. */
  readonly asked: string[];
  /** Back to the defaults. */
  reset(): void;
}

/** The fixtures the played sources answer with by default. */
export const YOUTUBE_FEED = readFileSync(join(root, "test", "fixtures", "youtube-feed.xml"), "utf8");
export const THUMB = new Uint8Array(readFileSync(join(root, "test", "fixtures", "thumb.jpg")));
/** A made-up newest release of a repository, as GitHub's API answers it. */
export function releaseAnswer(repo: string, tag: string, publishedAt: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tag_name: tag,
    name: `Release ${tag}`,
    html_url: `https://github.com/${repo}/releases/tag/${tag}`,
    published_at: publishedAt,
    draft: false,
    prerelease: false,
    body: "## Install\n\n```\nmade up\n```",
    ...fields,
  });
}
/** The made-up newest releases the played GitHub answers with by default. */
export const RELEASES: Record<string, string> = {
  "stigmer/stigmer": releaseAnswer("stigmer/stigmer", "v0.1.2", "2026-11-06T23:43:27Z"),
  "whysosuresh/capsjump": releaseAnswer("whysosuresh/capsjump", "v0.9.10", "2026-10-23T08:00:00Z"),
};

function playOutside(): PlayedOutside {
  const played: PlayedOutside = {
    youtube: {},
    releases: new Map(),
    pictures: new Map(),
    asked: [],
    reset() {
      played.youtube = {};
      played.releases.clear();
      played.pictures.clear();
      played.asked.length = 0;
    },
  };
  return played;
}

/** A played answer, with the default body when the test gave none. */
function playedAnswer(played: Played, fallback: string | Uint8Array, type: string): RuntimeResponse | Promise<RuntimeResponse> {
  if (played.hang === true) return new Promise<RuntimeResponse>(() => undefined);
  const body = played.body ?? fallback;
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const sent =
    played.stream === true
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            for (let at = 0; at < bytes.byteLength; at += 16 * 1024) controller.enqueue(bytes.slice(at, at + 16 * 1024));
            controller.close();
          },
        })
      : bytes;
  return new RuntimeResponse(sent as never, { status: played.status ?? 200, headers: { "content-type": type } });
}

export interface Harness {
  /** Sends a request to the Worker as the edge would hand it over. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** The Worker's database, to look at or stage what it holds. */
  db(): Promise<Database>;
  /** The pages bucket, to look at what the Worker kept. */
  pages(): Promise<Bucket>;
  /** Every host the Worker tried to reach. */
  outboundHosts: Set<string>;
  /** Cloudflare Access, played. */
  access: PlayedAccess;
  /** The home page's outside sources, played. */
  outside: PlayedOutside;
  /** Fires the Worker's hourly run, as its cron trigger does, and answers how it ended (`ok`, or why not). */
  scheduled(): Promise<string>;
  /** Applies the migrations not yet applied, up to and including `through` (a four-digit number), or all of them. */
  migrate(through?: string): Promise<void>;
  /** Empties every table, between tests. */
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

/** Each migration, in order: its four-digit number and its statements, without their comments. */
function migrations(): { number: string; statements: string[] }[] {
  const dir = join(root, "migrations");
  return readdirSync(dir)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort()
    .map((file) => ({
      number: file.slice(0, 4),
      statements: readFileSync(join(dir, file), "utf8")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .split(/;\s*$/m)
        .map((statement) => statement.trim())
        .filter((statement) => statement !== ""),
    }));
}

/** The tables `reset` empties, children before the tables they name, because D1 checks foreign keys. */
const TABLES = ["outside_items", "events", "comments", "members", "attendees", "pages", "threads", "people", "talk_days", "talk_senders", "answer_senders", "ask_thread_senders", "ask_answer_senders", "journal_answers", "journal_storylines", "journal_entries", "journal_versions", "journal_photos", "now_lines"];

/**
 * The Worker's evaluation key in the harness, as the deploy hands it over (an RSA private key as a JWK), and its
 * public half, which the tests check the evaluation door's answers and its keys address against.
 */
const evaluation = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const EVALUATION_KEY = JSON.stringify(evaluation.privateKey.export({ format: "jwk" }));
export const EVALUATION_PUBLIC_KEY: KeyObject = createPublicKey(evaluation.privateKey);

const base64Url = (bytes: Buffer): string => bytes.toString("base64url");

interface ServedKey {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

function newKey(kid: string): ServedKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
}

function playAccess(): PlayedAccess & { serve(request: RuntimeRequest): RuntimeResponse } {
  const keys = [newKey("harness-key-1")];
  const foreign = newKey("harness-key-1");
  let fetches = 0;
  let down = false;

  const now = (): number => Math.floor(Date.now() / 1000);
  const common = (): Claims => ({
    aud: [THREADS_ACCESS_AUD],
    iss: `https://${ACCESS_TEAM_DOMAIN}`,
    iat: now(),
    nbf: now(),
    exp: now() + 3600,
    type: "app",
  });

  return {
    ownerClaims: () => ({ ...common(), email: OWNER, sub: "7335d417-61da-459d-899c-0a01c76a2f94", identity_nonce: "nonce", country: "IN" }),
    // A service token's claims carry no email or identity, only the token's client id (Cloudflare's
    // application-token page); the owner's are removed so `token()` doesn't merge them in.
    syncClaims: () => ({ ...common(), common_name: INBOX_SYNC_CLIENT_ID, sub: "", email: undefined, identity_nonce: undefined, country: undefined }),
    memberClaims(email) {
      return { ...this.ownerClaims(), email, sub: "0f6f2c1e-6a40-4a5e-9d5e-3f1d5b2a7c11" };
    },
    evaluationClaims: (email, nonce = "nonce-from-access") => ({
      // Its audience is sent but never checked, so the harness's value stands for any.
      aud: "an-audience-the-door-does-not-check",
      iat: now(),
      exp: now() + 60,
      nonce,
      identity: { email, idp: { type: "onetimepin" } },
      request_url: "https://hey.whysosuresh.com/threads/api/sign-in",
      iss: undefined,
      nbf: undefined,
      type: undefined,
      email: undefined,
      sub: undefined,
      identity_nonce: undefined,
      country: undefined,
    }),
    token(claims = {}, options = {}) {
      const signer = options.foreignKey ? foreign : (keys[keys.length - 1] ?? foreign);
      const merged: Claims = { ...this.ownerClaims(), ...claims };
      for (const [key, value] of Object.entries(merged)) if (value === undefined) delete merged[key];
      const header = base64Url(Buffer.from(JSON.stringify({ alg: options.alg ?? "RS256", kid: options.kid ?? signer.kid, typ: "JWT" })));
      const payload = base64Url(Buffer.from(JSON.stringify(merged)));
      const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(signer.privateKey);
      if (options.badSignature) signature[10] = (signature[10] ?? 0) ^ 0xff;
      return `${header}.${payload}.${base64Url(signature)}`;
    },
    get fetches() {
      return fetches;
    },
    rotate() {
      const key = newKey(`harness-key-${keys.length + 1}`);
      keys.push(key);
      return key.kid;
    },
    setDown(value) {
      down = value;
    },
    serve() {
      fetches += 1;
      if (down) return new RuntimeResponse("down", { status: 503 });
      return new RuntimeResponse(JSON.stringify({ keys: keys.map((key) => key.jwk) }), { headers: { "content-type": "application/json" } });
    },
  };
}

export async function startHarness(options: { secret?: string; owner?: string; through?: string; evaluationKey?: string; triggers?: boolean } = {}): Promise<Harness> {
  const bundlePath = join(root, "dist", "worker.js");
  if (!existsSync(bundlePath)) throw new Error("dist/worker.js is missing: run `npm run dry-run` first (`npm test` does)");
  if (!COMPATIBILITY_DATE) throw new Error("wrangler.jsonc names no compatibility_date");
  const outboundHosts = new Set<string>();
  // The host the test last asked: the page a played widget ran on, which a passing verdict names, as Turnstile's does.
  let askedHost = new URL(SITE).hostname;
  const access = playAccess();
  const outside = playOutside();

  async function outbound(request: RuntimeRequest): Promise<RuntimeResponse> {
    const url = new URL(request.url);
    outboundHosts.add(url.host);
    if (url.host === ACCESS_TEAM_DOMAIN && url.pathname === "/cdn-cgi/access/certs" && request.method === "GET") {
      return access.serve(request);
    }
    if (url.host === TURNSTILE_HOST && url.pathname === "/turnstile/v0/siteverify" && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      const token = form.get("response");
      if (token === "unreachable") return new RuntimeResponse("down", { status: 503 });
      // Cloudflare's own test secret passes any token, for example.com and no action, as Cloudflare answers it.
      if (form.get("secret") === TEST_SECRET) {
        return new RuntimeResponse(JSON.stringify({ success: true, hostname: "example.com", metadata: { result_with_testing_key: true } }), { headers: { "content-type": "application/json" } });
      }
      const known = form.get("secret") === SECRET && form.get("remoteip") !== null;
      const verdict = {
        success: known && ["pass", "wrong-host", "wrong-action"].includes(token ?? ""),
        hostname: token === "wrong-host" ? "elsewhere.example" : askedHost,
        action: token === "wrong-action" ? "subscribe" : "talk",
      };
      return new RuntimeResponse(JSON.stringify(verdict), { headers: { "content-type": "application/json" } });
    }
    if (url.host === "www.youtube.com" && url.pathname === "/feeds/videos.xml" && request.method === "GET") {
      outside.asked.push("youtube");
      return playedAnswer(outside.youtube, YOUTUBE_FEED, "text/xml; charset=UTF-8");
    }
    const release = /^\/repos\/([\w.-]+\/[\w.-]+)\/releases\/latest$/.exec(url.pathname)?.[1];
    if (url.host === "api.github.com" && release !== undefined && request.method === "GET") {
      outside.asked.push(`release:${release}`);
      if (request.headers.get("user-agent") === null) return new RuntimeResponse("a User-Agent is required", { status: 403 });
      const answer = RELEASES[release];
      return playedAnswer(outside.releases.get(release) ?? (answer === undefined ? { status: 404 } : {}), answer ?? '{"message":"Not Found"}', "application/json; charset=utf-8");
    }
    const picture = /^\/vi\/([\w-]+)\/mqdefault\.jpg$/.exec(url.pathname)?.[1];
    if (url.host === "i.ytimg.com" && picture !== undefined && request.method === "GET") {
      outside.asked.push(`picture:${picture}`);
      return playedAnswer(outside.pictures.get(picture) ?? {}, THUMB, "image/jpeg");
    }
    return new RuntimeResponse("refused by the test harness", { status: 599 });
  }

  const secret = options.secret ?? SECRET;
  const owner = options.owner ?? OWNER;
  const evaluationKey = options.evaluationKey ?? EVALUATION_KEY;
  const mf = new Miniflare({
    host: "127.0.0.1",
    port: 0,
    ...(options.triggers === true ? { unsafeTriggerHandlers: true } : {}),
    workers: [
      {
        config: {
          name: WORKER,
          compatibilityDate: COMPATIBILITY_DATE,
          manifest: { mainModule: "worker.js", modules: { "worker.js": { type: "esm", contents: readFileSync(bundlePath, "utf8") } } },
          assets: {
            directory: join(root, "site"),
            hasUserWorker: true,
            htmlHandling: HTML_HANDLING,
            notFoundHandling: NOT_FOUND_HANDLING,
            runWorkerFirst: RUN_WORKER_FIRST,
          },
          env: {
            [ASSETS_BINDING]: { type: "assets" as const },
            DB: { type: "d1", id: "whysosuresh-com" },
            PAGES: { type: "r2", name: "whysosuresh-com-pages" },
            ...(secret === "" ? {} : { TURNSTILE_SECRET: { type: "text" as const, value: secret } }),
            ...(owner === "" ? {} : { INBOX_OWNER_EMAIL: { type: "text" as const, value: owner } }),
            ...(evaluationKey === "" ? {} : { THREADS_EVALUATION_KEY: { type: "text" as const, value: evaluationKey } }),
            ACCESS_TEAM_DOMAIN: { type: "text" as const, value: ACCESS_TEAM_DOMAIN },
            THREADS_ACCESS_AUD: { type: "text" as const, value: THREADS_ACCESS_AUD },
            INBOX_SYNC_CLIENT_ID: { type: "text" as const, value: INBOX_SYNC_CLIENT_ID },
          },
        },
        dev: { outboundService: { type: "fetcher", handler: outbound } },
      },
    ],
  });
  await mf.ready;

  const db = async (): Promise<Database> => (await mf.getD1Database("DB", WORKER)) as unknown as Database;
  const pending = migrations();
  async function migrate(through?: string): Promise<void> {
    const database = await db();
    while (pending[0] !== undefined && (through === undefined || pending[0].number <= through)) {
      const next = pending.shift();
      if (next !== undefined) await database.batch(next.statements.map((statement) => database.prepare(statement)));
    }
  }
  await migrate(options.through);

  return {
    async fetch(url, init) {
      askedHost = new URL(url).hostname;
      return (await mf.dispatchFetch(url, init as never)) as unknown as Response;
    },
    db,
    pages: async () => (await mf.getR2Bucket("PAGES", WORKER)) as unknown as Bucket,
    outboundHosts,
    access,
    outside,
    async scheduled() {
      if (options.triggers !== true) throw new Error("start the harness with { triggers: true } to fire the hourly run");
      const response = (await mf.dispatchFetch(`${SITE}/cdn-cgi/local/scheduled?cron=${encodeURIComponent("17 * * * *")}&format=json`)) as unknown as Response;
      return ((await response.json()) as { outcome: string }).outcome;
    },
    migrate,
    async reset() {
      const database = await db();
      const present = new Set(
        (await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()).results.map((table) => table.name),
      );
      await database.batch(TABLES.filter((table) => present.has(table)).map((table) => database.prepare(`DELETE FROM ${table}`)));
      const bucket = (await mf.getR2Bucket("PAGES", WORKER)) as unknown as Bucket;
      const kept = (await bucket.list()).objects.map((object) => object.key);
      if (kept.length > 0) await bucket.delete(kept);
      outboundHosts.clear();
      outside.reset();
    },
    dispose: () => mf.dispose(),
  };
}
