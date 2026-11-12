// The Worker's code, on two hosts (site/hosts.js): the home page's, whysosuresh.com, and the threads', one label below
// it at hey.whysosuresh.com, where everything behind the door lives. It runs only for the paths `run_worker_first`
// names in wrangler.jsonc, and splits by host first, then by path; every other path is a file from site/ on either
// host. On the home page's host it answers the home page, /, with what Suresh posted written in, every update at
// /updates, its feed, /feed.xml (src/home.ts), its videos' pictures, /thumbs/* (src/outside.ts), and POST /api/talk, the note flow's public send
// (src/talk.ts). On the threads' host it answers the threads' private calls under /threads/api/ (src/threads.ts),
// behind their Cloudflare Access application and the Worker's own check of the caller against its tag; under
// /api/access/, the site's answer to Access's sign-in question for invited people, with the public key it is signed
// with (src/evaluate.ts), which Access calls itself and so are outside the application; a thread Suresh made public,
// read and a note sent on it under /api/threads/ (src/public.ts), outside Access too, with no sign-in; an ask, a
// questions page anyone answers by its link, read and answered under /api/asks/ (src/asks.ts), outside Access too;
// an avatar's photo under /api/photos/ (src/photos.ts), outside Access too, because a public thread shows his photo;
// and the threads page (src/pages.ts) at its root, Today, the door everyone signed in enters by, at the rooms
// (/meetings, /asks, /people and a person under it, /journal and everything under it), at an ask's own address
// (/ask/<slug>) and at every other path under /threads/, handed over from site/ with no sign-in, because Access
// guards the calls, never a thread's page. The calls are matched first, so no call ever reaches the pages. Every
// other path the code runs for answers the same JSON 404 on either host, so the threads' old addresses on the home
// page's host (/threads/42, /ask/<slug>, /journal) lead nowhere. It also runs every hour on a cron trigger
// (wrangler.jsonc): `scheduled` fetches his videos and the products' releases into the home page's list
// (src/outside.ts) and, beside it, looks up the Gravatars of people he invited (src/photos.ts), each failing on its own
// without stopping the other, and awaits both, so Cloudflare's record of each run says how it ended.

import { isThreadsHost } from "../site/hosts.js";
import { handleAsks } from "./asks.ts";
import type { Bindings } from "./bindings.ts";
import { handleEvaluate, handleKeys } from "./evaluate.ts";
import { FEED_PATH, UPDATES_PATH, handleFeed, handleHome, handleUpdates } from "./home.ts";
import { json } from "./json.ts";
import { handleThumb, refreshOutside } from "./outside.ts";
import { handlePage } from "./pages.ts";
import { refreshPhotos, servePhoto } from "./photos.ts";
import { handlePublic } from "./public.ts";
import { handleTalk } from "./talk.ts";
import { handleThreads } from "./threads.ts";

/** The home page's host: the home page, every update's page, its feed, its videos' pictures and the note flow's send. */
function home(request: Request, env: Bindings, pathname: string): Promise<Response> | Response {
  if (pathname === "/") return handleHome(request, env);
  if (pathname === FEED_PATH) return handleFeed(request, env);
  if (pathname === UPDATES_PATH) return handleUpdates(request, env);
  if (pathname.startsWith("/thumbs/")) return handleThumb(request, env);
  if (pathname === "/api/talk") {
    if (request.method !== "POST") return json(405, { reason: "method" }, { Allow: "POST" });
    return handleTalk(request, env);
  }
  return json(404, { reason: "not-found" });
}

/** The threads' host: every call and page behind the door, Today at its root. */
function threads(request: Request, env: Bindings, pathname: string): Promise<Response> | Response {
  if (pathname === "/api/access/evaluate") {
    if (request.method !== "POST") return json(405, { reason: "method" }, { Allow: "POST" });
    return handleEvaluate(request, env);
  }
  // Cloudflare's example names the keys address with and without a final slash, so both answer.
  if (pathname === "/api/access/keys" || pathname === "/api/access/keys/") {
    if (request.method !== "GET" && request.method !== "HEAD") return json(405, { reason: "method" }, { Allow: "GET" });
    return handleKeys(env);
  }
  if (pathname.startsWith("/api/threads/")) return handlePublic(request, env);
  if (pathname.startsWith("/api/asks/")) return handleAsks(request, env);
  if (pathname.startsWith("/api/photos/")) return servePhoto(request, env);
  if (pathname.startsWith("/threads/api/")) return handleThreads(request, env);
  if (pathname === "/" || pathname.startsWith("/threads/") || pathname.startsWith("/people/") || pathname === "/meetings" || pathname === "/people") return handlePage(request, env);
  if (pathname === "/asks" || pathname.startsWith("/ask/")) return handlePage(request, env);
  if (pathname === "/journal" || pathname.startsWith("/journal/")) return handlePage(request, env);
  return json(404, { reason: "not-found" });
}

export default {
  async fetch(request, env): Promise<Response> {
    const { hostname, pathname } = new URL(request.url);
    return isThreadsHost(hostname) ? threads(request, env, pathname) : home(request, env, pathname);
  },
  async scheduled(_controller, env): Promise<void> {
    const [outside, photos] = await Promise.allSettled([refreshOutside(env), refreshPhotos(env)]);
    if (outside.status === "rejected") throw outside.reason;
    if (photos.status === "rejected") throw photos.reason;
  },
} satisfies ExportedHandler<Bindings>;
