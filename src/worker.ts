// The Worker's code, which runs only for /api/* and /threads/* (`run_worker_first` in wrangler.jsonc); every other
// path is a file from site/, /inbox's redirect to /threads/ among them (site/_redirects). Two doors: POST /api/talk,
// the note flow's public send (src/talk.ts); and the threads' private calls under /threads/api/ (src/threads.ts),
// behind their Cloudflare Access application and the Worker's own check of the caller against its tag. Every other path under /threads/ is the
// threads page (src/pages.ts), handed over from site/ with no sign-in, because Access guards the calls, never a
// thread's page. The calls are matched first, so no call ever reaches the pages.

import type { Bindings } from "./bindings.ts";
import { json } from "./json.ts";
import { handlePage } from "./pages.ts";
import { handleTalk } from "./talk.ts";
import { handleThreads } from "./threads.ts";

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/talk") {
      if (request.method !== "POST") return json(405, { reason: "method" }, { Allow: "POST" });
      return handleTalk(request, env);
    }
    if (pathname.startsWith("/threads/api/")) return handleThreads(request, env);
    if (pathname.startsWith("/threads/")) return handlePage(request, env);
    return json(404, { reason: "not-found" });
  },
} satisfies ExportedHandler<Bindings>;
