import { describe, expect, test } from "bun:test";
import { legalMoves, terminalState } from "../../src/core/rules";
import type { Position } from "../../src/core/rules";
import { positionFixture } from "../fixtures/positions";
import type { PositionFixtureId } from "../fixtures/positions";

const INITIAL_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const CHECKMATE_POSITION: Position = {
  fen: "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
  history: ["f3", "e5", "g4", "Qh4#"],
  ply: 4,
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

describe("terminalState", () => {
  test("returns undefined while play can continue", () => {
    const position: Position = {
      fen: INITIAL_FEN,
      history: [],
      ply: 0,
      turn: "white",
    };

    expect(terminalState(position, 200)).toBeUndefined();
  });

  test("awards checkmate to the colour opposite the side to move", () => {
    expect(terminalState(CHECKMATE_POSITION, 200)).toEqual({
      reason: "checkmate",
      result: "black",
    });
  });

  test("recognises stalemate as a draw", () => {
    expect(terminalState(fixturePosition("stalemate"), 200)).toEqual({
      reason: "stalemate",
      result: "draw",
    });
  });

  test("recognises insufficient mating material as a draw", () => {
    expect(
      terminalState(fixturePosition("insufficient-material"), 200),
    ).toEqual({
      reason: "insufficient-material",
      result: "draw",
    });
  });

  test("ends a live position exactly at the configured move limit", () => {
    const position: Position = {
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 41",
      history: [],
      ply: 80,
      turn: "white",
    };

    expect(terminalState(position, 80)).toEqual({
      reason: "move-limit",
      result: "draw",
    });
  });

  test("recognises a position repeated three times", () => {
    const position: Position = {
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 8 5",
      history: [
        "Nf3",
        "Nf6",
        "Ng1",
        "Ng8",
        "Nf3",
        "Nf6",
        "Ng1",
        "Ng8",
      ],
      ply: 8,
      turn: "white",
    };

    expect(terminalState(position, 200)).toEqual({
      reason: "threefold",
      result: "draw",
    });
  });

  test("recognises the fifty-move rule from the FEN halfmove clock", () => {
    const position: Position = {
      fen: "4k3/8/8/8/8/8/8/R3K3 w - - 100 51",
      history: [],
      ply: 100,
      turn: "white",
    };

    expect(terminalState(position, 200)).toEqual({
      reason: "fifty-move",
      result: "draw",
    });
  });

  test("a checkmated position has no legal continuation", () => {
    expect(terminalState(CHECKMATE_POSITION, 200)).toEqual({
      reason: "checkmate",
      result: "black",
    });
    expect(legalMoves(CHECKMATE_POSITION)).toEqual([]);
  });
});
