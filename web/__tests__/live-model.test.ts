import { describe, expect, test } from "bun:test";

import type { DecisionRecord, ResultEvent } from "../../src/core/types.ts";
import { classifyStatus, liveCompetitor, liveOutcome, liveSeasonId, viewFromLive } from "../src/live-model.ts";

const OPENING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

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

describe("liveCompetitor", () => {
  test("is unknown before that colour has ever moved", () => {
    expect(liveCompetitor([], "white")).toBeUndefined();
    expect(liveCompetitor([buildDecision({ colour: "white" })], "black")).toBeUndefined();
  });

  test("names the competitor from that colour's first decision", () => {
    const decisions = [
      buildDecision({ colour: "white", competitor: "calculated-risk", version: "v1" }),
      buildDecision({ ply: 2, colour: "black", competitor: "steady-hand", version: "v2" }),
      buildDecision({ ply: 3, colour: "white", competitor: "calculated-risk", version: "v3" }),
    ];
    // The earliest decision for the colour wins, even once a later one for
    // the same side has landed with a different version.
    expect(liveCompetitor(decisions, "white")).toEqual({ name: "calculated-risk", version: "v1" });
    expect(liveCompetitor(decisions, "black")).toEqual({ name: "steady-hand", version: "v2" });
  });
});

describe("liveSeasonId", () => {
  test("is unknown with no decisions yet", () => {
    expect(liveSeasonId([])).toBeUndefined();
  });

  test("reads the season off the first decision", () => {
    expect(liveSeasonId([buildDecision({ seasonId: "season-9" })])).toBe("season-9");
  });
});

describe("liveOutcome", () => {
  test("is undefined while the game has not finished", () => {
    expect(liveOutcome(undefined)).toBeUndefined();
  });

  test("carries the result and reason without an adjudicated score", () => {
    const finished: ResultEvent = { type: "result", gameId: "game-1", ply: 40, result: "white", reason: "checkmate" };
    expect(liveOutcome(finished)).toEqual({ result: "white", reason: "checkmate" });
  });

  test("carries the adjudicated score when the rule awarded it", () => {
    const finished: ResultEvent = {
      type: "result",
      gameId: "game-1",
      ply: 120,
      result: "draw",
      reason: "fifty-move",
      adjudicatedCp: 250,
    };
    expect(liveOutcome(finished)).toEqual({ result: "draw", reason: "fifty-move", adjudicatedCp: 250 });
  });
});

describe("viewFromLive", () => {
  test("replays in full and never carries a scheduled reveal", () => {
    const decisions = [buildDecision()];
    const view = viewFromLive({ gameId: "game-1", fen: "position", cursor: 1, decisions }, "game-1");
    expect(view.catchUp).toBe(true);
    expect(view.window.nextBoundaryAt).toBeUndefined();
    expect(view.window.status).toBe("on-air");
    expect(view.decisions).toBe(decisions);
  });

  test("reports finished once the stream carries a result", () => {
    const finished: ResultEvent = { type: "result", gameId: "game-1", ply: 1, result: "black", reason: "checkmate" };
    const view = viewFromLive(
      { gameId: "game-1", fen: "position", cursor: 1, decisions: [buildDecision()], finished },
      "game-1",
    );
    expect(view.window.status).toBe("finished");
    expect(view.outcome).toEqual({ result: "black", reason: "checkmate" });
  });
});

describe("classifyStatus", () => {
  test("shows a plain connecting screen on the very first attempt", () => {
    expect(
      classifyStatus({
        hasSeasonId: true,
        recordedError: undefined,
        spectatorConnection: "connecting",
        spectatorEverConnected: false,
      }),
    ).toBe("connecting");
  });

  test("a recorded 404 alone never reads as an error - it just means the game is not filed yet", () => {
    expect(
      classifyStatus({
        hasSeasonId: true,
        recordedError: "Not found.",
        spectatorConnection: "connecting",
        spectatorEverConnected: false,
      }),
    ).toBe("connecting");
  });

  test("surfaces a genuine fetch failure as an error", () => {
    expect(
      classifyStatus({
        hasSeasonId: true,
        recordedError: "The arena answered 500.",
        spectatorConnection: "offline",
        spectatorEverConnected: false,
      }),
    ).toBe("error");
  });

  test("reads as not-started once the socket has failed without ever opening", () => {
    expect(
      classifyStatus({
        hasSeasonId: false,
        recordedError: undefined,
        spectatorConnection: "offline",
        spectatorEverConnected: false,
      }),
    ).toBe("not-started");
  });

  test("a drop after connecting once stays a plain connecting retry, not not-started", () => {
    expect(
      classifyStatus({
        hasSeasonId: false,
        recordedError: undefined,
        spectatorConnection: "offline",
        spectatorEverConnected: true,
      }),
    ).toBe("connecting");
  });
});
