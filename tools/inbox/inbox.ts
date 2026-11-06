// The inbox's command line, run as is by the Node in .nvmrc (`node tools/inbox/inbox.ts --help`), which
// strips the types itself: it hands tools/inbox/run.ts the real fetch, environment and streams. Kept apart
// from the logic so the tests drive run.ts without starting a process.

import { readFileSync, writeFileSync } from "node:fs";
import { readClientId, run } from "./run.ts";

process.exitCode = await run(process.argv.slice(2), {
  fetch: (url, init) => fetch(url, init),
  env: process.env,
  stdin: async () => readFileSync(0, "utf8"),
  readFile: (path) => new Uint8Array(readFileSync(path)),
  writeFile: (path, bytes) => writeFileSync(path, bytes),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  clientId: readClientId(new URL("../../wrangler.jsonc", import.meta.url)),
});
