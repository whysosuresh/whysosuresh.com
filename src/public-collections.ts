// A public collection's calls under /api/collections/, with no sign-in (Access guards /threads/api alone): anyone with
// its link, /collections/<key>, reads it.
//
//   GET /api/collections/<key>                                 the collection and the threads strangers may read in it
//   GET /api/collections/<key>/threads/<n>                     one of those threads, with the comments written for anyone
//   GET /api/collections/<key>/threads/<n>/pages/<version>     its page, sealed as a public thread's is (src/page.ts)
//
// The key is a public collection's link key (32 lowercase hex characters, `share_key`), which only he gives out. A
// stranger reads its name and description and, in his order, only the threads in it of his own words that aren't an
// ask's (`IN_PUBLIC_COLLECTION` in src/collections-store.ts holds that in its own SQL): never a site note or a told
// thread, whose words are someone else's, and never an ask's thread or an answer to one. A thread read this way needn't
// be public itself, and the read changes nothing about it. Each thread reads as a public thread does (src/public.ts):
// its title, summary, space and main section as it now stands, and the comments written for anyone that are shown,
// never an answer to its page's questions; no thread's own key and nothing about who it is shared with. It is read
// only: no note and no answer is taken here, and a page gets no greeting from the threads page, so its questions show
// with no boxes. Every address that isn't one of these, a wrong key, a collection no longer public, a number not in it
// or a thread strangers may not read, answers the same 404 bytes as a public thread's calls, with `noindex`.

import type { Bindings } from "./bindings.ts";
import type { JsonValue } from "./json.ts";
import { servePage } from "./page.ts";
import { answer, noThread, publicComment, publicThread, withNoindex } from "./public.ts";
import { ownerPhotoId } from "./photos-store.ts";
import { SHARE_KEY_SHAPE, pagesOf } from "./store.ts";
import { findInPublicCollection, findPageInPublicCollection, findPublicCollection, publicCollectionComments, publicCollectionThreads } from "./collections-store.ts";

/** The most comments one thread's read holds; `truncated` says there are more. */
const HISTORY = 500;
/** A thread's number or a page's version as a path names it. */
const NUMBER_SHAPE = /^[1-9]\d{0,8}$/;

async function read(key: string, env: Bindings): Promise<Response> {
  const collection = await findPublicCollection(env.DB, key);
  if (collection === null) return noThread();
  const [threads, ownerPhoto] = await Promise.all([publicCollectionThreads(env.DB, key), ownerPhotoId(env.DB)]);
  return answer(200, {
    collection: { name: collection.name, description: collection.description },
    threads: threads.map((row): JsonValue => ({ ...publicThread(row), place: row.position + 1 })),
    ownerPhoto,
  });
}

async function readThread(key: string, given: string, env: Bindings): Promise<Response> {
  if (!NUMBER_SHAPE.test(given)) return noThread();
  const row = await findInPublicCollection(env.DB, key, Number(given));
  if (row === null) return noThread();
  const [comments, pages, ownerPhoto] = await Promise.all([
    publicCollectionComments(env.DB, row.id, HISTORY + 1),
    row.main === "page" ? pagesOf(env.DB, row.id) : Promise.resolve([]),
    ownerPhotoId(env.DB),
  ]);
  const newest = pages[pages.length - 1];
  return answer(200, {
    thread: publicThread(row),
    page: newest === undefined ? null : { version: newest.version, savedAt: newest.created_at, versions: pages.map((page) => ({ version: page.version, savedAt: page.created_at })) },
    comments: comments.slice(0, HISTORY).map((comment) => publicComment(comment, null)),
    truncated: comments.length > HISTORY,
    ownerPhoto,
  });
}

async function readPage(request: Request, key: string, given: string, version: string, env: Bindings): Promise<Response> {
  if (!NUMBER_SHAPE.test(given) || !NUMBER_SHAPE.test(version)) return noThread();
  const page = await findPageInPublicCollection(env.DB, key, Number(given), Number(version));
  if (page === null) return noThread();
  const served = await servePage(env.PAGES, page.object_key, request);
  return served === null ? noThread() : withNoindex(served);
}

/** Answers every request under /api/collections/. */
export async function handlePublicCollections(request: Request, env: Bindings): Promise<Response> {
  const { pathname } = new URL(request.url);
  const route = /^\/api\/collections\/([^/]+)(?:\/threads\/([^/]+)(?:\/pages\/([^/]+))?)?$/.exec(pathname);
  if (route === null) return noThread();
  if (request.method !== "GET" && request.method !== "HEAD") return answer(405, { reason: "method" }, { Allow: "GET" });
  const [, key = "", number, version] = route;
  if (!SHARE_KEY_SHAPE.test(key)) return noThread();
  if (number === undefined) return read(key, env);
  return version === undefined ? readThread(key, number, env) : readPage(request, key, number, version, env);
}
