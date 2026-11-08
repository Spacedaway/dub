CREATE TABLE tvmaze_shows (
  show_id INTEGER PRIMARY KEY,
  body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE remembered_shows (
  volume_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  name_key TEXT NOT NULL,
  show_id INTEGER,
  namesakes INTEGER NOT NULL DEFAULT 0,
  chosen_at INTEGER NOT NULL,
  PRIMARY KEY (volume_id, folder, name_key)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
