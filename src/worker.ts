// The Worker's code, which runs only for /api/*, /inbox/api/* and /threads/api/* (`run_worker_first` in
// wrangler.jsonc); every other path is a file from site/. Three doors: POST /api/talk, the note flow's public
// send (src/talk.ts); the private inbox's calls under /inbox/api/ (src/inbox.ts); and the threads' private calls
// under /threads/api/ (src/threads.ts). Each private door is behind its own Cloudflare Access application and
// the Worker's own check of the caller against that application's tag.

import type { Bindings } from "./bindings.ts";
import { handleInbox } from "./inbox.ts";
import { json } from "./json.ts";
import { handleTalk } from "./talk.ts";
import { handleThreads } from "./threads.ts";

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/talk") {
      if (request.method !== "POST") return json(405, { reason: "method" }, { Allow: "POST" });
      return handleTalk(request, env);
    }
    if (pathname.startsWith("/inbox/api/")) return handleInbox(request, env);
    if (pathname.startsWith("/threads/api/")) return handleThreads(request, env);
    return json(404, { reason: "not-found" });
  },
} satisfies ExportedHandler<Bindings>;
