import { describe, expect, test } from "bun:test";

import type { DecisionRecord, RevealedGame } from "../../src/core/types.ts";
import { OPENINGS } from "../../src/season/openings.ts";
import {
  NO_GUESSES,
  probabilityBars,
  replayDecisions,
  replayOpening,
  recordGuess,
  scrub,
  settleGuess,
} from "../src/watch-model.ts";
import type { GuessState } from "../src/watch-model.ts";

const OPENING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const ITALIAN = OPENINGS.find((opening) => opening.id === "italian-game");
if (ITALIAN === undefined) throw new Error("Italian Game opening fixture is missing");

function buildDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    seasonId: "season-1",
    gameId: "game-1",
    ply: 1,
    competitor: "calculated-risk",
    version: "v1",
    colour: "white",
    fen: OPENING_FEN,
    legalMoveCount: 20,
    move: "e2e4",
    strategy: "direct",
    latencyMs: 100,
    featuresSeen: [],
    idempotencyKey: "game-1:1:v1",
    ...overrides,
  };
}

function buildGame(overrides: Partial<RevealedGame> = {}): RevealedGame {
  return {
    gameId: "game-1",
    seasonId: "season-1",
    white: { name: "calculated-risk", version: "v1" },
    black: { name: "steady-hand", version: "v1" },
    openingId: "opening-1",
    window: { status: "on-air", revealedPlies: 0 },
    fen: OPENING_FEN,
    decisions: [],
    catchUp: true,
    ...overrides,
  };
}

describe("probabilityBars", () => {
  test("orders bars by probability, highest first", () => {
    const decision = buildDecision({
      move: "e2e4",
      distribution: { e2e4: 0.5, d2d4: 0.3, g1f3: 0.2 },
    });

    expect(probabilityBars(decision)).toEqual([
      { move: "e2e4", probability: 0.5, chosen: true },
      { move: "d2d4", probability: 0.3, chosen: false },
      { move: "g1f3", probability: 0.2, chosen: false },
    ]);
  });

  test("shows the played move at zero probability when the distribution omits it", () => {
    const decision = buildDecision({
      move: "g1f3",
      distribution: { e2e4: 0.6, d2d4: 0.4 },
    });

    const bars = probabilityBars(decision);

    expect(bars).toHaveLength(3);
    expect(bars).toContainEqual({ move: "g1f3", probability: 0, chosen: true });
  });

  test("gives a single full-probability bar for the played move with no recorded distribution or confidence", () => {
    const decision = buildDecision({ move: "e2e4" });

    expect(probabilityBars(decision)).toEqual([
      { move: "e2e4", probability: 1, chosen: true },
    ]);
  });

  test("uses the stated confidence for the lone bar when only the distribution is missing", () => {
    const decision = buildDecision({ move: "e2e4", confidence: 0.62 });

    expect(probabilityBars(decision)).toEqual([
      { move: "e2e4", probability: 0.62, chosen: true },
    ]);
  });

  test("breaks probability ties on the move string for a stable order", () => {
    const decision = buildDecision({
      move: "e2e4",
      distribution: { e2e4: 0.5, g1f3: 0.25, b1c3: 0.25 },
    });

    expect(probabilityBars(decision).map((bar) => bar.move)).toEqual([
      "e2e4",
      "b1c3",
      "g1f3",
    ]);
  });

  test("returns every bar unchanged when the limit is not reached", () => {
    const decision = buildDecision({
      move: "e2e4",
      distribution: { e2e4: 0.5, d2d4: 0.3, g1f3: 0.2 },
    });

    expect(probabilityBars(decision, 10)).toHaveLength(3);
  });

  test("keeps exactly the limit by evicting the lowest-ranked bar for the played move", () => {
    const decision = buildDecision({
      move: "h7h5",
      distribution: { e2e4: 0.5, d2d4: 0.3, g1f3: 0.1, b1c3: 0.05, h7h5: 0.05 },
    });

    expect(probabilityBars(decision, 3)).toEqual([
      { move: "e2e4", probability: 0.5, chosen: false },
      { move: "d2d4", probability: 0.3, chosen: false },
      { move: "h7h5", probability: 0.05, chosen: true },
    ]);
  });

  test("evicts to make room for a played move the distribution never mentioned, sorted to its zero-probability rank", () => {
    const decision = buildDecision({
      move: "b1c3",
      distribution: { e2e4: 0.6, d2d4: 0.25, g1f3: 0.15 },
    });

    expect(probabilityBars(decision, 3)).toEqual([
      { move: "e2e4", probability: 0.6, chosen: false },
      { move: "d2d4", probability: 0.25, chosen: false },
      { move: "b1c3", probability: 0, chosen: true },
    ]);
  });
});

describe("recordGuess", () => {
  test("stores the guess and the ply it was made for", () => {
    expect(recordGuess(NO_GUESSES, 5, "e2e4")).toEqual({
      ply: 5,
      guess: "e2e4",
      settled: 0,
      hits: 0,
    });
  });

  test("replaces an outstanding guess made at the same ply", () => {
    const first = recordGuess(NO_GUESSES, 5, "e2e4");

    expect(recordGuess(first, 5, "d2d4")).toEqual({
      ply: 5,
      guess: "d2d4",
      settled: 0,
      hits: 0,
    });
  });

  test("abandons an unsettled guess at a new ply instead of scoring it", () => {
    const withHistory: GuessState = { settled: 3, hits: 2, guess: "e2e4", ply: 5 };

    expect(recordGuess(withHistory, 9, "g1f3")).toEqual({
      settled: 3,
      hits: 2,
      guess: "g1f3",
      ply: 9,
    });
  });
});

describe("settleGuess", () => {
  test("scores a hit and flashes correct feedback when the guess matches the revealed move", () => {
    const guessed = recordGuess(NO_GUESSES, 5, "e2e4");
    const decision = buildDecision({ ply: 5, move: "e2e4" });

    const settled = settleGuess(guessed, decision);

    expect(settled.settled).toBe(1);
    expect(settled.hits).toBe(1);
    expect(settled.lastCorrect).toBe(true);
  });

  test("counts a miss without a hit when the guess differs from the revealed move", () => {
    const guessed = recordGuess(NO_GUESSES, 5, "e2e4");
    const decision = buildDecision({ ply: 5, move: "d2d4" });

    const settled = settleGuess(guessed, decision);

    expect(settled.settled).toBe(1);
    expect(settled.hits).toBe(0);
    expect(settled.lastCorrect).toBe(false);
  });

  test("leaves the state untouched when there is no outstanding guess", () => {
    const decision = buildDecision({ ply: 5, move: "e2e4" });

    expect(settleGuess(NO_GUESSES, decision)).toEqual(NO_GUESSES);
  });

  test("cannot inflate the hit rate from a reveal at a different ply than the guess", () => {
    const guessed = recordGuess(NO_GUESSES, 5, "e2e4");
    const decision = buildDecision({ ply: 6, move: "e2e4" });

    expect(settleGuess(guessed, decision)).toEqual(guessed);
  });

  test("settling the same decision twice counts once", () => {
    const guessed = recordGuess(NO_GUESSES, 5, "e2e4");
    const decision = buildDecision({ ply: 5, move: "e2e4" });

    const once = settleGuess(guessed, decision);
    const twice = settleGuess(once, decision);

    expect(twice).toEqual(once);
    expect(twice.settled).toBe(1);
    expect(twice.hits).toBe(1);
  });

  test("NO_GUESSES is a usable empty state that no operation mutates", () => {
    const snapshot = { ...NO_GUESSES };

    recordGuess(NO_GUESSES, 5, "e2e4");
    settleGuess(NO_GUESSES, buildDecision({ ply: 5, move: "e2e4" }));

    expect(NO_GUESSES).toEqual(snapshot);
  });
});

describe("scrub", () => {
  const decisionOne = buildDecision({ ply: 1, fen: "opening-fen", move: "e2e4" });
  const decisionTwo = buildDecision({ ply: 2, fen: "after-move-1-fen", move: "e7e5" });
  const decisionThree = buildDecision({ ply: 3, fen: "after-move-2-fen", move: "g1f3" });
  const liveFen = "after-move-3-fen";

  const game = buildGame({
    decisions: [decisionOne, decisionTwo, decisionThree],
    fen: liveFen,
    window: { status: "on-air", revealedPlies: 3 },
  });

  test("index 0 is the opening position with no decision behind it", () => {
    expect(scrub(game, 0)).toEqual({ fen: "opening-fen", index: 0, decision: undefined });
  });

  test("index 1 is the position produced by the first revealed decision", () => {
    const frame = scrub(game, 1);

    expect(frame.fen).toBe("after-move-1-fen");
    expect(frame.decision).toEqual(decisionOne);
  });

  test("index 2 is the position produced by the second revealed decision", () => {
    const frame = scrub(game, 2);

    expect(frame.fen).toBe("after-move-2-fen");
    expect(frame.decision).toEqual(decisionTwo);
  });

  test("the last index is the live frame, taken from the game's own fen rather than recomputed", () => {
    const frame = scrub(game, 3);

    expect(frame.fen).toBe(liveFen);
    expect(frame.decision).toEqual(decisionThree);
  });

  test("an index past the revealed prefix clamps to the live frame", () => {
    expect(scrub(game, 99)).toEqual(scrub(game, 3));
  });

  test("a negative index clamps to the opening position", () => {
    expect(scrub(game, -5)).toEqual(scrub(game, 0));
  });

  test("a game with nothing revealed gives only the opening frame", () => {
    const bare = buildGame({
      decisions: [],
      fen: "opening-fen",
      window: { status: "scheduled", revealedPlies: 0 },
    });

    expect(scrub(bare, 0)).toEqual({ fen: "opening-fen", index: 0, decision: undefined });
    expect(scrub(bare, 5)).toEqual(scrub(bare, 0));
  });
});

describe("replayOpening", () => {
  test("replays a known exact opening from the normal initial board with real move metadata", () => {
    const replay = replayOpening(ITALIAN.id, ITALIAN.fen);

    expect(replay).toBeDefined();
    expect(replay?.name).toBe("Italian Game");
    expect(replay?.positions).toHaveLength(ITALIAN.moves.length + 1);
    expect(replay?.positions[0]).toBe(OPENING_FEN);
    expect(replay?.positions.at(-1)).toBe(ITALIAN.fen);
    expect(replay?.moves.map((move) => move.san)).toEqual([...ITALIAN.moves]);
    expect(replay?.uciMoves).toEqual(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5"]);
    expect(replay?.moves.map(({ capturedRole, capturedValue, isCheck }) => ({
      capturedRole,
      capturedValue,
      isCheck,
    }))).toEqual(
      ITALIAN.moves.map(() => ({
        capturedRole: undefined,
        capturedValue: 0,
        isCheck: false,
      })),
    );
  });

  test("does not fabricate opening history for an unknown id or mismatched first position", () => {
    expect(replayOpening("not-a-real-opening", ITALIAN.fen)).toBeUndefined();
    expect(replayOpening(ITALIAN.id, OPENING_FEN)).toBeUndefined();
    expect(replayOpening(undefined, ITALIAN.fen)).toBeUndefined();
    expect(replayOpening(ITALIAN.id, undefined)).toBeUndefined();
  });

  test("hands the final book position directly to the first saved decision", () => {
    const firstDecision = buildDecision({
      ply: ITALIAN.moves.length,
      fen: ITALIAN.fen,
      move: "d2d3",
    });
    const openingReplay = replayOpening(ITALIAN.id, firstDecision.fen);
    const decisionReplay = replayDecisions([firstDecision]);

    expect(openingReplay?.positions.at(-1)).toBe(firstDecision.fen);
    expect(decisionReplay.positions[0]).toBe(firstDecision.fen);
    expect(openingReplay?.positions.at(-1)).toBe(decisionReplay.positions[0]);
  });
});
