// Checks every write from the site's own pages makes before reading a body: that the request comes from the
// site itself, and that it says it is JSON. A browser form can't send JSON, and a page on another origin
// can't forge Origin or Sec-Fetch-Site, so together they close cross-site posts.

/** Whether the request comes from the site's own page: its Origin is this request's own origin. */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null && site !== "same-origin") return false;
  return request.headers.get("Origin") === new URL(request.url).origin;
}

/** Whether the declared media type is JSON; parameters such as `charset` are allowed. */
export function isJson(request: Request): boolean {
  const type = request.headers.get("Content-Type") ?? "";
  return type.split(";")[0]?.trim().toLowerCase() === "application/json";
}
