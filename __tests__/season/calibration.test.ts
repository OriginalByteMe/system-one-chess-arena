import { describe, expect, test } from "bun:test";
import type { CalibrationBucket, CalibrationCurve } from "../../src/core/types.ts";
import {
  CALIBRATION_BUCKETS,
  brierScore,
  calibrationCurve,
} from "../../src/season/calibration.ts";
import { competitorRef, decision, game } from "../fixtures/leaderboard.ts";

function bucketAt(curve: CalibrationCurve, index: number): CalibrationBucket {
  const bucket = curve.buckets[index];
  if (bucket === undefined) {
    throw new Error(`missing bucket at index ${index}`);
  }
  return bucket;
}

describe("calibrationCurve", () => {
  test("always returns ten buckets matching the fixed boundaries, even with nothing to plot", () => {
    const curve = calibrationCurve("Nova", [], []);

    expect(curve.buckets).toHaveLength(10);
    curve.buckets.forEach((bucket, index) => {
      const [lower, upper] = CALIBRATION_BUCKETS[index] ?? [0, 0];
      expect(bucket.lower).toBe(lower);
      expect(bucket.upper).toBe(upper);
      expect(bucket.decisions).toBe(0);
    });
  });

  test("scores a decision by the game outcome of the side that made it, for either colour", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [
      game("g1", nova, rival, "white"),
      game("g2", rival, nova, "white"),
    ];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 0.95, ply: 1 }),
      decision({ gameId: "g2", competitor: "Nova", version: "v1", colour: "black", confidence: 0.95, ply: 1 }),
    ];

    const curve = calibrationCurve("Nova", decisions, games);
    const bucket = bucketAt(curve, 9);

    expect(bucket.decisions).toBe(2);
    expect(bucket.meanScore).toBeCloseTo(0.5, 6);
  });

  test("excludes decisions with no stated confidence", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "white")];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 0.85, ply: 1 }),
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", ply: 2 }),
    ];

    const curve = calibrationCurve("Nova", decisions, games);
    const totalDecisions = curve.buckets.reduce((sum, bucket) => sum + bucket.decisions, 0);

    expect(totalDecisions).toBe(1);
  });

  test("excludes a decision whose game was never revealed", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "white")];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 0.5, ply: 1 }),
      decision({
        gameId: "hidden-game",
        competitor: "Nova",
        version: "v1",
        colour: "white",
        confidence: 0.99,
        ply: 1,
      }),
    ];

    const curve = calibrationCurve("Nova", decisions, games);
    const totalDecisions = curve.buckets.reduce((sum, bucket) => sum + bucket.decisions, 0);

    expect(totalDecisions).toBe(1);
    expect(bucketAt(curve, 9).decisions).toBe(0);
  });

  test("places a confidence of exactly 1.0 in the last bucket and 0 in the first", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "draw")];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 1.0, ply: 1 }),
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 0, ply: 2 }),
    ];

    const curve = calibrationCurve("Nova", decisions, games);

    expect(bucketAt(curve, 9).decisions).toBe(1);
    expect(bucketAt(curve, 0).decisions).toBe(1);
  });

  test("places a confidence sitting exactly on a bucket boundary into the higher bucket", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "draw")];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 0.3, ply: 1 }),
    ];

    const curve = calibrationCurve("Nova", decisions, games);

    expect(bucketAt(curve, 3).decisions).toBe(1);
    expect(bucketAt(curve, 2).decisions).toBe(0);
  });

  test("computes meanConfidence and meanScore within a bucket", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [
      game("g1", nova, rival, "white"),
      game("g2", nova, rival, "draw"),
    ];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 0.62, ply: 1 }),
      decision({ gameId: "g2", competitor: "Nova", version: "v1", colour: "white", confidence: 0.68, ply: 1 }),
    ];

    const curve = calibrationCurve("Nova", decisions, games);
    const bucket = bucketAt(curve, 6);

    expect(bucket.decisions).toBe(2);
    expect(bucket.meanConfidence).toBeCloseTo(0.65, 6);
    expect(bucket.meanScore).toBeCloseTo(0.75, 6);
  });

  test("scores zero for a perfectly calibrated set", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [
      game("g1", nova, rival, "white"),
      game("g2", nova, rival, "white"),
    ];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 1, ply: 1 }),
      decision({ gameId: "g2", competitor: "Nova", version: "v1", colour: "white", confidence: 1, ply: 1 }),
    ];

    expect(calibrationCurve("Nova", decisions, games).error).toBe(0);
  });

  test("scores one for a set that is always confident and always wrong", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [
      game("g1", rival, nova, "white"),
      game("g2", rival, nova, "white"),
    ];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "black", confidence: 1, ply: 1 }),
      decision({ gameId: "g2", competitor: "Nova", version: "v1", colour: "black", confidence: 1, ply: 1 }),
    ];

    expect(calibrationCurve("Nova", decisions, games).error).toBe(1);
  });

  test("scores zero when there is nothing to score", () => {
    expect(calibrationCurve("Nova", [], []).error).toBe(0);
  });

  test("counts only the named competitor's decisions", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "white")];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 0.5, ply: 1 }),
      decision({ gameId: "g1", competitor: "Rival", version: "v1", colour: "black", confidence: 0.5, ply: 1 }),
    ];

    const curve = calibrationCurve("Nova", decisions, games);
    const totalDecisions = curve.buckets.reduce((sum, bucket) => sum + bucket.decisions, 0);

    expect(totalDecisions).toBe(1);
  });
});

describe("brierScore", () => {
  test("is the mean squared difference between confidence and outcome", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [
      game("g1", nova, rival, "white"),
      game("g2", rival, nova, "white"),
    ];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 0.9, ply: 1 }),
      decision({ gameId: "g2", competitor: "Nova", version: "v1", colour: "black", confidence: 0.2, ply: 1 }),
    ];

    const expected = ((0.9 - 1) ** 2 + (0.2 - 0) ** 2) / 2;

    expect(brierScore(decisions, games)).toBeCloseTo(expected, 10);
  });

  test("is zero for an empty set of decisions", () => {
    expect(brierScore([], [])).toBe(0);
  });

  test("excludes decisions with no stated confidence", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "white")];
    const withConfidence = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 1, ply: 1 }),
    ];
    const withUnconfidentAdded = [
      ...withConfidence,
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", ply: 2 }),
    ];

    expect(brierScore(withUnconfidentAdded, games)).toBeCloseTo(brierScore(withConfidence, games), 10);
  });

  test("excludes a decision whose game was never revealed", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "white")];
    const revealedOnly = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 1, ply: 1 }),
    ];
    const withSpoiler = [
      ...revealedOnly,
      decision({
        gameId: "hidden-game",
        competitor: "Nova",
        version: "v1",
        colour: "white",
        confidence: 0,
        ply: 1,
      }),
    ];

    expect(brierScore(withSpoiler, games)).toBeCloseTo(brierScore(revealedOnly, games), 10);
  });
});
