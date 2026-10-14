-- Email opt-ins for The Peak Humans Daily Protocol gift.
-- email is unique so repeat signups are ignored (INSERT OR IGNORE).
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_name TEXT NOT NULL DEFAULT '',
  source_page TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
