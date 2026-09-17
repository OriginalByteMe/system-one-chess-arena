import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { ContractViolation } from "../../src/core/errors";
import {
  applyMove,
  initialPosition,
  isLegal,
  legalMoves,
  positionFromFen,
  positionFromOpening,
  toPgn,
  toSan,
} from "../../src/core/rules";
import type { Position } from "../../src/core/rules";
import type { Opening } from "../../src/core/types";
import {
  POSITIONS,
  positionFixture,
} from "../fixtures/positions";
import type { PositionFixtureId } from "../fixtures/positions";

const INITIAL_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const START_POSITION: Position = {
  fen: INITIAL_FEN,
  history: [],
  ply: 0,
  turn: "white",
};

function fixturePosition(id: PositionFixtureId): Position {
  const fixture = positionFixture(id);
  return {
    fen: fixture.fen,
    history: [],
    ply: 0,
    turn: fixture.turn,
  };
}

function oracleMoves(fen: string): readonly string[] {
  return new Chess(fen)
    .moves({ verbose: true })
    .map((move) => `${move.from}${move.to}${move.promotion ?? ""}`)
    .sort();
}

describe("chess rules", () => {
  test("initialPosition returns the standard untouched board", () => {
    expect(initialPosition()).toEqual({
      fen: INITIAL_FEN,
      history: [],
      ply: 0,
      turn: "white",
    });
  });

  test("positionFromFen round-trips FEN, ply, history, and active colour", () => {
    const fen = "4k3/8/8/8/8/8/4P3/4K3 b - - 7 12";

    expect(positionFromFen(fen, 23, ["e4", "e5", "Ke2"])).toEqual({
      fen,
      history: ["e4", "e5", "Ke2"],
      ply: 23,
      turn: "black",
    });
  });

  for (const fixture of POSITIONS) {
    test(`legalMoves matches chess.js for ${fixture.id}`, () => {
      expect([...legalMoves(fixturePosition(fixture.id))].sort()).toEqual(
        [...oracleMoves(fixture.fen)].sort(),
      );
    });
  }

  test("legalMoves formats each promotion with a lowercase UCI suffix", () => {
    const promotionMoves = legalMoves(fixturePosition("promotion-choice"))
      .filter((move) => move.startsWith("a7a8"))
      .slice()
      .sort();

    expect(promotionMoves).toEqual(["a7a8b", "a7a8n", "a7a8q", "a7a8r"]);
  });

  test("isLegal accepts a legal UCI move", () => {
    expect(isLegal(START_POSITION, "e2e4")).toBe(true);
  });

  test("isLegal rejects an illegal UCI move", () => {
    expect(isLegal(START_POSITION, "e2e5")).toBe(false);
  });

  test("applyMove advances FEN, ply, turn, and SAN history", () => {
    expect(applyMove(START_POSITION, "e2e4")).toEqual({
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      history: ["e4"],
      ply: 1,
      turn: "black",
    });
  });

  test("applyMove rejects a well-formed but illegal move", () => {
    expect(() => applyMove(START_POSITION, "e2e5")).toThrow(
      ContractViolation,
    );
  });

  test("applyMove rejects malformed move notation", () => {
    expect(() => applyMove(START_POSITION, "not-a-move")).toThrow(
      ContractViolation,
    );
  });

  test("toSan renders a forced king recapture", () => {
    expect(toSan(fixturePosition("forced-recapture"), "e1e2")).toBe("Kxe2");
  });

  test("positionFromOpening reaches the opening's declared position", () => {
    const opening: Opening = {
      id: "king-pawn-knight",
      name: "King Pawn Game",
      moves: ["e4", "e5", "Nf3"],
      fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
    };

    expect(positionFromOpening(opening)).toEqual({
      fen: opening.fen,
      history: ["e4", "e5", "Nf3"],
      ply: 3,
      turn: "black",
    });
  });

  test("toPgn preserves played SAN moves in order", () => {
    const position: Position = {
      fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
      history: ["e4", "e5", "Nf3", "Nc6"],
      ply: 4,
      turn: "white",
    };

    expect(toPgn(position)).toContain("1. e4 e5 2. Nf3 Nc6");
  });
});
