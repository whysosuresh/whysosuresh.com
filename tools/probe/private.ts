// The privacy probe the deploy runs against the live site after every deploy (`.github/workflows/site.yaml`, job
// `private`), holding no key: it asks for Suresh's private calls as a stranger would, with no sign-in and with a forged
// one, and fails unless each stops at Cloudflare Access's sign-in, never answering a word. His journal's calls are all
// asked, every kind of address under /threads/api/journal (the list, a day, an earlier version, a week, the storylines,
// a photo), and the threads' own private calls beside them (a tab's list, the people, the asks, a thread, the home
// page's Now line). The journal's
// pages are asked too: each must be the same shell as /me, byte for byte, because a page holds no words and reads them
// only from the calls after sign-in. A recent day's address is asked whatever the date, since the shell is the same for
// a day written or not. This module is the logic, with fetch handed in so a test plays the site; tools/probe/run.ts is
// the entry point.

/** One address the probe asks, and what it expects of it. */
export interface Probe {
  readonly path: string;
  /** `sign-in`: a redirect to the Access team's sign-in, or a refusal; `shell`: the same bytes as /me. */
  readonly expect: "sign-in" | "shell";
  /** Headers sent with it: none, or a forged sign-in. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** A sign-in Access never issued: a token signed by nobody, and a service token with a made-up secret. */
const FORGED_TOKEN = { "Cf-Access-Jwt-Assertion": "eyJhbGciOiJSUzI1NiIsImtpZCI6InByb2JlIn0.eyJlbWFpbCI6InByb2JlQGV4YW1wbGUuY29tIn0.cHJvYmU" };
const FORGED_SERVICE = { "CF-Access-Client-Id": "probe.access", "CF-Access-Client-Secret": "probe-secret-that-access-never-issued" };
/** A photo id no photo has: the probe must be refused before the Worker could even say so. */
const PHOTO = "00000000-0000-4000-8000-000000000000";

/** Every address the probe asks, for a day it names (`YYYY-MM-DD`) and that day's ISO week (`YYYY-Www`). */
export function probes(day: string, week: string): Probe[] {
  const journal = ["", `/${day}`, `/${day}?version=1`, `/${week}`, "/storylines", `/photos/${PHOTO}`].map((rest) => `/threads/api/journal${rest}`);
  const threads = ["/threads/api/threads?tab=look", "/threads/api/threads/1", "/threads/api/people", "/threads/api/asks", "/threads/api/me", "/threads/api/now"];
  return [
    ...[...journal, ...threads].map((path): Probe => ({ path, expect: "sign-in" })),
    { path: "/threads/api/journal", expect: "sign-in", headers: FORGED_TOKEN },
    { path: "/threads/api/journal", expect: "sign-in", headers: FORGED_SERVICE },
    { path: `/threads/api/journal/${day}`, expect: "sign-in", headers: FORGED_TOKEN },
    ...["/journal", `/journal/${day}`, `/journal/${week}`, "/journal/storylines"].map((path): Probe => ({ path, expect: "shell" })),
  ];
}

/** What the probe found wrong; empty when every address held. */
export async function run(fetcher: (url: string, init: RequestInit) => Promise<Response>, origin: string, accessHost: string, day: string, week: string): Promise<string[]> {
  const failures: string[] = [];
  const shellAnswer = await fetcher(`${origin}/me`, { redirect: "manual" });
  const shell = shellAnswer.status === 200 ? await shellAnswer.text() : null;
  if (shell === null) failures.push(`/me answered ${shellAnswer.status}, so no page can be compared with the shell`);
  for (const probe of probes(day, week)) {
    const answer = await fetcher(`${origin}${probe.path}`, { redirect: "manual", headers: { ...probe.headers } });
    const said = probe.headers === undefined ? probe.path : `${probe.path} with a forged sign-in`;
    if (probe.expect === "shell") {
      const body = await answer.text();
      if (answer.status !== 200 || shell === null || body !== shell) failures.push(`${said} answered ${answer.status} and is not the /me shell`);
      continue;
    }
    // Refused at the edge or by the Worker are both a stranger kept out; anything that answers 2xx is not.
    await answer.body?.cancel();
    if (answer.status >= 300 && answer.status < 400) {
      const location = answer.headers.get("Location") ?? "";
      let host = "";
      try {
        host = new URL(location, origin).host;
      } catch {
        // An unreadable Location is reported below.
      }
      if (host !== accessHost) failures.push(`${said} redirected to ${location === "" ? "nowhere" : host || "an unreadable address"}, not to Access's sign-in`);
    } else if (answer.status !== 401 && answer.status !== 403) {
      failures.push(`${said} answered ${answer.status}; a stranger must be sent to sign in or refused`);
    }
  }
  return failures;
}

/** A day's ISO week, `YYYY-Www`, as site/app/journal.js keys it. */
export function isoWeek(day: string): string {
  const time = Date.parse(`${day}T00:00:00Z`);
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  const thursday = time + (3 - weekday) * 86_400_000;
  const year = new Date(thursday).getUTCFullYear();
  const january4 = Date.UTC(year, 0, 4);
  const firstMonday = january4 - ((new Date(january4).getUTCDay() + 6) % 7) * 86_400_000;
  return `${year}-W${String(Math.floor((thursday - firstMonday) / (7 * 86_400_000)) + 1).padStart(2, "0")}`;
}
