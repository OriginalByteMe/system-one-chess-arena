import { describe, expect, test } from "bun:test";

import type {
  CompetitorManifest,
  Opening,
  Pairing,
  Rng,
  SeasonConfig,
} from "../../src/core/types.ts";
import { OPENINGS } from "../../src/season/openings.ts";
import { buildPairings } from "../../src/season/pairings.ts";

function manifest(name: string): CompetitorManifest {
  return {
    name,
    version: `${name}-v1`,
    model: "test",
    playstyle: "pairing fixture",
    strategies: ["direct"],
    features: [],
    historyPlies: 0,
    fallback: "first-legal",
    budget: { maxMs: 100 },
    hierarchical: false,
  };
}

const COMPETITORS = [manifest("alpha"), manifest("beta"), manifest("gamma")];

function testRng(seed: string): Rng {
  const high = seed === "seed-b";
  const next = (): number => (high ? 0.999_999 : 0);
  return {
    next,
    nextInt(boundExclusive: number): number {
      if (!Number.isInteger(boundExclusive) || boundExclusive <= 0) {
        throw new Error("bound must be a positive integer");
      }
      return high ? boundExclusive - 1 : 0;
    },
    pick<T>(items: readonly T[]): T {
      const picked = items[high ? items.length - 1 : 0];
      if (picked === undefined) throw new Error("cannot pick from an empty list");
      return picked;
    },
  };
}

function config(
  roundsPerPair = 1,
  competitors: readonly CompetitorManifest[] = COMPETITORS,
  openings: readonly Opening[] = OPENINGS.slice(0, 2),
): SeasonConfig {
  return {
    seasonId: "pairing-season",
    seed: "config-seed",
    competitors,
    openings,
    roundsPerPair,
    maxPlies: 80,
  };
}

function pairKey(pairing: Pairing): string {
  return `${pairing.white.name}@${pairing.white.version}->${pairing.black.name}@${pairing.black.version}`;
}

function pairings(seed = "seed-a", season = config()): readonly Pairing[] {
  return buildPairings(season, testRng(seed));
}

describe("buildPairings", () => {
  test("schedules every ordered pair once and reverses colours", () => {
    const scheduled = pairings();

    expect(scheduled).toHaveLength(6);
    expect(scheduled.map(pairKey).sort()).toEqual([
      "alpha@alpha-v1->beta@beta-v1",
      "alpha@alpha-v1->gamma@gamma-v1",
      "beta@beta-v1->alpha@alpha-v1",
      "beta@beta-v1->gamma@gamma-v1",
      "gamma@gamma-v1->alpha@alpha-v1",
      "gamma@gamma-v1->beta@beta-v1",
    ]);
    expect(scheduled.filter((pairing) => pairing.white.name === pairing.black.name)).toEqual([]);
  });

  test("produces unique, stable game ids for a fixed seed", () => {
    const first = pairings("seed-a");
    const repeated = pairings("seed-a");
    const ids = first.map((pairing) => pairing.gameId);

    expect(first).toEqual(repeated);
    expect(new Set(ids).size).toBe(6);
  });

  test("a different seed changes order without changing the pair multiset", () => {
    const firstOrder = pairings("seed-a").map(pairKey);
    const secondOrder = pairings("seed-b").map(pairKey);

    expect(secondOrder).not.toEqual(firstOrder);
    expect([...secondOrder].sort()).toEqual([...firstOrder].sort());
  });

  test("roundsPerPair two schedules each ordered pair twice", () => {
    const scheduled = pairings("seed-a", config(2));
    const counts = new Map<string, number>();
    for (const pairing of scheduled) {
      const key = pairKey(pairing);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    expect(scheduled).toHaveLength(12);
    expect([...counts.values()].sort()).toEqual([2, 2, 2, 2, 2, 2]);
  });

  test("cycles through only the configured openings", () => {
    const scheduled = pairings("seed-a", config(1, COMPETITORS, OPENINGS.slice(0, 2)));
    const ids = scheduled.map((pairing) => pairing.openingId);
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);

    expect([...new Set(ids)].sort()).toEqual(["italian-game", "queens-gambit"]);
    expect([...counts.entries()].sort(([left], [right]) => left.localeCompare(right))).toEqual([
      ["italian-game", 3],
      ["queens-gambit", 3],
    ]);
  });

  test("returns no pairings for one competitor", () => {
    expect(pairings("seed-a", config(1, [manifest("solo")]))).toEqual([]);
  });
});
