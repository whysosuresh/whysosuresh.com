// The signed-in local site, for looking at the threads page in a real browser before a deploy:
// `npm run dev:signed-in` serves the home page at http://localhost:8790/ and the threads at http://hey.localhost:8790/
// (site/hosts.js; a browser sends every *.localhost to this machine) from the Worker's own bundle in workerd
// (test/harness.ts), each request to the host it was sent to, with a local D1 and R2 holding a few made-up threads,
// and plays Cloudflare Access by signing every call under /threads/api/ as the owner, the way the edge hands a signed-in request over. `--signed-out` signs nothing, so the
// page shows what a visitor sees; `--member <address>` signs every call as a person signed in by that address, so
// the page shows what an invited person sees. The seed always shares one thread ("Who owns what") with a made-up
// person, Meera, at that address or meera@example.com, who has the last word on it, beside an "Only me" comment of
// the owner's: the owner's Today shows it waiting on him, and the invited person never sees the note. One thread of
// his own is public ("Shipping Stigmer 0.1.0, in public"), shared with the same person, with a comment of his
// written for anyone and two visitors' notes, one of whose words hold Markdown and a link that must show as typed;
// signed out, its address shows the public view. The pricing page thread is public as well, and not shared, so the
// invited person reads it in the public view too. A third public thread's page asks questions ("A cold read"), with
// two visitors' answers from two browsers' keys, both named Sam, so signed out the page takes answers with a name,
// shows a visitor other people's answers once they gave their own, and opens in full screen at `?full`. All three
// public threads are posted on the home page, a page, a text with notes and a page with answers, under his Now line,
// beside what arrives from outside as the hourly run keeps it: two made-up episodes (one with its picture in the local
// bucket, test/fixtures/thumb.jpg, one without) and a made-up release of each product, so http://localhost:8790/
// shows every shape of item and /feed.xml its feed. Everyone in the seed is a person: Asha wrote
// from the site and was then invited to the meetup thread, Dev K. told him something in person, Meera is invited
// (with his own notes on her, and a photo, as the hourly run copies an invited person's Gravatar), Tomás wrote on the public thread with an address (Priya gave none, so she is no
// person), and Rex's only note was junk he dropped, so Rex sits under the people only in dropped threads. Four
// threads are meetings, set as the sync sets them, relative to now so Today always has some coming up: "Who owns
// what" later today (with Meera, who is invited, and Dev K., who has no address), the review next Wednesday (with
// Meera and Asha), the meetup a few days out as a day with no time (with Asha and Leela, someone new added by name),
// and pricing for small teams three days ago (with Asha). Three asks, each a thread of his own with a questions page:
// "Tuesday demo", open at hey's /ask/demo-nov-10, answered from 34 browsers (Ravi and Priya by name, Meera with the guest's
// address, whom he invited back to her own thread, and 31 more, a few without a name), its earlier answers marked
// read and the newest still new, so Today folds them into one row and Answered by has enough for Show all and its
// filter; "Founders dinner", a draft at /ask/founders-dinner, which only he can open; and "October meetup", closed,
// whose page reads with no boxes. A journal of three made-up days before today, written as the sync writes them (the
// latest with no page for today yet), with a storyline counting down, one new and one closed, a photo, a hand edit
// that made the latest day's version 2, a typed answer to one day's question, and last week's chapter. Pages are seeded the way the sync saves them, through the threads' call with its
// played token: the sealed probe (test/fixtures/sealed-probe.html, every line of which should read "blocked" in the
// browser), a made-up page that asks questions ("The review on Wednesday", shared with the guest and Asha), with
// answers, a discussion on its words, one on words its second version cut, and replies, and each file given with
// `--page <file>` (an
// artifact's HTML as the Artifact tool's read saved it) as a version of one thread. Requests reach the Worker at
// these local addresses, so the bridge a page carries addresses what it says to them, as it addresses
// hey.whysosuresh.com live. Nothing here is deployed or reaches Cloudflare: the harness refuses every outside request but Access's
// played keys.

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { addDays, weekDays, weekOf } from "../site/app/journal.js";
import { SITE, TEST_SECRET, THREADS, THUMB, startHarness, type Harness } from "./harness.ts";

const PORT = 8790;
/** The two local hosts, as the browser names them: the home page's, and the threads' one label below it (site/hosts.js). */
const LOCAL = `http://localhost:${PORT}`;
const LOCAL_THREADS = `http://hey.localhost:${PORT}`;
const LOCAL_HOSTS = new Set([new URL(LOCAL).host, new URL(LOCAL_THREADS).host]);
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
  const response = await harness.fetch(`${THREADS}/threads/api/threads${path}`, {
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

/** The questions the made-up asks put, by their ids, as the demo template words them. */
const ASK_QUESTIONS: Record<string, string> = {
  "stood-out": "What stood out, good or bad?",
  fit: "Where would this fit in what you build, if anywhere?",
  "before-you-try": "What would you need to see or try before you'd use it?",
  "anything-else": "Anything else?",
};

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
    const response = await harness.fetch(`${THREADS}/threads/api/threads${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: THREADS, "Cf-Access-Jwt-Assertion": harness.access.token(claims) },
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
    const response = await harness.fetch(`${THREADS}/threads/api/people/${number}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: THREADS, "Cf-Access-Jwt-Assertion": harness.access.token(owner) },
      body: new TextEncoder().encode(JSON.stringify(change)),
    });
    if (!response.ok) throw new Error(`seeding person ${number} answered ${response.status}: ${await response.text()}`);
  };
  const meera = (await database.prepare("SELECT number FROM people WHERE email = ?1").bind(guest).first<{ number: number }>())?.number ?? 0;
  await toPerson(meera, { note: "Met at the infra meetup in October.\n\n- prefers async, writes long\n- owns pricing from Friday" });
  // Meera has a Gravatar, kept as the hourly run keeps one for a person he invited (src/photos.ts), so a person's
  // photo shows on her comments, her page, the people and the thread's Share.
  const meeraPhoto = crypto.randomUUID();
  await (await harness.pages()).put(`photos/${meeraPhoto}.jpg`, THUMB, { httpMetadata: { contentType: "image/jpeg" } });
  await database.batch([
    database.prepare("INSERT INTO photos (id, object_key, type, bytes, created_at) VALUES (?1, ?2, 'image/jpeg', ?3, ?4)").bind(meeraPhoto, `photos/${meeraPhoto}.jpg`, THUMB.byteLength, new Date().toISOString()),
    database.prepare("UPDATE people SET photo_id = ?1, photo_checked_at = ?2 WHERE email = ?3").bind(meeraPhoto, new Date().toISOString(), guest),
  ]);
  const page = async (number: number, html: Uint8Array, from: string | null): Promise<void> => {
    const query = from === null ? "" : `?${new URLSearchParams({ from }).toString()}`;
    const response = await harness.fetch(`${THREADS}/threads/api/threads/${number}/pages${query}`, {
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
  await asPerson(owner, `/${pricing}`, { action: "post" });
  // A page that asks questions, shared with the guest and Asha: their answers under two of its questions, a discussion
  // on its words with a reply, one on words of version 1 that version 2 cut, a reply under a general comment, and an
  // Only me comment with his own reply, which the guest never sees. The meeting is made up.
  const review = await add("chat:seed-review", { title: "The review on Wednesday: how it runs", status: "discuss", space: "company", body: "The plan for the half hour, as a page." });
  const asha = harness.access.memberClaims("asha@example.com");
  const guestClaims = harness.access.memberClaims(guest);
  const commentAs = async (claims: Record<string, unknown>, body: Record<string, unknown>): Promise<string> => {
    const response = await harness.fetch(`${THREADS}/threads/api/threads/${review}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: THREADS, "Cf-Access-Jwt-Assertion": harness.access.token(claims) },
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
  await asPerson(owner, `/${shipping}`, { action: "post" });
  await asPerson(owner, `/${shipping}/comments`, { body: "Day one: the install works on macOS and Linux. Windows next.", audience: "public" });
  await asPerson(owner, `/${shipping}/people`, { add: { email: guest, name: "Meera" } });
  const note = async (words: string, name: string, email: string): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const response = await harness.fetch(`${THREADS}/api/threads/${shipping}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: THREADS, "CF-Connecting-IP": "203.0.113.50" },
      body: new TextEncoder().encode(JSON.stringify({ body: words, name, email, token: "pass" })),
    });
    if (response.status !== 201) throw new Error(`seeding a note on #${shipping} answered ${response.status}: ${await response.text()}`);
  };
  await note("Followed along from the install page. The Linux steps worked first time.", "Priya", "");
  await note("Loved the install video. **not bold**\n[a link that stays text](https://example.com/should-not-link)\nWhen does Windows land?", "Tomás", "tomas@example.com");

  // A public page that asks questions, with two visitors' answers, from two browsers' keys, under the same typed name.
  const cold = await add("chat:seed-cold-read", { title: "A cold read of the install page", status: "discuss", space: "stigmer", body: "Questions for a developer meeting the site for the first time." });
  const questions = `<!doctype html><html><head><meta charset="utf-8"><title>A cold read</title><style>body{font:16px/1.6 system-ui;margin:28px;max-width:640px}.q{padding:14px 0;border-bottom:1px solid #ddd}.q p{margin:0;font-weight:600}</style></head><body>
<h1>A cold read</h1><p>Open the site in another tab and start cold. Each answer holds up to 4,000 characters.</p>
<p data-outside-thread>Open the link you were sent to answer these.</p>
<div class="q" data-thread-question="what-is-it"><p>In your own words, what is it?</p></div>
<div class="q" data-thread-question="first-job"><p>Did your first job work, and where did you get stuck?</p></div>
<div class="q" data-thread-question="would-you"><p>Would you use it: yes, not yet, or no?</p></div>
${"<p>A line to make the page tall.</p>".repeat(12)}</body></html>`;
  await page(cold, new TextEncoder().encode(questions), null);
  await asPerson(owner, `/${cold}`, { action: "publish" });
  await asPerson(owner, `/${cold}`, { action: "post" });
  const visitorAnswer = async (key: string, question: string, words: string): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const response = await harness.fetch(`${THREADS}/api/threads/${cold}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: THREADS, "CF-Connecting-IP": "203.0.113.60" },
      body: new TextEncoder().encode(JSON.stringify({ question, body: words, name: "Sam", token: "pass", key })),
    });
    if (response.status !== 201) throw new Error(`seeding an answer on #${cold} answered ${response.status}: ${await response.text()}`);
  };
  await visitorAnswer("5a".repeat(32), "what-is-it", "Somewhere to run AI agents, I think. The headline lost me.");
  await visitorAnswer("5a".repeat(32), "first-job", "It ran after I found the install page, about ten minutes.");
  await visitorAnswer("6b".repeat(32), "what-is-it", "A CLI and a server for agents, with **workflows**.");

  // Asks: a questions page, made a draft by the sync and opened from his own page, as the real ones are.
  const askPage = (title: string, ids: readonly string[]): string => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px/1.55 system-ui;margin:0;padding:32px 28px;max-width:640px}h1{font-size:30px;letter-spacing:-.02em;margin:0 0 8px}p.lede{color:#5c5c5c}.q{padding:16px 0;border-bottom:1px solid #e5e5e5}.q p{margin:0;font-weight:600}@media (prefers-color-scheme:dark){body{background:#0d0d0e;color:#f1f1f1}}</style></head><body>
<h1>${title}</h1><p class="lede">A few questions, all optional. I read every answer myself.</p>
<p data-outside-thread>On hey.whysosuresh.com/ask, a box to answer appears under each question.</p>
${ids.map((id) => `<div class="q" data-thread-question="${id}"><p>${ASK_QUESTIONS[id] ?? id}</p></div>`).join("\n")}
</body></html>`;
  const makeAsk = async (ref: string, title: string, slug: string, ids: readonly string[], space: string): Promise<number> => {
    const number = await add(ref, { title, status: "discuss", space, body: "Questions for the people who came." });
    await page(number, new TextEncoder().encode(askPage(title, ids)), null);
    await asSync(`/${number}/ask`, { slug });
    return number;
  };
  const DEMO = ["stood-out", "fit", "before-you-try", "anything-else"];
  const demo = await makeAsk("chat:seed-ask-demo", "Tuesday demo", "demo-nov-10", DEMO, "stigmer");
  await asSync(`/${demo}/text`, { field: "summary", text: "Decided: one link for the four who came.\nOpen: what it costs at their volume.\nNext: read the answers on Friday." });
  await asPerson(owner, `/${demo}/ask`, { action: "open" });
  /** One answer to an ask from a browser's key, as the page sends it; the name and email count only on the first. */
  const answerAsk = async (slug: string, key: string, question: string, words: string, name = "", email = ""): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 3));
    const response = await harness.fetch(`${THREADS}/api/asks/${slug}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: THREADS, "CF-Connecting-IP": "203.0.113.70" },
      body: new TextEncoder().encode(JSON.stringify({ question, body: words, name, email, token: "pass", key })),
    });
    if (response.status !== 201) throw new Error(`seeding an answer to ${slug} answered ${response.status}: ${await response.text()}`);
  };
  const keyOf = (n: number): string => n.toString(16).padStart(2, "0").repeat(32);
  const MADE_UP = ["Arjun", "Lena", "Kofi", "Sara", "Diego", "Ana", "Wei", "Noor", "Jonas", "Aisha", "Mateo", "Yuki", "Omar", "Ines", "Liam", "Zara", "Felix", "Hana", "Ivan", "Maya", "Tariq", "Elif", "Sam", "Nina"];
  const SAID = ["The resume after the crash.", "Too much on one screen, but the CLI was clear.", "Our ticket routing, maybe.", "Pricing before anything else.", "The way runs show their steps.", "A self-hosted version."];
  for (let i = 0; i < 31; i += 1) {
    const name = i % 7 === 3 ? "" : `${MADE_UP[i % MADE_UP.length] ?? "Someone"} ${String.fromCharCode(65 + ((i * 7) % 26))}.`;
    await answerAsk("demo-nov-10", keyOf(100 + i), DEMO[i % DEMO.length] ?? "fit", SAID[i % SAID.length] ?? "Fine.", name);
  }
  await answerAsk("demo-nov-10", keyOf(1), "stood-out", "The agent picked up the half-finished run after you killed the server. I didn't expect that to just work.", "Ravi", "ravi@example.com");
  await answerAsk("demo-nov-10", keyOf(1), "fit", "Our support triage. Today it is three scripts and a cron job.");
  await answerAsk("demo-nov-10", keyOf(1), "before-you-try", "How it behaves with our own model gateway, and what it costs at 2,000 runs a day.");
  await answerAsk("demo-nov-10", keyOf(3), "fit", "Release notes, maybe. Not sure yet.", "Meera", guest);
  // Everything so far is read; the next answers are new, so Today folds them and Answered by puts them first.
  await asPerson(owner, `/${demo}/ask`, { action: "read" });
  await answerAsk("demo-nov-10", keyOf(2), "stood-out", "Honestly the CLI felt slow to start. The console was clean.", "Priya");
  await answerAsk("demo-nov-10", keyOf(2), "anything-else", "Can I get the slides?");
  await answerAsk("demo-nov-10", keyOf(1), "fit", "Support triage, and the nightly report after it.");
  await answerAsk("demo-nov-10", keyOf(200), "anything-else", "Probably nowhere yet, we are still on plain prompts.");
  // Meera answered with the guest's address, and he invited her back to her own thread, so she can keep answering.
  const meeraAnswered = (await database.prepare("SELECT number FROM threads WHERE ask_thread_id = (SELECT id FROM threads WHERE number = ?1) AND sender_name = 'Meera'").bind(demo).first<{ number: number }>())?.number ?? 0;
  await asPerson(owner, `/${meeraAnswered}/people`, { add: { email: guest, name: "Meera" } });
  await makeAsk("chat:seed-ask-dinner", "Founders dinner, 13 Nov", "founders-dinner", DEMO, "company");
  const meetupAsk = await makeAsk("chat:seed-ask-meetup", "October meetup", "oct-meetup", ["stood-out", "anything-else"], "stigmer");
  await asPerson(owner, `/${meetupAsk}/ask`, { action: "open" });
  await answerAsk("oct-meetup", keyOf(7), "stood-out", "The talk on runners.", "Dev K.");
  await asPerson(owner, `/${meetupAsk}/ask`, { action: "close" });

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

/** A made-up 1x1 grey PNG, the photo the seeded journal shows. */
const SEED_PHOTO = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+v9/PQAI8wNPvd7POQAAAABJRU5ErkJggg==";

/** The made-up journal: three days before today, a hand edit, an answer, and last week's chapter. */
async function seedJournal(): Promise<void> {
  const journal = `${THREADS}/threads/api/journal`;
  const write = async (key: string, text: string, base: number, as: "sync" | "owner" = "sync"): Promise<void> => {
    const claims = as === "sync" ? harness.access.syncClaims() : harness.access.ownerClaims();
    const response = await harness.fetch(`${journal}/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": harness.access.token(claims), Origin: THREADS },
      body: new TextEncoder().encode(JSON.stringify({ text, base })),
    });
    if (response.status !== 201) throw new Error(`seeding the journal's ${key} answered ${response.status}: ${await response.text()}`);
  };
  const photo = await harness.fetch(`${journal}/photos`, {
    method: "POST",
    headers: { "Content-Type": "image/png", "Cf-Access-Jwt-Assertion": sync() },
    body: new Uint8Array(Buffer.from(SEED_PHOTO, "base64")),
  });
  if (photo.status !== 201) throw new Error(`seeding the journal's photo answered ${photo.status}: ${await photo.text()}`);
  const photoId = ((await photo.json()) as { id: string }).id;

  const today = new Date().toISOString().slice(0, 10);
  const [d3, d2, d1] = [addDays(today, -3), addDays(today, -2), addDays(today, -1)];
  const words = (key: string): string => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  const page = (key: string, title: string, line: string, storylines: string[], stories: string, close: string): string =>
    `## ${title}\n*${words(key)} · two stories*\n\n**In one line:** ${line}\n\n- **Morning** · The walk\n- **At the desk** · The day at the desk\n\n**People:** Ada, Grace\n**Wins:** a walk · a draft\n${storylines.join("\n")}\n\n· · ·\n\n${stories}\n\n· · ·\n\n${close}\n`;
  const story = (extra = ""): string =>
    `### The walk\n*7:10 am, along the river*\n\nThe river was high and loud.\n\nAda called halfway and we talked about the launch.\n\n> Slow is a speed too.${extra}\n\n· · ·\n\n### The day at the desk\n*At the desk*\n\nMost of the day went to the draft. It is nearly there.`;

  await write(d3, page(d3, "The river was high", "A loud river and a quiet desk.", ["**Storyline · The launch:** 8 days to go. The draft is half done.", "**Storyline · Morning walks:** day three."], story(), "**Sitting with:** slow mornings make fast afternoons.\n\n→ [#1](https://hey.whysosuresh.com/threads/1) · The launch plan\n\n*From two recordings.*"), 0);
  await write(d2, page(d2, "Seeds in the ground", "The garden started, and the draft moved.", ["**Storyline · The launch:** 7 days to go.", "**Storyline · The garden (new):** seeds in the ground.", "**Storyline · Morning walks:** day four."], story(`\n\n![The bed, freshly dug](photo:${photoId})`), "**Sitting with:** starting small.\n\n**Tomorrow's question:** Did the seeds survive the rain?\n\n→ [#12](https://github.com/example/example/issues/12) · The launch checklist"), 0);
  const latest = (fix: string): string => page(d1, "A day of rain", fix, ["**Storyline · The launch:** 6 days to go. Rehearsal tomorrow.", "**Storyline · Old habit:** let go (closed)"], story(), "**Sitting with:** rain days are desk days.\n\n**Still asking:** Did the seeds survive the rain?\n\n**Tomorrow's question:** What will the rehearsal show you?\n\n*From one recording and 40 desk dictations.*");
  await write(d1, latest("Rain all day, and the draft is dnoe."), 0);
  await write(d1, latest("Rain all day, and the draft is done."), 1, "owner");

  const answer = await harness.fetch(`${journal}/${d2}/answers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.ownerClaims()), Origin: THREADS },
    body: new TextEncoder().encode(JSON.stringify({ body: "They did. Two came up already." })),
  });
  if (answer.status !== 201) throw new Error(`seeding the journal's answer answered ${answer.status}: ${await answer.text()}`);

  const lastWeek = weekOf(addDays(today, -7));
  const [monday = today, , , , , , sunday = today] = weekDays(lastWeek);
  await write(lastWeek, `## Week ${Number(lastWeek.slice(6))} · Small steps\n*${words(monday)} – ${words(sunday)}*\n\nThe week opened slowly and ended with a plan.\n\nThe draft found its shape, and the garden found a corner.\n\n> Slow is a speed too.\n\n**People:** Ada, Grace\n**Wins:** a draft · a walk every day\n**Storyline · The launch:** 11 days to go.\n**The week ahead:** What does the launch need first?\n`, 0);
}

async function body(request: IncomingMessage): Promise<Uint8Array | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return chunks.length === 0 ? undefined : new Uint8Array(Buffer.concat(chunks));
}

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = request.url ?? "/";
  // Each request goes to the host it was sent to, so the Worker splits it as production does; any other host is refused.
  const host = request.headers.host ?? "";
  if (!LOCAL_HOSTS.has(host)) {
    response.writeHead(421, { "Content-Type": "text/plain" }).end(`Open ${LOCAL}/ or ${LOCAL_THREADS}/`);
    return;
  }
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
  const answer = await harness.fetch(`http://${host}${path}`, { method, headers, redirect: "manual", ...(sent === undefined ? {} : { body: sent }) });
  const out: Record<string, string> = {};
  answer.headers.forEach((value, name) => {
    out[name] = value;
  });
  // The site's HSTS would pin localhost to https in the browser, so it stays out of the local answers.
  delete out["strict-transport-security"];
  response.writeHead(answer.status, out);
  response.end(Buffer.from(await answer.arrayBuffer()));
}

/** His Now line, set from his own page as Today sets it. */
async function seedNow(): Promise<void> {
  const response = await harness.fetch(`${THREADS}/threads/api/now`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": harness.access.token(harness.access.ownerClaims()), Origin: THREADS },
    body: new TextEncoder().encode(JSON.stringify({ text: "Getting Stigmer 0.1 into the hands of its first teams" })),
  });
  if (!response.ok) throw new Error(`seeding the Now line answered ${response.status}: ${await response.text()}`);
}

/**
 * What the hourly run keeps from outside, written as it writes it: two made-up episodes in the last days, the newer
 * with its picture in the bucket, and a made-up release of each product. The run itself never fires here, because the
 * harness refuses every outside host.
 */
async function seedOutside(): Promise<void> {
  const database = await harness.db();
  const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();
  const row = (id: string, kind: string, source: string, ref: string, title: string, url: string, at: string, updated: string | null, thumb: number) =>
    database
      .prepare("INSERT INTO outside_items (id, kind, source, ref, title, url, published_at, updated_at, thumb) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
      .bind(id, kind, source, ref, title, url, at, updated, thumb);
  const channel = "UCkdfCh9gN60s_h_nfTYEwyg";
  await database.batch([
    row("video:EPISODE0002", "video", channel, "EPISODE0002", "Episode two: what shipped, and what the feed made of it", "https://www.youtube.com/watch?v=EPISODE0002", daysAgo(1.2), daysAgo(1.1), 1),
    row("video:EPISODE0001", "video", channel, "EPISODE0001", "Episode one: the pilot", "https://www.youtube.com/watch?v=EPISODE0001", daysAgo(4.5), daysAgo(4.4), 0),
    row("release:stigmer/stigmer", "release", "stigmer/stigmer", "v0.1.2", "Stigmer 0.1.2", "https://github.com/stigmer/stigmer/releases/tag/v0.1.2", daysAgo(2.3), null, 0),
    row("release:whysosuresh/capsjump", "release", "whysosuresh/capsjump", "v0.9.10", "CapsJump 0.9.10", "https://github.com/whysosuresh/capsjump/releases/tag/v0.9.10", daysAgo(9), null, 0),
  ]);
  await (await harness.pages()).put("outside/EPISODE0002.jpg", THUMB, { httpMetadata: { contentType: "image/jpeg" } });
}

await seed();
await seedJournal();
await seedNow();
await seedOutside();
createServer((request, response) => {
  serve(request, response).catch((error: unknown) => {
    console.error(error);
    response.writeHead(500).end();
  });
}).listen(PORT, "127.0.0.1", () => {
  const as = signedOut ? "signed out" : member === null ? "signed in as the owner" : `signed in as ${member}, invited to one thread`;
  console.log(`hey.whysosuresh.com, ${as}: ${LOCAL_THREADS}/ (Ctrl-C stops it)`);
  console.log(`whysosuresh.com, the home page: ${LOCAL}/`);
});
process.on("SIGINT", () => {
  void harness.dispose().then(() => process.exit(0));
});
