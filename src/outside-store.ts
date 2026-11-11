// The store of what arrives on the home page from outside (migrations/0019_outside.sql): his full YouTube episodes
// and the newest release of each product, as the hourly run (src/outside.ts) last read them. That run is its only
// writer and the home page's read (`homeFeed`, src/store.ts) its only reader, so its rules live here once.
//
// It is a mirror of the sources, not a history: a row lives while its source lists it. A video row is kept or changed
// on every answer that lists it, and dropped when an answer leaves it out while still reaching back past its date (the
// feed lists only its newest entries, so an older video can't be seen to go). A release row is the product's newest
// release, replaced in place by the next. Every date is stored as Date#toISOString writes it, so it orders as text
// beside `threads.feed_at`.
//
// A release gives way to his post about it: while a thread he posted names it as its origin
// (`release:<owner>/<repo>/<tag>`, the recorder sync's draft of a release post), the read leaves the release's row out,
// so the home page and the feed tell that news once, as his story.

/** A row as the home page and its feed read it. */
export interface OutsideRow {
  readonly id: string;
  readonly kind: "video" | "release";
  /** The channel id, or `<owner>/<repo>`. */
  readonly source: string;
  /** The video id, or the release's tag. */
  readonly ref: string;
  readonly title: string;
  readonly url: string;
  readonly published_at: string;
  /** A video's own <updated>, which versions its picture's address; null for a release. */
  readonly updated_at: string | null;
  /** 1 once the video's picture is in the pages bucket. */
  readonly thumb: number;
}

/** A full episode as the channel's feed lists it, checked and normalised. */
export interface Episode {
  readonly ref: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly updatedAt: string;
}

/** A product's newest release, checked and normalised. */
export interface Release {
  readonly repo: string;
  readonly tag: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
}

/** A video whose picture isn't kept yet, and the version of it the run copies. */
export interface WantedPicture {
  readonly ref: string;
  readonly updated_at: string | null;
}

const videoId = (ref: string): string => `video:${ref}`;
const releaseId = (repo: string): string => `release:${repo}`;

/**
 * The home page's read of the outside items, newest first, as one statement for its batch. `listed` is the SQL
 * condition on `threads` that the home page's own posts meet (the store's, so the rule lives once): a release whose
 * post meets it is left out.
 */
export function outsideItems(db: D1Database, limit: number, listed: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id, kind, source, ref, title, url, published_at, updated_at, thumb FROM outside_items
       WHERE NOT (kind = 'release' AND EXISTS (SELECT 1 FROM threads WHERE threads.origin_ref = 'release:' || outside_items.source || '/' || outside_items.ref AND ${listed}))
       ORDER BY published_at DESC, id ASC LIMIT ?1`,
    )
    .bind(limit);
}

/**
 * Keeps the channel's answer, in one batch: every episode written in (its picture wanted again when its `updated`
 * moved), and every row of the channel the answer leaves out, published at or after `windowStart` (the oldest entry the
 * answer holds, Shorts included), dropped: taken down or unlisted. `listed` is every video id the answer holds.
 */
export async function keepVideos(db: D1Database, channel: string, episodes: readonly Episode[], listed: readonly string[], windowStart: string): Promise<void> {
  const upserts = episodes.map((episode) =>
    db
      .prepare(
        `INSERT INTO outside_items (id, kind, source, ref, title, url, published_at, updated_at, thumb)
         VALUES (?1, 'video', ?2, ?3, ?4, ?5, ?6, ?7, 0)
         ON CONFLICT (id) DO UPDATE SET title = excluded.title, url = excluded.url, published_at = excluded.published_at,
           updated_at = excluded.updated_at,
           thumb = CASE WHEN outside_items.updated_at IS excluded.updated_at THEN outside_items.thumb ELSE 0 END`,
      )
      .bind(videoId(episode.ref), channel, episode.ref, episode.title, episode.url, episode.publishedAt, episode.updatedAt),
  );
  const drop = db
    .prepare("DELETE FROM outside_items WHERE kind = 'video' AND source = ?1 AND published_at >= ?2 AND ref NOT IN (SELECT value FROM json_each(?3))")
    .bind(channel, windowStart, JSON.stringify(listed));
  await db.batch([...upserts, drop]);
}

/** Keeps a product's newest release in its one row, replacing the one before. */
export async function keepRelease(db: D1Database, release: Release): Promise<void> {
  await db
    .prepare(
      `INSERT INTO outside_items (id, kind, source, ref, title, url, published_at, updated_at, thumb)
       VALUES (?1, 'release', ?2, ?3, ?4, ?5, ?6, NULL, 0)
       ON CONFLICT (id) DO UPDATE SET ref = excluded.ref, title = excluded.title, url = excluded.url, published_at = excluded.published_at`,
    )
    .bind(releaseId(release.repo), release.repo, release.tag, release.title, release.url, release.publishedAt)
    .run();
}

/** Drops a product's release row: the repository has no release any more. */
export async function dropRelease(db: D1Database, repo: string): Promise<void> {
  await db.prepare("DELETE FROM outside_items WHERE id = ?1").bind(releaseId(repo)).run();
}

/** In one batch: up to `limit` videos whose picture isn't kept, newest first, and every video's id. */
export async function picturesWanted(db: D1Database, limit: number): Promise<{ wanted: WantedPicture[]; videos: string[] }> {
  const [wanted, videos] = await db.batch([
    db.prepare("SELECT ref, updated_at FROM outside_items WHERE kind = 'video' AND thumb = 0 ORDER BY published_at DESC, id ASC LIMIT ?1").bind(limit),
    db.prepare("SELECT ref FROM outside_items WHERE kind = 'video'"),
  ]);
  return {
    wanted: (wanted?.results ?? []) as WantedPicture[],
    videos: ((videos?.results ?? []) as { ref: string }[]).map((row) => row.ref),
  };
}

/** Marks the pictures copied, in one statement: each only while its video's `updated` is still the one copied. */
export async function picturesKept(db: D1Database, kept: readonly WantedPicture[]): Promise<void> {
  if (kept.length === 0) return;
  await db
    .prepare(
      `UPDATE outside_items SET thumb = 1 WHERE kind = 'video' AND EXISTS (
         SELECT 1 FROM json_each(?1) AS kept
         WHERE json_extract(kept.value, '$[0]') = outside_items.ref AND json_extract(kept.value, '$[1]') IS outside_items.updated_at)`,
    )
    .bind(JSON.stringify(kept.map((picture) => [picture.ref, picture.updated_at])))
    .run();
}
