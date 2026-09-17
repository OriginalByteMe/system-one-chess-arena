import { ContractViolation } from "../core/errors.ts";
import { chooseGreedyMove } from "../core/greedy.ts";
import type {
  Clock,
  Competitor,
  CompetitorManifest,
  Rng,
} from "../core/types.ts";

export function createGreedyPlayer(
  manifest: CompetitorManifest,
  rng: Rng,
  clock: Clock,
): Competitor {
  const strategy = manifest.strategies[0];
  if (strategy === undefined) {
    throw new ContractViolation(
      "players.greedy.createGreedyPlayer",
      "manifest must declare a strategy",
    );
  }

  return {
    manifest,
    async decide(input) {
      const startedAt = clock.now();
      const move = chooseGreedyMove(input.fen, input.legalMoves, rng);
      return {
        move,
        strategy,
        latencyMs: clock.now() - startedAt,
      };
    },
  };
}
