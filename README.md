# whysosuresh.com

The source of [whysosuresh.com](https://whysosuresh.com), Suresh's home page: who he is, his latest videos, the things he makes, where else to find him, and a short page on how to [talk to him](https://whysosuresh.com/feedback).

## How it is built

- `site/` is the whole site: plain HTML, one stylesheet and the note flow's three scripts (`talk.js`, the screens; `talk-topics.js`, the topics a note can be about and their questions; `talk-send.js`, the bot check and the upload), with no build step. `site/_headers` sets the security headers on every file.
- `site/inbox/` is Suresh's private inbox at `whysosuresh.com/inbox`, built for sorting one note at a time: four queues (To look at, To act on, To discuss, Done), the newest note open on arrival, one key or tap to sort it (Act on it, for feedback; Talk it through, for an idea; Drop, with a reason), and the next note opening by itself. No move asks for confirmation; each can be undone from its toast. On a laptop it is three columns with every move on a key (`?` lists them); on a phone, one note at a time with the moves under the thumb. Reply drafts an email inside the note and opens it in his own Gmail. Cloudflare Access guards `/inbox` and everything under it: he signs in with a one-time code sent to his email, and the recorder sync with its service token. The page holds no data; it reads the inbox's calls under `/inbox/api/`.
- `src/` is the Worker's code, which runs only for `/api/*` and `/inbox/api/*`. `POST /api/talk` takes a typed note of up to 4,000 characters about one of the topics, as JSON, checks it with Cloudflare's Turnstile and two daily limits (20 a day from one network, 60 in all), and stores it as a row in D1's `inbox`. The inbox's calls check Access's signature on every request themselves (`src/access.ts`) and admit only the owner and the sync: `GET /inbox/api/items` lists one tab, 50 at a time, and `POST /inbox/api/items/<id>` makes one move on one note (owner only). `migrations/` holds the database's tables.
- `wrangler.jsonc` describes the Cloudflare Worker `whysosuresh-com`: its files, its code, its one route (`whysosuresh.com`) and its binding to the database.
- `test/site.test.ts` checks the site: the files served, valid HTML, links, outside resources, the headers, unused CSS, and that no file names the owner's email address. `test/talk.test.ts` and `test/inbox.test.ts` run the Worker's bundle in Cloudflare's runtime, through Miniflare, with a local database; the inbox's tests play Access, signing tokens with the harness's own keys.
- `.github/workflows/site.yaml` runs the checks on every pull request and on `main`. On `main` it also applies new migrations and deploys, with a key that can deploy Workers and edit the database, and nothing in DNS.
- `infrastructure/` declares the rest: the zone, its records, the `www` redirect, the zone's settings, the database, the bot check and the inbox's Access (its sign-in, its two callers and its application), applied by Planton.

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

Then press "Send a note" on `http://localhost:8787/`, or open `#talk/stigmer` for one topic. Locally, `/inbox/` loads but every call it makes is refused: nothing signs for Access there, and the Worker admits no request Access didn't sign. The inbox's tests are where its calls run.

`AGENTS.md` lists the rules for changes.

## License

The code is MIT licensed (`LICENSE`). The words, the photo and the pictures on the site are Suresh's own and are not covered by that license.
