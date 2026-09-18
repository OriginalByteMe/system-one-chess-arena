import { NotImplemented } from "../core/errors.ts";
import type {
  CalibrationCurve,
  DecisionRecord,
  GameSummary,
} from "../core/types.ts";

/** Ten equal buckets over [0, 1]; 1.0 falls in the last one. */
export const CALIBRATION_BUCKETS: readonly (readonly [number, number])[] = [
  [0, 0.1],
  [0.1, 0.2],
  [0.2, 0.3],
  [0.3, 0.4],
  [0.4, 0.5],
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1],
];

/**
 * Stated confidence against what actually happened, which is the chart that
 * justifies the whole arena.
 *
 * Contract:
 * - The outcome of a decision is the game score of the side that made it: 1
 *   for a win, 0.5 for a draw, 0 for a loss.
 * - Decisions with no stated confidence are excluded, not treated as zero.
 * - Decisions whose game is not in `games` are excluded: an unrevealed game
 *   must never reach a chart.
 * - Empty buckets are returned with zero counts so the curve keeps its shape.
 * - `error` is the Brier score, the mean squared difference between stated
 *   confidence and outcome, and is zero when there is nothing to score.
 */
export function calibrationCurve(
  competitor: string,
  decisions: readonly DecisionRecord[],
  games: readonly GameSummary[],
): CalibrationCurve {
  void competitor;
  void decisions;
  void games;
  throw new NotImplemented("season.calibration.calibrationCurve");
}

/** Brier score alone, for the leaderboard column. */
export function brierScore(
  decisions: readonly DecisionRecord[],
  games: readonly GameSummary[],
): number {
  void decisions;
  void games;
  throw new NotImplemented("season.calibration.brierScore");
}
