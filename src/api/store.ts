import { ContractViolation } from "../core/errors.ts";
import { parseManifest } from "../core/manifest.ts";
import type {
  ArenaStore,
  CompetitorVersionRow,
  GameResult,
  Match,
  MatchSlot,
  RecordedGame,
  TerminalReason,
  Trait,
} from "../core/types.ts";
import { parseDecisionRow } from "../season/decisions.ts";

const SUBJECT = "api.store.d1Store";

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

function isOneOf<T extends string>(value: string, options: readonly T[]): value is T {
  return (options as readonly string[]).includes(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    fail(`${field} must be a string`);
  }
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`${field} must be an integer`);
  }
  return value;
}

function requireOneOf<T extends string>(
  value: unknown,
  field: string,
  options: readonly T[],
): T {
  const stringValue = requireString(value, field);
  if (!isOneOf(stringValue, options)) {
    fail(`${field} must be one of: ${options.join(", ")}`);
  }
  return stringValue;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requireString(value, field);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseJsonStringArray(value: unknown, field: string): readonly string[] {
  const text = requireString(value, field);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(`${field} must be valid JSON`);
  }
  if (!isStringArray(parsed)) {
    fail(`${field} must be an array of strings`);
  }
  return parsed;
}

function isTrait(value: unknown): value is Trait {
  return (
    isObject(value) &&
    typeof value.rule === "string" &&
    typeof value.opponent === "string" &&
    typeof value.reason === "string" &&
    isStringArray(value.gameIds)
  );
}

function isTraitArray(value: unknown): value is readonly Trait[] {
  return Array.isArray(value) && value.every(isTrait);
}

function parseTraits(value: unknown): readonly Trait[] {
  if (value === null || value === undefined) return [];
  const text = requireString(value, "traits_json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("traits_json must be valid JSON");
  }
  if (!isTraitArray(parsed)) {
    fail("traits_json must be an array of traits");
  }
  return parsed;
}

function parseGameRow(row: unknown): RecordedGame {
  if (!isObject(row)) fail("games row must be an object");

  const seasonId = requireString(row.season_id, "season_id");
  const gameId = requireString(row.game_id, "game_id");
  const openingId = requireString(row.opening_id, "opening_id");
  const result = requireOneOf(row.result, "result", GAME_RESULTS);
  const reason = requireOneOf(row.reason, "reason", TERMINAL_REASONS);
  const plies = requireInteger(row.plies, "plies");
  const pgn = requireString(row.pgn, "pgn");
  const adjudicatedCp =
    row.adjudicated_cp === null || row.adjudicated_cp === undefined
      ? undefined
      : requireInteger(row.adjudicated_cp, "adjudicated_cp");
  const matchId = optionalString(row.match_id, "match_id");
  const startAt = requireInteger(row.broadcast_start_at, "broadcast_start_at");
  const msPerPly = requireInteger(row.ms_per_ply, "ms_per_ply");

  return {
    summary: {
      seasonId,
      gameId,
      white: {
        name: requireString(row.white_competitor, "white_competitor"),
        version: requireString(row.white_version, "white_version"),
      },
      black: {
        name: requireString(row.black_competitor, "black_competitor"),
        version: requireString(row.black_version, "black_version"),
      },
      openingId,
      result,
      reason,
      ...(adjudicatedCp === undefined ? {} : { adjudicatedCp }),
      plies,
      pgn,
    },
    schedule: { startAt, msPerPly },
    ...(matchId === undefined ? {} : { matchId }),
  };
}

function parseVersionRow(row: unknown): CompetitorVersionRow {
  if (!isObject(row)) fail("competitor_versions row must be an object");

  const seasonId = requireString(row.season_id, "season_id");
  const competitor = requireString(row.competitor, "competitor");
  const version = requireString(row.version, "version");
  const manifestJson = requireString(row.manifest_json, "manifest_json");
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(manifestJson);
  } catch {
    fail("manifest_json must be valid JSON");
  }
  const manifest = parseManifest(parsedManifest);
  const parentVersion = optionalString(row.parent_version, "parent_version");
  const traits = parseTraits(row.traits_json);
  const rationale = optionalString(row.rationale, "rationale");

  return {
    seasonId,
    competitor,
    version,
    manifest,
    ...(parentVersion === undefined ? {} : { parentVersion }),
    traits,
    ...(rationale === undefined ? {} : { rationale }),
  };
}

function slotFromColumns(competitor: unknown, feeder: unknown, side: string): MatchSlot {
  const competitorName = optionalString(competitor, `competitor_${side}`);
  if (competitorName !== undefined) {
    return { kind: "competitor", competitor: competitorName };
  }
  const feederId = optionalString(feeder, `feeder_${side}`);
  if (feederId !== undefined) {
    return { kind: "winner-of", matchId: feederId };
  }
  return { kind: "bye" };
}

function parseMatchRow(row: unknown): Match {
  if (!isObject(row)) fail("matches row must be an object");

  const matchId = requireString(row.match_id, "match_id");
  const bracketId = requireString(row.bracket_id, "bracket_id");
  const round = requireInteger(row.round, "round");
  const slot = requireInteger(row.slot, "slot");
  const a = slotFromColumns(row.competitor_a, row.feeder_a, "a");
  const b = slotFromColumns(row.competitor_b, row.feeder_b, "b");
  const bestOf = requireInteger(row.best_of, "best_of");
  const gameIds = parseJsonStringArray(row.game_ids_json, "game_ids_json");
  const winner = optionalString(row.winner, "winner");

  return {
    matchId,
    bracketId,
    round,
    slot,
    a,
    b,
    bestOf,
    gameIds,
    ...(winner === undefined ? {} : { winner }),
  };
}

/**
 * The only module that knows SQL for the read side. Every query is scoped by
 * season or competitor, and none of them filters by reveal state: gating is the
 * gate's job, so this returns the record and the handler slices it.
 */
export function d1Store(db: D1Database): ArenaStore {
  return {
    game: async (seasonId, gameId) => {
      const row = await db
        .prepare("SELECT * FROM games WHERE season_id = ? AND game_id = ?")
        .bind(seasonId, gameId)
        .first();
      return row === null ? undefined : parseGameRow(row);
    },
    games: async (seasonId) => {
      const { results } = await db
        .prepare("SELECT * FROM games WHERE season_id = ?")
        .bind(seasonId)
        .all();
      return results.map(parseGameRow);
    },
    decisions: async (seasonId, gameId) => {
      const { results } = await db
        .prepare("SELECT * FROM decisions WHERE season_id = ? AND game_id = ? ORDER BY ply")
        .bind(seasonId, gameId)
        .all();
      return results.map(parseDecisionRow);
    },
    competitorDecisions: async (competitor) => {
      const { results } = await db
        .prepare(
          "SELECT * FROM decisions WHERE competitor = ? ORDER BY season_id, game_id, ply",
        )
        .bind(competitor)
        .all();
      return results.map(parseDecisionRow);
    },
    versions: async (competitor) => {
      const { results } = await db
        .prepare("SELECT * FROM competitor_versions WHERE competitor = ?")
        .bind(competitor)
        .all();
      return results.map(parseVersionRow);
    },
    matches: async (bracketId) => {
      const { results } = await db
        .prepare("SELECT * FROM matches WHERE bracket_id = ? ORDER BY round, slot")
        .bind(bracketId)
        .all();
      return results.map(parseMatchRow);
    },
    bracketSeason: async (bracketId) => {
      const row = await db
        .prepare("SELECT season_id FROM brackets WHERE bracket_id = ?")
        .bind(bracketId)
        .first();
      if (row === null) return undefined;
      return requireString(row.season_id, "season_id");
    },
  };
}
