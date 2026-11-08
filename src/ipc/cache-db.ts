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

export type FolderShowKey = {volumeId: string; folder: string; nameKey: string};

export type RememberedShow = {showId: number | null; namesakes: boolean};

export async function readRememberedShow({
  volumeId,
  folder,
  nameKey,
}: FolderShowKey): Promise<RememberedShow | null> {
  const [row] = await database.select<
    Array<{show_id: number | null; namesakes: number}>
  >(
    `SELECT show_id, namesakes FROM remembered_shows
     WHERE volume_id = $1 AND folder = $2 AND name_key = $3`,
    [volumeId, folder, nameKey]
  );
  return row === undefined
    ? null
    : {showId: row.show_id, namesakes: row.namesakes === 1};
}

export async function rememberShow(
  {volumeId, folder, nameKey}: FolderShowKey,
  {showId, namesakes}: RememberedShow
): Promise<void> {
  await database.execute(
    `INSERT INTO remembered_shows (volume_id, folder, name_key, show_id, namesakes, chosen_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (volume_id, folder, name_key) DO UPDATE SET
       show_id = excluded.show_id, namesakes = excluded.namesakes, chosen_at = excluded.chosen_at`,
    [volumeId, folder, nameKey, showId, namesakes ? 1 : 0, Date.now()]
  );
}

export async function forgetShow({
  volumeId,
  folder,
  nameKey,
}: FolderShowKey): Promise<void> {
  await database.execute(
    `DELETE FROM remembered_shows WHERE volume_id = $1 AND folder = $2 AND name_key = $3`,
    [volumeId, folder, nameKey]
  );
}

export async function readSetting(key: string): Promise<string | null> {
  const [row] = await database.select<Array<{value: string}>>(
    'SELECT value FROM settings WHERE key = $1',
    [key]
  );
  return row?.value ?? null;
}

export async function writeSetting(key: string, value: string): Promise<void> {
  await database.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}
