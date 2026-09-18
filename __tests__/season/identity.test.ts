import { describe, expect, test } from "bun:test";

import { ContractViolation } from "../../src/core/errors.ts";
import { buildManifest } from "../../src/core/manifest.ts";
import {
  RESERVED_NAMES,
  lineageOf,
  registerVersions,
} from "../../src/season/identity.ts";
import type {
  CompetitorManifest,
  CompetitorVersionRow,
  ManifestFields,
  SeasonConfig,
} from "../../src/core/types.ts";

function fields(name: string, tweak: Partial<ManifestFields> = {}): ManifestFields {
  return {
    name,
    model: "test-model",
    playstyle: "baseline",
    strategies: ["direct"],
    features: [],
    historyPlies: 0,
    fallback: "first-legal",
    budget: { maxMs: 100 },
    hierarchical: false,
    ...tweak,
  };
}

function manifest(name: string, tweak: Partial<ManifestFields> = {}): CompetitorManifest {
  return buildManifest(fields(name, tweak));
}

function config(
  competitors: readonly CompetitorManifest[],
  seasonId = "season-1",
): SeasonConfig {
  return {
    seasonId,
    seed: "identity-seed",
    competitors,
    openings: [],
    roundsPerPair: 1,
    maxPlies: 80,
  };
}

function row(
  manifestRow: CompetitorManifest,
  seasonId: string,
  parentVersion?: string,
): CompetitorVersionRow {
  return {
    competitor: manifestRow.name,
    version: manifestRow.version,
    seasonId,
    manifest: manifestRow,
    parentVersion,
    traits: [],
  };
}

describe("registerVersions", () => {
  test("registers one row per competitor when every name is new", () => {
    const alpha = manifest("Alpha");
    const beta = manifest("Beta");
    const result = registerVersions({
      config: config([alpha, beta], "season-1"),
      known: [],
    });
    expect(result.violations).toEqual([]);
    expect(result.rows).toHaveLength(2);
    const byName = new Map(result.rows.map((r) => [r.competitor, r]));
    expect(byName.get("Alpha")?.version).toBe(alpha.version);
    expect(byName.get("Alpha")?.seasonId).toBe("season-1");
    expect(byName.get("Alpha")?.manifest).toEqual(alpha);
    expect(byName.get("Alpha")?.parentVersion).toBeUndefined();
    expect(byName.get("Beta")?.version).toBe(beta.version);
    expect(byName.get("Beta")?.parentVersion).toBeUndefined();
  });

  test("re-registering a version already in the lineage produces no row and no violation", () => {
    const alpha = manifest("Alpha");
    const result = registerVersions({
      config: config([alpha], "season-2"),
      known: [row(alpha, "season-1")],
    });
    expect(result.violations).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  test("re-registering an older, non-latest version in the lineage still produces no row", () => {
    const v1 = manifest("Alpha", { playstyle: "v1" });
    const v2 = manifest("Alpha", { playstyle: "v2" });
    const known = [row(v1, "season-1"), row(v2, "season-2", v1.version)];
    const result = registerVersions({
      config: config([v1], "season-3"),
      known,
    });
    expect(result.violations).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  test("registers a new version whose declared parent is in the name's lineage", () => {
    const v1 = manifest("Alpha", { playstyle: "v1" });
    const v2 = manifest("Alpha", { playstyle: "v2" });
    const result = registerVersions({
      config: config([v2], "season-2"),
      known: [row(v1, "season-1")],
      parents: { Alpha: v1.version },
      rationales: { Alpha: "learned to castle earlier" },
    });
    expect(result.violations).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.version).toBe(v2.version);
    expect(result.rows[0]?.parentVersion).toBe(v1.version);
    expect(result.rows[0]?.rationale).toBe("learned to castle earlier");
  });

  test("a new version with no declared parent is version-not-derived", () => {
    const v1 = manifest("Alpha", { playstyle: "v1" });
    const v2 = manifest("Alpha", { playstyle: "v2" });
    const result = registerVersions({
      config: config([v2], "season-2"),
      known: [row(v1, "season-1")],
    });
    expect(result.rows).toEqual([]);
    expect(result.violations).toEqual([
      { competitor: "Alpha", reason: "version-not-derived", detail: expect.any(String) },
    ]);
  });

  test("a declared parent outside the name's own lineage is version-not-derived", () => {
    const alphaV1 = manifest("Alpha", { playstyle: "v1" });
    const alphaV2 = manifest("Alpha", { playstyle: "v2" });
    const betaV1 = manifest("Beta", { playstyle: "beta-v1" });
    const result = registerVersions({
      config: config([alphaV2], "season-2"),
      known: [row(alphaV1, "season-1"), row(betaV1, "season-1")],
      parents: { Alpha: betaV1.version },
    });
    expect(result.rows).toEqual([]);
    expect(result.violations).toEqual([
      { competitor: "Alpha", reason: "version-not-derived", detail: expect.any(String) },
    ]);
  });

  test("two competitors sharing a name in one config is duplicate-in-season", () => {
    const first = manifest("Alpha", { playstyle: "a" });
    const second = manifest("Alpha", { playstyle: "b" });
    const result = registerVersions({
      config: config([first, second], "season-1"),
      known: [],
    });
    expect(result.rows).toEqual([]);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ competitor: "Alpha", reason: "duplicate-in-season" }),
    );
  });

  test.each([...RESERVED_NAMES])("rejects the reserved name %s case-insensitively", (reserved: string) => {
    const capitalized = `${(reserved[0] ?? "").toUpperCase()}${reserved.slice(1)}`;
    for (const candidate of [reserved, reserved.toUpperCase(), capitalized]) {
      const result = registerVersions({
        config: config([manifest(candidate)], "season-1"),
        known: [],
      });
      expect(result.rows).toEqual([]);
      expect(result.violations).toEqual([
        { competitor: candidate, reason: "reserved-name", detail: expect.any(String) },
      ]);
    }
  });

  test("a violation on one competitor empties rows for the whole registration", () => {
    const alpha = manifest("Alpha");
    const bye = manifest("bye");
    const result = registerVersions({
      config: config([alpha, bye], "season-1"),
      known: [],
    });
    expect(result.rows).toEqual([]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.competitor).toBe("bye");
    expect(result.violations[0]?.reason).toBe("reserved-name");
  });

  test("returns every violation found in one config", () => {
    const dup1 = manifest("Alpha", { playstyle: "a" });
    const dup2 = manifest("Alpha", { playstyle: "b" });
    const reserved = manifest("TBD");
    const result = registerVersions({
      config: config([dup1, dup2, reserved], "season-1"),
      known: [],
    });
    expect(result.rows).toEqual([]);
    expect(
      result.violations.some((v) => v.reason === "duplicate-in-season" && v.competitor === "Alpha"),
    ).toBe(true);
    expect(
      result.violations.some((v) => v.reason === "reserved-name" && v.competitor === "TBD"),
    ).toBe(true);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});

describe("lineageOf", () => {
  test("returns the version chain oldest first regardless of input order", () => {
    const v1 = manifest("Alpha", { playstyle: "v1" });
    const v2 = manifest("Alpha", { playstyle: "v2" });
    const v3 = manifest("Alpha", { playstyle: "v3" });
    const r1 = row(v1, "season-1");
    const r2 = row(v2, "season-2", v1.version);
    const r3 = row(v3, "season-3", v2.version);
    const lineage = lineageOf("Alpha", [r3, r1, r2]);
    expect(lineage.map((r) => r.version)).toEqual([v1.version, v2.version, v3.version]);
  });

  test("returns an empty list for an unknown competitor", () => {
    const v1 = manifest("Alpha");
    expect(lineageOf("Ghost", [row(v1, "season-1")])).toEqual([]);
  });

  test("throws on a cycle", () => {
    const v1 = manifest("Alpha", { playstyle: "v1" });
    const v2 = manifest("Alpha", { playstyle: "v2" });
    const r1 = row(v1, "season-1", v2.version);
    const r2 = row(v2, "season-1", v1.version);
    expect(() => lineageOf("Alpha", [r1, r2])).toThrow(ContractViolation);
  });

  test("throws when a row's parent version is missing from the input", () => {
    const v1 = manifest("Alpha", { playstyle: "v1" });
    const v2 = manifest("Alpha", { playstyle: "v2" });
    const orphan = row(v2, "season-1", v1.version);
    expect(() => lineageOf("Alpha", [orphan])).toThrow(ContractViolation);
  });

  test("ignores rows belonging to other competitors, even invalid ones", () => {
    const alphaV1 = manifest("Alpha", { playstyle: "v1" });
    const betaOrphan = row(manifest("Beta", { playstyle: "orphan" }), "season-1", "missing-parent-hash");
    const rows = [betaOrphan, row(alphaV1, "season-1")];
    expect(lineageOf("Alpha", rows)).toEqual([row(alphaV1, "season-1")]);
  });
});
