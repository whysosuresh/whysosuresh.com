# Agent guide: infrastructure

What whysosuresh.com runs on, declared as files and operated by Planton (`planton.ai`), organization `why-so-suresh`. Read [`README.md`](README.md) first, then [`planton/planton.ai/README.md`](planton/planton.ai/README.md) (the apply order), then the vendor record before touching anything a vendor holds.

## Laws

- **The files are the automation.** Every Planton resource is a committed file here, applied with `planton apply -f <file> --instance planton.ai --org why-so-suresh`. A change made in a console and not captured here is a defect, closed by writing the file and applying it.
- **Read the folder before asking Planton.** What exists is listed here; Planton is checked to prove it (`planton diff -f <file>`), not to discover it.
- **Every YAML file explains itself.** A leading comment says why it exists and the command that applies it; a non-obvious choice gets a comment on its line.
- **Names are permanent.** Organization, environment, connection and secret slugs are identities; propose a new one with its consequence before applying it.
- **No secret value in any file, command line or chat.** A value goes from the clipboard into Planton through standard input (`pbpaste | planton secret set <slug> --string ...`), and its copy for people lives in the owner's password manager.
- **The CLI acts as the organization's owner.** Its active account may be another; pass `--account <owner's email>` (or `PLANTON_ACCOUNT`) on each command rather than switching the active account.
- **Never touch the zone's TXT records `_atproto` and `_dmarc`.** The Planton token can edit DNS; nothing applied here may change those two.
- **Nothing private in any file:** this repository is public.
