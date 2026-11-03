// The Worker in Cloudflare's own runtime, for test/talk.test.ts: Miniflare (pinned to the version the pinned
// wrangler itself runs, so the runtime and compatibility date are production's) runs the exact bundle
// `wrangler deploy --dry-run --outdir dist` writes, with a real local D1 holding migrations/ and a real
// local R2. Turnstile's verification is played here: a token of `pass` passes for the request's own host,
// `wrong-host` passes for another host, `wrong-action` for another action, `unreachable` answers as a check
// that is down, and anything else fails. Every other host the Worker tries is refused and recorded.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, Response as RuntimeResponse, type Request as RuntimeRequest } from "miniflare";

const root = fileURLToPath(new URL("..", import.meta.url));

/** wrangler.jsonc's date, read rather than copied, so the tests can't drift from it. */
const COMPATIBILITY_DATE = /"compatibility_date": "(\d{4}-\d{2}-\d{2})"/.exec(readFileSync(join(root, "wrangler.jsonc"), "utf8"))?.[1];

export const SITE = "https://whysosuresh.com";
export const TURNSTILE_HOST = "challenges.cloudflare.com";
/** The bot check's secret in the harness; the played Turnstile refuses any other. */
export const SECRET = "turnstile-secret-for-the-harness";

export interface Harness {
  /** Sends a request to the Worker as the edge would hand it over. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** The Worker's database, to look at or stage what it holds. */
  db(): ReturnType<Miniflare["getD1Database"]>;
  /** The recordings' bucket. */
  bucket(): ReturnType<Miniflare["getR2Bucket"]>;
  /** Every host the Worker tried to reach. */
  outboundHosts: Set<string>;
  /** Empties every table and the bucket, between tests. */
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

/** The statements of each migration, in order, without their comments. */
function migrations(): string[] {
  const dir = join(root, "migrations");
  return readdirSync(dir)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort()
    .flatMap((file) =>
      readFileSync(join(dir, file), "utf8")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .split(/;\s*$/m)
        .map((statement) => statement.trim())
        .filter((statement) => statement !== ""),
    );
}

export async function startHarness(options: { secret?: string } = {}): Promise<Harness> {
  const bundlePath = join(root, "dist", "worker.js");
  if (!existsSync(bundlePath)) throw new Error("dist/worker.js is missing: run `npm run dry-run` first (`npm test` does)");
  if (!COMPATIBILITY_DATE) throw new Error("wrangler.jsonc names no compatibility_date");
  const outboundHosts = new Set<string>();

  async function outbound(request: RuntimeRequest): Promise<RuntimeResponse> {
    const url = new URL(request.url);
    outboundHosts.add(url.host);
    if (url.host === TURNSTILE_HOST && url.pathname === "/turnstile/v0/siteverify" && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      const token = form.get("response");
      if (token === "unreachable") return new RuntimeResponse("down", { status: 503 });
      const known = form.get("secret") === SECRET && form.get("remoteip") !== null;
      const verdict = {
        success: known && ["pass", "wrong-host", "wrong-action"].includes(token ?? ""),
        hostname: token === "wrong-host" ? "elsewhere.example" : new URL(SITE).hostname,
        action: token === "wrong-action" ? "subscribe" : "talk",
      };
      return new RuntimeResponse(JSON.stringify(verdict), { headers: { "content-type": "application/json" } });
    }
    return new RuntimeResponse("refused by the test harness", { status: 599 });
  }

  const secret = options.secret ?? SECRET;
  const mf = new Miniflare({
    compatibilityDate: COMPATIBILITY_DATE,
    modules: [{ type: "ESModule", path: bundlePath, contents: readFileSync(bundlePath, "utf8") }],
    d1Databases: { DB: "whysosuresh-com" },
    r2Buckets: { AUDIO: "whysosuresh-com-recordings" },
    bindings: secret === "" ? {} : { TURNSTILE_SECRET: secret },
    outboundService: outbound,
  });
  await mf.ready;

  const db = () => mf.getD1Database("DB");
  const schema = await db();
  await schema.batch(migrations().map((statement) => schema.prepare(statement)));

  return {
    async fetch(url, init) {
      return (await mf.dispatchFetch(url, init as never)) as unknown as Response;
    },
    db,
    bucket: () => mf.getR2Bucket("AUDIO"),
    outboundHosts,
    async reset() {
      const database = await db();
      await database.batch(["inputs", "talk_days", "talk_senders"].map((table) => database.prepare(`DELETE FROM ${table}`)));
      const bucket = await mf.getR2Bucket("AUDIO");
      const listed = await bucket.list();
      if (listed.objects.length > 0) await bucket.delete(listed.objects.map((object) => object.key));
      outboundHosts.clear();
    },
    dispose: () => mf.dispose(),
  };
}
