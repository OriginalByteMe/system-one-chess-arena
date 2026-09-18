import { ContractViolation } from "../core/errors";
import {
  FEATURE_KEYS,
  STRATEGY_LABELS,
  type Colour,
  type DecisionRecord,
  type FallbackReason,
  type FeatureKey,
  type MoveDistribution,
  type TokenUsage,
} from "../core/types";

const SUBJECT = "season.decisions.parseDecisionRow";

const COLOURS = ["white", "black"] as const satisfies readonly Colour[];
const FALLBACK_REASONS = [
  "timeout",
  "illegal-output",
  "provider-error",
  "malformed-response",
  "malformed-distribution",
  "unknown-strategy",
] as const satisfies readonly FallbackReason[];

/** The D1 row shape of one decision. Column names match migration 0002. */
export interface DecisionRowShape {
  readonly season_id: string;
  readonly game_id: string;
  readonly ply: number;
  readonly competitor: string;
  readonly version: string;
  readonly colour: string;
  readonly fen: string;
  readonly legal_move_count: number;
  readonly move: string;
  readonly strategy: string;
  readonly confidence: number | null;
  readonly distribution_json: string | null;
  readonly latency_ms: number;
  readonly tokens_in: number | null;
  readonly tokens_out: number | null;
  readonly fallback: string | null;
  readonly features_seen_json: string;
  readonly idempotency_key: string;
}

// The single source of column order. DECISION_INSERT and decisionValues both
// derive from this array, so they cannot drift apart.
const COLUMNS = [
  "season_id",
  "game_id",
  "ply",
  "competitor",
  "version",
  "colour",
  "fen",
  "legal_move_count",
  "move",
  "strategy",
  "confidence",
  "distribution_json",
  "latency_ms",
  "tokens_in",
  "tokens_out",
  "fallback",
  "features_seen_json",
  "idempotency_key",
] as const satisfies readonly (keyof DecisionRowShape)[];

/** Insert with ON CONFLICT DO NOTHING, so an alarm retry cannot duplicate. */
export const DECISION_INSERT: string = `INSERT INTO decisions (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")}) ON CONFLICT (season_id, game_id, ply) DO NOTHING`;

/** Flattens a record for storage. Absent optionals become SQL NULL. */
export function decisionRow(record: DecisionRecord): DecisionRowShape {
  return {
    season_id: record.seasonId,
    game_id: record.gameId,
    ply: record.ply,
    competitor: record.competitor,
    version: record.version,
    colour: record.colour,
    fen: record.fen,
    legal_move_count: record.legalMoveCount,
    move: record.move,
    strategy: record.strategy,
    confidence: record.confidence ?? null,
    distribution_json:
      record.distribution === undefined
        ? null
        : JSON.stringify(record.distribution),
    latency_ms: record.latencyMs,
    tokens_in: record.tokens?.in ?? null,
    tokens_out: record.tokens?.out ?? null,
    fallback: record.fallback ?? null,
    features_seen_json: JSON.stringify(record.featuresSeen),
    idempotency_key: record.idempotencyKey,
  };
}

/** Bind order matching DECISION_INSERT. */
export function decisionValues(
  record: DecisionRecord,
): readonly (string | number | null)[] {
  const row = decisionRow(record);
  return COLUMNS.map((column) => row[column]);
}

function fail(detail: string): never {
  throw new ContractViolation(SUBJECT, detail);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: string,
  options: readonly T[],
): value is T {
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

function optionalFiniteNumber(
  value: unknown,
  field: string,
): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${field} must be a finite number`);
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

function optionalOneOf<T extends string>(
  value: unknown,
  field: string,
  options: readonly T[],
): T | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return requireOneOf(value, field, options);
}

function isDistribution(value: unknown): value is MoveDistribution {
  return (
    isObject(value) &&
    Object.values(value).every(
      (probability) =>
        typeof probability === "number" && Number.isFinite(probability),
    )
  );
}

function parseDistribution(value: unknown): MoveDistribution | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = requireString(value, "distribution_json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("distribution_json must be valid JSON");
  }
  if (!isDistribution(parsed)) {
    fail("distribution_json must be a map of move to number");
  }
  return parsed;
}

function parseTokens(
  tokensIn: unknown,
  tokensOut: unknown,
): TokenUsage | undefined {
  const hasIn = tokensIn !== null && tokensIn !== undefined;
  const hasOut = tokensOut !== null && tokensOut !== undefined;
  if (!hasIn && !hasOut) {
    return undefined;
  }
  if (!hasIn || !hasOut) {
    fail("tokens_in and tokens_out must both be present or both be absent");
  }
  return {
    in: requireInteger(tokensIn, "tokens_in"),
    out: requireInteger(tokensOut, "tokens_out"),
  };
}

function isFeatureKeyArray(value: unknown): value is readonly FeatureKey[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && isOneOf(item, FEATURE_KEYS))
  );
}

function parseFeaturesSeen(value: unknown): readonly FeatureKey[] {
  const text = requireString(value, "features_seen_json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("features_seen_json must be valid JSON");
  }
  if (!isFeatureKeyArray(parsed)) {
    fail("features_seen_json must be an array of known feature keys");
  }
  return parsed;
}

/**
 * Narrows an untrusted D1 row back into a DecisionRecord.
 *
 * Contract: round-trips `decisionRow` exactly, including absent optionals
 * staying absent rather than becoming undefined-valued keys. A row with a
 * missing column, an unknown strategy, an unknown fallback reason, an unknown
 * colour, or malformed JSON is a ContractViolation, never a silent default.
 */
export function parseDecisionRow(row: unknown): DecisionRecord {
  if (!isObject(row)) {
    fail("row must be an object");
  }

  const seasonId = requireString(row.season_id, "season_id");
  const gameId = requireString(row.game_id, "game_id");
  const ply = requireInteger(row.ply, "ply");
  const competitor = requireString(row.competitor, "competitor");
  const version = requireString(row.version, "version");
  const colour = requireOneOf(row.colour, "colour", COLOURS);
  const fen = requireString(row.fen, "fen");
  const legalMoveCount = requireInteger(row.legal_move_count, "legal_move_count");
  const move = requireString(row.move, "move");
  const strategy = requireOneOf(row.strategy, "strategy", STRATEGY_LABELS);
  const confidence = optionalFiniteNumber(row.confidence, "confidence");
  const distribution = parseDistribution(row.distribution_json);
  const latencyMs = requireInteger(row.latency_ms, "latency_ms");
  const tokens = parseTokens(row.tokens_in, row.tokens_out);
  const fallback = optionalOneOf(row.fallback, "fallback", FALLBACK_REASONS);
  const featuresSeen = parseFeaturesSeen(row.features_seen_json);
  const idempotencyKey = requireString(row.idempotency_key, "idempotency_key");

  return {
    seasonId,
    gameId,
    ply,
    competitor,
    version,
    colour,
    fen,
    legalMoveCount,
    move,
    strategy,
    ...(confidence === undefined ? {} : { confidence }),
    ...(distribution === undefined ? {} : { distribution }),
    latencyMs,
    ...(tokens === undefined ? {} : { tokens }),
    ...(fallback === undefined ? {} : { fallback }),
    featuresSeen,
    idempotencyKey,
  };
}

/** Statements for a batch write, one per record, in ply order. */
export function decisionStatements(
  db: D1Database,
  records: readonly DecisionRecord[],
): readonly D1PreparedStatement[] {
  return [...records]
    .sort((a, b) => a.ply - b.ply)
    .map((record) => db.prepare(DECISION_INSERT).bind(...decisionValues(record)));
}
