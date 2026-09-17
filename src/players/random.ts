import { ContractViolation } from "../core/errors.ts";
import type { Clock, Competitor, CompetitorManifest, Rng } from "../core/types.ts";

export function createRandomPlayer(
  manifest: CompetitorManifest,
  rng: Rng,
  clock: Clock,
): Competitor {
  const strategy = manifest.strategies[0];
  if (strategy === undefined) {
    throw new ContractViolation(
      "players.random.createRandomPlayer",
      "manifest must declare a strategy",
    );
  }

  return {
    manifest,
    async decide(input) {
      const startedAt = clock.now();
      if (input.legalMoves.length === 0) {
        throw new ContractViolation(
          "players.random.decide",
          "position must have a legal move",
        );
      }

      return {
        move: rng.pick(input.legalMoves),
        strategy,
        latencyMs: clock.now() - startedAt,
      };
    },
  };
}
