import { describe, expect, test } from "bun:test";
import { computeFeatures } from "../../src/core/features.ts";
import { positionFromFen } from "../../src/core/rules.ts";
import type { Fen } from "../../src/core/types.ts";
import { positionFixture } from "../fixtures/positions.ts";

// Position after 1.Nf3 Nf6: Black's last move is quiet and attacks no white piece.
const QUIET_POSITION: Fen = "rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 2 2";

describe("computeFeatures opponent context", () => {
  test("detects the opponent's new mate-in-one threat", () => {
    const fixture = positionFixture("opponent-threatens-mate");
    const features = computeFeatures(
      positionFromFen(fixture.fen, 2, ["Rb1", "Re8"]),
      fixture.lastMove,
    );

    expect(features.opponentMateInOne).toBe(true);
    expect(features.lastMoveThreatValue).toBeGreaterThan(0);
  });

  test("reports no mate or material threat after a quiet move", () => {
    const features = computeFeatures(
      positionFromFen(QUIET_POSITION, 2, ["Nf3", "Nf6"]),
      "g8f6",
    );

    expect(features.opponentMateInOne).toBe(false);
    expect(features.lastMoveThreatValue).toBe(0);
  });

  test("recognises a capture and counts every own piece attacked by the moved piece", () => {
    const fixture = positionFixture("forced-recapture");
    const features = computeFeatures(
      positionFromFen(fixture.fen, 2, ["Kh1", "Qxe2+"]),
      fixture.lastMove,
    );

    expect(features.lastMoveWasCapture).toBe(true);
    expect(features.lastMoveAttacks).toBe(1);
  });

  test("uses neutral last-move features when no last move is supplied", () => {
    const fixture = positionFixture("forced-recapture");
    const features = computeFeatures(positionFromFen(fixture.fen));

    expect(features.lastMoveWasCapture).toBe(false);
    expect(features.lastMoveAttacks).toBe(0);
  });
});
