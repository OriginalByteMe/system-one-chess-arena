import { ContractViolation } from "./errors.ts";
import { parseManifest } from "./manifest.ts";
import { positionFromOpening } from "./rules.ts";
import type { Opening, SeasonConfig } from "./types.ts";

const CONFIG_KEYS = [
  "seasonId",
  "seed",
  "competitors",
  "openings",
  "roundsPerPair",
  "maxPlies",
] as const;
const OPENING_KEYS = ["id", "name", "moves", "fen"] as const;
const MAX_COMPETITORS = 32;
const MAX_OPENINGS = 16;
const MAX_ROUNDS_PER_PAIR = 8;
const MAX_PLIES = 1_000;

function violation(detail: string): never {
  throw new ContractViolation("season-config.parseSeasonConfig", detail);
}


function hasExactKeys(
  value: object,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry: unknown) => typeof entry === "string")
  );
}

export function parseSeasonConfig(raw: unknown): SeasonConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return violation("expected an object");
  }
  if (!hasExactKeys(raw, CONFIG_KEYS)) {
    return violation("season config fields do not match the contract");
  }

  const seasonId: unknown = Reflect.get(raw, "seasonId");
  const seed: unknown = Reflect.get(raw, "seed");
  const competitors: unknown = Reflect.get(raw, "competitors");
  const openings: unknown = Reflect.get(raw, "openings");
  const roundsPerPair: unknown = Reflect.get(raw, "roundsPerPair");
  const maxPlies: unknown = Reflect.get(raw, "maxPlies");
  if (
    typeof seasonId !== "string" ||
    typeof seed !== "string" ||
    typeof roundsPerPair !== "number" ||
    !Number.isSafeInteger(roundsPerPair) ||
    roundsPerPair <= 0 ||
    roundsPerPair > MAX_ROUNDS_PER_PAIR ||
    typeof maxPlies !== "number" ||
    !Number.isSafeInteger(maxPlies) ||
    maxPlies <= 0 ||
    maxPlies > MAX_PLIES
  ) {
    return violation("season config contains an invalid field");
  }
  if (
    !Array.isArray(competitors) ||
    competitors.length === 0 ||
    competitors.length > MAX_COMPETITORS
  ) {
    return violation(
      `competitors must contain between 1 and ${MAX_COMPETITORS} entries`,
    );
  }
  if (
    !Array.isArray(openings) ||
    openings.length === 0 ||
    openings.length > MAX_OPENINGS
  ) {
    return violation(
      `openings must contain between 1 and ${MAX_OPENINGS} entries`,
    );
  }

  const parsedCompetitors = competitors.map(parseManifest);
  const competitorIdentities = new Set<string>();
  for (const competitor of parsedCompetitors) {
    const identity = `${competitor.name}\0${competitor.version}`;
    if (competitorIdentities.has(identity)) {
      return violation(
        `duplicate competitor identity: ${competitor.name}@${competitor.version}`,
      );
    }
    competitorIdentities.add(identity);
  }

  const openingIds = new Set<string>();
  const parsedOpenings: Opening[] = [];
  for (const opening of openings) {
    if (
      typeof opening !== "object" ||
      opening === null ||
      Array.isArray(opening) ||
      !hasExactKeys(opening, OPENING_KEYS)
    ) {
      return violation("opening fields do not match the contract");
    }
    const id: unknown = Reflect.get(opening, "id");
    const name: unknown = Reflect.get(opening, "name");
    const moves: unknown = Reflect.get(opening, "moves");
    const fen: unknown = Reflect.get(opening, "fen");
    if (
      typeof id !== "string" ||
      typeof name !== "string" ||
      !isStringArray(moves) ||
      typeof fen !== "string"
    ) {
      return violation("opening contains an invalid field");
    }
    if (openingIds.has(id)) {
      return violation(`duplicate opening id: ${id}`);
    }
    openingIds.add(id);
    const parsedOpening = { id, name, moves, fen };
    positionFromOpening(parsedOpening);
    parsedOpenings.push(parsedOpening);
  }

  return {
    seasonId,
    seed,
    competitors: parsedCompetitors,
    openings: parsedOpenings,
    roundsPerPair,
    maxPlies,
  };
}
