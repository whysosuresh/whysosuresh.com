// The signed-in local site, for looking at the threads page in a real browser before a deploy:
// `npm run dev:signed-in` serves http://localhost:8790/ from the Worker's own bundle in workerd (test/harness.ts),
// with a local D1 and R2 holding a few made-up threads, and plays Cloudflare Access by signing every call under
// /threads/api/ as the owner, the way the edge hands a signed-in request over. `--signed-out` signs nothing, so the
// page shows what a visitor sees; `--member <address>` signs every call as a person signed in by that address, so
// the page shows what an invited person sees. The seed always shares one thread ("Who owns what") with a made-up
// person, Meera, at that address or meera@example.com, who has the last word on it, beside an "Only me" comment of
// the owner's: the owner's Today shows it waiting on him, and the invited person never sees the note. Pages are seeded the way the sync saves them, through the threads' call with its
// played token: the sealed probe (test/fixtures/sealed-probe.html, every line of which should read "blocked" in the
// browser), and each file given with `--page <file>` (an
// artifact's HTML as the Artifact tool's read saved it) as a version of one thread. Requests reach the Worker at
// this local address, so the script a page carries addresses its height to it, as it addresses whysosuresh.com
// live. Nothing here is deployed or reaches Cloudflare: the harness refuses every outside request but Access's
// played keys.

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SITE, startHarness, type Harness } from "./harness.ts";

const PORT = 8790;
const LOCAL = `http://localhost:${PORT}`;
const signedOut = process.argv.includes("--signed-out");
/** The address after `--member`, signed in as an invited person instead of the owner. */
const memberAt = process.argv.indexOf("--member");
const member = memberAt === -1 ? null : (process.argv[memberAt + 1] ?? "");
if (member !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member)) {
  console.error("--member takes an email address, such as meera@example.com");
  process.exit(2);
}
/** Each file after a `--page`, saved in order as versions of one thread's page. */
const pageFiles = process.argv.flatMap((arg, i) => (process.argv[i - 1] === "--page" ? [arg] : []));

const harness: Harness = await startHarness();
const sync = (): string => harness.access.token(harness.access.syncClaims());

/** Sends one call as the sync, as `inbox` does, and answers its JSON. */
async function asSync(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await harness.fetch(`${SITE}/threads/api/threads${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": sync() },
    body: new TextEncoder().encode(JSON.stringify(body)),
  });
  if (!response.ok) throw new Error(`seeding ${path} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as Record<string, unknown>;
}

/** Made-up threads in every tab and source, so each screen has something to show. */
async function seed(): Promise<void> {
  const add = async (ref: string, fields: Record<string, unknown>): Promise<number> =>
    ((await asSync("", { ref, source: "self", status: "received", space: "company", ...fields })).thread as { number: number }).number;
  const who = await add("chat:seed-1", {
    title: "Who owns what",
    status: "discuss",
    body: "After the first release, the three of us decide most things in passing. One page that says who owns each area.\n\n| Area | Owner |\n|---|---|\n| The command line | Suresh |\n| Hosted cloud | Asha |\n\nRelated: #2 for the video editor.",
  });
  await add("chat:seed-2", { title: "Hire a part-time video editor", status: "discuss", space: "videos", body: "Two episodes a week is more than I can cut. Someone for the rough cut only." });
  await add("chat:seed-3", { title: "Pricing for small teams", status: "act", space: "stigmer", body: "A price a team of three can say yes to without a meeting." });
  await add("chat:seed-4", { source: "told", name: "Dev K.", title: "A key for the tab I used last", space: "capsjump", body: "He jumps between two tabs all day and wants Caps Lock plus one key to flip back." });
  await add("chat:seed-5", { title: "Talk at the meetup in December", body: "Asked on the way out of the October meetup. Twenty minutes, any topic." });
  const done = await add("chat:seed-6", { title: "Rename the inbox to threads", status: "act", space: "other", body: "Things need names people can say." });
  await asSync(`/${done}`, { action: "done" });
  await asSync(`/${who}/text`, { field: "summary", text: "Decided: a release needs two people.\nOpen: who owns pricing.\nWaiting on: you.\nNext: settle pricing on Friday's call." });
  await asSync(`/${who}/comments`, { body: "From the call: Asha takes on-call, and wants releases to need two of us." });
  const guest = member ?? "meera@example.com";
  /** Sends one call from a signed-in browser on the site: the owner's, or the invited guest's. */
  const asPerson = async (claims: Record<string, unknown>, path: string, body: unknown): Promise<void> => {
    const response = await harness.fetch(`${SITE}/threads/api/threads${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SITE, "Cf-Access-Jwt-Assertion": harness.access.token(claims) },
      body: new TextEncoder().encode(JSON.stringify(body)),
    });
    if (!response.ok) throw new Error(`seeding ${path} answered ${response.status}: ${await response.text()}`);
  };
  const owner = harness.access.ownerClaims();
  await asPerson(owner, `/${who}/comments`, { body: "Before sharing: pricing stays between us until Friday.", audience: "owner" });
  await asPerson(owner, `/${who}/people`, { add: { email: guest, name: "Meera" } });
  await asPerson(owner, `/${who}/comments`, { body: "Meera, would you own pricing?" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await asPerson(harness.access.memberClaims(guest), `/${who}/comments`, { body: "Happy to own pricing. I'll draft the tiers by Thursday." });

  const database = await harness.db();
  await database
    .prepare(
      `INSERT INTO threads (id, number, created_at, activity_at, source, space, body, status, sender_name, sender_email)
       VALUES (?1, (SELECT MAX(number) + 1 FROM threads), ?2, ?2, 'talk', 'stigmer', ?3, 'received', 'Asha', 'asha@example.com')`,
    )
    .bind(crypto.randomUUID(), new Date().toISOString(), "Followed the install page on Windows. It stops after \"fetching the runner\" with no message.")
    .run();
  const page = async (number: number, html: Uint8Array, from: string | null): Promise<void> => {
    const query = from === null ? "" : `?${new URLSearchParams({ from }).toString()}`;
    const response = await harness.fetch(`${SITE}/threads/api/threads/${number}/pages${query}`, {
      method: "POST",
      headers: { "Content-Type": "text/html; charset=utf-8", "Cf-Access-Jwt-Assertion": sync() },
      body: html,
    });
    if (response.status !== 201) throw new Error(`seeding a page into #${number} answered ${response.status}: ${await response.text()}`);
  };
  const probe = await add("chat:seed-probe", { title: "Sealed probe", status: "act", space: "other", body: "A page that tries every way out of its frame." });
  await page(probe, new Uint8Array(readFileSync(new URL("./fixtures/sealed-probe.html", import.meta.url))), null);
  const pricing = await add("chat:seed-pricing", { title: "Hosted cloud pricing", status: "discuss", space: "company", body: "The pricing proposal, as a page." });
  const files = pageFiles.length > 0 ? pageFiles : [];
  if (files.length === 0) {
    const sample = (n: number): string =>
      `<!doctype html><html><head><meta charset="utf-8"><title>Pricing</title><style>body{font:15px/1.5 system-ui;margin:24px}button[aria-selected=true]{font-weight:700}</style></head><body><h1>Hosted cloud pricing, version ${n}</h1><p>Three ways to charge.</p><div><button aria-selected="true">Per seat</button> <button>Per run</button> <button>Flat</button></div>${"<p>A line to make the page tall.</p>".repeat(30)}<script>for(const b of document.querySelectorAll('button'))b.onclick=()=>{for(const o of document.querySelectorAll('button'))o.setAttribute('aria-selected',String(o===b))}</script></body></html>`;
    await page(pricing, new TextEncoder().encode(sample(1)), "https://claude.ai/artifact/example-pricing");
    await page(pricing, new TextEncoder().encode(sample(2)), "https://claude.ai/artifact/example-pricing");
  }
  for (const file of files) await page(pricing, new Uint8Array(readFileSync(file)), null);
  await asSync(`/${pricing}/text`, { field: "summary", text: "Decided: small teams use it free until launch.\nOpen: per seat, per run, or flat.\nWaiting on: the cost per run.\nNext: pick one on Friday." });
  const slides = await add("chat:seed-slides", { title: "Launch talk slides", status: "act", space: "stigmer", body: "The launch talk, as slides on claude.ai." });
  await asSync(`/${slides}/link`, { url: "https://claude.ai/artifact/example-slides", title: "Launch talk" });

  // One thread untouched for ten days, so Today has something that sat a week.
  const old = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
  await database.prepare("UPDATE threads SET activity_at = ?1 WHERE origin_ref = 'chat:seed-2'").bind(old).run();
}

async function body(request: IncomingMessage): Promise<Uint8Array | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return chunks.length === 0 ? undefined : new Uint8Array(Buffer.concat(chunks));
}

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = request.url ?? "/";
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || ["host", "connection", "content-length"].includes(name)) continue;
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  if (path.startsWith("/threads/api/") && !signedOut) {
    headers["cf-access-jwt-assertion"] = harness.access.token(member === null ? harness.access.ownerClaims() : harness.access.memberClaims(member));
  }
  const method = request.method ?? "GET";
  const sent = method === "GET" || method === "HEAD" ? undefined : await body(request);
  const answer = await harness.fetch(`${LOCAL}${path}`, { method, headers, redirect: "manual", ...(sent === undefined ? {} : { body: sent }) });
  const out: Record<string, string> = {};
  answer.headers.forEach((value, name) => {
    out[name] = value;
  });
  // The site's HSTS would pin localhost to https in the browser, so it stays out of the local answers.
  delete out["strict-transport-security"];
  response.writeHead(answer.status, out);
  response.end(Buffer.from(await answer.arrayBuffer()));
}

await seed();
createServer((request, response) => {
  serve(request, response).catch((error: unknown) => {
    console.error(error);
    response.writeHead(500).end();
  });
}).listen(PORT, "127.0.0.1", () => {
  const as = signedOut ? "signed out" : member === null ? "signed in as the owner" : `signed in as ${member}, invited to one thread`;
  console.log(`The threads, ${as}: ${LOCAL}/threads/ (Ctrl-C stops it)`);
});
process.on("SIGINT", () => {
  void harness.dispose().then(() => process.exit(0));
});
