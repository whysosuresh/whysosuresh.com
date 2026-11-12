// The privacy probe the deploy runs (tools/probe/private.ts), driven against a played site on its two hosts: it passes
// when every private call on the threads' host sends a stranger to Access's sign-in or refuses them, every journal
// page is the shell at the threads' root, and the threads' old addresses on the home page's host are gone (404); and
// it fails, naming the address, when a call answers 200, redirects anywhere but Access, a journal page carries anything
// the shell doesn't, or an old address answers anything but 404; it asks every journal address and the threads'
// private calls, with no sign-in and with forged ones. One run of the entry point is not made here, because it asks
// the live site.

import { describe, expect, it } from "vitest";
import { isoWeek, probes, run } from "../tools/probe/private.ts";

const ORIGIN = "https://whysosuresh.com";
const THREADS = "https://hey.whysosuresh.com";
const ACCESS = "whysosuresh.cloudflareaccess.com";
const SHELL = "<!doctype html><title>Threads</title><main data-main></main>";

/**
 * A played site: on the threads' host, the shell at every page and Access's redirect at every call; on the home page's,
 * 404 at every address the probe asks; unless `change` says otherwise. An address the home page's host was asked for
 * is named with `home:` in front.
 */
function site(change: (path: string, headers: Headers) => Response | null = () => null) {
  const asked: string[] = [];
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    const home = !url.startsWith(THREADS);
    const path = home ? `home:${url.slice(ORIGIN.length)}` : url.slice(THREADS.length);
    asked.push(path);
    const changed = change(path, new Headers(init.headers));
    if (changed !== null) return changed;
    if (home) return new Response('{"reason":"not-found"}', { status: 404 });
    if (path.startsWith("/threads/api/")) return new Response(null, { status: 302, headers: { Location: `https://${ACCESS}/cdn-cgi/access/login/hey.whysosuresh.com?redirect_url=x` } });
    return new Response(SHELL, { status: 200, headers: { "Content-Type": "text/html" } });
  };
  return { fetcher, asked };
}

describe("the privacy probe", () => {
  it("passes a site that keeps every private address behind Access and draws the journal from the shell", async () => {
    const { fetcher, asked } = site();
    expect(await run(fetcher, ORIGIN, ACCESS, "2026-11-06", "2026-W45")).toEqual([]);
    expect(asked).toContain("/threads/api/journal/photos/00000000-0000-4000-8000-000000000000");
    expect(asked).toContain("/threads/api/journal/2026-11-06?version=1");
    expect(asked).toContain("/journal/2026-W45");
    expect(asked).toContain("/threads/api/photo");
    expect(asked).toContain("/");
    expect(asked.filter((path) => path.startsWith("home:"))).toEqual(["home:/threads/api/me", "home:/threads/api/journal", "home:/journal", "home:/me"]);
  });

  it("fails, naming it, when an old address on the home page's host still answers", async () => {
    const { fetcher } = site((path) => (path === "home:/journal" ? new Response(SHELL, { status: 200 }) : path === "home:/me" ? new Response(null, { status: 301, headers: { Location: "/" } }) : null));
    expect(await run(fetcher, ORIGIN, ACCESS, "2026-11-06", "2026-W45")).toEqual([
      "/journal on the home page's host answered 200; the threads' old address must be gone (404)",
      "/me on the home page's host answered 301; the threads' old address must be gone (404)",
    ]);
  });

  it("fails when the threads' root is not the shell, so nothing can be compared with it", async () => {
    const { fetcher } = site((path) => (path === "/" ? new Response(null, { status: 404 }) : null));
    const failures = await run(fetcher, ORIGIN, ACCESS, "2026-11-06", "2026-W45");
    expect(failures[0]).toBe("the threads' root answered 404, so no page can be compared with the shell");
    expect(failures).toHaveLength(5);
  });

  it("asks every kind of journal address, the threads' private calls, and forged sign-ins", () => {
    const all = probes("2026-11-06", "2026-W45");
    expect(all.filter((probe) => probe.path.startsWith("/threads/api/journal")).length).toBeGreaterThanOrEqual(9);
    expect(all.some((probe) => probe.path === "/threads/api/people")).toBe(true);
    expect(all.filter((probe) => probe.headers !== undefined).length).toBe(3);
    expect(all.filter((probe) => probe.host === "home").every((probe) => probe.expect === "gone")).toBe(true);
  });

  it("takes a refusal (401 or 403) as a stranger kept out", async () => {
    const { fetcher } = site((path) => (path === "/threads/api/journal" ? new Response('{"reason":"sign-in"}', { status: 401 }) : null));
    expect(await run(fetcher, ORIGIN, ACCESS, "2026-11-06", "2026-W45")).toEqual([]);
  });

  it("fails, naming it, when a journal call answers a stranger", async () => {
    const { fetcher } = site((path) => (path === "/threads/api/journal/storylines" ? new Response('{"storylines":[]}', { status: 200 }) : null));
    expect(await run(fetcher, ORIGIN, ACCESS, "2026-11-06", "2026-W45")).toEqual(["/threads/api/journal/storylines answered 200; a stranger must be sent to sign in or refused"]);
  });

  it("fails when a forged sign-in is let in", async () => {
    const { fetcher } = site((path, headers) => (headers.has("Cf-Access-Jwt-Assertion") && path === "/threads/api/journal" ? new Response("{}", { status: 200 }) : null));
    expect(await run(fetcher, ORIGIN, ACCESS, "2026-11-06", "2026-W45")).toEqual(["/threads/api/journal with a forged sign-in answered 200; a stranger must be sent to sign in or refused"]);
  });

  it("fails when a call redirects anywhere but Access's sign-in", async () => {
    const { fetcher } = site((path) => (path === "/threads/api/people" ? new Response(null, { status: 302, headers: { Location: "https://elsewhere.example/login" } }) : null));
    expect(await run(fetcher, ORIGIN, ACCESS, "2026-11-06", "2026-W45")).toEqual(["/threads/api/people redirected to elsewhere.example, not to Access's sign-in"]);
  });

  it("fails when a journal page carries anything the shell doesn't", async () => {
    const { fetcher } = site((path) => (path === "/journal/2026-11-06" ? new Response(`${SHELL}<p>Light, every day</p>`, { status: 200 }) : null));
    expect(await run(fetcher, ORIGIN, ACCESS, "2026-11-06", "2026-W45")).toEqual(["/journal/2026-11-06 answered 200 and is not the threads' shell"]);
  });

  it("keys the week as the journal does", () => {
    expect([isoWeek("2026-11-06"), isoWeek("2026-11-01"), isoWeek("2027-01-03")]).toEqual(["2026-W45", "2026-W44", "2026-W53"]);
  });
});
