import { ContractViolation } from "./errors.ts";
import { parseManifest } from "./manifest.ts";
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
    typeof maxPlies !== "number" ||
    !Number.isSafeInteger(maxPlies) ||
    maxPlies <= 0
  ) {
    return violation("season config contains an invalid field");
  }
  if (!Array.isArray(competitors) || competitors.length === 0) {
    return violation("competitors must be a non-empty array");
  }
  if (!Array.isArray(openings) || openings.length === 0) {
    return violation("openings must be a non-empty array");
  }

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
    parsedOpenings.push({ id, name, moves, fen });
  }

  return {
    seasonId,
    seed,
    competitors: competitors.map(parseManifest),
    openings: parsedOpenings,
    roundsPerPair,
    maxPlies,
  };
}
