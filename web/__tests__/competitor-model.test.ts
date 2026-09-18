import { describe, expect, test } from "bun:test";

import type {
  CalibrationBucket,
  CalibrationCurve,
  CompetitorManifest,
  CompetitorProfile,
  CompetitorVersionRow,
  LeaderboardRow,
  StrategyLabel,
  StrategyStats,
} from "../../src/core/types.ts";
import {
  calibrationPoints,
  lineageSteps,
  strategyMix,
} from "../src/competitor-model.ts";

const bucket = (overrides: Partial<CalibrationBucket>): CalibrationBucket => ({
  lower: 0,
  upper: 0.5,
  decisions: 0,
  meanConfidence: 0,
  meanScore: 0,
  ...overrides,
});

const curve = (buckets: readonly CalibrationBucket[]): CalibrationCurve => ({
  competitor: "hal",
  buckets,
  error: 0,
});

const manifest = (overrides: Partial<CompetitorManifest>): CompetitorManifest => ({
  name: "hal",
  model: "builtin-scripted",
  playstyle: "Play solid chess.",
  strategies: ["direct"],
  features: [],
  historyPlies: 0,
  fallback: "first-legal",
  budget: { maxMs: 25 },
  hierarchical: false,
  version: "v1",
  ...overrides,
});

const versionRow = (overrides: Partial<CompetitorVersionRow>): CompetitorVersionRow => ({
  competitor: "hal",
  version: "v1",
  seasonId: "season-1",
  manifest: manifest({}),
  traits: [],
  ...overrides,
});

const leaderboardRow: LeaderboardRow = {
  competitor: "hal",
  versions: ["v1"],
  games: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  score: 0,
  elo: 1000,
  meanConfidence: 0,
  calibrationError: 0,
  fallbackRate: 0,
  meanLatencyMs: 0,
  costUsd: 0,
};

const profile = (
  mix: { readonly [key in StrategyLabel]?: StrategyStats },
): CompetitorProfile => ({
  competitor: "hal",
  row: leaderboardRow,
  lineage: [],
  strategyMix: mix,
  calibration: curve([]),
  rivals: [],
});

describe("calibration points", () => {
  test("drops buckets with no decisions in them", () => {
    const points = calibrationPoints(
      curve([
        bucket({ lower: 0, upper: 0.5, decisions: 0 }),
        bucket({ lower: 0.5, upper: 1, decisions: 4, meanConfidence: 0.7, meanScore: 0.6 }),
      ]),
    );

    expect(points).toHaveLength(1);
    expect(points[0]?.decisions).toBe(4);
  });

  test("plots the bucket midpoint as stated and the mean score as actual", () => {
    const points = calibrationPoints(
      curve([bucket({ lower: 0, upper: 0.5, decisions: 5, meanConfidence: 0.1, meanScore: 0.9 })]),
    );

    expect(points[0]?.stated).toBeCloseTo(0.25);
    expect(points[0]?.actual).toBe(0.9);
  });

  test("a perfectly calibrated curve lands its points on the diagonal", () => {
    const points = calibrationPoints(
      curve([
        bucket({ lower: 0.6, upper: 0.8, decisions: 10, meanConfidence: 0.7, meanScore: 0.7 }),
      ]),
    );

    expect(points[0]?.actual).toBeCloseTo(points[0]?.stated ?? Number.NaN);
  });

  test("carries the bucket's decision count through for point weighting", () => {
    const points = calibrationPoints(
      curve([
        bucket({ lower: 0, upper: 0.5, decisions: 3, meanScore: 0.2 }),
        bucket({ lower: 0.5, upper: 1, decisions: 17, meanScore: 0.8 }),
      ]),
    );

    expect(points.map((point) => point.decisions)).toEqual([3, 17]);
  });
});

describe("lineage steps", () => {
  test("orders steps oldest first and reads the first version as the original entry", () => {
    const v1 = versionRow({
      version: "v1",
      manifest: manifest({ version: "v1", strategies: ["direct"], playstyle: "A" }),
    });
    const v2 = versionRow({
      version: "v2",
      parentVersion: "v1",
      manifest: manifest({ version: "v2", strategies: ["direct", "attack"], playstyle: "A" }),
    });
    const v3 = versionRow({
      version: "v3",
      parentVersion: "v2",
      manifest: manifest({ version: "v3", strategies: ["attack"], playstyle: "B" }),
    });

    const steps = lineageSteps([v1, v2, v3]);

    expect(steps.map((step) => step.version)).toEqual(["v1", "v2", "v3"]);
    expect(steps[0]?.added).toEqual([]);
    expect(steps[0]?.removed).toEqual([]);
    expect(steps[0]?.playstyleChanged).toBe(false);
    expect(steps[1]?.added).toEqual(["attack"]);
    expect(steps[1]?.removed).toEqual([]);
    expect(steps[2]?.removed).toEqual(["direct"]);
  });

  test("carries the row's rationale when present and omits it otherwise", () => {
    const withRationale = versionRow({ version: "v1", rationale: "Started the season." });
    const withoutRationale = versionRow({ version: "v1" });

    expect(lineageSteps([withRationale])[0]?.rationale).toBe("Started the season.");
    expect(lineageSteps([withoutRationale])[0]?.rationale).toBeUndefined();
  });

  test("a version that only changed playstyle reports no strategy churn", () => {
    const v1 = versionRow({
      version: "v1",
      manifest: manifest({ version: "v1", strategies: ["direct", "attack"], playstyle: "A" }),
    });
    const v2 = versionRow({
      version: "v2",
      parentVersion: "v1",
      manifest: manifest({ version: "v2", strategies: ["attack", "direct"], playstyle: "B" }),
    });

    const steps = lineageSteps([v1, v2]);

    expect(steps[1]?.added).toEqual([]);
    expect(steps[1]?.removed).toEqual([]);
    expect(steps[1]?.playstyleChanged).toBe(true);
  });

  test("a version that only changed strategies reports playstyleChanged false", () => {
    const v1 = versionRow({
      version: "v1",
      manifest: manifest({ version: "v1", strategies: ["direct"], playstyle: "A" }),
    });
    const v2 = versionRow({
      version: "v2",
      parentVersion: "v1",
      manifest: manifest({ version: "v2", strategies: ["direct", "endgame"], playstyle: "A" }),
    });

    const steps = lineageSteps([v1, v2]);

    expect(steps[1]?.playstyleChanged).toBe(false);
    expect(steps[1]?.added).toEqual(["endgame"]);
  });
});

describe("strategy mix", () => {
  test("gives shares summing to 1, most picked first", () => {
    const mix = strategyMix(
      profile({
        direct: { picks: 6, score: 3, avgConfidence: 0.5 },
        attack: { picks: 2, score: 1, avgConfidence: 0.5 },
        defend: { picks: 2, score: 1, avgConfidence: 0.5 },
      }),
    );

    const total = mix.reduce((sum, entry) => sum + entry.share, 0);
    expect(total).toBeCloseTo(1);
    expect(mix[0]?.strategy).toBe("direct");
    expect(mix[0]?.share).toBeCloseTo(0.6);
  });

  test("an empty mix gives an empty list rather than NaN shares", () => {
    const mix = strategyMix(profile({}));

    expect(mix).toEqual([]);
  });
});
