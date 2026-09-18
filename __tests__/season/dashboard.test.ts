import { describe, expect, test } from "bun:test";
import {
  dashboardFrom,
  interestScore,
  materialSwing,
} from "../../src/season/dashboard.ts";
import { pairKey } from "../../src/rivalry/head-to-head.ts";
import type {
  Colour,
  DecisionRecord,
  Fen,
  RevealedGame,
  Trait,
} from "../../src/core/types.ts";
import { positionFixture } from "../fixtures/positions";
import { BROADCAST_DECISIONS } from "../fixtures/broadcast";

// Two rooks and a king each, so material is easy to reason about by eye.
const BALANCED_WHITE_TO_MOVE: Fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
const BALANCED_BLACK_TO_MOVE: Fen = "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1";
// Black's a8 rook is gone: White is up a full rook.
const WHITE_UP_A_ROOK_WHITE_TO_MOVE: Fen = "4k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 2";
const WHITE_UP_A_ROOK_BLACK_TO_MOVE: Fen = "4k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 2";

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`missing item at index ${index}`);
  return item;
}

function broadcastDecisionAt(ply: number): DecisionRecord {
  return at(BROADCAST_DECISIONS, ply);
}

function basicDecision(
  ply: number,
  colour: Colour,
  fen: Fen,
  overrides: Partial<DecisionRecord> = {},
): DecisionRecord {
  return {
    seasonId: "season-material",
    gameId: "game-material",
    ply,
    competitor: colour === "white" ? "Alpha" : "Beta",
    version: "v1",
    colour,
    fen,
    legalMoveCount: 10,
    move: "e2e4",
    strategy: "direct",
    latencyMs: 10,
    featuresSeen: ["materialBalance"],
    idempotencyKey: `game-material:${ply}:v1`,
    ...overrides,
  };
}

function revealedGame(overrides: Partial<RevealedGame> = {}): RevealedGame {
  return {
    gameId: "game-1",
    seasonId: "season-1",
    white: { name: "Alpha", version: "v1" },
    black: { name: "Beta", version: "v1" },
    openingId: "start",
    window: { status: "on-air", revealedPlies: 2 },
    fen: positionFixture("start").fen,
    decisions: [],
    catchUp: false,
    ...overrides,
  };
}

function trait(overrides: Partial<Trait> = {}): Trait {
  return {
    rule: "loss-streak-3",
    opponent: "Beta",
    reason: "lost the last three games to Beta",
    gameIds: ["game-0"],
    ...overrides,
  };
}

describe("materialSwing", () => {
  test("is zero for an empty decision list", () => {
    expect(materialSwing([])).toBe(0);
  });

  test("is zero for a single decision", () => {
    const decisions = [basicDecision(0, "white", BALANCED_WHITE_TO_MOVE)];
    expect(materialSwing(decisions)).toBe(0);
  });

  test("is zero across a run of quiet developing moves", () => {
    // Scholar's mate plies 0-6: e4 e5 Bc4 Nc6 Qh5 Nf6, no captures yet.
    const decisions = [broadcastDecisionAt(0), broadcastDecisionAt(6)];
    expect(materialSwing(decisions)).toBe(0);
  });

  test("is positive when the side now to move just gained a material edge", () => {
    const decisions = [
      basicDecision(4, "black", BALANCED_BLACK_TO_MOVE),
      basicDecision(5, "white", WHITE_UP_A_ROOK_WHITE_TO_MOVE),
    ];
    expect(materialSwing(decisions)).toBeGreaterThan(0);
  });

  test("is negative when the side now to move just lost a material edge", () => {
    const decisions = [
      basicDecision(4, "white", BALANCED_WHITE_TO_MOVE),
      basicDecision(5, "black", WHITE_UP_A_ROOK_BLACK_TO_MOVE),
    ];
    expect(materialSwing(decisions)).toBeLessThan(0);
  });
});

describe("interestScore", () => {
  test("rises with a bigger recent material swing, other inputs held constant", () => {
    const quiet = revealedGame({
      decisions: [
        broadcastDecisionAt(0),
        { ...broadcastDecisionAt(6), confidence: 0.5 },
      ],
    });
    const bigSwing = revealedGame({
      decisions: [
        basicDecision(4, "black", BALANCED_BLACK_TO_MOVE),
        basicDecision(5, "white", WHITE_UP_A_ROOK_WHITE_TO_MOVE, {
          confidence: 0.5,
        }),
      ],
    });
    expect(interestScore(bigSwing, [])).toBeGreaterThan(
      interestScore(quiet, []),
    );
  });

  test("rises when a rivalry trait is active, other inputs held constant", () => {
    const game = revealedGame({
      decisions: [
        broadcastDecisionAt(0),
        { ...broadcastDecisionAt(6), confidence: 0.5 },
      ],
    });
    expect(interestScore(game, [trait()])).toBeGreaterThan(
      interestScore(game, []),
    );
  });

  test("rises as the most recent decision's confidence falls, other inputs held constant", () => {
    const highConfidence = revealedGame({
      decisions: [
        broadcastDecisionAt(0),
        { ...broadcastDecisionAt(6), confidence: 0.9 },
      ],
    });
    const lowConfidence = revealedGame({
      decisions: [
        broadcastDecisionAt(0),
        { ...broadcastDecisionAt(6), confidence: 0.1 },
      ],
    });
    expect(interestScore(lowConfidence, [])).toBeGreaterThan(
      interestScore(highConfidence, []),
    );
  });
});

describe("dashboardFrom", () => {
  test("copies gameId, seasonId, participants, position and reveal depth from the game", () => {
    const game = revealedGame({
      gameId: "game-42",
      seasonId: "season-9",
      white: { name: "Alpha", version: "v1" },
      black: { name: "Beta", version: "v2" },
      window: { status: "on-air", revealedPlies: 2 },
      fen: broadcastDecisionAt(6).fen,
      decisions: [broadcastDecisionAt(0), broadcastDecisionAt(6)],
    });
    const entries = dashboardFrom([game], new Map<string, readonly Trait[]>());
    expect(entries.length).toBe(1);
    const entry = at(entries, 0);
    expect(entry.gameId).toBe("game-42");
    expect(entry.seasonId).toBe("season-9");
    expect(entry.white).toEqual({ name: "Alpha", version: "v1" });
    expect(entry.black).toEqual({ name: "Beta", version: "v2" });
    expect(entry.fen).toBe(broadcastDecisionAt(6).fen);
    expect(entry.ply).toBe(2);
  });

  test("orders entries by interest score, most interesting first", () => {
    const boring = revealedGame({
      gameId: "game-boring",
      window: { status: "scheduled", revealedPlies: 0 },
      decisions: [],
    });
    const exciting = revealedGame({
      gameId: "game-exciting",
      window: { status: "on-air", revealedPlies: 2 },
      fen: WHITE_UP_A_ROOK_WHITE_TO_MOVE,
      decisions: [
        basicDecision(4, "black", BALANCED_BLACK_TO_MOVE),
        basicDecision(5, "white", WHITE_UP_A_ROOK_WHITE_TO_MOVE),
      ],
    });
    const entries = dashboardFrom(
      [boring, exciting],
      new Map<string, readonly Trait[]>(),
    );
    expect(at(entries, 0).gameId).toBe("game-exciting");
    expect(at(entries, 1).gameId).toBe("game-boring");
  });

  test("sorts a finished game after an unfinished game of equal interest", () => {
    const sharedDecisions = [
      broadcastDecisionAt(0),
      { ...broadcastDecisionAt(6), confidence: 0.5 },
    ];
    const finished = revealedGame({
      gameId: "game-finished",
      window: { status: "finished", revealedPlies: 2 },
      decisions: sharedDecisions,
      outcome: { result: "white", reason: "checkmate" },
    });
    const onAir = revealedGame({
      gameId: "game-on-air",
      window: { status: "on-air", revealedPlies: 2, nextBoundaryAt: 5_000 },
      decisions: sharedDecisions,
    });
    // Deliberately pass the finished game first: a naive implementation that
    // just keeps input order would put it ahead of the still-live game.
    const entries = dashboardFrom(
      [finished, onAir],
      new Map<string, readonly Trait[]>(),
    );
    expect(at(entries, 0).gameId).toBe("game-on-air");
    expect(at(entries, 1).gameId).toBe("game-finished");
  });

  test("still includes a game with nothing revealed, at ply 0 and scheduled", () => {
    const game = revealedGame({
      gameId: "game-not-started",
      window: { status: "scheduled", revealedPlies: 0, nextBoundaryAt: 10_000 },
      decisions: [],
    });
    const entries = dashboardFrom([game], new Map<string, readonly Trait[]>());
    expect(entries.length).toBe(1);
    const entry = at(entries, 0);
    expect(entry.ply).toBe(0);
    expect(entry.status).toBe("scheduled");
    expect(entry.strategy).toBeUndefined();
    expect(entry.confidence).toBeUndefined();
  });

  test("looks up traits by pairKey regardless of which side is named first", () => {
    const game = revealedGame({
      gameId: "game-rivalry",
      white: { name: "Alpha", version: "v1" },
      black: { name: "Beta", version: "v1" },
    });
    const activeTrait = trait({ rule: "loss-streak-3" });
    const forward = new Map<string, readonly Trait[]>([
      [pairKey("Alpha", "Beta"), [activeTrait]],
    ]);
    const backward = new Map<string, readonly Trait[]>([
      [pairKey("Beta", "Alpha"), [activeTrait]],
    ]);
    const forwardEntry = at(dashboardFrom([game], forward), 0);
    const backwardEntry = at(dashboardFrom([game], backward), 0);
    expect(forwardEntry.rivalry).toEqual(["loss-streak-3"]);
    expect(backwardEntry.rivalry).toEqual(["loss-streak-3"]);
  });

  test("gives an empty rivalry list to a pair with no trait entry", () => {
    const game = revealedGame({ gameId: "game-no-rivalry" });
    const entry = at(
      dashboardFrom([game], new Map<string, readonly Trait[]>()),
      0,
    );
    expect(entry.rivalry).toEqual([]);
  });

  test("takes strategy and confidence from the last revealed decision, not an earlier one", () => {
    const earlierRevealed = { ...broadcastDecisionAt(3), confidence: 0.3 };
    const laterRevealed = { ...broadcastDecisionAt(4), confidence: 0.85 };
    expect(earlierRevealed.strategy).not.toBe(laterRevealed.strategy);
    const game = revealedGame({
      gameId: "game-window",
      window: { status: "on-air", revealedPlies: 2 },
      fen: laterRevealed.fen,
      decisions: [earlierRevealed, laterRevealed],
    });
    const entry = at(
      dashboardFrom([game], new Map<string, readonly Trait[]>()),
      0,
    );
    expect(entry.strategy).toBe(laterRevealed.strategy);
    expect(entry.confidence).toBe(laterRevealed.confidence);
  });
});
