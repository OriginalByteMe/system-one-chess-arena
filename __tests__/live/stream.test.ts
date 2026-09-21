import { describe, expect, test } from "bun:test";
import {
  applyEvent,
  initialSpectatorState,
  resubscribeCursor,
} from "../../src/live/stream.ts";
import type {
  DecisionRecord,
  Fen,
  MoveEvent,
  ResultEvent,
  SpectatorState,
  StrategyLabel,
} from "../../src/core/types.ts";

const START_FEN: Fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FEN_AFTER_E4: Fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const FEN_AFTER_E4_E5: Fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
const FEN_AFTER_E4_E5_NF3: Fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2";

/** The audit row a live move carries, so a spectator sees the whole decision. */
function decisionFor(
  ply: number,
  competitor: string,
  version: string,
  move: string,
  fen: Fen,
  strategy: StrategyLabel,
  latencyMs: number,
): DecisionRecord {
  return {
    seasonId: "season-live",
    gameId: "game-live-1",
    ply: ply - 1,
    competitor,
    version,
    colour: ply % 2 === 1 ? "white" : "black",
    fen,
    legalMoveCount: 20,
    move,
    strategy,
    latencyMs,
    featuresSeen: [],
    idempotencyKey: `game-live-1:${ply - 1}:${version}`,
  };
}

const DECISION_ONE = decisionFor(1, "white-player", "white-v1", "e2e4", START_FEN, "develop", 41);
const DECISION_TWO = decisionFor(2, "black-player", "black-v1", "e7e5", FEN_AFTER_E4, "direct", 36);
const DECISION_THREE = decisionFor(
  3,
  "white-player",
  "white-v1",
  "g1f3",
  FEN_AFTER_E4_E5,
  "develop",
  29,
);

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
  decision: DECISION_ONE,
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
  decision: DECISION_TWO,
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
  decision: DECISION_THREE,
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
    decisions: [DECISION_ONE],
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
      decisions: [],
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
      decisions: [DECISION_ONE],
    });
    expect(afterTwo).toEqual({
      gameId: "game-live-1",
      fen: FEN_AFTER_E4_E5,
      cursor: 2,
      lastMove: MOVE_TWO,
      decisions: [DECISION_ONE, DECISION_TWO],
    });
  });

  test("a game that starts from an opening applies its first move at that ply", () => {
    const fresh = initialSpectatorState("game-live-1", START_FEN);
    const openingMove: MoveEvent = { ...MOVE_ONE, ply: 6 };

    const afterOpeningMove = applyEvent(fresh, openingMove);

    expect(afterOpeningMove).toEqual({
      gameId: "game-live-1",
      fen: FEN_AFTER_E4,
      cursor: 6,
      lastMove: openingMove,
      decisions: [DECISION_ONE],
    });
    expect(applyEvent(afterOpeningMove, { ...MOVE_THREE, ply: 8 })).toEqual(
      afterOpeningMove,
    );
    expect(applyEvent(afterOpeningMove, { ...MOVE_TWO, ply: 7 }).cursor).toBe(7);
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
      decisions: [DECISION_ONE, DECISION_TWO, DECISION_THREE],
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
      decisions: [DECISION_ONE, DECISION_TWO],
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
