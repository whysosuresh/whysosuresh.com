// The daily limits on what visitors write, counted without keeping anyone's address, in four budgets: notes (the note
// flow's and a public thread's, 20 a day from one network and 60 a day in all), answers to a public thread's page (60
// and 300, because one questionnaire is many answers), and an ask's own two, apart from those so a link handed to a
// room of people never spends the note flow's allowance: the answers that make a browser's thread for an ask (100 and
// 500, which caps how many threads strangers can make), and every answer to an ask (400 and 2,000). Each UTC day gets one random salt, shared by both; a
// network is counted under the SHA-256 of that salt and the network, and each send deletes earlier days' salts and
// its own budget's earlier counts, so yesterday's hashes can't be matched to anyone once the day is over.

/** A budget's limits and the table it counts in, a closed set so no table name ever comes from a request. */
export const BUDGETS = {
  notes: { table: "talk_senders", perNetwork: 20, perDay: 60 },
  answers: { table: "answer_senders", perNetwork: 60, perDay: 300 },
  askThreads: { table: "ask_thread_senders", perNetwork: 100, perDay: 500 },
  askAnswers: { table: "ask_answer_senders", perNetwork: 400, perDay: 2000 },
} as const;

export type Budget = keyof typeof BUDGETS;

/**
 * The network an address belongs to: a whole IPv4 address, or an IPv6 address's first 64 bits, because a
 * device on IPv6 changes its address within its /64 at will. Null for anything that isn't an address.
 */
export function networkOf(address: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    return address.split(".").every((part) => Number(part) <= 255) ? address : null;
  }
  const groups = expandIPv6(address);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : null;
}

/** An IPv6 address as its eight groups, lowercase without leading zeros, or null. */
function expandIPv6(address: string): string[] | null {
  if (!/^[0-9a-f:.]{2,45}$/i.test(address)) return null;
  let text = address.toLowerCase();
  // A dotted IPv4 tail (::ffff:192.0.2.1) is its last two groups.
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail?.[1]) {
    const bytes = tail[1].split(".").map(Number);
    if (bytes.some((b) => b > 255)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = bytes;
    text = `${text.slice(0, -tail[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const split = (part: string | undefined): string[] => (part ? part.split(":") : []);
  const head = split(halves[0]);
  const rest = split(halves[1]);
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 1 ? 0 : missing).fill("0"), ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16).toString(16));
}

/** Today, as the UTC date the counts are kept under. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function senderHash(saltHex: string, network: string): Promise<string> {
  const salt = Uint8Array.from(saltHex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
  const data = new Uint8Array([...salt, ...new TextEncoder().encode(network)]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Counts one send from a network against a budget if both its limits allow it, and says whether they did. Two round
 * trips: one batch that makes sure today has a salt, drops earlier days and reads the salt; then one statement that
 * both checks and counts, so concurrent sends can't slip past a limit between a read and a write.
 */
export async function take(db: D1Database, network: string, budget: Budget, day: string = today()): Promise<boolean> {
  const { table, perNetwork, perDay } = BUDGETS[budget];
  const [, , , salted] = await db.batch<{ salt: string }>([
    db.prepare("INSERT INTO talk_days (day, salt) VALUES (?1, randomblob(32)) ON CONFLICT (day) DO NOTHING").bind(day),
    db.prepare("DELETE FROM talk_days WHERE day < ?1").bind(day),
    db.prepare(`DELETE FROM ${table} WHERE day < ?1`).bind(day),
    db.prepare("SELECT hex(salt) AS salt FROM talk_days WHERE day = ?1").bind(day),
  ]);
  const saltHex = salted?.results[0]?.salt;
  if (!saltHex) throw new Error("today's salt is missing");
  const sender = await senderHash(saltHex, network);
  const counted = await db
    .prepare(
      `INSERT INTO ${table} (day, sender, sends)
         SELECT ?1, ?2, 1 WHERE (SELECT COALESCE(SUM(sends), 0) FROM ${table} WHERE day = ?1) < ?4
       ON CONFLICT (day, sender) DO UPDATE SET sends = sends + 1
         WHERE ${table}.sends < ?3 AND (SELECT SUM(sends) FROM ${table} WHERE day = ?1) < ?4
       RETURNING sends`,
    )
    .bind(day, sender, perNetwork, perDay)
    .first<{ sends: number }>();
  return counted !== null;
}
