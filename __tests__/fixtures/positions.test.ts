import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { POSITIONS, positionFixture } from "./positions";

const turnCode = (turn: "white" | "black"): "w" | "b" =>
  turn === "white" ? "w" : "b";

describe("position fixtures", () => {
  for (const fixture of POSITIONS) {
    test(`${fixture.id} is a valid position with its declared turn and move count`, () => {
      expect(() => new Chess(fixture.fen)).not.toThrow();
      const chess = new Chess(fixture.fen);

      expect(chess.fen()).toBe(fixture.fen);
      expect(chess.turn()).toBe(turnCode(fixture.turn));
      expect(chess.moves({ verbose: true }).length).toBe(
        fixture.legalMoveCount,
      );
    });
  }

  test("start is the standard untouched initial position", () => {
    const chess = new Chess(positionFixture("start").fen);

    expect(chess.fen()).toBe(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    );
    expect(chess.history()).toEqual([]);
  });

  test("mate-in-one-white contains Qg7 checkmate", () => {
    const chess = new Chess(positionFixture("mate-in-one-white").fen);

    const move = chess.move({ from: "g6", to: "g7" });
    expect(move.san).toBe("Qg7#");
    expect(chess.isCheckmate()).toBe(true);
  });

  test("back-rank-mate contains Re8 checkmate", () => {
    const chess = new Chess(positionFixture("back-rank-mate").fen);

    const move = chess.move({ from: "e1", to: "e8" });
    expect(move.san).toBe("Re8#");
    expect(chess.isCheckmate()).toBe(true);
  });

  test("stalemate has no move without being checkmate", () => {
    const chess = new Chess(positionFixture("stalemate").fen);

    expect(chess.moves()).toEqual([]);
    expect(chess.isStalemate()).toBe(true);
    expect(chess.isCheckmate()).toBe(false);
  });

  test("insufficient-material has only two kings", () => {
    const chess = new Chess(positionFixture("insufficient-material").fen);

    expect(chess.isInsufficientMaterial()).toBe(true);
    expect(
      chess.board().flat().filter((piece) => piece !== null).length,
    ).toBe(2);
  });

  test("promotion-choice offers each promotion exactly once", () => {
    const chess = new Chess(positionFixture("promotion-choice").fen);
    const promotions = chess
      .moves({ verbose: true })
      .filter((move) => move.from === "a7" && move.to === "a8")
      .map((move) => move.promotion)
      .sort();

    expect(promotions).toEqual(["b", "n", "q", "r"]);
  });

  test("en-passant-available removes the pawn passed on d5", () => {
    const chess = new Chess(positionFixture("en-passant-available").fen);

    const move = chess.move({ from: "e5", to: "d6" });
    expect(move.san).toBe("exd6");
    expect(chess.get("d5")).toBeUndefined();
    expect(chess.get("d6")).toEqual({ color: "w", type: "p" });
  });

  test("castling-rights-lost offers neither castle", () => {
    const chess = new Chess(positionFixture("castling-rights-lost").fen);
    const kingMoves = chess
      .moves({ verbose: true })
      .filter((move) => move.from === "e1");

    expect(kingMoves.map((move) => move.san)).not.toContain("O-O");
    expect(kingMoves.map((move) => move.san)).not.toContain("O-O-O");
    expect(kingMoves.map((move) => move.to).sort()).toEqual([
      "d1",
      "d2",
      "e2",
      "f1",
      "f2",
    ]);
  });

  test("forced-recapture has Kxe2 as its only legal move", () => {
    const fixture = positionFixture("forced-recapture");
    const chess = new Chess(fixture.fen);
    const moves = chess.moves({ verbose: true });

    expect(fixture.lastMove).toBe("c2e2");
    expect(
      moves.map((move) => ({ from: move.from, san: move.san, to: move.to })),
    ).toEqual([{ from: "e1", san: "Kxe2", to: "e2" }]);
  });

  test("hanging-queen leaves the black queen undefended on e8", () => {
    const fixture = positionFixture("hanging-queen");
    const chess = new Chess(fixture.fen);

    expect(fixture.lastMove).toBe("e7e8");
    const move = chess.move({ from: "e1", to: "e8" });
    expect(move.captured).toBe("q");
    expect(move.san).toBe("Rxe8+");
    expect(chess.get("e8")).toEqual({ color: "w", type: "r" });
    expect(
      chess.moves({ verbose: true }).some((reply) => reply.to === "e8"),
    ).toBe(false);
  });

  test("opponent-threatens-mate permits Re1 mate after a quiet move", () => {
    const fixture = positionFixture("opponent-threatens-mate");
    const chess = new Chess(fixture.fen);

    expect(fixture.lastMove).toBe("e7e8");
    expect(chess.move({ from: "b1", to: "b2" }).san).toBe("Rb2");
    expect(chess.move({ from: "e8", to: "e1" }).san).toBe("Re1#");
    expect(chess.isCheckmate()).toBe(true);
  });

  test("endgame-kp has only a king, pawn, and king", () => {
    const chess = new Chess(positionFixture("endgame-kp").fen);

    expect(
      chess.board().flat().filter((piece) => piece !== null).length,
    ).toBe(3);
  });
});
