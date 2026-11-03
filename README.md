# whysosuresh.com

The source of [whysosuresh.com](https://whysosuresh.com), Suresh's home page: who he is, his latest videos, the things he makes, where else to find him, and a short page on [feedback and ideas](https://whysosuresh.com/feedback).

## How it is built

- `site/` is the whole site: plain HTML and one stylesheet, with no build step and no script. `site/_headers` sets the security headers on every response.
- `wrangler.jsonc` describes the Cloudflare Worker `whysosuresh-com`, which serves `site/` and runs no code of its own. Its one route sends `whysosuresh.com` to it.
- `test/site.test.ts` checks the site: the files served, valid HTML, links, outside resources, the headers, and unused CSS.
- `.github/workflows/site.yaml` runs the checks on every pull request and on `main`. On `main` it also deploys, with a key that can deploy Workers and nothing in DNS.
- `infrastructure/` declares the rest: the zone, its records, the `www` redirect and the zone's settings, applied by Planton.

## Working on it

With the Node version in `.nvmrc`:

```sh
npm ci
npm ci --prefix deploy
npm run check
```

To see the site with its headers:

```sh
deploy/node_modules/.bin/wrangler dev --config wrangler.jsonc --port 8787
```

`AGENTS.md` lists the rules for changes.

## License

The code is MIT licensed (`LICENSE`). The words, the photo and the pictures on the site are Suresh's own and are not covered by that license.
