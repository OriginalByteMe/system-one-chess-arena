import { ContractViolation } from "../core/errors.ts";
import type { Pairing, Rng, SeasonConfig } from "../core/types.ts";

export function buildPairings(config: SeasonConfig, rng: Rng): readonly Pairing[] {
  const games: Array<{
    white: SeasonConfig["competitors"][number];
    black: SeasonConfig["competitors"][number];
    round: number;
  }> = [];

  for (let round = 0; round < config.roundsPerPair; round += 1) {
    for (const white of config.competitors) {
      for (const black of config.competitors) {
        if (white !== black) games.push({ white, black, round });
      }
    }
  }

  for (let index = games.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.nextInt(index + 1);
    [games[index], games[swapIndex]] = [games[swapIndex]!, games[index]!];
  }

  if (games.length === 0) return [];
  if (config.openings.length === 0) {
    throw new ContractViolation("pairings.buildPairings", "at least one opening is required");
  }

  const openingOffset = rng.nextInt(config.openings.length);
  return games.map(({ white, black, round }, index) => {
    const opening = config.openings[(openingOffset + index) % config.openings.length]!;
    return {
      gameId: `${config.seasonId}:${round}:${white.name}@${white.version}:${black.name}@${black.version}`,
      white: { name: white.name, version: white.version },
      black: { name: black.name, version: black.version },
      openingId: opening.id,
    };
  });
}
