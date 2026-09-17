import { ContractViolation } from "./errors.ts";
import type { MoveDistribution, Rng, Uci } from "./types.ts";

const NORMALISATION_TOLERANCE = 1e-6;

export function sumProbabilities(distribution: MoveDistribution): number {
  let total = 0;
  for (const probability of Object.values(distribution)) {
    total += probability;
  }
  return total;
}

export function validateDistribution(
  distribution: MoveDistribution,
  legalMoves: readonly Uci[],
): boolean {
  const entries = Object.entries(distribution);
  return (
    entries.length > 0 &&
    entries.every(
      ([move, probability]) =>
        legalMoves.includes(move) && Number.isFinite(probability) && probability >= 0,
    ) &&
    Math.abs(sumProbabilities(distribution) - 1) <= NORMALISATION_TOLERANCE
  );
}

export function argmax(distribution: MoveDistribution, rng: Rng): Uci {
  const entries = Object.entries(distribution);
  if (entries.length === 0) {
    throw new ContractViolation("distribution.argmax", "distribution must not be empty");
  }

  let maximum = -Infinity;
  const tiedMoves: Uci[] = [];
  for (const [move, probability] of entries) {
    if (probability > maximum) {
      maximum = probability;
      tiedMoves.length = 0;
      tiedMoves.push(move);
    } else if (probability === maximum) {
      tiedMoves.push(move);
    }
  }
  return rng.pick(tiedMoves);
}
