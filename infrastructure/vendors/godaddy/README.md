# GoDaddy

What GoDaddy holds for whysosuresh.com: the registration, and the two nameservers that send every DNS question to Cloudflare. Nothing else: no DNS, no forwarding, no hosting and no mail.

## The registration

- `whysosuresh.com`, registered 2026-10-20 in the owner's own GoDaddy account; the registry's expiry is 2027-10-20 (`whois whysosuresh.com`).
- The registrar's locks are on (`clientTransferProhibited`, `clientUpdateProhibited` and the rest in `whois`). GoDaddy lifts its own update lock when the owner changes the nameservers in its portal, so they stay on.
- DNSSEC is off (`whois` reads "DNSSEC: unsigned", and the registry holds no DS record). That is why moving the zone between Cloudflare accounts can't break validation. Turning it on is two steps in a fixed order: sign the zone in Cloudflare once it is active, then enter its DS record here. Entering a DS record for an unsigned zone breaks resolution.

## The nameservers

The domain delegates to the two nameservers Cloudflare gave the zone (`status.outputs.nameservers` of `../../planton/planton.ai/Infra.prod.CloudflareDnsZone.whysosuresh-com.yaml`). They are set in GoDaddy under Domain Portfolio, whysosuresh.com, DNS, Nameservers, Change nameservers, "I'll use my own nameservers".

**Proof.** `dig +norec NS whysosuresh.com @a.gtld-servers.net` names the two. The registry's answer is cached for 172800 seconds (two days), so the old pair keeps getting questions for up to two days after a change, and the zone they serve must keep answering until then.

**Changing them** is the owner's act, by hand in GoDaddy. Nothing in this repository or in Planton can change them.
