import { describe, expect, test } from "bun:test";
import { ContractViolation } from "../../src/core/errors.ts";
import { buildManifest } from "../../src/core/manifest.ts";
import { parseSeasonConfig } from "../../src/core/season-config.ts";
import type {
  ManifestFields,
  Opening,
  SeasonConfig,
} from "../../src/core/types.ts";

const MANIFEST_FIELDS: ManifestFields = {
  name: "test-player",
  model: "test-model",
  playstyle: "Control the centre.",
  strategies: ["develop"],
  features: ["materialBalance"],
  historyPlies: 8,
  fallback: "first-legal",
  budget: { maxMs: 750 },
  hierarchical: false,
};

const OPENING: Opening = {
  id: "initial-position",
  name: "Initial position",
  moves: [],
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
};

const CONFIG: SeasonConfig = {
  seasonId: "season-1",
  seed: "deterministic-seed",
  competitors: [buildManifest(MANIFEST_FIELDS)],
  openings: [OPENING],
  roundsPerPair: 1,
  maxPlies: 80,
};

function validRaw(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(CONFIG)) as Record<string, unknown>;
}

function expectContractViolation(raw: unknown): void {
  expect(() => parseSeasonConfig(raw)).toThrow(ContractViolation);
}

describe("parseSeasonConfig", () => {
  test("parses a valid JSON object into a deep-equal season config", () => {
    const raw: unknown = JSON.parse(JSON.stringify(CONFIG));

    expect(parseSeasonConfig(raw)).toEqual(CONFIG);
  });

  test.each([
    ["a string", "not-a-config"],
    ["null", null],
    ["an array", []],
  ])("rejects %s instead of an object", (_description, raw) => {
    expectContractViolation(raw);
  });

  test.each(["seasonId", "seed", "roundsPerPair", "maxPlies"])(
    "rejects a config missing %s",
    (field) => {
      const raw = validRaw();
      delete raw[field];

      expectContractViolation(raw);
    },
  );

  test.each([
    ["seasonId", 1],
    ["seed", false],
    ["roundsPerPair", "1"],
    ["maxPlies", "80"],
  ])("rejects a wrongly typed %s", (field, value) => {
    expectContractViolation({ ...validRaw(), [field]: value });
  });

  test("rejects non-positive roundsPerPair", () => {
    expectContractViolation({ ...validRaw(), roundsPerPair: 0 });
  });

  test("rejects non-positive maxPlies", () => {
    expectContractViolation({ ...validRaw(), maxPlies: -1 });
  });

  test("rejects an empty competitors list", () => {
    expectContractViolation({ ...validRaw(), competitors: [] });
  });

  test("rejects an empty openings list", () => {
    expectContractViolation({ ...validRaw(), openings: [] });
  });

  test("rejects a competitor that is not a valid manifest", () => {
    expectContractViolation({
      ...validRaw(),
      competitors: [{ ...CONFIG.competitors[0], version: "wrong-version" }],
    });
  });

  test.each([
    ["id", 1],
    ["name", false],
    ["moves", "e4"],
    ["moves entries", [1]],
    ["fen", null],
  ])("rejects an opening with invalid %s", (field, value) => {
    const property = field === "moves entries" ? "moves" : field;
    expectContractViolation({
      ...validRaw(),
      openings: [{ ...OPENING, [property]: value }],
    });
  });

  test("rejects an extra config field", () => {
    expectContractViolation({ ...validRaw(), unexpected: true });
  });

  test("rejects an extra opening field", () => {
    expectContractViolation({
      ...validRaw(),
      openings: [{ ...OPENING, unexpected: true }],
    });
  });
});
