import { NotImplemented } from "../core/errors.ts";
import type { DecisionRecord } from "../core/types.ts";

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

/** Insert with ON CONFLICT DO NOTHING, so an alarm retry cannot duplicate. */
export const DECISION_INSERT: string =
  "INSERT INTO decisions (season_id, game_id, ply, competitor, version, colour, fen, legal_move_count, move, strategy, confidence, distribution_json, latency_ms, tokens_in, tokens_out, fallback, features_seen_json, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (season_id, game_id, ply) DO NOTHING";

/** Flattens a record for storage. Absent optionals become SQL NULL. */
export function decisionRow(record: DecisionRecord): DecisionRowShape {
  void record;
  throw new NotImplemented("season.decisions.decisionRow");
}

/** Bind order matching DECISION_INSERT. */
export function decisionValues(
  record: DecisionRecord,
): readonly (string | number | null)[] {
  void record;
  throw new NotImplemented("season.decisions.decisionValues");
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
  void row;
  throw new NotImplemented("season.decisions.parseDecisionRow");
}

/** Statements for a batch write, one per record, in ply order. */
export function decisionStatements(
  db: D1Database,
  records: readonly DecisionRecord[],
): readonly D1PreparedStatement[] {
  void db;
  void records;
  throw new NotImplemented("season.decisions.decisionStatements");
}
