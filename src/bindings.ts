// The Worker's bindings: what wrangler.jsonc declares (the generated `Env`), plus the three secrets the deploy
// hands over from the GitHub environment `production`, which wrangler.jsonc doesn't name and so the
// generated type can't. Any may be missing (a local run, a deploy gone wrong), and the route that reads it
// refuses with 503 rather than run without it.

export type Bindings = Env & {
  /** The bot check's secret, read by the note flow's send (src/talk.ts). */
  readonly TURNSTILE_SECRET?: string;
  /** The one email address the threads admit (src/access.ts); kept out of the public repository. */
  readonly INBOX_OWNER_EMAIL?: string;
  /** The RSA private key, as a JWK, that signs the site's answers to Access's sign-in question (src/evaluate.ts). */
  readonly THREADS_EVALUATION_KEY?: string;
};
