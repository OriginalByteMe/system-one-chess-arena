-- Phase 2. The decision log leaves the Durable Object, games gain a broadcast
-- schedule, competitor names become the stable cross-season identity, and
-- matches, brackets and head-to-head history get tables of their own.
-- There is deliberately no ratings table: ratings are computed on read from
-- revealed games only, so a stored rating cannot spoil an unaired result.

CREATE TABLE IF NOT EXISTS decisions (season_id TEXT NOT NULL, game_id TEXT NOT NULL, ply INTEGER NOT NULL, competitor TEXT NOT NULL, version TEXT NOT NULL, colour TEXT NOT NULL, fen TEXT NOT NULL, legal_move_count INTEGER NOT NULL, move TEXT NOT NULL, strategy TEXT NOT NULL, confidence REAL, distribution_json TEXT, latency_ms INTEGER NOT NULL, tokens_in INTEGER, tokens_out INTEGER, fallback TEXT, features_seen_json TEXT NOT NULL, idempotency_key TEXT NOT NULL, PRIMARY KEY (season_id, game_id, ply));
CREATE INDEX IF NOT EXISTS decisions_by_competitor ON decisions (competitor, season_id, game_id, ply);

-- Nullable on purpose: games recorded before Phase 2 have no schedule.
ALTER TABLE games ADD COLUMN match_id TEXT;
ALTER TABLE games ADD COLUMN broadcast_start_at INTEGER;
ALTER TABLE games ADD COLUMN ms_per_ply INTEGER;

-- Version lineage. parent_version is null for a competitor's first version.
ALTER TABLE competitor_versions ADD COLUMN parent_version TEXT;
ALTER TABLE competitor_versions ADD COLUMN traits_json TEXT;
ALTER TABLE competitor_versions ADD COLUMN rationale TEXT;

-- The rollup key for every rating and record. A name is claimed once and never
-- reused by another lineage.
CREATE TABLE IF NOT EXISTS competitors (name TEXT NOT NULL PRIMARY KEY, first_season_id TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS brackets (bracket_id TEXT NOT NULL PRIMARY KEY, season_id TEXT NOT NULL, best_of INTEGER NOT NULL);
-- feeder_a and feeder_b hold the match ids a future slot is waiting on, which
-- is what lets the gated bracket answer "winner of match 3" without a name.
CREATE TABLE IF NOT EXISTS matches (match_id TEXT NOT NULL PRIMARY KEY, bracket_id TEXT NOT NULL, round INTEGER NOT NULL, slot INTEGER NOT NULL, competitor_a TEXT, competitor_b TEXT, feeder_a TEXT, feeder_b TEXT, best_of INTEGER NOT NULL, game_ids_json TEXT NOT NULL, winner TEXT);
CREATE INDEX IF NOT EXISTS matches_by_round ON matches (bracket_id, round, slot);

CREATE TABLE IF NOT EXISTS head_to_head (competitor TEXT NOT NULL, opponent TEXT NOT NULL, wins INTEGER NOT NULL, losses INTEGER NOT NULL, draws INTEGER NOT NULL, streak INTEGER NOT NULL, recent_json TEXT NOT NULL, game_ids_json TEXT NOT NULL, PRIMARY KEY (competitor, opponent));
