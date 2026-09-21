-- Operator settings, key/value. Today the only key is 'featured_season', the
-- season id the front page opens on when ARENA_FEATURED_SEASON is unset.
CREATE TABLE IF NOT EXISTS site_settings (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
