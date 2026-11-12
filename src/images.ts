// What the site takes as an image, in one place: the journal's photos (src/journal.ts), his own photo and the
// Gravatars the hourly run copies (src/photos.ts), and the preview cards his page draws (src/cards.ts, which then takes
// a PNG alone) all agree on it. An image is a JPEG or a PNG by its own first bytes,
// and only when that is the type it was declared as, because it is served as itself. An upload must declare its
// length, at most the cap its caller gives (411 `length`, 413 `too-large`), and its type (415 `type`), each refused
// before a byte is read; the bytes are counted again once read.

import { refuse } from "./wire.ts";

/** The two kinds of image the site shows, each with its file's first bytes and the extension its object takes. */
export const IMAGES = [
  { type: "image/jpeg", extension: "jpg", signature: [0xff, 0xd8, 0xff] },
  { type: "image/png", extension: "png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
] as const;

export type Image = (typeof IMAGES)[number];

/** A photo's id, and a preview card's: the UUID it was given. */
export const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The media type a header declares, lowercased, without its parameters. */
export function declaredType(header: string | null): string {
  return (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** Which image the bytes are, by their first bytes, when that is the type they were declared as. */
export function imageOf(bytes: Uint8Array, declared: string): Image | null {
  const image = IMAGES.find((one) => one.type === declared);
  if (image === undefined || bytes.byteLength < image.signature.length) return null;
  return image.signature.every((byte, index) => bytes[index] === byte) ? image : null;
}

/** An uploaded image's bytes and kind, or the refusal to answer with. */
export async function readImage(request: Request, cap: number): Promise<{ bytes: Uint8Array; image: Image } | Response> {
  const declared = request.headers.get("Content-Length");
  if (declared === null || !/^\d{1,12}$/.test(declared)) return refuse(411, "length");
  if (Number(declared) > cap) return refuse(413, "too-large");
  const type = declaredType(request.headers.get("Content-Type"));
  if (!IMAGES.some((one) => one.type === type)) return refuse(415, "type");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > cap) return refuse(413, "too-large");
  const image = imageOf(bytes, type);
  if (image === null) return refuse(415, "type");
  return { bytes, image };
}

/** An image's answer: its stored type and length, never sniffed or run as a page, cached as `cache` says. */
export function imageHeaders(type: string, bytes: number, cache: string): Record<string, string> {
  return {
    "Content-Type": type,
    "Content-Length": String(bytes),
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}
