// A page saved into a thread, as its frame on the threads page loads it: the Worker's one answer that isn't JSON.
// A page is a Claude artifact's own HTML, so it runs its own scripts, styles and libraries; it is shown at its
// thread's own call address (GET /threads/api/threads/<n>/pages/<version>, behind Access and the Worker's check of
// the caller, src/threads.ts) and sealed by its response's headers rather than by a second domain:
//
// - The CSP's `sandbox` puts the document in an opaque origin, as though framed with a sandbox attribute, so it
//   can't read the site's cookies or storage, reach the parent's document or move the top window. It allows
//   scripts, forms (their handlers; `form-action 'none'` blocks every real submission) and popups that open as
//   ordinary tabs (a link with target=_blank). The threads page frames it with the same tokens.
// - The CSP's sources are claude.ai's own page contract and no wider: inline script and style, scripts from the
//   five script hosts that contract names, Google Fonts, images and media as data: or blob:, Web Workers from
//   blob:, and no connection anywhere (`connect-src 'none'`), so a page can't send what it shows, or call the
//   threads' calls with the owner's cookie. `frame-ancestors 'self'` lets only the site frame it. An artifact that
//   needs more (claude.ai's runtime, several files, compiling in the browser) is kept as a link instead.
// - The bridge (frame/bridge.js, as text in src/frame-bridge.ts) is added at the document's end, after a JSON script
//   naming the site's own origin (from the request, never `*`), which is where it addresses everything it says. It
//   tells the parent the page's height, so the frame grows to fit and the thread scrolls as one; in a signed-in
//   thread it also draws answer boxes under the page's questions and marks the words its discussions are on, and
//   it never saves anything itself. Both are inline scripts, which the CSP already allows; nothing widens.
// - A version never changes, so the answer is cached and revalidated (`private, no-cache`) with an ETag built from
//   the object's own and the bridge's version (a hash of its text): opening a thread again costs a 304, every open
//   still passes Access and the Worker's check, and a deploy that changes the bridge is never answered from a stale
//   copy.
//
// A document that doesn't start with `<!doctype` gets the skeleton claude.ai wraps every published page in, when
// it is saved (`withSkeleton`), so a file written by hand looks as it would on claude.ai.

import { BRIDGE, SCRIPT_VERSION } from "./frame-bridge.ts";

/** The CSP every page is served with; test/pages.test.ts holds the exact string. */
export const PAGE_CSP = [
  "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox",
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com",
  "worker-src blob:",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src data: blob:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

export { SCRIPT_VERSION } from "./frame-bridge.ts";

/** The head claude.ai publishes every page with, put in front of a document that has none of its own. */
export const SKELETON =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n';

/** The document as it is stored: as given when it opens with a doctype, else behind claude.ai's skeleton. */
export function withSkeleton(html: string): string {
  return /^\s*<!doctype/i.test(html) ? html : `${SKELETON}${html}`;
}

/**
 * What is added at a page's end: the site's origin as JSON (`<` escaped, so nothing in it can end the tag), then the
 * bridge as a module script, which runs once the document is parsed.
 */
export function frameScripts(origin: string): string {
  const config = JSON.stringify({ origin }).replace(/</g, "\\u003c");
  return `\n<script type="application/json" data-whysosuresh-frame>${config}</script>\n<script type="module">${BRIDGE}</script>\n`;
}

/** The ETag of a version as served: the object's own, joined to the added script's version. */
export function pageTag(objectEtag: string): string {
  return `"${objectEtag}-${SCRIPT_VERSION}"`;
}

/** The object's own ETag a revalidation names, when it names one of this script version's tags; null otherwise. */
export function objectTagFrom(ifNoneMatch: string | null): string | null {
  const match = ifNoneMatch === null ? null : new RegExp(`^"([^"]+)-${SCRIPT_VERSION}"$`).exec(ifNoneMatch.trim().replace(/^W\//, ""));
  return match?.[1] ?? null;
}

/** The headers of a page's answer, a 200 or a 304 alike. */
export function pageHeaders(tag: string): Record<string, string> {
  return {
    "Content-Security-Policy": PAGE_CSP,
    "Cache-Control": "private, no-cache",
    ETag: tag,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

/** Answers one stored version: 304 when the browser holds it already, else the document with the bridge. */
export async function servePage(bucket: R2Bucket, objectKey: string, request: Request): Promise<Response | null> {
  const origin = new URL(request.url).origin;
  const known = objectTagFrom(request.headers.get("If-None-Match"));
  const object = await bucket.get(objectKey, known === null ? {} : { onlyIf: { etagDoesNotMatch: known } });
  if (object === null) return null;
  const tag = pageTag(object.etag);
  if (!("body" in object)) return new Response(null, { status: 304, headers: pageHeaders(tag) });
  const page = new Blob([await object.arrayBuffer(), frameScripts(origin)]);
  return new Response(page, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...pageHeaders(tag) } });
}
