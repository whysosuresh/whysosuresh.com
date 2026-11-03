# planton.ai: Planton production

Everything applied to Planton production (`planton.ai`), all of it in organization `why-so-suresh`. This folder is the runbook: applying its rows in order, from this folder, rebuilds the organization. The charter and the naming law are in [`../../README.md`](../../README.md).

Every command names its instance and organization, because the CLI's saved context may be another one, and acts as the organization's owner, because the CLI's active account may be another one (zsh doesn't split an unquoted variable into words, so write the flags out or use `${=O}`):

```bash
export PLANTON_ACCOUNT=<the owner's Planton email>   # one command's account, without switching the active one
O="--instance planton.ai --org why-so-suresh"
```

## Environments

One, `prod` (`Environment.prod.yaml`), created 2026-11-03: the zone, its records, its redirect and its settings, and everything the site runs on. Everything there lives and dies together, so there is no separate environment for the zone. The Cloudflare connection is authorized for the whole organization, so it serves `prod` without a step.

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
| 7 | `Infra.prod.CloudflareDnsZone.whysosuresh-com.yaml` | The zone in the account `whysosuresh`, held so no other Cloudflare account can add it | `planton diff -f <file> $O` exits 0; `status.outputs.nameservers` names the two nameservers row 13 gives GoDaddy |
| 8 | `Infra.prod.CloudflareDnsRecord.whysosuresh-com-atproto.yaml` | The Bluesky handle's TXT, never changed | Before the switch: the `content` in the component's state (`planton tofu state download`) equals `did=did:plc:b2skyswdyxq73sryvjtquofy`. After it: `dig +short TXT _atproto.whysosuresh.com @1.1.1.1` gives the same, and `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=whysosuresh.com` returns that DID |
| 9 | `Infra.prod.CloudflareDnsRecord.whysosuresh-com-dmarc.yaml` | The DMARC policy's TXT, never changed | As row 8, for `_dmarc` and its policy string |
| 10 | `Infra.prod.CloudflareDnsRecord.whysosuresh-com-apex.yaml`, `Infra.prod.CloudflareDnsRecord.whysosuresh-com-www.yaml` | Proxied AAAA `100::` on the apex and www: names only Cloudflare answers | `planton diff -f <file> $O` exits 0 |
| 11 | `Infra.prod.CloudflareRuleset.whysosuresh-com-redirects.yaml` | The zone's redirect rules | `planton diff -f <file> $O` exits 0; after the switch, `curl -sI https://www.whysosuresh.com/feedback?x=1` answers 301 to `https://whysosuresh.com/feedback?x=1` |
| 12 | `Infra.prod.CloudflareZoneSettings.whysosuresh-com.yaml` | Always Use HTTPS | `curl -sI http://whysosuresh.com` answers 301 to `https://whysosuresh.com/` |
| 13 | **[owner]** At GoDaddy, the domain's nameservers set to the two from row 7 (`../../vendors/godaddy/README.md`), then "Check nameservers" pressed on the zone's overview in the `whysosuresh` account | Nothing in Planton | `dig +norec NS whysosuresh.com @a.gtld-servers.net` names the two; rows 8 and 9's after-reads hold |
| 14 | **[owner]** Two days after row 13, whysosuresh.com deleted from the Cloudflare account it came from | Nothing in Planton | `dig NS whysosuresh.com` names only the two from row 7 |

The site's Worker isn't a Planton resource: Planton can't upload a repository's static files to a Worker yet, so it's deployed from the repository itself, as the root `AGENTS.md` says. Its one route is declared in `wrangler.jsonc`, never in the dashboard.
