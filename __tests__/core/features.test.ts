import { describe, expect, test } from "bun:test";
import { computeFeatures, filterFeatures } from "../../src/core/features.ts";
import { positionFromFen } from "../../src/core/rules.ts";
import type { FeatureSet, Fen } from "../../src/core/types.ts";
import {
  POSITIONS,
  positionFixture,
} from "../fixtures/positions.ts";
const COMPLETE_FEATURES: FeatureSet = {
  materialBalance: 100,
  mobility: 6,
  opponentMobility: 5,
  hangingOwnPieces: 0,
  hangingOpponentPieces: 1,
  kingSafety: 4,
  inCheck: false,
  opponentMateInOne: false,
  lastMoveAttacks: 1,
  lastMoveThreatValue: 900,
  lastMoveWasCapture: true,
  development: 2,
  phase: "endgame",
};


const MATERIAL_CASES: readonly {
  readonly piece: string;
  readonly fen: Fen;
  readonly value: number;
}[] = [
  { piece: "pawn", fen: "7k/8/8/8/4P3/8/8/7K w - - 0 1", value: 100 },
  { piece: "knight", fen: "7k/8/8/8/4N3/8/8/7K w - - 0 1", value: 320 },
  { piece: "bishop", fen: "7k/8/8/8/4B3/8/8/7K w - - 0 1", value: 330 },
  { piece: "rook", fen: "7k/8/8/8/4R3/8/8/7K w - - 0 1", value: 500 },
  { piece: "queen", fen: "7k/8/8/8/4Q3/8/8/7K w - - 0 1", value: 900 },
];

// White is castled behind an intact three-pawn shield.
const CASTLED_WHITE: Fen = "r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 3 5";
// White's king is exposed in the centre with no pawn shield.
const EXPOSED_WHITE: Fen = "7k/8/8/8/4K3/8/8/8 w - - 0 1";

describe("computeFeatures", () => {
  test("scores every non-king piece in centipawns from the side-to-move perspective", () => {
    for (const materialCase of MATERIAL_CASES) {
      const whiteToMove = computeFeatures(positionFromFen(materialCase.fen));
      const blackFen = materialCase.fen.replace(" w ", " b ");
      const blackToMove = computeFeatures(positionFromFen(blackFen));

      expect(whiteToMove.materialBalance).toBe(materialCase.value);
      expect(blackToMove.materialBalance).toBe(-materialCase.value);
    }
  });

  test("reports concrete material balances for shared positions", () => {
    const start = positionFixture("start");
    const endgame = positionFixture("endgame-kp");
    const hangingQueen = positionFixture("hanging-queen");

    expect(computeFeatures(positionFromFen(start.fen)).materialBalance).toBe(0);
    expect(computeFeatures(positionFromFen(endgame.fen)).materialBalance).toBe(100);
    expect(computeFeatures(positionFromFen(hangingQueen.fen)).materialBalance).toBe(-400);
  });

  test("matches every fixture's verified legal move count", () => {
    for (const fixture of POSITIONS) {
      const features = computeFeatures(positionFromFen(fixture.fen));

      expect(features.mobility).toBe(fixture.legalMoveCount);
    }
  });

  test("reports check only when the fixture places the moving king in check", () => {
    const checked = positionFixture("forced-recapture");
    const start = positionFixture("start");
    const stalemate = positionFixture("stalemate");

    expect(computeFeatures(positionFromFen(checked.fen)).inCheck).toBe(true);
    expect(computeFeatures(positionFromFen(start.fen)).inCheck).toBe(false);
    expect(computeFeatures(positionFromFen(stalemate.fen)).inCheck).toBe(false);
  });

  test("counts the undefended opponent queen as hanging", () => {
    const fixture = positionFixture("hanging-queen");
    const features = computeFeatures(positionFromFen(fixture.fen));

    expect(features.hangingOwnPieces).toBe(0);
    expect(features.hangingOpponentPieces).toBe(1);
  });

  test("rates a castled king behind its pawn shield safer than an exposed king", () => {
    const castled = computeFeatures(positionFromFen(CASTLED_WHITE));
    const exposed = computeFeatures(positionFromFen(EXPOSED_WHITE));

    expect(castled.kingSafety).toBeGreaterThan(exposed.kingSafety);
  });

  test("starts with no developed minor pieces", () => {
    const fixture = positionFixture("start");

    expect(computeFeatures(positionFromFen(fixture.fen)).development).toBe(0);
  });

  test("labels the initial position opening and a late king-and-pawn position endgame", () => {
    const start = positionFixture("start");
    const endgame = positionFixture("endgame-kp");

    expect(computeFeatures(positionFromFen(start.fen, 0)).phase).toBe("opening");
    expect(computeFeatures(positionFromFen(endgame.fen, 60)).phase).toBe("endgame");
  });
});

describe("filterFeatures", () => {
  test("returns exactly the declared feature subset", () => {
    const filtered = filterFeatures(COMPLETE_FEATURES, ["mobility", "phase"]);

    expect(filtered).toEqual({ mobility: 6, phase: "endgame" });
    expect(Object.keys(filtered)).toEqual(["mobility", "phase"]);
  });

  test("returns no features when the manifest declares none", () => {
    expect(filterFeatures(COMPLETE_FEATURES, [])).toEqual({});
  });
});
