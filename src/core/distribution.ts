import { NotImplemented } from "./errors.ts";
import type { MoveDistribution, Rng, Uci } from "./types.ts";

export function sumProbabilities(distribution: MoveDistribution): number {
  throw new NotImplemented("distribution.sumProbabilities");
}

export function validateDistribution(
  distribution: MoveDistribution,
  legalMoves: readonly Uci[],
): boolean {
  throw new NotImplemented("distribution.validateDistribution");
}

export function argmax(distribution: MoveDistribution, rng: Rng): Uci {
  throw new NotImplemented("distribution.argmax");
}
