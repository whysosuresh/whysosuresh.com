// The asks' public calls, outside Cloudflare Access: an ask is one of Suresh's own threads whose main section is a
// questions page, handed to many people by one link, /ask/<slug>, which anyone answers with no sign-in. Each browser
// that answers gets a thread of its own in his inbox, and nobody but him (and anyone he invites back to that thread)
// ever reads what it said. The request's cookies are never read.
//
//   GET  /api/asks/<slug>                   the ask, its page's versions, and this browser's own answers
//                                           [X-Visitor-Key: <the visitor's key>]
//   GET  /api/asks/<slug>/pages/<version>   one version of its page
//   POST /api/asks/<slug>/answers           {"question", "body", "name", "email", "token", "key"}: an answer
//
// An ask is read while it is open or closed: a closed one says so, with its page, so an old link isn't a dead end,
// and refuses answers with 409 `closed`. A draft and a slug no thread has answer the same 404 `no-ask` bytes on every
// call. What the read says is the ask's slug, its title (written for strangers: the one thing about its thread a
// stranger reads), its state and its page's versions: never its summary, which is his private label, its number, id,
// space or history, nor anyone's answers but the reader's own browser's (`answers`, the newest per question, read
// from that browser's own thread by the key in `X-Visitor-Key`).
//
// An answer runs every visitor answer's checks in the same order (src/note.ts), with a name and an email both
// optional, as a note's: the shape, the bot check, then the ask (404 `no-ask`, 409 `closed`), then the asks' own daily
// budgets (src/quota.ts), apart from the notes' and the public pages' answers': the answer that makes this browser's
// thread counts first against `askThreads` (100 a day from one network, 500 in all), which caps how many threads
// strangers can make, so a refused thread spends no answer; then every answer against `askAnswers` (400 and 2,000). The store keeps the
// answer, and the first time its thread, in one batch that holds the ask being open (src/store.ts, `answerAsk`). The
// `key` is 32 random bytes as hex that the visitor's browser made once and keeps; only its SHA-256 is kept, so the
// thread is that browser's, and answering again from it adds an answer that shows in place of its last. Every answer
// carries `X-Robots-Tag: noindex`, because an ask is found by its link. Nothing personal is logged.

import type { Bindings } from "./bindings.ts";
import { json, type JsonValue } from "./json.ts";
import { checkBot, readAskAnswer, readFields, takeLimit } from "./note.ts";
import { servePage } from "./page.ts";
import { keyHash, readerKey, withNoindex } from "./public.ts";
import { answerAsk, findAsk, findAskPage, hasAnswered, ownAnswers, pagesOf, type AskRow } from "./store.ts";

/** An ask's slug: lowercase letters, digits and hyphens, at most 40, starting and ending with a letter or digit. */
export const SLUG_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** A page's version as a path names it: no sign, no leading zero, at most nine digits. */
const NUMBER_SHAPE = /^[1-9]\d{0,8}$/;
/** The fields an answer to an ask carries. */
const ANSWER_KEYS = ["question", "body", "name", "email", "token", "key"];
/** Every ask answer is kept out of search results. */
const NOINDEX = { "X-Robots-Tag": "noindex" };

/** A JSON answer with the asks' header, logging a refusal's status and reason only. */
function answer(status: number, body: { readonly [key: string]: JsonValue }, headers: Record<string, string> = {}): Response {
  if (status >= 400) console.log(JSON.stringify({ refused: status, reason: body.reason ?? null }));
  return json(status, body, { ...NOINDEX, ...headers });
}

/** The one answer a draft and a slug no thread has get, on every call. */
function noAsk(): Response {
  return answer(404, { reason: "no-ask" });
}

/** The ask with that slug while strangers may read it (open or closed); null for a draft and a slug nobody has. */
async function readableAsk(env: Bindings, slug: string): Promise<AskRow | null> {
  const ask = await findAsk(env.DB, slug);
  return ask === null || ask.state === "draft" ? null : ask;
}

async function read(request: Request, slug: string, env: Bindings): Promise<Response> {
  const ask = await readableAsk(env, slug);
  if (ask === null) return noAsk();
  const key = await readerKey(request);
  const [pages, answers] = await Promise.all([ask.main === "page" ? pagesOf(env.DB, ask.id) : Promise.resolve([]), key === null ? Promise.resolve([]) : ownAnswers(env.DB, ask.id, key)]);
  const newest = pages[pages.length - 1];
  return answer(200, {
    ask: { slug, title: ask.title, state: ask.state },
    // A version's claude.ai source names his own artifact, so it isn't said.
    page:
      newest === undefined
        ? null
        : { version: newest.version, savedAt: newest.created_at, versions: pages.map((page) => ({ version: page.version, savedAt: page.created_at })) },
    answers: answers.map((one) => ({ question: one.question, body: one.body, at: one.at })),
  });
}

async function readPage(request: Request, slug: string, given: string, env: Bindings): Promise<Response> {
  if (!NUMBER_SHAPE.test(given)) return noAsk();
  const page = await findAskPage(env.DB, slug, Number(given));
  if (page === null) return noAsk();
  const served = await servePage(env.PAGES, page.object_key, request);
  return served === null ? noAsk() : withNoindex(served);
}

async function sendAnswer(request: Request, slug: string, env: Bindings): Promise<Response> {
  const fields = await readFields(request, env, ANSWER_KEYS);
  if (fields instanceof Response) return withNoindex(fields);
  const given = readAskAnswer(fields.fields);
  if (given instanceof Response) return withNoindex(given);
  const sender = await checkBot(request, fields.secret, given.token);
  if (sender instanceof Response) return withNoindex(sender);
  const ask = await readableAsk(env, slug);
  if (ask === null) return noAsk();
  if (ask.state !== "open") return answer(409, { reason: "closed" });
  const key = await keyHash(given.key);
  // A new thread is checked first, so a refused one spends no answer.
  if (!(await hasAnswered(env.DB, ask.id, key))) {
    const threads = await takeLimit(env, sender.network, "askThreads");
    if (threads !== null) return withNoindex(threads);
  }
  const answers = await takeLimit(env, sender.network, "askAnswers");
  if (answers !== null) return withNoindex(answers);
  const kept = await answerAsk(env.DB, ask, { question: given.question, body: given.body, name: given.name, email: given.email, key });
  return kept ? answer(201, {}) : answer(409, { reason: "closed" });
}

/** Answers every request under /api/asks/. */
export async function handleAsks(request: Request, env: Bindings): Promise<Response> {
  const { pathname } = new URL(request.url);
  const route = /^\/api\/asks\/([^/]+)(?:\/(answers)|\/pages\/([^/]+))?$/.exec(pathname);
  if (route === null) return noAsk();
  const [, slug = "", write, version] = route;
  if (write !== undefined) {
    if (request.method !== "POST") return answer(405, { reason: "method" }, { Allow: "POST" });
  } else if (request.method !== "GET" && request.method !== "HEAD") {
    return answer(405, { reason: "method" }, { Allow: "GET" });
  }
  if (!SLUG_SHAPE.test(slug)) return noAsk();
  if (write !== undefined) return sendAnswer(request, slug, env);
  return version === undefined ? read(request, slug, env) : readPage(request, slug, version, env);
}
