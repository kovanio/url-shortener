DROP TABLE IF EXISTS analytics;
CREATE TABLE analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT,
  ip TEXT,
  country TEXT,
  user_agent TEXT,
  is_bot INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);