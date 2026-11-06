// The signed-in local site, for looking at the threads page in a real browser before a deploy:
// `npm run dev:signed-in` serves http://localhost:8790/ from the Worker's own bundle in workerd (test/harness.ts),
// with a local D1 and R2 holding a few made-up threads, and plays Cloudflare Access by signing every call under
// /threads/api/ as the owner, the way the edge hands a signed-in request over. `--signed-out` signs nothing, so the
// page shows what a visitor sees; `--member <address>` signs every call as a person signed in by that address, so
// the page shows what an invited person sees. The seed always shares one thread ("Who owns what") with a made-up
// person, Meera, at that address or meera@example.com, who has the last word on it, beside an "Only me" comment of
// the owner's: the owner's Today shows it waiting on him, and the invited person never sees the note. One thread of
// his own is public ("Shipping Stigmer 0.1.0, in public"), shared with the same person, with a comment of his
// written for anyone, a visitor's note he OK'd and one waiting for his OK, whose words hold Markdown and a link that
// must show as typed; signed out, its address shows the public view. The pricing page thread is public as well, and
// not shared, so the invited person reads it in the public view too. Everyone in the seed is a person: Asha wrote
// from the site and was then invited to the meetup thread, Dev K. told him something in person, Meera is invited
// (with his own notes on her), Tomás wrote on the public thread with an address (Priya gave none, so she is no
// person), and Rex's only note was junk he dropped, so Rex sits under the people only in dropped threads. Four
// threads are meetings, set as the sync sets them, relative to now so Today always has some coming up: "Who owns
// what" later today (with Meera, who is invited, and Dev K., who has no address), the review next Wednesday (with
// Meera and Asha), the meetup a few days out as a day with no time (with Asha and Leela, someone new added by name),
// and pricing for small teams three days ago (with Asha). Pages are seeded the way the sync saves them, through the threads' call with its
// played token: the sealed probe (test/fixtures/sealed-probe.html, every line of which should read "blocked" in the
// browser), a made-up page that asks questions ("The review on Wednesday", shared with the guest and Asha), with
// answers, a discussion on its words, one on words its second version cut, and replies, and each file given with
// `--page <file>` (an
// artifact's HTML as the Artifact tool's read saved it) as a version of one thread. Requests reach the Worker at
// this local address, so the bridge a page carries addresses what it says to it, as it addresses whysosuresh.com
// live. Nothing here is deployed or reaches Cloudflare: the harness refuses every outside request but Access's
// played keys.

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SITE, TEST_SECRET, startHarness, type Harness } from "./harness.ts";

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

// Cloudflare's always-pass test secret, as `npm run dev` gives the Worker, so the browser's test widget's token passes
// the bot check when a note is sent on the public thread.
const harness: Harness = await startHarness({ secret: TEST_SECRET });
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

/**
 * A made-up page that asks questions, as Claude builds one for a thread: each question marked with an id that stays
 * fixed across versions, and a line for claude.ai alone, which the bridge hides on the thread. Version 2 cuts the
 * demo from twenty minutes to twelve.
 */
function reviewPage(version: number): string {
  const demo = version === 1 ? "twenty minutes of demo" : "twelve minutes of demo";
  return `<!doctype html><html><head><meta charset="utf-8"><title>The review</title><style>body{font:16px/1.6 Georgia,serif;margin:0;padding:32px 40px;background:#fbfaf7;color:#1d1b18}h1{font-size:28px;margin:0 0 6px}h2{font-size:18px;border-bottom:1px solid #e4e0d6;padding-bottom:6px;margin-top:28px}small{font:600 11px system-ui;letter-spacing:.1em;text-transform:uppercase;color:#2b4c7e}.row{display:grid;grid-template-columns:92px 1fr;gap:14px}.row span{font:13px/1.9 ui-monospace,monospace;color:#6b665d}.q p{font-weight:600;margin:18px 0 6px}@media (prefers-color-scheme:dark){body{background:#1a1916;color:#ece8df}}</style></head><body>
<small>Company · Wednesday 12 November, 15:00 · version ${version}</small>
<h1>The review: how the half hour runs</h1>
<p data-outside-thread><em>Answer these on the thread.</em></p>
<h2>The half hour</h2>
<div class="row"><span>0–3 min</span><p>Dev opens and says why we are in the room.</p></div>
<div class="row"><span>3–15 min</span><p>Then ${demo}, told as a story: the setup, the three things that broke last month, then the same job on the new runner.</p></div>
<div class="row"><span>15–25 min</span><p>Questions. Product questions go to Suresh, money questions go to Asha. The live app is shown only if someone asks to see it running.</p></div>
<div class="row"><span>25–30 min</span><p>Next steps, written into the thread before anyone leaves.</p></div>
<h2>Over to you</h2>
<div class="q" data-thread-question="right-part"><p>Is your part the right length, or should it be longer or shorter?</p></div>
<div class="q" data-thread-question="order"><p>Would you run the half hour in a different order?</p></div>
<div class="q" data-thread-question="missing"><p>Is there something the room will expect that isn't here?</p></div>
</body></html>`;
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
  /** A note sent from the site's note flow, as a visitor sends one; answers its thread's number. */
  const siteNote = async (name: string, email: string, words: string): Promise<number> => {
    const response = await harness.fetch(`${SITE}/api/talk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SITE, "CF-Connecting-IP": "203.0.113.40" },
      body: new TextEncoder().encode(JSON.stringify({ topic: "stigmer", body: words, name, email, token: "pass" })),
    });
    if (response.status !== 201) throw new Error(`seeding a site note answered ${response.status}: ${await response.text()}`);
    return (await database.prepare("SELECT MAX(number) AS n FROM threads").first<{ n: number }>())?.n ?? 0;
  };
  await siteNote("Asha", "asha@example.com", "Followed the install page on Windows. It stops after \"fetching the runner\" with no message.");
  const junk = await siteNote("Rex", "rex@example.net", "Cheap followers, best price, reply now.");
  await asSync(`/${junk}`, { action: "drop", reason: "spam" });
  const meetup = (await database.prepare("SELECT number FROM threads WHERE origin_ref = 'chat:seed-5'").first<{ number: number }>())?.number ?? 0;
  await asPerson(owner, `/${meetup}/people`, { add: { email: "asha@example.com", name: "Asha" } });
  /** A change to a person from the owner's own page. */
  const toPerson = async (number: number, change: Record<string, string>): Promise<void> => {
    const response = await harness.fetch(`${SITE}/threads/api/people/${number}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SITE, "Cf-Access-Jwt-Assertion": harness.access.token(owner) },
      body: new TextEncoder().encode(JSON.stringify(change)),
    });
    if (!response.ok) throw new Error(`seeding person ${number} answered ${response.status}: ${await response.text()}`);
  };
  const meera = (await database.prepare("SELECT number FROM people WHERE email = ?1").bind(guest).first<{ number: number }>())?.number ?? 0;
  await toPerson(meera, { note: "Met at the infra meetup in October.\n\n- prefers async, writes long\n- owns pricing from Friday" });
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
  // Public too, and not shared with the invited person, so they read it in the public view, its page from the public address.
  await asPerson(owner, `/${pricing}`, { action: "publish" });
  // A page that asks questions, shared with the guest and Asha: their answers under two of its questions, a discussion
  // on its words with a reply, one on words of version 1 that version 2 cut, a reply under a general comment, and an
  // Only me comment with his own reply, which the guest never sees. The meeting is made up.
  const review = await add("chat:seed-review", { title: "The review on Wednesday: how it runs", status: "discuss", space: "company", body: "The plan for the half hour, as a page." });
  const asha = harness.access.memberClaims("asha@example.com");
  const guestClaims = harness.access.memberClaims(guest);
  const commentAs = async (claims: Record<string, unknown>, body: Record<string, unknown>): Promise<string> => {
    const response = await harness.fetch(`${SITE}/threads/api/threads/${review}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SITE, "Cf-Access-Jwt-Assertion": harness.access.token(claims) },
      body: new TextEncoder().encode(JSON.stringify(body)),
    });
    if (response.status !== 201) throw new Error(`seeding a comment on #${review} answered ${response.status}: ${await response.text()}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return ((await response.json()) as { comment: { id: string } }).comment.id;
  };
  await page(review, new TextEncoder().encode(reviewPage(1)), "https://claude.ai/artifact/example-review");
  await asPerson(owner, `/${review}/people`, { add: { email: guest, name: "Meera" } });
  await asPerson(owner, `/${review}/people`, { add: { email: "asha@example.com", name: "Asha" } });
  const asked = await commentAs(owner, { body: "The plan for Wednesday. Answer the questions at the end, or select anything you would change." });
  await commentAs(asha, { body: "Will do tonight.", parent: asked });
  const secret = await commentAs(owner, { body: "Ask Dev about the budget before the meeting.", audience: "owner" });
  await commentAs(owner, { body: "Asked. It holds.", parent: secret });
  const cut = await commentAs(asha, { body: "Twenty is a lot for this room. Fifteen?", quote: "twenty minutes of demo", prefix: "Then ", suffix: ", told as a story", version: 1 });
  await commentAs(owner, { body: "Agreed. Version 2 cuts it to twelve.", parent: cut });
  await page(review, new TextEncoder().encode(reviewPage(2)), "https://claude.ai/artifact/example-review");
  await commentAs(guestClaims, { body: "Fine as is. Maybe two more minutes for the demo.", question: "order" });
  await commentAs(asha, { body: "Pricing. Someone will ask what it costs.", question: "missing" });
  const live = await commentAs(guestClaims, {
    body: "I would show it anyway, even for two minutes. Engineers want to see it run.",
    quote: "The live app is shown only if someone asks",
    prefix: "money questions go to Asha. ",
    suffix: " to see it running.",
    version: 2,
  });
  await commentAs(owner, { body: "Fair. Two minutes at the end of the demo, then questions.", parent: live });
  const slides = await add("chat:seed-slides", { title: "Launch talk slides", status: "act", space: "stigmer", body: "The launch talk, as slides on claude.ai." });
  await asSync(`/${slides}/link`, { url: "https://claude.ai/artifact/example-slides", title: "Launch talk" });

  // A public thread of his own, with a comment for anyone, a note he OK'd, and one waiting for his OK.
  const shipping = await add("chat:seed-public", {
    title: "Shipping Stigmer 0.1.0, in public",
    status: "act",
    space: "stigmer",
    body: "Writing down each step of the first release as it happens, so anyone can follow along.\n\n- the install page\n- the release notes\n- the launch talk",
  });
  await asSync(`/${shipping}/text`, { field: "summary", text: "Decided: 0.1.0 ships when the install works on all three systems.\nOpen: the Windows runner.\nNext: a fresh install on Windows on Friday." });
  await asPerson(owner, `/${shipping}`, { action: "publish" });
  await asPerson(owner, `/${shipping}/comments`, { body: "Day one: the install works on macOS and Linux. Windows next.", audience: "public" });
  await asPerson(owner, `/${shipping}/people`, { add: { email: guest, name: "Meera" } });
  const note = async (words: string, name: string, email: string): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const response = await harness.fetch(`${SITE}/api/threads/${shipping}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SITE, "CF-Connecting-IP": "203.0.113.50" },
      body: new TextEncoder().encode(JSON.stringify({ body: words, name, email, token: "pass" })),
    });
    if (response.status !== 201) throw new Error(`seeding a note on #${shipping} answered ${response.status}: ${await response.text()}`);
  };
  await note("Followed along from the install page. The Linux steps worked first time.", "Priya", "");
  const okd = await database.prepare("SELECT id FROM comments WHERE author = 'visitor' ORDER BY created_at LIMIT 1").first<{ id: string }>();
  await asPerson(owner, `/${shipping}/comments/${okd?.id ?? ""}`, { action: "show" });
  await note("Loved the install video. **not bold**\n[a link that stays text](https://example.com/should-not-link)\nWhen does Windows land?", "Tomás", "tomas@example.com");

  // Meetings, set as the sync sets them, relative to now: later today, next Wednesday (at least two days out), a day
  // four days out with no time, and one three days ago. Times are on the hour or half hour in UTC, as people book them.
  const personNamed = async (name: string): Promise<number> =>
    (await database.prepare("SELECT number FROM people WHERE name = ?1").bind(name).first<{ number: number }>())?.number ?? 0;
  const hour = 3600 * 1000;
  const onTheHour = (at: number): string => new Date(Math.ceil(at / hour) * hour).toISOString();
  const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);
  const now = Date.now();
  const untilWednesday = (3 - new Date(now).getUTCDay() + 7) % 7;
  const wednesday = `${dayOf(now + (untilWednesday < 2 ? untilWednesday + 7 : untilWednesday) * 24 * hour)}T09:30:00.000Z`;
  const pricingTeams = (await database.prepare("SELECT number FROM threads WHERE origin_ref = 'chat:seed-3'").first<{ number: number }>())?.number ?? 0;
  const [meeraNumber, devNumber, ashaNumber] = [await personNamed("Meera"), await personNamed("Dev K."), await personNamed("Asha")];
  await asSync(`/${who}/meeting`, { when: onTheHour(now + 2 * hour), minutes: 45, where: "Google Meet" });
  await asSync(`/${who}/attendees`, { add: { person: meeraNumber } });
  await asSync(`/${who}/attendees`, { add: { person: devNumber } });
  await asSync(`/${review}/meeting`, { when: wednesday, minutes: 30, where: "Asha's office" });
  await asSync(`/${review}/attendees`, { add: { person: ashaNumber } });
  await asSync(`/${review}/attendees`, { add: { person: meeraNumber } });
  await asSync(`/${meetup}/meeting`, { when: dayOf(now + 4 * 24 * hour), minutes: null, where: null });
  await asSync(`/${meetup}/attendees`, { add: { person: ashaNumber } });
  await asSync(`/${meetup}/attendees`, { add: { name: "Leela" } });
  await asSync(`/${pricingTeams}/meeting`, { when: onTheHour(now - 3 * 24 * hour), minutes: 60, where: "Zoom" });
  await asSync(`/${pricingTeams}/attendees`, { add: { person: ashaNumber } });

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
  console.log(`whysosuresh.com/me, ${as}: ${LOCAL}/me (Ctrl-C stops it)`);
});
process.on("SIGINT", () => {
  void harness.dispose().then(() => process.exit(0));
});
