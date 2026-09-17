import { describe, expect, test } from "bun:test";
import { ContractViolation } from "../../src/core/errors";
import type { DecisionRecord } from "../../src/core/types";
import {
  idempotencyKey,
  parseDecisionLine,
  parseDecisionLog,
  serialiseDecision,
} from "../../src/season/log";

const MINIMAL_DECISION: DecisionRecord = {
  seasonId: "season-1",
  gameId: "game-1",
  ply: 7,
  competitor: "Alpha",
  version: "alpha-v1",
  colour: "white",
  fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
  legalMoveCount: 3,
  move: "a1a2",
  strategy: "endgame",
  latencyMs: 17,
  featuresSeen: ["materialBalance", "phase"],
  idempotencyKey: "game-1:7:alpha-v1",
};

const FULL_DECISION: DecisionRecord = {
  ...MINIMAL_DECISION,
  confidence: 0.75,
  distribution: { a1a2: 0.75, a1b1: 0.25 },
  tokens: { in: 120, out: 18 },
  fallback: "provider-error",
};

function invalidLine(fields: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ ...MINIMAL_DECISION, ...fields });
}

describe("idempotencyKey", () => {
  test("is stable for the same game, ply, and version", () => {
    const first = idempotencyKey("game-42", 19, "version-a");
    const second = idempotencyKey("game-42", 19, "version-a");

    expect(first).toBe(second);
  });

  test("changes when any member of the identity triple changes", () => {
    const original = idempotencyKey("game-42", 19, "version-a");

    expect(idempotencyKey("game-43", 19, "version-a")).not.toBe(original);
    expect(idempotencyKey("game-42", 20, "version-a")).not.toBe(original);
    expect(idempotencyKey("game-42", 19, "version-b")).not.toBe(original);
  });
});

describe("decision line serialisation", () => {
  test("round-trips every optional field on one physical line", () => {
    const line = serialiseDecision(FULL_DECISION);

    expect(line).not.toContain("\n");
    expect(line).not.toContain("\r");
    expect(parseDecisionLine(line)).toEqual(FULL_DECISION);
  });

  test("round-trips a record with no optional fields", () => {
    const line = serialiseDecision(MINIMAL_DECISION);

    expect(parseDecisionLine(line)).toEqual(MINIMAL_DECISION);
  });
});

describe("parseDecisionLine", () => {
  test.each([
    ["an empty string", ""],
    ["non-JSON text", "this is not json"],
    ["a JSON array", "[]"],
    ["a missing required field", JSON.stringify({ gameId: "game-1" })],
    ["ply with the wrong type", invalidLine({ ply: "7" })],
    ["an unknown fallback reason", invalidLine({ fallback: "network-melted" })],
    ["an unknown strategy label", invalidLine({ strategy: "wait-and-see" })],
  ])("rejects %s with ContractViolation", (_description, line) => {
    expect(() => parseDecisionLine(line)).toThrow(ContractViolation);
  });
});

describe("parseDecisionLog", () => {
  test("ignores blank lines and trailing newlines while preserving record order", () => {
    const second: DecisionRecord = {
      ...MINIMAL_DECISION,
      ply: 8,
      colour: "black",
      move: "h1h2",
      idempotencyKey: "game-1:8:alpha-v1",
    };
    const text = `${serialiseDecision(MINIMAL_DECISION)}\n\n${serialiseDecision(second)}\n\n`;

    expect(parseDecisionLog(text)).toEqual([MINIMAL_DECISION, second]);
  });

  test("reports the physical line number of a corrupt row", () => {
    const text = `${serialiseDecision(MINIMAL_DECISION)}\n\nnot-json\n${serialiseDecision(FULL_DECISION)}`;

    expect(() => parseDecisionLog(text)).toThrow(/line 3/i);
  });
});
