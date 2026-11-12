// The avatars' photos: Suresh's own, which he sets from his page, and the Gravatar of each person he invited, which
// the hourly run copies, so every avatar on the threads page can show a face, and no reader's browser asks anyone
// but the site for one.
//
//   POST   /threads/api/photo     a JPEG or PNG   owner, from his own page: his photo     {"photo": <id>}
//   DELETE /threads/api/photo                    owner, from his own page: none          {"photo": null}
//   GET    /api/photos/<id>                       anyone, with no sign-in: a photo shown now
//
// His photo is his alone: an invited person and the sync are refused with 403 `owner-only` before anything is read,
// as the Now line's calls refuse them. It is checked as every image the site keeps (src/images.ts: 411 `length`, 413
// `too-large` past 4 MiB, 415 `type`), written to the pages bucket under `photos/<id>.<jpg|png>` first, then its row
// beside a new row of his history (migrations/0020_photos.sql), and the object is deleted again when the rows aren't
// kept (500 `store`). The photo it replaced, row and object, is dropped after, so a photo he took down is never served
// again.
//
// A photo is served on the threads' host outside Access (wrangler.jsonc runs the Worker for /api/*, and Access
// guards /threads/api alone), because a public thread shows his photo to anyone. Its address is a random id that
// appears only in an answer whose reader already sees that person's name, so walking addresses finds nothing. It is
// answered with its stored type, `nosniff`, a sandboxing CSP and `Cache-Control: public, max-age=31536000,
// immutable`: a new photo is a new address. Any id with no photo answers one 404.
//
// The hourly run (`refreshPhotos`) looks up up to 20 people a run who were ever invited, whose address their sign-in
// proves, and who haven't been looked up, oldest first: Gravatar is asked by the SHA-256 of the trimmed, lowercased
// address and never the address, for a 96-pixel image or 404 (`d=404`), without following a redirect, at most 256
// KiB. A JPEG or PNG is kept as their photo; a 404 or anything that isn't an image marks them looked up with none;
// any other answer, or no answer, leaves them for the next run. A visitor's typed address is never looked up, so a
// face is never put beside words whose writer nobody checked. Each address is asked once: an address is given at
// most once (src/people.ts). Its log line holds counts only.

import type { Caller } from "./access.ts";
import type { Bindings } from "./bindings.ts";
import { PHOTO_ID, declaredType, imageHeaders, imageOf, readImage } from "./images.ts";
import { json } from "./json.ts";
import { SourceFailure, fetchOutside, readCapped } from "./outside.ts";
import { dropUnshown, findPhoto, lookedUp, peopleDue, setOwnerPhoto, type PhotoRow } from "./photos-store.ts";
import { sameOrigin } from "./request.ts";
import { MAX_PHOTO_BYTES, refuse } from "./wire.ts";

/** Where the photos live in the pages bucket. */
const PHOTOS = "photos/";
/** The most people one run looks up. */
export const PHOTOS_PER_RUN = 20;
/** The most a Gravatar may be: a 96-pixel image is a few kilobytes. */
const MAX_GRAVATAR_BYTES = 256 * 1024;
const PHOTO_PATH = /^\/api\/photos\/([^/]+)$/;

/** Drops every photo no longer shown, its row and then its object. */
async function tidy(env: Bindings): Promise<void> {
  const gone = await dropUnshown(env.DB);
  if (gone.length > 0) await env.PAGES.delete(gone);
}

/** Keeps an image as a photo: the object first, then the rows `keep` writes, the object deleted again when they fail. */
async function keep(env: Bindings, bytes: Uint8Array, type: string, extension: string, rows: (photo: PhotoRow) => Promise<void>): Promise<PhotoRow> {
  const id = crypto.randomUUID();
  const photo = { id, object_key: `${PHOTOS}${id}.${extension}`, type, bytes: bytes.byteLength };
  await env.PAGES.put(photo.object_key, bytes, { httpMetadata: { contentType: type } });
  try {
    await rows(photo);
  } catch (error) {
    await env.PAGES.delete(photo.object_key);
    throw error;
  }
  return photo;
}

async function setOwn(request: Request, env: Bindings): Promise<Response> {
  const read = await readImage(request, MAX_PHOTO_BYTES);
  if (read instanceof Response) return read;
  let photo: PhotoRow;
  try {
    photo = await keep(env, read.bytes, read.image.type, read.image.extension, (row) => setOwnerPhoto(env.DB, row));
  } catch {
    return refuse(500, "store");
  }
  await tidy(env);
  return json(200, { photo: photo.id });
}

async function removeOwn(env: Bindings): Promise<Response> {
  await setOwnerPhoto(env.DB, null);
  await tidy(env);
  return json(200, { photo: null });
}

/** Answers /threads/api/photo for a caller the door has named: his photo, set or removed, his alone. */
export async function handlePhoto(request: Request, env: Bindings, who: Caller): Promise<Response> {
  if (request.method !== "POST" && request.method !== "DELETE") return json(405, { reason: "method" }, { Allow: "POST, DELETE" });
  if (who.caller !== "owner") return refuse(403, "owner-only");
  if (!sameOrigin(request)) return refuse(403, "origin");
  return request.method === "POST" ? setOwn(request, env) : removeOwn(env);
}

/** Answers /api/photos/<id>: a photo shown now, for anyone, or the one 404. */
export async function servePhoto(request: Request, env: Bindings): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return json(405, { reason: "method" }, { Allow: "GET" });
  const id = PHOTO_PATH.exec(new URL(request.url).pathname)?.[1] ?? "";
  const row = PHOTO_ID.test(id) ? await findPhoto(env.DB, id) : null;
  if (row === null) return json(404, { reason: "no-photo" });
  const headers = imageHeaders(row.type, row.bytes, "public, max-age=31536000, immutable");
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  const object = await env.PAGES.get(row.object_key);
  return object === null ? json(404, { reason: "no-photo" }) : new Response(object.body, { status: 200, headers });
}

/** The hex SHA-256 of an address as Gravatar is asked for it: trimmed and lowercased. */
async function gravatarHash(email: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase())));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What Gravatar said of one address: an image, none (it has none, or what came isn't one), or nothing this time. */
type Looked = { readonly bytes: Uint8Array; readonly type: string; readonly extension: string } | "none" | "missed";

async function lookUp(email: string): Promise<Looked> {
  try {
    const response = await fetchOutside(`https://gravatar.com/avatar/${await gravatarHash(email)}?d=404&s=96`);
    if (response.status === 404) {
      await response.body?.cancel();
      return "none";
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      return "missed";
    }
    const bytes = await readCapped(response, MAX_GRAVATAR_BYTES);
    const image = bytes === null ? null : imageOf(bytes, declaredType(response.headers.get("Content-Type")));
    return bytes === null || image === null ? "none" : { bytes, type: image.type, extension: image.extension };
  } catch (error) {
    if (error instanceof SourceFailure) return "missed";
    throw error;
  }
}

/**
 * One hourly run's lookups, one person at a time. Gravatar failing leaves a person for the next run; the database or
 * the bucket failing fails the run, so Cloudflare's record of it says so.
 */
export async function refreshPhotos(env: Bindings): Promise<void> {
  const due = await peopleDue(env.DB, PHOTOS_PER_RUN);
  const counts = { kept: 0, none: 0, missed: 0 };
  for (const person of due) {
    const looked = await lookUp(person.email);
    if (looked === "missed") counts.missed += 1;
    else if (looked === "none") {
      await lookedUp(env.DB, person.id, null);
      counts.none += 1;
    } else {
      await keep(env, looked.bytes, looked.type, looked.extension, (row) => lookedUp(env.DB, person.id, row));
      counts.kept += 1;
    }
  }
  // A lookup that lost a race with another run kept a photo nobody shows; this drops it.
  if (counts.kept > 0) await tidy(env);
  console.log(JSON.stringify({ photos: "gravatar", ...counts }));
}
