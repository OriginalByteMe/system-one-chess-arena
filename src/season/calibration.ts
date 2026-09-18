import type {
  CalibrationBucket,
  CalibrationCurve,
  DecisionRecord,
  GameScore,
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

function outcomeFor(decision: DecisionRecord, game: GameSummary): GameScore {
  if (decision.colour === "white") {
    return game.result === "white" ? 1 : game.result === "black" ? 0 : 0.5;
  }
  return game.result === "black" ? 1 : game.result === "white" ? 0 : 0.5;
}

function bucketIndexFor(confidence: number): number {
  for (let index = 0; index < CALIBRATION_BUCKETS.length; index += 1) {
    const bounds = CALIBRATION_BUCKETS[index];
    if (bounds === undefined) continue;
    const [lower, upper] = bounds;
    const isLast = index === CALIBRATION_BUCKETS.length - 1;
    if (confidence >= lower && (confidence < upper || (isLast && confidence <= upper))) {
      return index;
    }
  }
  return CALIBRATION_BUCKETS.length - 1;
}

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
  const gamesById = new Map(games.map((entry) => [entry.gameId, entry]));
  const named = decisions.filter((entry) => entry.competitor === competitor);

  const counts = CALIBRATION_BUCKETS.map(() => 0);
  const confidenceSums = CALIBRATION_BUCKETS.map(() => 0);
  const scoreSums = CALIBRATION_BUCKETS.map(() => 0);

  for (const decision of named) {
    if (decision.confidence === undefined) continue;
    const game = gamesById.get(decision.gameId);
    if (game === undefined) continue;
    const index = bucketIndexFor(decision.confidence);
    counts[index] = (counts[index] ?? 0) + 1;
    confidenceSums[index] = (confidenceSums[index] ?? 0) + decision.confidence;
    scoreSums[index] = (scoreSums[index] ?? 0) + outcomeFor(decision, game);
  }

  const buckets: CalibrationBucket[] = CALIBRATION_BUCKETS.map(([lower, upper], index) => {
    const count = counts[index] ?? 0;
    return {
      lower,
      upper,
      decisions: count,
      meanConfidence: count === 0 ? 0 : (confidenceSums[index] ?? 0) / count,
      meanScore: count === 0 ? 0 : (scoreSums[index] ?? 0) / count,
    };
  });

  return { competitor, buckets, error: brierScore(named, games) };
}

/** Brier score alone, for the leaderboard column. */
export function brierScore(
  decisions: readonly DecisionRecord[],
  games: readonly GameSummary[],
): number {
  const gamesById = new Map(games.map((entry) => [entry.gameId, entry]));
  let sumSquaredError = 0;
  let scored = 0;
  for (const decision of decisions) {
    if (decision.confidence === undefined) continue;
    const game = gamesById.get(decision.gameId);
    if (game === undefined) continue;
    const outcome = outcomeFor(decision, game);
    sumSquaredError += (decision.confidence - outcome) ** 2;
    scored += 1;
  }
  return scored === 0 ? 0 : sumSquaredError / scored;
}
