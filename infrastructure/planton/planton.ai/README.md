# planton.ai: Planton production

Everything applied to Planton production (`planton.ai`), all of it in organization `why-so-suresh`. This folder is the runbook: applying its rows in order, from this folder, rebuilds the organization. The charter and the naming law are in [`../../README.md`](../../README.md).

Every command names its instance and organization, because the CLI's saved context may be another one, and acts as the organization's owner, because the CLI's active account may be another one (zsh doesn't split an unquoted variable into words, so write the flags out or use `${=O}`):

```bash
export PLANTON_ACCOUNT=<the owner's Planton email>   # one command's account, without switching the active one
O="--instance planton.ai --org why-so-suresh"
```

## Environments

None yet. The Cloudflare connection is authorized for the whole organization, so it serves every environment the day one is created. The first environment is declared here (`Environment.<slug>.yaml`) when the first Planton-managed resource needs one.

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
