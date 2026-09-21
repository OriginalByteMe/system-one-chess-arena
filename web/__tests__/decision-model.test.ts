import { describe, expect, test } from "bun:test";

import type { DecisionRecord, MoveEvent } from "../../src/core/types.ts";
import { formatDecision } from "../src/decision-model.ts";

const record: DecisionRecord = {
  seasonId: "season-1",
  gameId: "round-1-game-4",
  ply: 16,
  competitor: "calculated-risk",
  version: "v3",
  colour: "white",
  fen: "8/8/8/8/8/8/8/8 w - - 0 9",
  legalMoveCount: 24,
  move: "g1f3",
  strategy: "direct",
  confidence: 0.734,
  latencyMs: 842,
  featuresSeen: [],
  idempotencyKey: "round-1-game-4:16:v3",
};

const decision: MoveEvent = {
  type: "move",
  gameId: "round-1-game-4",
  ply: 17,
  move: "g1f3",
  fen: "8/8/8/8/8/5N2/8/8 b - - 1 9",
  competitor: { name: "calculated-risk", version: "v3" },
  strategy: "direct",
  confidence: 0.734,
  latencyMs: 842,
  decision: record,
};

describe("decision panel model", () => {
  test("formats the latest move for quick spectator scanning", () => {
    expect(formatDecision(decision)).toEqual({
      move: "g1 → f3",
      strategy: "Direct",
      confidence: "73%",
      latency: "842 ms",
      competitor: "calculated-risk",
      ply: "Ply 17",
    });
  });

  test("shows an honest waiting state before the first decision", () => {
    expect(formatDecision()).toEqual({
      move: "—",
      strategy: "Awaiting move",
      confidence: "—",
      latency: "—",
      competitor: "No competitor yet",
      ply: "Pre-game",
    });
  });

  test("distinguishes unreported confidence and formats slow decisions in seconds", () => {
    expect(formatDecision({ ...decision, confidence: undefined, latencyMs: 1_250 })).toMatchObject({
      confidence: "Not reported",
      latency: "1.25 s",
    });
  });
});
