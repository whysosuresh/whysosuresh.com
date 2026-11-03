# Agent guide: whysosuresh.com

This repository is whysosuresh.com, Suresh's home page: the static folder `site/`, served by one Cloudflare Worker, `whysosuresh-com` (`wrangler.jsonc`), deployed from `main` by `.github/workflows/site.yaml`. These are the laws for any change here.

## Laws

- **Run `npm run check` before every push.** It runs the strict type check, the site tests (`test/site.test.ts`) and wrangler's dry run. Local commands run on the Node in `.nvmrc`.
- **Code style.** Strict TypeScript with no `any`. Every file opens with a comment that says what it is for.
- **`site/` is an allowlist.** Every file it holds is served, and the list in `test/site.test.ts` names each one. A new file is added there on purpose, never by accident.
- **Links are clean and root-absolute:** `/` and `/feedback`, never `feedback.html` or `index.html`. The Worker redirects those with a 307, and a relative link breaks on the 404 page, which is served at any path.
- **Never `no-referrer`,** on a page, an element or a header. The YouTube player refuses to play without a referrer.
- **`site/_headers` matches the pages.** The test holds the expected set. A new kind of resource changes the CSP, and the test with it.
- **`wrangler.jsonc`'s `routes` is the domain's whole truth.** Every deploy attaches exactly the domains named there and detaches any other, so a domain added in Cloudflare's dashboard is gone after the next deploy.
- **Never touch the zone's TXT records `_atproto` and `_dmarc`.** `_atproto` is what makes `whysosuresh.com` a Bluesky handle, and `_dmarc` is the mail policy. The deploy key can't reach DNS, and nothing here should try to.
- **The Cloudflare key lives only in the GitHub environment `production`,** which only `main` may use. The `check` job holds no key. The deploy job installs nothing but the wrangler pinned in `deploy/`.
- **Nothing private in any file:** no notes from outside this repository, no task or plan names, and no one's name but Suresh's.
