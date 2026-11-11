// The privacy probe's entry point (`node tools/probe/run.ts`), run by the deploy against the live site after every
// deploy, and by hand at any time: it hands tools/probe/private.ts the real fetch, the home page's origin (the threads'
// host is derived from it by site/hosts.js), Access's sign-in host as
// wrangler.jsonc names it, and yesterday's date, and exits non-zero with one line per address that let a stranger in.

import { readFileSync } from "node:fs";
import { isoWeek, run } from "./private.ts";

const wrangler = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
const accessHost = /"ACCESS_TEAM_DOMAIN": "([^"]+)"/.exec(wrangler)?.[1];
if (accessHost === undefined) throw new Error("wrangler.jsonc names no ACCESS_TEAM_DOMAIN");
const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const failures = await run((url, init) => fetch(url, init), "https://whysosuresh.com", accessHost, day, isoWeek(day));
for (const failure of failures) console.log(`::error::${failure}`);
console.log(failures.length === 0 ? `private: every private address kept a stranger out (${day})` : `private: ${failures.length} address(es) let a stranger in`);
process.exitCode = failures.length === 0 ? 0 : 1;
