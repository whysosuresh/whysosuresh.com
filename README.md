# whysosuresh.com

The source of [whysosuresh.com](https://whysosuresh.com), Suresh's home page: who he is, his latest videos, the things he makes, where else to find him, and a short page on how to [talk to him](https://whysosuresh.com/feedback).

## How it is built

- `site/` is the whole site: plain HTML, one stylesheet and the note flow's three scripts (`talk.js`, the screens; `talk-topics.js`, the topics a note can be about and their questions; `talk-send.js`, the bot check and the upload), with no build step. `site/_headers` sets the security headers on every file.
- `site/inbox/` is Suresh's private inbox at `whysosuresh.com/inbox`, built for sorting one note at a time: four queues (To look at, To act on, To discuss, Done), the newest note open on arrival, one key or tap to sort it (Act on it, for feedback; Talk it through, for an idea; Drop, with a reason), and the next note opening by itself. No move asks for confirmation; each can be undone from its toast. On a laptop it is three columns with every move on a key (`?` lists them); on a phone, one note at a time with the moves under the thumb. Reply drafts an email inside the note and opens it in his own Gmail. Beside the site's notes it shows what the recorder sync adds (things told to him in person, his own work and ideas, each with a title, and items moved from a GitHub issue with a link back), and notes the sync filed as issues, in Done as Filed with a link to the issue. What the sync adds is GitHub Markdown and is shown formatted (`site/app/markdown.js` parses it into plain data the page builds with DOM calls); a visitor's note is always shown as the plain text they typed. Cloudflare Access guards `/inbox` and everything under it: he signs in with a one-time code sent to his email, and the recorder sync with its service token. The page holds no data; it reads the inbox's calls under `/inbox/api/`.
- `site/threads/` and `site/app/` are the threads at `whysosuresh.com/threads`, the inbox's successor: Today (new notes, and open threads that sat a week), the list (four tabs by where a thread stands, and the spaces), and each thread at its own address (`/threads/42-who-owns-what`) with its living summary on top, its text, then its comments and history in order. It keeps the inbox's one-key moves with Undo and its Reply, and adds comments, editing a thread's title, summary and text with a preview, new threads and ⌘K search, in Compact type, with a bar along the bottom on a phone. The page holds no data; it reads the threads' calls under `/threads/api/`, which Access guards. A thread's main section is its text, a **page** (a Claude artifact's own HTML, saved into the thread by the sync with `inbox page`, every version kept, shown in a sealed frame under a bar with its versions, Open in Claude and full screen), or a **link** (a card that opens an artifact that only works on claude.ai). Signed out, it shows what a missing address shows, so an address never says a thread exists.
- `src/` is the Worker's code, which runs only for `/api/*`, `/inbox/api/*` and `/threads/*` (the threads' calls, and the threads page at its addresses, handed over from `site/` through the assets binding). Everything in the inbox is a **thread** (`src/store.ts`): one row in D1's `threads` with a number people can say out loud (#42), its history in `events` (created, moved, its space changed, its text edited, with the text it replaced) and the words added to it in `comments`. `POST /api/talk` takes a typed note of up to 4,000 characters about one of the topics, as JSON, checks it with Cloudflare's Turnstile and two daily limits (20 a day from one network, 60 in all), and keeps it as a new thread, answering only its id. Both private doors check Access's signature on every request themselves (`src/access.ts`), each against its own Access application's tag, and admit only the owner and the sync. The inbox's calls, which its page uses, answer as they always have: `GET /inbox/api/items` lists one tab, 50 at a time; `POST /inbox/api/items` adds one item the sync was told about (something told to Suresh in person, or his own work or idea), once per origin it names; and `POST /inbox/api/items/<id>` makes one move on one item, the sync's own move being to file it as a GitHub issue. The threads' calls (`src/threads.ts`) name a thread by its number: `GET` and `POST /threads/api/threads` list a tab and add, `GET /threads/api/threads/<n>` answers a thread with its comments and history, `POST /threads/api/threads/<n>` moves it, and `POST /threads/api/threads/<n>/comments` and `/text` add a comment and replace its title, its living summary or its main text (a visitor's own words are never rewritten); the owner's page starts threads of his own with the same `POST /threads/api/threads`, `GET /threads/api/search?q=` finds a thread by its number or words for ⌘K, and `GET /threads/api/sign-in?next=` is where a signed-out page sends him, Access signing him in on the way. `POST /threads/api/threads/<n>/pages` (the sync's) keeps an HTML document of up to 16 MiB as the thread's page's next version, in the private R2 bucket `whysosuresh-com-pages`; `GET /threads/api/threads/<n>/pages/<version>` serves it to the thread's frame, sealed by its own headers (`src/page.ts`); `POST /threads/api/threads/<n>/link` sets or clears the thread's link to a claude.ai address. Every write stamps the thread's last activity. `site/spaces.js` lists what a thread can be about: every topic, and the company. `migrations/` holds the database's tables.
- `tools/inbox/` is the inbox's command line, which the recorder sync and Suresh's other sessions run with Node as is (`node tools/inbox/inbox.ts --help`), on the threads' calls and by a thread's number: `list`, `add`, `move`, `comment` (Markdown on stdin), `edit` (a thread's living summary or main text, on stdin), `show` (a thread with its comments, history, page versions and link), `page` (an HTML file as the thread's page) and `link` (a claude.ai address, or `--clear`), as the sync's service token, whose secret it reads from `INBOX_SYNC_CLIENT_SECRET` and never prints.
- `wrangler.jsonc` describes the Cloudflare Worker `whysosuresh-com`: its files, its code, its one route (`whysosuresh.com`) and its bindings to the database and the pages bucket.
- `test/site.test.ts` checks the site: the files served, valid HTML, links, outside resources, the headers, unused CSS, and that no file names the owner's email address. `test/inbox-cli.test.ts` drives the command line with a played fetch. `test/talk.test.ts`, `test/inbox.test.ts`, `test/threads.test.ts`, `test/pages.test.ts`, `test/routing.test.ts` and `test/migrations.test.ts` run the Worker's bundle in Cloudflare's runtime, through Miniflare, in front of `site/` with the routing `wrangler.jsonc` declares, and with a local database; the private doors' tests play Access, signing tokens with the harness's own keys for either application.
- `.github/workflows/site.yaml` runs the checks on every pull request and on `main`. On `main` it also applies new migrations and deploys, with a key that can deploy Workers and edit the database, and nothing in DNS.
- `infrastructure/` declares the rest: the zone, its records, the `www` redirect, the zone's settings, the database, the pages bucket, the bot check and Access (its sign-in, its two callers, and one application each for `/inbox` and `/threads/api`), applied by Planton.

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

Then press "Send a note" on `http://localhost:8787/`, or open `#talk/stigmer` for one topic. Locally, `/inbox/` and `/threads/` load but every call they make is refused: nothing signs for Access there, and the Worker admits no request Access didn't sign.

To use the threads page signed in, on made-up threads, with Access played by the test harness:

```sh
npm run dev:signed-in
```

Then open `http://localhost:8790/threads/`. `npm run dev:signed-in -- --signed-out` shows what a visitor sees.

`AGENTS.md` lists the rules for changes.

## License

The code is MIT licensed (`LICENSE`). The words, the photo and the pictures on the site are Suresh's own and are not covered by that license.
