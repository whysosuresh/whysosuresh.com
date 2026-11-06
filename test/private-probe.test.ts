// The privacy probe the deploy runs (tools/probe/private.ts), driven against a played site: it passes when every
// private call sends a stranger to Access's sign-in or refuses them and every journal page is /me's shell, and it
// fails, naming the address, when a call answers 200, redirects anywhere but Access, or a journal page carries anything
// the shell doesn't; it asks every journal address and the threads' private calls, with no sign-in and with forged
// ones. One run of the entry point is not made here, because it asks the live site.

import { describe, expect, it } from "vitest";
import { isoWeek, probes, run } from "../tools/probe/private.ts";

const ORIGIN = "https://whysosuresh.com";
const ACCESS = "whysosuresh.cloudflareaccess.com";
const SHELL = "<!doctype html><title>Threads</title><main data-main></main>";

/** A played site: the shell at every page, Access's redirect at every call, unless `change` says otherwise. */
function site(change: (path: string, headers: Headers) => Response | null = () => null) {
  const asked: string[] = [];
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    const path = url.slice(ORIGIN.length);
    asked.push(path);
    const changed = change(path, new Headers(init.headers));
    if (changed !== null) return changed;
    if (path.startsWith("/threads/api/")) return new Response(null, { status: 302, headers: { Location: `https://${ACCESS}/cdn-cgi/access/login/whysosuresh.com?redirect_url=x` } });
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
  });

  it("asks every kind of journal address, the threads' private calls, and forged sign-ins", () => {
    const all = probes("2026-11-06", "2026-W45");
    expect(all.filter((probe) => probe.path.startsWith("/threads/api/journal")).length).toBeGreaterThanOrEqual(9);
    expect(all.some((probe) => probe.path === "/threads/api/people")).toBe(true);
    expect(all.filter((probe) => probe.headers !== undefined).length).toBe(3);
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
    expect(await run(fetcher, ORIGIN, ACCESS, "2026-11-06", "2026-W45")).toEqual(["/journal/2026-11-06 answered 200 and is not the /me shell"]);
  });

  it("keys the week as the journal does", () => {
    expect([isoWeek("2026-11-06"), isoWeek("2026-11-01"), isoWeek("2027-01-03")]).toEqual(["2026-W45", "2026-W44", "2026-W53"]);
  });
});
