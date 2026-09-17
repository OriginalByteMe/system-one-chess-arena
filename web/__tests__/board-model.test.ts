import { describe, expect, test } from "bun:test";

import { ContractViolation } from "../../src/core/errors.ts";
import {
  buildBoard,
  mapFen,
  squaresFor,
} from "../src/board-model.ts";

const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("spectator board model", () => {
  test("orders all 64 squares from the selected player's perspective", () => {
    const white = squaresFor("white");
    const black = squaresFor("black");

    expect(white).toHaveLength(64);
    expect(white.slice(0, 8)).toEqual(["a8", "b8", "c8", "d8", "e8", "f8", "g8", "h8"]);
    expect(white.slice(-8)).toEqual(["a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1"]);
    expect(black.slice(0, 8)).toEqual(["h1", "g1", "f1", "e1", "d1", "c1", "b1", "a1"]);
    expect(black.slice(-8)).toEqual(["h8", "g8", "f8", "e8", "d8", "c8", "b8", "a8"]);
  });

  test("maps FEN pieces to algebraic squares", () => {
    const pieces = mapFen("8/8/3k4/8/4P3/8/8/4K3 w - - 0 1");

    expect(pieces.get("d6")).toEqual({ colour: "black", role: "king" });
    expect(pieces.get("e4")).toEqual({ colour: "white", role: "pawn" });
    expect(pieces.get("e1")).toEqual({ colour: "white", role: "king" });
    expect(pieces.get("a8")).toBeUndefined();
  });

  test("marks both endpoints of the last UCI move", () => {
    const board = buildBoard(START_FEN, "white", "e2e4");
    const highlighted = board.filter((cell) => cell.isLastMove).map((cell) => cell.square);

    expect(highlighted).toEqual(["e4", "e2"]);
  });

  test("rejects invalid FEN at the pure boundary", () => {
    expect(() => mapFen("not-a-fen")).toThrow(
      new ContractViolation("web/board-model.mapFen", "invalid FEN: not-a-fen"),
    );
  });
});
