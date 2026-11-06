// The note flow's send, the site's first public write: a typed note about one of Suresh's topics, with an
// optional name and email, kept as a new thread (src/store.ts, which links it to the person that address is), from
// the site's own page, as JSON with exactly five string keys. Its checks and their order are every visitor note's
// (src/note.ts): no bot-check secret (503), another origin (403), no or too large a declared length (411, 413), a
// body that isn't JSON (415), a malformed note (400; the topic is checked right after the shape), a failed bot check
// (403), and the daily limits (429). Nothing personal is ever logged: a refusal's line holds its status and reason
// only.

import { isTopic } from "../site/talk-topics.js";
import { create } from "./store.ts";
import { json } from "./json.ts";
import { checkBot, readFields, readNote, takeLimit } from "./note.ts";
import { refuse } from "./wire.ts";
import type { Bindings } from "./bindings.ts";

const KEYS = ["topic", "body", "name", "email", "token"];

export async function handleTalk(request: Request, env: Bindings): Promise<Response> {
  const read = await readFields(request, env, KEYS);
  if (read instanceof Response) return read;
  const { secret, fields } = read;

  const topic = fields.topic ?? "";
  if (!isTopic(topic)) return refuse(400, "topic");
  const note = readNote(fields);
  if (note instanceof Response) return note;

  const sender = await checkBot(request, secret, note.token);
  if (sender instanceof Response) return sender;
  const limited = await takeLimit(env, sender.network);
  if (limited !== null) return limited;

  // A new thread in To look at, its words the visitor's own. The answer is its id alone: a thread's number would
  // tell a visitor how many threads there are.
  let id: string;
  try {
    const kept = await create(
      env.DB,
      { source: "talk", space: topic, title: null, body: note.body, senderName: note.name, senderEmail: note.email, status: "received", originRef: null, person: null },
      "visitor",
    );
    if (kept === null || kept === "no-person") return refuse(500, "store");
    id = kept.row.id;
  } catch {
    return refuse(500, "store");
  }
  return json(201, { id });
}
