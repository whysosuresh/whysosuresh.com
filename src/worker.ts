// The Worker's code, which runs only for /api/*, /threads/*, /me, /meetings, /people, /people/*, /asks and /ask/*
// (`run_worker_first` in wrangler.jsonc); every other
// path is a file from site/, /inbox's redirect to /threads/ among them (site/_redirects). Four doors: POST /api/talk,
// the note flow's public send (src/talk.ts); the threads' private calls under /threads/api/ (src/threads.ts),
// behind their Cloudflare Access application and the Worker's own check of the caller against its tag; and, under
// /api/access/, the site's answer to Access's sign-in question for invited people, with the public key it is
// signed with (src/evaluate.ts), which Access calls itself and so are outside the application. A thread Suresh
// made public is read, and a note sent on it, under /api/threads/ (src/public.ts), outside Access too, with no
// sign-in. An ask, a questions page anyone answers by its link, is read and answered under /api/asks/ (src/asks.ts),
// outside Access too. The rooms (/me, the door everyone signed in enters by; /meetings; /asks; /people and a person
// under it), an ask's own address (/ask/<slug>) and every other path under /threads/ are the threads page
// (src/pages.ts), handed over from site/ with no sign-in, because Access guards the calls, never a thread's page. The calls are matched first, so no call ever
// reaches the pages.

import { handleAsks } from "./asks.ts";
import type { Bindings } from "./bindings.ts";
import { handleEvaluate, handleKeys } from "./evaluate.ts";
import { json } from "./json.ts";
import { handlePage } from "./pages.ts";
import { handlePublic } from "./public.ts";
import { handleTalk } from "./talk.ts";
import { handleThreads } from "./threads.ts";

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/talk") {
      if (request.method !== "POST") return json(405, { reason: "method" }, { Allow: "POST" });
      return handleTalk(request, env);
    }
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
    if (pathname.startsWith("/threads/api/")) return handleThreads(request, env);
    if (pathname.startsWith("/threads/") || pathname.startsWith("/people/") || pathname === "/me" || pathname === "/meetings" || pathname === "/people") return handlePage(request, env);
    if (pathname === "/asks" || pathname.startsWith("/ask/")) return handlePage(request, env);
    return json(404, { reason: "not-found" });
  },
} satisfies ExportedHandler<Bindings>;
