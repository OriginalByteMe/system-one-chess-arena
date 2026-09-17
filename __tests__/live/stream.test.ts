import { describe, expect, test } from "bun:test";
import {
  applyEvent,
  initialSpectatorState,
  resubscribeCursor,
} from "../../src/live/stream.ts";
import type {
  Fen,
  MoveEvent,
  ResultEvent,
  SpectatorState,
} from "../../src/core/types.ts";

const START_FEN: Fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FEN_AFTER_E4: Fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const FEN_AFTER_E4_E5: Fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
const FEN_AFTER_E4_E5_NF3: Fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2";

const MOVE_ONE: MoveEvent = {
  type: "move",
  gameId: "game-live-1",
  ply: 1,
  move: "e2e4",
  fen: FEN_AFTER_E4,
  competitor: { name: "white-player", version: "white-v1" },
  strategy: "develop",
  confidence: 0.82,
  latencyMs: 41,
};

const MOVE_TWO: MoveEvent = {
  type: "move",
  gameId: "game-live-1",
  ply: 2,
  move: "e7e5",
  fen: FEN_AFTER_E4_E5,
  competitor: { name: "black-player", version: "black-v1" },
  strategy: "direct",
  confidence: 0.77,
  latencyMs: 36,
};

const MOVE_THREE: MoveEvent = {
  type: "move",
  gameId: "game-live-1",
  ply: 3,
  move: "g1f3",
  fen: FEN_AFTER_E4_E5_NF3,
  competitor: { name: "white-player", version: "white-v1" },
  strategy: "develop",
  latencyMs: 29,
};

const RESULT: ResultEvent = {
  type: "result",
  gameId: "game-live-1",
  ply: 2,
  result: "draw",
  reason: "threefold",
};

function stateAfterFirstMove(): SpectatorState {
  return {
    gameId: "game-live-1",
    fen: FEN_AFTER_E4,
    cursor: 1,
    lastMove: MOVE_ONE,
  };
}

function deepFreezeState(state: SpectatorState): SpectatorState {
  if (state.lastMove !== undefined) {
    Object.freeze(state.lastMove.competitor);
    Object.freeze(state.lastMove);
  }
  if (state.finished !== undefined) {
    Object.freeze(state.finished);
  }
  return Object.freeze(state);
}

describe("live spectator stream", () => {
  test("initial state starts at cursor zero without a last move", () => {
    expect(initialSpectatorState("game-live-1", START_FEN)).toEqual({
      gameId: "game-live-1",
      fen: START_FEN,
      cursor: 0,
    });
  });

  test("consecutive moves advance the cursor, FEN, and last move", () => {
    const afterOne = applyEvent(
      initialSpectatorState("game-live-1", START_FEN),
      MOVE_ONE,
    );
    const afterTwo = applyEvent(afterOne, MOVE_TWO);

    expect(afterOne).toEqual({
      gameId: "game-live-1",
      fen: FEN_AFTER_E4,
      cursor: 1,
      lastMove: MOVE_ONE,
    });
    expect(afterTwo).toEqual({
      gameId: "game-live-1",
      fen: FEN_AFTER_E4_E5,
      cursor: 2,
      lastMove: MOVE_TWO,
    });
  });

  test("a duplicate ply is ignored without changing state", () => {
    const state = stateAfterFirstMove();

    expect(applyEvent(state, MOVE_ONE)).toEqual(state);
  });

  test("an out-of-order move is ignored until its gap has been filled", () => {
    const afterOne = stateAfterFirstMove();
    const ignoredThree = applyEvent(afterOne, MOVE_THREE);

    expect(ignoredThree).toEqual(afterOne);
    expect(ignoredThree.cursor).toBe(1);
    expect(ignoredThree.fen).toBe(FEN_AFTER_E4);

    const afterTwo = applyEvent(ignoredThree, MOVE_TWO);
    const afterThree = applyEvent(afterTwo, MOVE_THREE);

    expect(afterTwo.cursor).toBe(2);
    expect(afterTwo.fen).toBe(FEN_AFTER_E4_E5);
    expect(afterThree).toEqual({
      gameId: "game-live-1",
      fen: FEN_AFTER_E4_E5_NF3,
      cursor: 3,
      lastMove: MOVE_THREE,
    });
  });

  test("a result finishes the stream and all later moves are ignored", () => {
    const afterTwo = applyEvent(stateAfterFirstMove(), MOVE_TWO);
    const finished = applyEvent(afterTwo, RESULT);

    expect(finished).toEqual({
      gameId: "game-live-1",
      fen: FEN_AFTER_E4_E5,
      cursor: 2,
      lastMove: MOVE_TWO,
      finished: RESULT,
    });
    expect(applyEvent(finished, MOVE_THREE)).toEqual(finished);
  });

  test("the resubscribe cursor is the highest contiguous applied ply", () => {
    const afterOne = stateAfterFirstMove();
    const ignoredThree = applyEvent(afterOne, MOVE_THREE);
    const afterTwo = applyEvent(ignoredThree, MOVE_TWO);
    const afterThree = applyEvent(afterTwo, MOVE_THREE);

    expect(resubscribeCursor(afterOne)).toBe(1);
    expect(resubscribeCursor(ignoredThree)).toBe(1);
    expect(resubscribeCursor(afterTwo)).toBe(2);
    expect(resubscribeCursor(afterThree)).toBe(3);
  });

  test("applying an event never mutates the deeply frozen input state", () => {
    const state = deepFreezeState(stateAfterFirstMove());
    const expectedInput = stateAfterFirstMove();
    const next = applyEvent(state, MOVE_TWO);

    expect(state).toEqual(expectedInput);
    expect(next).not.toBe(state);
    expect(next.cursor).toBe(2);
    expect(next.lastMove).toEqual(MOVE_TWO);
  });
});
