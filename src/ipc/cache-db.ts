import Database from '@tauri-apps/plugin-sql';

export type CachedShow = {body: string; fetchedAt: number};

const database = Database.get('sqlite:cache.db');

export async function readCachedShow(
  showId: number
): Promise<CachedShow | null> {
  const [row] = await database.select<
    Array<{body: string; fetched_at: number}>
  >('SELECT body, fetched_at FROM tvmaze_shows WHERE show_id = $1', [showId]);
  return row === undefined ? null : {body: row.body, fetchedAt: row.fetched_at};
}

export async function writeCachedShow(
  showId: number,
  {body, fetchedAt}: CachedShow
): Promise<void> {
  await database.execute(
    `INSERT INTO tvmaze_shows (show_id, body, fetched_at) VALUES ($1, $2, $3)
     ON CONFLICT (show_id) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`,
    [showId, body, fetchedAt]
  );
}
