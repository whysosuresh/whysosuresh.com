# Infrastructure: whysosuresh.com, declared as files

This directory is the declared record of everything whysosuresh.com runs on outside its own code: the Planton organization that operates it, the connections Planton signs in with, and the vendor accounts underneath. If a fact about how the site's infrastructure was set up is not here, it is missing, not "somewhere else". An agent reads this folder to learn what exists before it asks Planton; Planton is the running copy, this folder is the truth. The laws are in [`AGENTS.md`](AGENTS.md).

## Layout

| Folder | Holds | Applied from |
|---|---|---|
| `planton/planton.ai/` | Every record applied to Planton (`planton.ai`), all of it in organization `why-so-suresh`: the organization, its configuration, its connections, its environment, and the zone with its records, redirect and settings. Flat, named by the naming law below. Its [`README.md`](planton/planton.ai/README.md) is the apply order | Planton, with the `planton` CLI |
| `vendors/` | What a vendor's own dashboard holds that Planton cannot create, one folder per vendor: the account, every credential it minted, who holds it, how to mint it again | The vendor's dashboard, by the owner |

The folder under `planton/` is named for the Planton its records are applied to, so the name answers "which Planton do I run these against".

## The naming law

A file's name is its group and the identity Planton itself uses for the resource. It copies the manifest's own fields and puts one word in front:

```
{Category}.[{env}.]{Kind}.{name}.yaml            Connection, Infra
{Kind}.{name}.yaml                               Organization, Environment, StateBackend, SecretBackend
Config.Org.{Kind}.{name}.yaml                    organization-scoped Variable or Secret
Config.Env.{env}.{Kind}.{name}.yaml              environment-scoped Variable or Secret
```

- `Category` is what a listing sorts by first: `Connection`, `Config`, `Infra`.
- `env` follows the category, for environment-scoped records only.
- `Kind` is the manifest's `kind`, exactly as written; `name` is its `metadata.name`.

Names are load-bearing: a resource's IaC state is keyed by organization, environment, kind and name, so renaming one is a migration, never an edit.

## Credentials

A credential a vendor mints is named at the vendor for who holds it, then what it opens: `planton-whysosuresh` is the Cloudflare token Planton holds. Its value is never in this repository. The record in `planton/planton.ai/` holds the metadata and the command that sets the value from the clipboard; the vendor record holds the permissions, the custody and the re-mint.
