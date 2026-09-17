import { NotImplemented } from "../core/errors.ts";
import type { Clock, Competitor, CompetitorManifest, Rng } from "../core/types.ts";

export function createScriptedPlayer(
  manifest: CompetitorManifest,
  rng: Rng,
  clock: Clock,
): Competitor {
  throw new NotImplemented("players/scripted.createScriptedPlayer");
}
