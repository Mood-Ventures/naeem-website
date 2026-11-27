-- Peak Wheel leads from /start. New table only. Do not change posts, subscribers, or import_meta.

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  scores TEXT NOT NULL,
  gaps TEXT NOT NULL,
  peak_score REAL,
  submitted_at TEXT NOT NULL,
  source TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  ip_country TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
