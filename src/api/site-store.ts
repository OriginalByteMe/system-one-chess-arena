// The D1 half of the front page's bundle. Same rule as api/store.ts: this is
// the only place that knows SQL, and every row is parsed rather than trusted.
import { ContractViolation } from "../core/errors.ts";
import { parseManifest } from "../core/manifest.ts";
import type { CompetitorManifest, GameResult, TerminalReason } from "../core/types.ts";
import type { SeasonRef, SiteRecentGame, SiteStore } from "./site.ts";

const SUBJECT = "api.siteStore";

const GAME_RESULTS = ["white", "black", "draw"] as const satisfies readonly GameResult[];
const TERMINAL_REASONS = [
  "checkmate",
  "stalemate",
  "insufficient-material",
  "fifty-move",
  "threefold",
  "move-limit",
] as const satisfies readonly TerminalReason[];

function fail(detail: string): never {
  throw new ContractViolation(SUBJECT, detail);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`${field} must be a string`);
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${field} must be a number`);
  return Math.trunc(value);
}

function isOneOf<T extends string>(value: string, options: readonly T[]): value is T {
  return (options as readonly string[]).includes(value);
}

function requireOneOf<T extends string>(value: unknown, field: string, options: readonly T[]): T {
  const stringValue = requireString(value, field);
  if (!isOneOf(stringValue, options)) fail(`${field} must be one of: ${options.join(", ")}`);
  return stringValue;
}

function parseSeasonRow(row: unknown): SeasonRef {
  if (!isObject(row)) fail("season row must be an object");
  return {
    seasonId: requireString(row.season_id, "season_id"),
    // A season recorded before the broadcast schedule existed has no start
    // time; it sorts last rather than breaking the list.
    startAt: row.start_at === null ? 0 : requireInteger(row.start_at, "start_at"),
    games: requireInteger(row.games, "games"),
  };
}

function parseManifestRow(row: unknown): CompetitorManifest {
  if (!isObject(row)) fail("competitor_versions row must be an object");
  const json = requireString(row.manifest_json, "manifest_json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail("manifest_json must be valid JSON");
  }
  return parseManifest(parsed);
}

function parseRecentGameRow(row: unknown): SiteRecentGame {
  if (!isObject(row)) fail("games row must be an object");
  const plies = requireInteger(row.plies, "plies");
  // A game recorded before the broadcast schedule existed has no start time
  // or pace; it is already public, so it finished the moment it was filed.
  const broadcastStartAt =
    row.broadcast_start_at === null ? null : requireInteger(row.broadcast_start_at, "broadcast_start_at");
  const msPerPly = row.ms_per_ply === null ? 0 : requireInteger(row.ms_per_ply, "ms_per_ply");
  return {
    gameId: requireString(row.game_id, "game_id"),
    seasonId: requireString(row.season_id, "season_id"),
    white: requireString(row.white_competitor, "white_competitor"),
    black: requireString(row.black_competitor, "black_competitor"),
    result: requireOneOf(row.result, "result", GAME_RESULTS),
    reason: requireOneOf(row.reason, "reason", TERMINAL_REASONS),
    plies,
    finishedAt: broadcastStartAt === null ? 0 : broadcastStartAt + plies * msPerPly,
  };
}

export function d1SiteStore(db: D1Database): SiteStore {
  return {
    seasons: async () => {
      const { results } = await db
        .prepare(
          "SELECT season_id, MIN(broadcast_start_at) AS start_at, COUNT(*) AS games" +
            " FROM games GROUP BY season_id ORDER BY start_at DESC, season_id DESC",
        )
        .all();
      return results.map(parseSeasonRow);
    },
    manifests: async (seasonId) => {
      const { results } = await db
        .prepare(
          "SELECT manifest_json FROM competitor_versions WHERE season_id = ? ORDER BY competitor",
        )
        .bind(seasonId)
        .all();
      const manifests = results.map(parseManifestRow);
      // A competitor can carry more than one version into a season once
      // rivalry traits resolve a manifest per opponent. The roster wants the
      // competitor, so the first version it played under stands for it.
      const seen = new Set<string>();
      return manifests.filter((manifest) => {
        if (seen.has(manifest.name)) return false;
        seen.add(manifest.name);
        return true;
      });
    },
    bracket: async (seasonId) => {
      const row = await db
        .prepare("SELECT bracket_id FROM brackets WHERE season_id = ? ORDER BY bracket_id LIMIT 1")
        .bind(seasonId)
        .first();
      return row === null ? undefined : requireString(row.bracket_id, "bracket_id");
    },
    setting: async (key) => {
      try {
        const row = await db
          .prepare("SELECT value FROM site_settings WHERE key = ?")
          .bind(key)
          .first();
        return row === null ? undefined : requireString(row.value, "value");
      } catch {
        // The table arrives with migration 0004. A database that has not run
        // it yet has no operator settings, which is not an error.
        return undefined;
      }
    },
    recentGames: async (now, limit) => {
      // A game is finished when it never had a broadcast schedule at all, or
      // when the schedule's own clock has run out; either way that is the
      // one predicate deciding whether a still-airing game can leak here.
      const { results } = await db
        .prepare(
          "SELECT season_id, game_id, white_competitor, black_competitor, result, reason, plies," +
            " broadcast_start_at, ms_per_ply FROM games" +
            " WHERE broadcast_start_at IS NULL OR broadcast_start_at + plies * ms_per_ply <= ?" +
            " ORDER BY CASE WHEN broadcast_start_at IS NULL THEN 0" +
            " ELSE broadcast_start_at + plies * ms_per_ply END DESC" +
            " LIMIT ?",
        )
        .bind(now, limit)
        .all();
      return results.map(parseRecentGameRow);
    },
  };
}
