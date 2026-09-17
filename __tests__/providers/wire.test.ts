import { describe, expect, test } from "bun:test";
import { sumProbabilities, validateDistribution } from "../../src/core/distribution.ts";
import { parseSystemOneResponse, toSystemOneBody } from "../../src/providers/wire.ts";
import type { SystemOneRequest } from "../../src/core/types.ts";

const REQUEST: SystemOneRequest = {
  kind: "systemone",
  model: "jev-latest",
  state: { fen: "start", history: [] },
  questions: {
    move: {
      type: "choice",
      instructions: "Choose the best legal move.",
      options: ["e2e4", "d2d4", "g1f3"],
      rubric: { e2e4: "e4", d2d4: "d4" },
    },
  },
};

/**
 * Recorded from api.typesafe.ai (jev-1.13.0) on 2026-09-17. Each probability is
 * rounded to two decimals, so twenty of them sum to 0.99 rather than 1.
 */
const ROUNDED_RESPONSE = {
  model: "jev-1.13.0",
  answers: {
    move: {
      type: "choice",
      choice: "e2e4",
      confidence: 0.79,
      probabilities: { e2e4: 0.79, d2d4: 0.11, g1f3: 0.09 },
    },
  },
  usage: { input_tokens: 543, output_tokens: 220 },
};

describe("toSystemOneBody", () => {
  test("sends options as a criteria map carrying the rubric, null where absent", () => {
    expect(toSystemOneBody(REQUEST)).toEqual({
      model: "jev-latest",
      state: { fen: "start", history: [] },
      questions: {
        move: {
          type: "choice",
          instructions: "Choose the best legal move.",
          criteria: { e2e4: "e4", d2d4: "d4", g1f3: null },
        },
      },
    });
  });
});

describe("parseSystemOneResponse", () => {
  test("renormalises two-decimal rounding so the core validator accepts the answer", () => {
    const response = parseSystemOneResponse(ROUNDED_RESPONSE, 200);
    if (response.kind !== "systemone") {
      throw new Error(`expected a systemone response, got ${response.kind}`);
    }
    const answer = response.answers.move;
    if (answer === undefined) throw new Error("expected a move answer");

    expect(sumProbabilities(ROUNDED_RESPONSE.answers.move.probabilities)).toBeCloseTo(0.99, 10);
    expect(sumProbabilities(answer.probabilities)).toBeCloseTo(1, 12);
    expect(validateDistribution(answer.probabilities, ["e2e4", "d2d4", "g1f3"])).toBe(true);
    expect(answer.choice).toBe("e2e4");
    expect(response.tokens).toEqual({ in: 543, out: 220 });
  });

  test("keeps a distribution that is wrong rather than rounded, so it is rejected", () => {
    const response = parseSystemOneResponse(
      {
        answers: {
          move: { choice: "e2e4", confidence: 0.7, probabilities: { e2e4: 0.7, d2d4: 0.5 } },
        },
      },
      200,
    );
    if (response.kind !== "systemone") {
      throw new Error(`expected a systemone response, got ${response.kind}`);
    }
    const answer = response.answers.move;
    if (answer === undefined) throw new Error("expected a move answer");

    expect(answer.probabilities).toEqual({ e2e4: 0.7, d2d4: 0.5 });
    expect(validateDistribution(answer.probabilities, ["e2e4", "d2d4"])).toBe(false);
  });

  test("reports a non-200 as a provider failure carrying the status", () => {
    expect(parseSystemOneResponse({ message: "invalid api key" }, 401)).toEqual({
      kind: "error",
      status: 401,
      message: "invalid api key",
    });
  });
});
