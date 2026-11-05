# planton.ai: Planton production

Everything applied to Planton production (`planton.ai`), all of it in organization `why-so-suresh`. This folder is the runbook: applying its rows in order, from this folder, rebuilds the organization. The charter and the naming law are in [`../../README.md`](../../README.md).

Every command names its instance and organization, because the CLI's saved context may be another one, and acts as the organization's owner, because the CLI's active account may be another one (zsh doesn't split an unquoted variable into words, so write the flags out or use `${=O}`):

```bash
export PLANTON_ACCOUNT=<the owner's Planton email>   # one command's account, without switching the active one
O="--instance planton.ai --org why-so-suresh"
```

## Environments

One, `prod` (`Environment.prod.yaml`), created 2026-11-03: the zone, its records, its redirect and its settings, the database, the bot check and Access in front of the inbox and the threads' calls, and everything the site runs on. Everything there lives and dies together, so there is no separate environment for the zone. The Cloudflare connection is authorized for the whole organization, so it serves `prod` without a step.

## Contents, in apply order

Each row is applied with `planton apply -f <file> $O` and followed by its proof. Owner steps are marked **[owner]**.

| # | File or step | Declares | Proof |
|---|---|---|---|
| 0 | **[owner]** The Cloudflare account `whysosuresh` and its account API token `planton-whysosuresh` (`../../vendors/cloudflare/README.md`) | Nothing in Planton yet | The token answers `active` at Cloudflare's `/accounts/<id>/tokens/verify` |
| 1 | `Organization.why-so-suresh.yaml` (applied with `--instance planton.ai` only) | The organization, created in the console 2026-11-03 and adopted | `planton get organization why-so-suresh --instance planton.ai` shows the file's spec |
| 2 | `Config.Org.Variable.cloudflare-whysosuresh-account-id.yaml` | The Cloudflare account id | `planton get variable cloudflare-whysosuresh-account-id $O` |
| 3 | `Config.Org.Secret.cloudflare-whysosuresh-account-api-token.yaml`, then its value from the clipboard as its header shows | The token's record on Planton's built-in store, and its value | `planton secret get cloudflare-whysosuresh-account-api-token $O` shows a version |
| 4 | `Connection.CloudflareProviderConnection.cloudflare-whysosuresh-account.yaml`, `Connection.ProviderConnectionAuthorization.cloudflare-whysosuresh-account.yaml`, `Connection.DefaultProviderConnection.cloudflare-default.yaml` | The Cloudflare connection, authorized for every environment and elected the organization's default | `planton connect cloudflare verify cloudflare-whysosuresh-account $O` reads "Signed In, Not Yet Checked for What It Can Deploy" (2026-11-03): healthy, but the token can't read its own permissions, so Planton can't count the kinds it can deploy. Adding Account API Tokens Read to the token turns this into a per-kind verdict. `planton connection default list $O` shows `cloudflare-default` |
| 5 | **[owner]** Planton's GitHub App ("Planton AI") installed on the `whysosuresh` account with only `whysosuresh/whysosuresh.com` selected (`../../vendors/github/README.md`); then `Connection.GithubConnection.github-whysosuresh.yaml` | Planton's way into the repository, installation 178170335 | `planton connect github list-repos github-whysosuresh $O` lists exactly `whysosuresh/whysosuresh.com` (2026-11-03) |
| 6 | `Environment.prod.yaml` | The one environment | `planton get environment prod $O` |
| 7 | `Infra.prod.CloudflareDnsZone.whysosuresh-com.yaml` | The zone in the account `whysosuresh` (no hold: Cloudflare offers it only on Enterprise zones) | `planton diff -f <file> $O` exits 0; `status.outputs.nameservers` names the two nameservers row 13 gives GoDaddy |
| 8 | `Infra.prod.CloudflareDnsRecord.whysosuresh-com-atproto.yaml` | The Bluesky handle's TXT, never changed | Before the switch: the `content` in the component's state (`planton tofu state download`) equals `did=did:plc:b2skyswdyxq73sryvjtquofy`. After it: `dig +short TXT _atproto.whysosuresh.com @1.1.1.1` gives the same, and `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=whysosuresh.com` returns that DID |
| 9 | `Infra.prod.CloudflareDnsRecord.whysosuresh-com-dmarc.yaml` | The DMARC policy's TXT, never changed | As row 8, for `_dmarc` and its policy string |
| 10 | `Infra.prod.CloudflareDnsRecord.whysosuresh-com-apex.yaml`, `Infra.prod.CloudflareDnsRecord.whysosuresh-com-www.yaml` | Proxied AAAA `100::` on the apex and www: names only Cloudflare answers | `planton diff -f <file> $O` exits 0 |
| 11 | `Infra.prod.CloudflareRuleset.whysosuresh-com-redirects.yaml` | The zone's redirect rules | `planton diff -f <file> $O` exits 0; after the switch, `curl -sI https://www.whysosuresh.com/feedback?x=1` answers 301 to `https://whysosuresh.com/feedback?x=1` |
| 12 | `Infra.prod.CloudflareZoneSettings.whysosuresh-com.yaml` | Always Use HTTPS | `curl -sI http://whysosuresh.com` answers 301 to `https://whysosuresh.com/` |
| 13 | **[owner]** At GoDaddy, the domain's nameservers set to the two from row 7 (`../../vendors/godaddy/README.md`), then "Check nameservers" pressed on the zone's overview in the `whysosuresh` account | Nothing in Planton | `dig +norec NS whysosuresh.com @a.gtld-servers.net` names the two; rows 8 and 9's after-reads hold |
| 14 | **[owner]** Two days after row 13, whysosuresh.com deleted from the Cloudflare account it came from | Nothing in Planton | `dig NS whysosuresh.com` names only the two from row 7 |
| 15 | Retired 2026-11-04, with row 17. It was: **[owner]** R2 turned on in the account `whysosuresh` for the site's recordings. R2 stays on and the card stays on the account (`../../vendors/cloudflare/README.md`) | Nothing in Planton | Nothing left to check |
| 16 | `Infra.prod.CloudflareD1Database.whysosuresh-com.yaml` | The site's database; its tables are the repository's migrations, applied by the deploy job | `planton diff -f <file> $O` exits 0; `status.outputs.database_id` is the id in `../../../wrangler.jsonc` |
| 17 | Retired 2026-11-04, when the site stopped taking voice. It was `Infra.prod.CloudflareR2Bucket.whysosuresh-com-recordings.yaml`, the recordings' bucket: emptied, torn down with `planton purge -f <file> $O`, and its file removed | Nothing in Planton | The account's R2 bucket list doesn't name `whysosuresh-com-recordings` |
| 18 | `Infra.prod.CloudflareTurnstileWidget.whysosuresh-com-talk.yaml` | The note flow's invisible bot check, for `whysosuresh.com` only | `planton diff -f <file> $O` exits 0; `status.outputs.sitekey` is the key in `../../../site/talk-send.js` |
| 19 | **[owner]** The deploy key `github-whysosuresh-com-deployer` gains Account / D1 / Edit (`../../vendors/cloudflare/README.md`) | Nothing in Planton | The deploy job's migration step succeeds |
| 20 | Row 18's secret copied from Planton into the GitHub environment `production` as `TURNSTILE_SECRET`, by the script in `../../vendors/cloudflare/README.md` | Nothing in Planton | The deploy job's secret step succeeds, and a send from the site is stored |
| 21 | **[owner]** Zero Trust switched on in the account `whysosuresh`, Free plan (2026-11-04, `../../vendors/cloudflare/README.md`, "Zero Trust"); then `Infra.prod.CloudflareZeroTrustOrganization.whysosuresh.yaml`, which gives the team the name `whysosuresh` | The team, configured (Cloudflare creates it when Zero Trust is switched on, under a random name) | `planton diff -f <file> $O` exits 0; Cloudflare's `/accounts/<id>/access/organizations` names `whysosuresh.cloudflareaccess.com`, the `ACCESS_TEAM_DOMAIN` in `../../../wrangler.jsonc` |
| 22 | `Config.Org.Secret.inbox-owner-email.yaml`, then its value through standard input as its header shows | The one email address the inbox admits, kept out of this repository | `planton secret get inbox-owner-email $O` shows a version |
| 23 | `Infra.prod.CloudflareZeroTrustAccessIdentityProvider.one-time-pin.yaml` | The sign-in by an emailed one-time code (one per account) | `planton diff -f <file> $O` exits 0 |
| 24 | `Infra.prod.CloudflareZeroTrustAccessServiceToken.whysosuresh-com-inbox-sync.yaml` | The recorder sync's machine sign-in, with no expiry; Planton keeps its secret | `planton diff -f <file> $O` exits 0; `status.outputs.client_id` is the `INBOX_SYNC_CLIENT_ID` in `../../../wrangler.jsonc` |
| 25 | `Infra.prod.CloudflareZeroTrustAccessPolicy.whysosuresh-com-inbox-owner.yaml`, `Infra.prod.CloudflareZeroTrustAccessPolicy.whysosuresh-com-inbox-sync.yaml` | Who may pass: the owner's address (row 22), for a week per code; the sync's token (row 24), by Service Auth | `planton diff -f <file> $O` exits 0 for each |
| 26 | `Infra.prod.CloudflareZeroTrustAccessApplication.whysosuresh-com-inbox.yaml` | The door on `whysosuresh.com/inbox` and every path under it, with row 25's policies, owner first | `planton diff -f <file> $O` exits 0; `status.outputs.aud` is the `ACCESS_AUD` in `../../../wrangler.jsonc`; `curl -sI https://whysosuresh.com/inbox/api/items` answers 302 to `whysosuresh.cloudflareaccess.com`, and the same request with the sync's token passes |
| 27 | Row 22's value copied from Planton into the GitHub environment `production` as `INBOX_OWNER_EMAIL`, by the script in `../../vendors/cloudflare/README.md` | Nothing in Planton | The deploy job's secret step succeeds, and the owner's sign-in opens the inbox |
| 28 | `Infra.prod.CloudflareZeroTrustAccessApplication.whysosuresh-com-threads.yaml` (applied 2026-11-05) | The door on the threads' private calls, `whysosuresh.com/threads/api` and every path under it, never a thread's own page, with row 25's policies, owner first | `planton diff -f <file> $O` exits 0; `status.outputs.aud` is the `THREADS_ACCESS_AUD` in `../../../wrangler.jsonc`; `curl -sI https://whysosuresh.com/threads/api/threads` answers 302 to `whysosuresh.cloudflareaccess.com` |

The site's Worker isn't a Planton resource: Planton can't upload a repository's static files to a Worker yet, so it's deployed from the repository itself, as the root `AGENTS.md` says. Its one route, its binding to row 16 and the public halves of rows 21, 24, 26 and 28 are declared in `wrangler.jsonc`, never in the dashboard.
