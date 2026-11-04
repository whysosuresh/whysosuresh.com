// Every answer the Worker gives: JSON that no cache keeps and no browser sniffs, because site/_headers
// covers the site's files only.

/** A value JSON can carry. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export function json(status: number, body: { readonly [key: string]: JsonValue }, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
