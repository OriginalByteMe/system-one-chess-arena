import { ContractViolation } from "../core/errors.ts";
import type {
  Clock,
  Competitor,
  CompetitorManifest,
  PositionInput,
  Rng,
  StrategyLabel,
  Uci,
} from "../core/types.ts";
import { chooseGreedyMove } from "./greedy.ts";

function scriptedStrategy(
  input: PositionInput,
  manifest: CompetitorManifest,
  defaultStrategy: StrategyLabel,
): StrategyLabel {
  if (input.features.opponentMateInOne === true || input.features.inCheck === true) {
    if (manifest.strategies.includes("defend")) return "defend";
    if (manifest.strategies.includes("fortify")) return "fortify";
  }
  if (
    (input.features.hangingOpponentPieces ?? 0) > 0 &&
    manifest.strategies.includes("attack")
  ) {
    return "attack";
  }
  if (
    (input.features.materialBalance ?? 0) > 0 &&
    manifest.strategies.includes("simplify")
  ) {
    return "simplify";
  }
  return defaultStrategy;
}

function fallbackMove(
  input: PositionInput,
  manifest: CompetitorManifest,
  rng: Rng,
): Uci {
  const first = input.legalMoves[0];
  if (first === undefined) {
    throw new ContractViolation(
      "players.scripted.decide",
      "position must have a legal move",
    );
  }

  switch (manifest.fallback) {
    case "random-legal":
      return rng.pick(input.legalMoves);
    case "greedy":
      return chooseGreedyMove(input.fen, input.legalMoves, rng);
    case "first-legal":
      return first;
  }
}

export function createScriptedPlayer(
  manifest: CompetitorManifest,
  rng: Rng,
  clock: Clock,
): Competitor {
  const defaultStrategy = manifest.strategies[0];
  if (defaultStrategy === undefined) {
    throw new ContractViolation(
      "players.scripted.createScriptedPlayer",
      "manifest must declare a strategy",
    );
  }

  return {
    manifest,
    async decide(input) {
      const startedAt = clock.now();
      const strategy = scriptedStrategy(input, manifest, defaultStrategy);
      const followsMaterialScript =
        (strategy === "attack" &&
          (input.features.hangingOpponentPieces ?? 0) > 0) ||
        (strategy === "simplify" && (input.features.materialBalance ?? 0) > 0);
      const move = followsMaterialScript
        ? chooseGreedyMove(input.fen, input.legalMoves, rng)
        : fallbackMove(input, manifest, rng);

      return {
        move,
        strategy,
        latencyMs: clock.now() - startedAt,
      };
    },
  };
}
