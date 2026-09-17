import { NotImplemented } from "../core/errors.ts";
import type { Pairing, Rng, SeasonConfig } from "../core/types.ts";

export function buildPairings(config: SeasonConfig, rng: Rng): readonly Pairing[] {
  throw new NotImplemented("pairings.buildPairings");
}
