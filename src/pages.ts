// The threads page's addresses, which the Worker answers because no file can sit at every thread's number:
// /threads/ (Today and the list, which the page tells apart by its query) and /threads/<n>, with the thread's
// title after the number or not (/threads/42-who-owns-what). Each gets the one page, site/threads/index.html,
// handed over from the site's own files through the assets binding, so it carries site/_headers (the CSP among
// them) exactly as a file served straight from site/ would. The status is 200 whatever the number: the page asks
// the private call for the thread, and a missing thread, a thread this browser may not read and a signed-out
// visitor all see the same "Nothing here", so the address alone never tells whether a thread exists. The Worker
// never reads the database here for the same reason; the page puts the thread's title into the address itself.
// Any other path under /threads/ is answered by the site's files as it would be without the Worker: the 404
// page, or a clean-address redirect. The page's scripts live under /app/, outside the Worker's paths, so they
// cost no Worker request.

import type { Bindings } from "./bindings.ts";

/** Today, the list, and a thread by its number with any title after it. */
const PAGE = /^\/threads\/(?:[1-9]\d{0,8}(?:-[^/]*)?)?$/;

/** The page's own address among the site's files. */
const SHELL = "/threads/";

export function isThreadsPage(pathname: string): boolean {
  return PAGE.test(pathname);
}

/** Answers a path under /threads/ that isn't one of the threads' calls. */
export async function handlePage(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url);
  if (!isThreadsPage(url.pathname) || (request.method !== "GET" && request.method !== "HEAD")) return env.ASSETS.fetch(request);
  return env.ASSETS.fetch(new Request(new URL(SHELL, url.origin), { method: request.method, headers: request.headers }));
}
