// The bot check's server half: asks Turnstile whether a token from the page is good, for this site's own
// host and the talk flow's action. A token is good once and for 5 minutes, so the page fetches it at Send.
// A check that can't be made is a refusal, never a pass.

const VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;

/** The action the page's widget names; a token minted for anything else is refused. */
export const ACTION = "talk";

export async function verifyToken(secret: string, token: string, fields: { remoteIp: string; hostname: string }): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token, remoteip: fields.remoteIp });
  try {
    const response = await fetch(VERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return false;
    const verdict: { success?: unknown; hostname?: unknown; action?: unknown } = await response.json();
    return verdict.success === true && verdict.hostname === fields.hostname && verdict.action === ACTION;
  } catch {
    return false;
  }
}
