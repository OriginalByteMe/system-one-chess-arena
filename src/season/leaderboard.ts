import { NotImplemented } from "../core/errors.ts";
import type {
  CompetitorVersionRow,
  DecisionRecord,
  EpochMs,
  GameSummary,
  Leaderboard,
} from "../core/types.ts";

export interface LeaderboardArgs {
  /** Revealed games only. Passing an unrevealed game is a spoiler bug. */
  readonly games: readonly GameSummary[];
  /** Revealed decisions only, for the confidence, fallback and cost columns. */
  readonly decisions: readonly DecisionRecord[];
  /** Version rows, so cost can find each decision's model. */
  readonly versions: readonly CompetitorVersionRow[];
  /** The reveal boundary this was computed at. */
  readonly asOf: EpochMs;
  readonly k?: number;
}

/**
 * One row per competitor name, versions rolled up, as decided on 2026-09-18.
 *
 * Contract:
 * - Rating is Elo over the given games keyed by name, so a competitor keeps one
 *   rating across its whole evolution, starting from DEFAULT_ELO.
 * - `versions` lists every version that played, oldest first by first
 *   appearance.
 * - A competitor with rows but no games still appears, at DEFAULT_ELO with zero
 *   games, so a new entrant is visible before its first reveal.
 * - Sorted by Elo descending, then score descending, then name ascending, so
 *   the order is stable.
 * - Every column is computed from the arguments only. There is no stored
 *   rating, by design: a stored one could spoil an unaired result.
 */
export function leaderboardFrom(args: LeaderboardArgs): Leaderboard {
  void args;
  throw new NotImplemented("season.leaderboard.leaderboardFrom");
}
