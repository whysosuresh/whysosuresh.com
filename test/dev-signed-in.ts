// The signed-in local site, for looking at the threads page in a real browser before a deploy:
// `npm run dev:signed-in` serves http://localhost:8790/ from the Worker's own bundle in workerd (test/harness.ts),
// with a local D1 holding a few made-up threads, and plays Cloudflare Access by signing every call under
// /threads/api/ and /inbox/api/ as the owner, the way the edge hands a signed-in request over. The browser's own
// origin is told to the Worker as the site's, so the owner's writes pass the same-origin check they pass in
// production. `--signed-out` signs nothing, so the page shows what a visitor sees. Nothing here is deployed or
// reaches Cloudflare: the harness refuses every outside request but Access's played keys.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SITE, startHarness, type Harness } from "./harness.ts";

const PORT = 8790;
const LOCAL = `http://localhost:${PORT}`;
const signedOut = process.argv.includes("--signed-out");

const harness: Harness = await startHarness();
const sync = (): string => harness.access.token(harness.access.syncClaims("threads"), { app: "threads" });

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

  const database = await harness.db();
  await database
    .prepare(
      `INSERT INTO threads (id, number, created_at, activity_at, source, space, body, status, sender_name, sender_email)
       VALUES (?1, (SELECT MAX(number) + 1 FROM threads), ?2, ?2, 'talk', 'stigmer', ?3, 'received', 'Asha', 'asha@example.com')`,
    )
    .bind(crypto.randomUUID(), new Date().toISOString(), "Followed the install page on Windows. It stops after \"fetching the runner\" with no message.")
    .run();
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
  if (headers.origin === LOCAL) headers.origin = SITE;
  const app = path.startsWith("/threads/api/") ? "threads" : path.startsWith("/inbox/api/") ? "inbox" : null;
  if (app !== null && !signedOut) headers["cf-access-jwt-assertion"] = harness.access.token(harness.access.ownerClaims(app), { app });
  const method = request.method ?? "GET";
  const sent = method === "GET" || method === "HEAD" ? undefined : await body(request);
  const answer = await harness.fetch(`${SITE}${path}`, { method, headers, redirect: "manual", ...(sent === undefined ? {} : { body: sent }) });
  const out: Record<string, string> = {};
  answer.headers.forEach((value, name) => {
    out[name] = name === "location" && value.startsWith(SITE) ? value.slice(SITE.length) || "/" : value;
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
  console.log(`The threads, ${signedOut ? "signed out" : "signed in as the owner"}: ${LOCAL}/threads/ (Ctrl-C stops it)`);
});
process.on("SIGINT", () => {
  void harness.dispose().then(() => process.exit(0));
});
