# Cloudflare

What the Cloudflare dashboard holds for whysosuresh.com that Planton cannot create: the account, the products turned on in it, the token Planton signs in with, the token the repository's deploy job uses, and the one copy each of the bot check's secret and the inbox owner's address outside Planton.

## The account

- Name `whysosuresh`, id `2f1cb3191775e02873cf13bb57e9e67f` (Account home, right column; recorded as `Config.Org.Variable.cloudflare-whysosuresh-account-id`). Free plan.
- Held by the owner's own Cloudflare login. It already existed on 2026-11-03 and was empty then: no zones, no Workers, no Pages projects.

## R2

R2 was turned on in the account on 2026-11-04 for the site's recordings (with a card, which stays on the account) and retired on 2026-11-04, when the site stopped taking voice; its one bucket is gone (`../../planton/planton.ai/README.md` rows 15 and 17).

## Zero Trust

Switched on by the owner on 2026-11-04, on the Free plan (up to 50 users, $0; the card from R2 is on file, and Cloudflare charges it only for use beyond the free limits). Onboarding asked for no team name and made the team `wild-violet-209f`; `Infra.prod.CloudflareZeroTrustOrganization.whysosuresh` renamed it at once, before anyone signed in, so the team domain is `whysosuresh.cloudflareaccess.com` (`../../planton/planton.ai/README.md` row 21).

It is used for one thing: Access in front of `whysosuresh.com/inbox`. Everything in it is a Planton file (rows 21 to 26): the team's name, the sign-in by an emailed one-time code, the recorder sync's service token, the two policies and the application. Cloudflare's own dashboard sign-in, which the account listed as an identity provider before any of this, is left as it is; the inbox's application allows only the email code.

The recorder sync's service token is Planton's, and so is its secret: Cloudflare shows it once, at creation, and Planton keeps it as the token's sensitive output. A script reads it from there for each use and never prints it; there is no other copy. Rotating it is one field (`clientSecretVersion`) in its file, re-applied.

## The inbox owner's address

The one email address the inbox admits is the Planton secret `inbox-owner-email` (row 22), read by the owner's Access policy. The Worker checks the same address again, so it has one more copy: `INBOX_OWNER_EMAIL` in the GitHub environment `production`, which the deploy hands to the Worker as a secret, as it does the bot check's. A deploy with it empty fails before uploading anything. The repository is public and names the address nowhere.

**Copy.** As the bot check's secret below: a script reveals the one value with `planton secret get inbox-owner-email --reveal -o plain`, checks its shape, and pipes it into `gh secret set INBOX_OWNER_EMAIL --env production --repo whysosuresh/whysosuresh.com`; nothing prints it. Changing the address means setting the Planton secret, re-applying the owner's policy, copying it again and re-running the latest `site` run on `main`.

## The bot check's secret

The note flow's Turnstile widget (`Infra.prod.CloudflareTurnstileWidget.whysosuresh-com-talk`) is Planton's, and so is its secret: Planton keeps it as the widget's sensitive output. The Worker isn't a Planton resource, so the secret has one more copy, carried by hand: `TURNSTILE_SECRET` in the GitHub environment `production` of `whysosuresh/whysosuresh.com`, beside the deploy key. On each deploy the job hands it to the Worker as a secret (`.github/workflows/site.yaml`); a deploy with it empty fails before uploading anything.

**Custody.** Planton and the `production` environment. Nowhere else: never in a file, a command line or a log.

**Copy or re-mint.** The copy is taken from Planton, never by hand: a script reads the widget's `status.outputs.secret` reference with `planton get`, reveals that one value with `planton secret get --reveal --key … -o plain` (recorded in the secret's read-audit trail), checks its shape, and pipes it into `gh secret set TURNSTILE_SECRET --env production --repo whysosuresh/whysosuresh.com`; nothing prints it. To re-mint, rotate the secret key on the widget's page in the dashboard, re-apply the widget's file so Planton holds the new value (Cloudflare returns the secret on every read), copy it the same way, and re-run the latest `site` run on `main`. Until the deploy runs, the Worker keeps the old secret and refuses every send.

The site key is public. It is the widget's identity, and sits in `site/talk-send.js`.

## The account API token `planton-whysosuresh`

Planton's sign-in to the account, stored as `Config.Org.Secret.cloudflare-whysosuresh-account-api-token` and used by `Connection.CloudflareProviderConnection.cloudflare-whysosuresh-account`. Minted by the owner on 2026-11-03 under Manage Account, Account API Tokens, as a custom token. No expiry, all IP addresses allowed. The summary Cloudflare showed before creating it:

- **Entire whysosuresh account:** Workers Scripts Write, Account Settings Read, D1 Write, Workers R2 Storage Write, Turnstile Sites Write, Access: Service Tokens Write, Access: Organizations, Identity Providers, and Groups Write, Access: Apps and Policies Write. The three Access rights have been in use since 2026-11-04, for the inbox's Access (`../../planton/planton.ai/README.md` rows 21 and 23 to 26).
- **All zones in whysosuresh:** DNS Write, Zone Write, Zone Settings Write, Workers Routes Write, SSL and Certificates Write, Dynamic URL Redirects Write.

In the token editor, "Write" is the Edit box. Workers Scripts is the group marked Legacy (the newer "Workers" group's Editor role is a different grant); "Access: Apps and Policies" appears in the editor as a row named just "Access"; the redirect permission is labelled "Dynamic URL Redirects". Zone resources are the editor's "All Domains" scope, which Cloudflare's summary reads as "All zones in whysosuresh".

The token is deliberately narrower than everything Planton can deploy on Cloudflare. It also lacks Account API Tokens Read, so Planton's Verify can sign in but can't list what the token may do.

**Custody.** Its value is in Planton's secret, and its copy for people is in the owner's password manager. Nowhere else.

**Re-mint.** In the dashboard, open the token's menu and choose Roll. That keeps its permissions and gives a new value. Copy the new value, then set it from the clipboard with the command in the secret's header, and run Verify. Revoking the token cuts Planton off at once.

The token can edit DNS. The zone's TXT records `_atproto` and `_dmarc` must never change.

## Set only in the dashboard: Real User Measurements off

A new free zone comes with Cloudflare's Real User Measurements in its default state, which adds a `static.cloudflareinsights.com/beacon.min.js` script tag to every HTML page a browser fetches. The site's CSP blocked it, so it measured nothing, but every page logged a CSP error and no longer matched `site/`. On 2026-11-03 it was turned off under the zone's Speed, Real user monitoring, "Disable completely"; the page now reads "RUM is currently disabled for this zone".

Planton has no record of this zone default (`CloudflareWebAnalyticsSite` creates a site; it doesn't hold the zone's automatic setup), so this note is its record. The proof: a browser-like request to `https://whysosuresh.com/` returns `site/index.html` byte for byte, with no `cloudflareinsights` in it. Turning it back on would need the CSP to allow the script.

## The account API token `github-whysosuresh-com-deployer`

The `deploy` job's key in `.github/workflows/site.yaml`: it applies the database's migrations, uploads `site/` and the Worker's code to the Worker `whysosuresh-com`, and sets the Worker's one route. Planton can't upload a repository's static files to a Worker yet, so this one Worker is deployed from GitHub instead. Created on 2026-11-03 under Manage Account, Account API Tokens, Create Token, "Start from scratch", as `github-whysosuresh-com-deployer`. No expiry, all IP addresses allowed. Two policies and nothing else; Cloudflare's review summary read "Entire whysosuresh account: Workers Scripts Write" and "All zones in whysosuresh: Zone Read, Workers Routes Write":

- **Entire account, Workers Scripts (Legacy), Edit:** creates the Worker on the first deploy and uploads each version.
- **All Domains, Workers Routes, Edit:** sets the route `whysosuresh.com/*` from `wrangler.jsonc`.
- **All Domains, Zone, Read:** wrangler finds the zone by its name (`zone_name` in `wrangler.jsonc`), within this account only.
- **Entire account, D1, Edit:** applies `migrations/` to the database `whysosuresh-com` before each deploy (`../../planton/planton.ai/README.md` row 19). Added after the key was created; its value didn't change.

It has no DNS, Zone Edit or Zone Settings rights, so it can't change a record, including `_atproto` and `_dmarc`. The account holds no other zone, Worker or database, so the account-wide rows reach nothing else today; a second site in this account would need this key narrowed first.

**Custody.** Its value is the secret `CLOUDFLARE_API_TOKEN` in the GitHub environment `production` of `whysosuresh/whysosuresh.com`, which only `main` may use, and its copy for people is in the owner's password manager. Nowhere else, and never in Planton.

**Re-mint.** In the dashboard, open the token's menu and choose Roll. Paste the new value into the `production` environment's `CLOUDFLARE_API_TOKEN` and the password manager, then re-run the latest `site` run on `main`; its `deploy` job is the proof. Revoking the token stops deploys and leaves the live site as it is.
