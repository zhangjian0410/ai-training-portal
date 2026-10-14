CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings VALUES ('rate_salt', lower(hex(randomblob(32))));

CREATE TABLE IF NOT EXISTS reactions (
  course_id TEXT NOT NULL,
  visitor TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('like', 'brick')),
  PRIMARY KEY (course_id, visitor)
);
CREATE INDEX IF NOT EXISTS reactions_counts ON reactions(course_id, kind);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_course ON comments(course_id, created_at DESC);
CREATE TABLE IF NOT EXISTS request_rates (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rates_expiry ON request_rates(expires);

CREATE TABLE IF NOT EXISTS metrics_totals (
  id INTEGER PRIMARY KEY CHECK (id = 1), pv INTEGER NOT NULL DEFAULT 0, uv INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO metrics_totals(id) VALUES (1);
CREATE TABLE IF NOT EXISTS metrics_daily (
  day TEXT PRIMARY KEY, pv INTEGER NOT NULL DEFAULT 0, uv INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS metrics_visitors (visitor TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS metrics_daily_visitors (
  day TEXT NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY (day, visitor)
);
CREATE TABLE IF NOT EXISTS page_events (
  id TEXT PRIMARY KEY, page TEXT NOT NULL, visitor TEXT NOT NULL, day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS page_events_day ON page_events(day);
CREATE TRIGGER IF NOT EXISTS on_new_visitor AFTER INSERT ON metrics_visitors BEGIN
  UPDATE metrics_totals SET uv = uv + 1 WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS on_new_daily_visitor AFTER INSERT ON metrics_daily_visitors BEGIN
  UPDATE metrics_daily SET uv = uv + 1 WHERE day = NEW.day;
END;
CREATE TRIGGER IF NOT EXISTS on_new_page_event AFTER INSERT ON page_events BEGIN
  UPDATE metrics_totals SET pv = pv + 1 WHERE id = 1;
  INSERT INTO metrics_daily(day, pv) VALUES (NEW.day, 1)
    ON CONFLICT(day) DO UPDATE SET pv = pv + 1;
  INSERT OR IGNORE INTO metrics_visitors(visitor) VALUES (NEW.visitor);
  INSERT OR IGNORE INTO metrics_daily_visitors(day, visitor) VALUES (NEW.day, NEW.visitor);
END;
