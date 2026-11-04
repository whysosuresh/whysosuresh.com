# whysosuresh.com

The source of [whysosuresh.com](https://whysosuresh.com), Suresh's home page: who he is, his latest videos, the things he makes, where else to find him, and a short page on how to [talk to him](https://whysosuresh.com/feedback).

## How it is built

- `site/` is the whole site: plain HTML, one stylesheet and the note flow's three scripts (`talk.js`, the screens; `talk-topics.js`, the topics a note can be about and their questions; `talk-send.js`, the bot check and the upload), with no build step. `site/_headers` sets the security headers on every file.
- `src/` is the Worker's code, which runs only for `/api/*`: `POST /api/talk` takes a typed note of up to 4,000 characters about one of the topics, as JSON, checks it with Cloudflare's Turnstile and two daily limits (20 a day from one network, 60 in all), and stores it as a row in D1's `inbox`. `migrations/` holds the database's tables.
- `wrangler.jsonc` describes the Cloudflare Worker `whysosuresh-com`: its files, its code, its one route (`whysosuresh.com`) and its binding to the database.
- `test/site.test.ts` checks the site: the files served, valid HTML, links, outside resources, the headers, and unused CSS. `test/talk.test.ts` runs the Worker's bundle in Cloudflare's runtime, through Miniflare, with a local database.
- `.github/workflows/site.yaml` runs the checks on every pull request and on `main`. On `main` it also applies new migrations and deploys, with a key that can deploy Workers and edit the database, and nothing in DNS.
- `infrastructure/` declares the rest: the zone, its records, the `www` redirect, the zone's settings, the database and the bot check, applied by Planton.

## Working on it

With the Node version in `.nvmrc`:

```sh
npm ci
npm ci --prefix deploy
npm run check
```

To run the site and its Worker locally, with a local database and Cloudflare's always-pass test keys for the bot check:

```sh
deploy/node_modules/.bin/wrangler d1 migrations apply whysosuresh-com --local --config wrangler.jsonc
npm run dev
```

Then open `http://localhost:8787/#talk`, or `#talk/stigmer` for one topic. No button opens the note flow yet; it appears with the inbox.

`AGENTS.md` lists the rules for changes.

## License

The code is MIT licensed (`LICENSE`). The words, the photo and the pictures on the site are Suresh's own and are not covered by that license.
