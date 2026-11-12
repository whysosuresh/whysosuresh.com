// A public thread's preview card: the 1200 x 630 picture a chat shows under its link (WhatsApp, iMessage, Slack),
// drawn by his own page (site/app/card.js) and kept here as bytes, as his photo is (src/photos.ts). The Worker draws
// nothing and reads nothing in the picture; it checks the bytes are a PNG and keeps them beside the stamp his page says
// they show, so his page knows which cards are out of date.
//
//   GET  /threads/api/cards                          owner, from his own page: every public thread's number, title, stamp
//   POST /threads/api/threads/<n>/card?stamp=<hex>   owner, from his own page: a PNG          {"card": <id>}
//   GET  /api/cards/<id>                             anyone, with no sign-in: a public thread's card
//
// Only his page draws, so the sync and an invited person are refused both calls with 403 `owner-only` before anything
// is read. An upload names the stamp of what it shows (64 lowercase hex characters, `cardStamp`; 400 `stamp`) and is
// checked as every image the site keeps (src/images.ts: 411 `length`, 413 `too-large` past 1 MiB, 415 `type`), and
// then must be a PNG (415 `type`), because a card is flat colour and type. The thread must be there (404 `no-thread`)
// and public (409 `not-public`) before anything is written. The object is written to the pages bucket under
// `cards/<id>.png` first, then its row (`setCard`, which holds the thread being public in its own SQL and answers the
// object the row replaced); the new object is deleted again when the row isn't kept (409 `not-public` when he took
// the thread back meanwhile, 500 `store` when the database failed), and the replaced object once it is, so the bucket
// holds exactly the cards the rows name.
//
// A card is served on the threads' host outside Access (wrangler.jsonc runs the Worker for /api/*), because a chat's
// preview fetcher signs in to nothing. Its address is a random id, never the thread's key, and the picture shows the
// thread's number, never its key, so a card read at an old thread's number address never leads to its link. It is
// answered only while its thread is public, as `image/png` with `nosniff`, a sandboxing CSP, `X-Robots-Tag: noindex`
// (a public thread is kept out of search results, and its card shows its title) and `Cache-Control: public,
// max-age=31536000, immutable`: a redrawn card is a new id, so a new address. Any other id, one with no card and one
// whose thread isn't public now answer one 404.

import type { Caller } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { PHOTO_ID, imageHeaders, readImage } from "./images.ts";
import { json } from "./json.ts";
import { cardsOf, find, findCard, setCard } from "./store.ts";
import { MAX_CARD_BYTES, refuse } from "./wire.ts";

/** Where the cards live in the pages bucket. */
const CARDS = "cards/";
/** What a card's picture shows, as `cardStamp` in site/app/card.js writes it: a SHA-256 in lowercase hex. */
export const STAMP_SHAPE = /^[0-9a-f]{64}$/;
const CARD_PATH = /^\/api\/cards\/([^/]+)$/;
/** A card's answer is cached for good (a new card is a new address) and kept out of search results with its thread. */
const CARD_CACHE = "public, max-age=31536000, immutable";
const NOINDEX = { "X-Robots-Tag": "noindex" };

/** Answers GET /threads/api/cards for a caller the door has named: every public thread's card stamp, his alone. */
export async function listCards(request: Request, env: Bindings, who: Caller): Promise<Response> {
  if (request.method !== "GET") return json(405, { reason: "method" }, { Allow: "GET" });
  if (who.caller !== "owner") return refuse(403, "owner-only");
  const due = await cardsOf(env.DB);
  return json(200, { cards: due.map((row) => ({ number: row.number, title: row.title, stamp: row.stamp })) });
}

/** The stamp an upload names: its query is exactly one `stamp` of the right shape, else null. */
function stampOf(url: URL): string | null {
  const given = [...url.searchParams];
  const [only] = given;
  return given.length === 1 && only !== undefined && only[0] === "stamp" && STAMP_SHAPE.test(only[1]) ? only[1] : null;
}

/**
 * Answers POST /threads/api/threads/<n>/card once the door has checked its origin and the number's shape: his page's
 * card for a public thread of his, kept, and the card it replaced dropped.
 */
export async function addCard(request: Request, url: URL, number: number, env: Bindings, who: Caller): Promise<Response> {
  if (who.caller !== "owner") return refuse(403, "owner-only");
  const stamp = stampOf(url);
  if (stamp === null) return refuse(400, "stamp");
  const read = await readImage(request, MAX_CARD_BYTES);
  if (read instanceof Response) return read;
  if (read.image.type !== "image/png") return refuse(415, "type");
  const thread = await find(env.DB, { number }, { caller: "owner" });
  if (thread === null) return refuse(404, "no-thread");
  if (thread.public_at === null || thread.source !== "self" || thread.share_key === null) return refuse(409, "not-public");

  const id = crypto.randomUUID();
  const card = { id, object_key: `${CARDS}${id}.png`, bytes: read.bytes.byteLength, stamp };
  await env.PAGES.put(card.object_key, read.bytes, { httpMetadata: { contentType: "image/png" } });
  let kept: Awaited<ReturnType<typeof setCard>>;
  try {
    kept = await setCard(env.DB, number, card);
  } catch {
    await env.PAGES.delete(card.object_key);
    return refuse(500, "store");
  }
  if (!kept.kept) {
    await env.PAGES.delete(card.object_key);
    return refuse(409, "not-public");
  }
  if (kept.replaced !== null) await env.PAGES.delete(kept.replaced);
  return json(200, { card: id });
}

/** Answers /api/cards/<id>: a public thread's card, for anyone, or the one 404. */
export async function serveCard(request: Request, env: Bindings): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return json(405, { reason: "method" }, { Allow: "GET" });
  const id = CARD_PATH.exec(new URL(request.url).pathname)?.[1] ?? "";
  const row = PHOTO_ID.test(id) ? await findCard(env.DB, id) : null;
  if (row === null) return json(404, { reason: "no-card" }, NOINDEX);
  const headers = { ...imageHeaders("image/png", row.bytes, CARD_CACHE), ...NOINDEX };
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  const object = await env.PAGES.get(row.object_key);
  return object === null ? json(404, { reason: "no-card" }, NOINDEX) : new Response(object.body, { status: 200, headers });
}
