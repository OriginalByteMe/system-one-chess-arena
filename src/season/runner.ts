import { NotImplemented } from "../core/errors.ts";
import type {
  Clock,
  Competitor,
  DecisionRecord,
  GameSummary,
  Rng,
  SeasonConfig,
  SeasonStandings,
} from "../core/types.ts";

export interface SeasonOutcome {
  readonly standings: SeasonStandings;
  readonly decisions: readonly DecisionRecord[];
  readonly games: readonly GameSummary[];
}

export function runSeason(
  config: SeasonConfig,
  players: readonly Competitor[],
  rng: Rng,
  clock: Clock,
): Promise<SeasonOutcome> {
  throw new NotImplemented("runner.runSeason");
}
