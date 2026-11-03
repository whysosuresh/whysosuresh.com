# Cloudflare

What the Cloudflare dashboard holds for whysosuresh.com that Planton cannot create: the account, and the token Planton signs in with.

## The account

- Name `whysosuresh`, id `2f1cb3191775e02873cf13bb57e9e67f` (Account home, right column; recorded as `Config.Org.Variable.cloudflare-whysosuresh-account-id`). Free plan.
- Held by the owner's own Cloudflare login. It already existed on 2026-11-03 and was empty then: no zones, no Workers, no Pages projects.

## The account API token `planton-whysosuresh`

Planton's sign-in to the account, stored as `Config.Org.Secret.cloudflare-whysosuresh-account-api-token` and used by `Connection.CloudflareProviderConnection.cloudflare-whysosuresh-account`. Minted by the owner on 2026-11-03 under Manage Account, Account API Tokens, as a custom token. No expiry, all IP addresses allowed. The summary Cloudflare showed before creating it:

- **Entire whysosuresh account:** Workers Scripts Write, Account Settings Read, D1 Write, Workers R2 Storage Write, Turnstile Sites Write, Access: Service Tokens Write, Access: Organizations, Identity Providers, and Groups Write, Access: Apps and Policies Write.
- **All zones in whysosuresh:** DNS Write, Zone Write, Zone Settings Write, Workers Routes Write, SSL and Certificates Write, Dynamic URL Redirects Write.

In the token editor, "Write" is the Edit box. Workers Scripts is the group marked Legacy (the newer "Workers" group's Editor role is a different grant); "Access: Apps and Policies" appears in the editor as a row named just "Access"; the redirect permission is labelled "Dynamic URL Redirects". Zone resources are the editor's "All Domains" scope, which Cloudflare's summary reads as "All zones in whysosuresh".

The token is deliberately narrower than everything Planton can deploy on Cloudflare. It also lacks Account API Tokens Read, so Planton's Verify can sign in but can't list what the token may do.

**Custody.** Its value is in Planton's secret, and its copy for people is in the owner's password manager. Nowhere else.

**Re-mint.** In the dashboard, open the token's menu and choose Roll. That keeps its permissions and gives a new value. Copy the new value, then set it from the clipboard with the command in the secret's header, and run Verify. Revoking the token cuts Planton off at once.

The token can edit DNS. The zone's TXT records `_atproto` and `_dmarc` must never change.
