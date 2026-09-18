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

  describe("adjudication on final material", () => {
    // Measured 2026-09-18: six of six recorded games drew by repetition or
    // move limit, so a league that honours those draws can never separate
    // anyone. A game with no progress is decided on material instead, with a
    // band wide enough that a pawn is not a win.
    function noProgress(fen: string): Position {
      return { fen, history: [], ply: 100, turn: "white" };
    }

    test("a move-limit game is awarded to whoever is ahead on material", () => {
      expect(terminalState(noProgress("4k3/8/8/8/8/8/8/R3K3 w - - 0 51"), 100)).toEqual({
        reason: "move-limit",
        result: "white",
        adjudicatedCp: 500,
      });

      expect(terminalState(noProgress("4k3/pp6/8/8/8/8/8/4K3 w - - 0 51"), 100)).toEqual({
        reason: "move-limit",
        result: "black",
        adjudicatedCp: -200,
      });
    });

    test("a repetition is adjudicated on the same rule", () => {
      // Repetition is only detected by replaying the history from the opening
      // position, so the fixture has to be a real line: black takes the e4
      // pawn with a knight and loses the knight for it, then both sides
      // shuffle until the position repeats. Net 320 minus 100 to white.
      const position: Position = {
        fen: "rnbqkb1r/pppppppp/8/8/4N3/8/PPPP1PPP/R1BQKBNR b KQkq - 8 7",
        history: [
          "e4", "Nf6", "Nc3", "Ne4", "Nxe4", "Nc6", "Ng3",
          "Nb8", "Ne4", "Nc6", "Ng3", "Nb8", "Ne4",
        ],
        ply: 13,
        turn: "black",
      };

      expect(terminalState(position, 200)).toEqual({
        reason: "threefold",
        result: "white",
        adjudicatedCp: 220,
      });
    });

    test("inside the draw band the game stays a draw and says nothing about material", () => {
      const drawn = terminalState(noProgress("4k3/pp6/8/8/8/8/8/4KB2 w - - 0 51"), 100);

      expect(drawn).toEqual({ reason: "move-limit", result: "draw" });
      expect(Object.hasOwn(drawn ?? {}, "adjudicatedCp")).toBe(false);
    });

    test("just outside the band is decisive", () => {
      expect(terminalState(noProgress("4k3/p7/8/8/8/8/8/4KN2 w - - 0 51"), 100)).toEqual({
        reason: "move-limit",
        result: "white",
        adjudicatedCp: 220,
      });
    });

    test("a real ending is never adjudicated", () => {
      for (const position of [
        CHECKMATE_POSITION,
        fixturePosition("stalemate"),
        fixturePosition("insufficient-material"),
        noProgress("4k3/8/8/8/8/8/8/R3K3 w - - 100 51"),
      ]) {
        const state = terminalState(position, 200);

        expect(state).toBeDefined();
        expect(Object.hasOwn(state ?? {}, "adjudicatedCp")).toBe(false);
      }
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
