CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Substack permalink for imported newsletters. Null for posts written in /admin/new.
  source_url TEXT
);

-- Last successful Substack import (ISO timestamp). Used to skip repeat work on /blog.
CREATE TABLE IF NOT EXISTS import_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
