import { describe, expect, test } from "bun:test";
import { buildManifest } from "../../src/core/manifest.ts";
import { FEATURE_KEYS, STRATEGY_LABELS } from "../../src/core/types.ts";
import { ROSTER } from "../../src/players/roster.ts";

/** The twenty names, fixed order. Every other consumer relies on this. */
const EXPECTED_NAMES = [
  "aggressor",
  "architect",
  "mason",
  "ledger",
  "economist",
  "blitzen",
  "gambit",
  "fortress",
  "vulture",
  "metronome",
  "swindler",
  "hermit",
  "scholar",
  "surgeon",
  "anvil",
  "tinker",
  "mirror",
  "compass",
  "hourglass",
  "sentry",
] as const;

/**
 * Versions already registered in the database for the six pre-existing
 * competitors (see `competitor_versions.manifest_json`, latest row per
 * name). The roster must reproduce these exactly, or their cross-season
 * identity breaks.
 */
const EXPECTED_VERSIONS: Readonly<Record<string, string>> = {
  aggressor: "ba3c6316488a5ba01c1de4ae8f2b0cb43c2157eb0a6e713696789eb5608500af",
  architect: "4574a49f03f96c160dbf0e8949d21b0d9546f38a7eae9d45c9a907eb01ca92bb",
  mason: "200b795d920005c25012fa5d87171eeaaddf405ea0536273dd97841795d9a958",
  ledger: "e9573d6ab7bc9631a692ee3b35948409c63aa44f9a8601103a7cd134b271f839",
  economist: "fad2b6bfd2a63323e29d0eaf553e1aa1fa361144a77c9085d782a31d96f7829b",
  blitzen: "15ad3f84c63adc831aff62550cfb65acf3dd096bb31df56e591c3672ca1ff024",
};

describe("ROSTER", () => {
  test("has exactly the twenty fixed names, in order", () => {
    expect(ROSTER.map((manifest) => manifest.name)).toEqual([...EXPECTED_NAMES]);
  });

  test("has no duplicate names", () => {
    const names = ROSTER.map((manifest) => manifest.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every strategy is in the declared closed set", () => {
    for (const manifest of ROSTER) {
      expect(manifest.strategies.length).toBeGreaterThan(0);
      for (const strategy of manifest.strategies) {
        expect(STRATEGY_LABELS).toContain(strategy);
      }
    }
  });

  test("every feature is in the declared closed set", () => {
    for (const manifest of ROSTER) {
      for (const feature of manifest.features) {
        expect(FEATURE_KEYS).toContain(feature);
      }
    }
  });

  test("every budget is positive", () => {
    for (const manifest of ROSTER) {
      expect(manifest.budget.maxMs).toBeGreaterThan(0);
    }
  });

  test("every historyPlies is a non-negative integer", () => {
    for (const manifest of ROSTER) {
      expect(Number.isInteger(manifest.historyPlies)).toBe(true);
      expect(manifest.historyPlies).toBeGreaterThanOrEqual(0);
    }
  });

  test("every playstyle is a non-empty, genuinely distinct sentence", () => {
    const playstyles = ROSTER.map((manifest) => manifest.playstyle);
    for (const playstyle of playstyles) {
      expect(playstyle.length).toBeGreaterThan(0);
    }
    expect(new Set(playstyles).size).toBe(playstyles.length);
  });

  test("all use the jev-latest model", () => {
    for (const manifest of ROSTER) {
      expect(manifest.model).toBe("jev-latest");
    }
  });

  test.each(Object.entries(EXPECTED_VERSIONS))(
    "%s hashes to the version already registered in the database",
    (name, version) => {
      const manifest = ROSTER.find((entry) => entry.name === name);
      expect(manifest).toBeDefined();
      expect(buildManifest(manifest!).version).toBe(version);
    },
  );
});
