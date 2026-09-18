import { describe, expect, test } from "bun:test";
import { computeDeclaredFeatures, computeFeatures } from "../../src/core/features.ts";
import { positionFromFen } from "../../src/core/rules.ts";
import { FEATURE_KEYS } from "../../src/core/types.ts";
import type { FeatureKey } from "../../src/core/types.ts";
import { positionFixture } from "../fixtures/positions.ts";

describe("computeDeclaredFeatures", () => {
  test("returns exactly the declared keys, in declared order, not the natural feature order", () => {
    const position = positionFromFen(positionFixture("start").fen);

    expect(Object.keys(computeDeclaredFeatures(position, ["phase", "mobility"]))).toEqual([
      "phase",
      "mobility",
    ]);
    expect(
      Object.keys(
        computeDeclaredFeatures(position, ["lastMoveWasCapture", "materialBalance", "kingSafety"]),
      ),
    ).toEqual(["lastMoveWasCapture", "materialBalance", "kingSafety"]);
    expect(Object.keys(computeDeclaredFeatures(position, ["inCheck"]))).toEqual(["inCheck"]);
  });

  test("collapses a duplicate declared key to a single entry at its first position", () => {
    const position = positionFromFen(positionFixture("start").fen);

    expect(Object.keys(computeDeclaredFeatures(position, ["mobility", "phase", "mobility"])))
      .toEqual(["mobility", "phase"]);
    expect(Object.keys(computeDeclaredFeatures(position, ["phase", "mobility", "phase"])))
      .toEqual(["phase", "mobility"]);
  });

  test("returns an empty object when nothing is declared", () => {
    const position = positionFromFen(positionFixture("start").fen);

    expect(computeDeclaredFeatures(position, [])).toEqual({});
  });

  test("matches computeFeatures for a spread of positions, ply values, and last moves", () => {
    const start = positionFromFen(positionFixture("start").fen);
    expect(computeDeclaredFeatures(start, FEATURE_KEYS)).toEqual(computeFeatures(start));

    const midgame = positionFromFen(positionFixture("castling-rights-lost").fen, 25);
    expect(computeDeclaredFeatures(midgame, FEATURE_KEYS)).toEqual(computeFeatures(midgame));

    const recaptureFixture = positionFixture("forced-recapture");
    const recapture = positionFromFen(recaptureFixture.fen, 2, ["Kh1", "Qxe2+"]);
    expect(
      computeDeclaredFeatures(recapture, FEATURE_KEYS, recaptureFixture.lastMove),
    ).toEqual(computeFeatures(recapture, recaptureFixture.lastMove));

    const mateThreatFixture = positionFixture("opponent-threatens-mate");
    const mateThreat = positionFromFen(mateThreatFixture.fen, 2, ["Rb1", "Re8"]);
    expect(
      computeDeclaredFeatures(mateThreat, FEATURE_KEYS, mateThreatFixture.lastMove),
    ).toEqual(computeFeatures(mateThreat, mateThreatFixture.lastMove));

    const endgame = positionFromFen(positionFixture("endgame-kp").fen, 65);
    expect(computeDeclaredFeatures(endgame, FEATURE_KEYS)).toEqual(computeFeatures(endgame));
  });

  test("a partial subset matches computeFeatures exactly for last-move and boolean features", () => {
    const fixture = positionFixture("opponent-threatens-mate");
    const position = positionFromFen(fixture.fen, 2, ["Rb1", "Re8"]);
    const expected = computeFeatures(position, fixture.lastMove);
    const declared: readonly FeatureKey[] = [
      "opponentMateInOne",
      "lastMoveThreatValue",
      "lastMoveWasCapture",
      "inCheck",
    ];

    expect(computeDeclaredFeatures(position, declared, fixture.lastMove)).toEqual({
      opponentMateInOne: expected.opponentMateInOne,
      lastMoveThreatValue: expected.lastMoveThreatValue,
      lastMoveWasCapture: expected.lastMoveWasCapture,
      inCheck: expected.inCheck,
    });
  });

  test("computes only the declared features, skipping the opponentMateInOne search when it is not declared", () => {
    // Timing test. opponentMateInOne is a 2-ply search measured at ~200ms per
    // position (see the doc comment on computeDeclaredFeatures), and it is
    // essentially the whole cost of feature computation. Running it enough
    // times to clear roughly a second keeps the ratio measurement stable
    // against scheduler jitter. The 5x margin below is deliberately generous:
    // the real gap between including that search and skipping it is close to
    // two orders of magnitude, so this only fails if the search still runs.
    const runs = 10;
    const position = positionFromFen(positionFixture("start").fen);

    const fullStart = performance.now();
    for (let i = 0; i < runs; i += 1) {
      computeDeclaredFeatures(position, FEATURE_KEYS);
    }
    const fullElapsed = performance.now() - fullStart;

    const cheapStart = performance.now();
    for (let i = 0; i < runs; i += 1) {
      computeDeclaredFeatures(position, ["mobility", "phase"]);
    }
    const cheapElapsed = performance.now() - cheapStart;

    expect(cheapElapsed * 5).toBeLessThan(fullElapsed);
  });
});
