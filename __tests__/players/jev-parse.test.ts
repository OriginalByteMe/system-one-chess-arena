import { describe, expect, test } from "bun:test";
import type {
  CompetitorManifest,
  FallbackReason,
  PositionInput,
  ProviderResponse,
  SystemOneResponse,
  ValidationResult,
} from "../../src/core/types.ts";
import { parseJevResponses } from "../../src/players/jev.ts";
import {
  JEV_FLAT_MANIFEST,
  JEV_HIERARCHICAL_MANIFEST,
} from "../fixtures/manifests.ts";
import { loadTranscript } from "../helpers/recorded-provider.ts";

const LEGAL_MOVES = ["e2e4", "d2d4", "g1f3"] as const;

function input(persona: CompetitorManifest): PositionInput {
  return {
    seasonId: "season-provider-tests",
    gameId: `parse-${persona.name}`,
    ply: 4,
    colour: "white",
    fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    history: ["e4", "e5"],
    legalMoves: LEGAL_MOVES,
    features: {
      materialBalance: 0,
      mobility: 29,
      hangingOwnPieces: 0,
      hangingOpponentPieces: 0,
      kingSafety: 5,
      inCheck: false,
      opponentMateInOne: false,
      phase: "opening",
    },
    persona,
    budget: persona.budget,
  };
}

function expectFailure(result: ValidationResult, reason: FallbackReason): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`expected ${reason}, received a decision for ${result.decision.move}`);
  }
  expect(result.reason).toBe(reason);
  expect(result.detail.length).toBeGreaterThan(0);
}

function splitHierarchical(response: ProviderResponse): readonly SystemOneResponse[] {
  if (response.kind !== "systemone") {
    throw new Error(`expected a systemone recording, received ${response.kind}`);
  }
  const strategy = response.answers.strategy;
  const move = response.answers.move;
  if (strategy === undefined || move === undefined) {
    throw new Error("hierarchical recording must contain strategy and move answers");
  }
  return [
    { kind: "systemone", answers: { strategy } },
    { kind: "systemone", answers: { move } },
  ];
}

function withTokens(
  response: ProviderResponse,
  tokens: { readonly in: number; readonly out: number },
): SystemOneResponse {
  if (response.kind !== "systemone") {
    throw new Error(`expected a systemone response, received ${response.kind}`);
  }
  return { ...response, tokens };
}

describe("parseJevResponses", () => {
  test("maps a healthy flat answer into a move decision", () => {
    const result = parseJevResponses(
      input(JEV_FLAT_MANIFEST),
      [loadTranscript("jev-flat-ok")],
      42,
    );

    if (!result.ok) {
      throw new Error(`expected a valid flat decision: ${result.reason}`);
    }
    expect(result.decision.move).toBe("e2e4");
    expect(result.decision.strategy).toBe("direct");
    expect(result.decision.confidence).toBe(0.78);
    expect(result.decision.distribution).toEqual({
      e2e4: 0.55,
      d2d4: 0.3,
      g1f3: 0.15,
    });
    expect(result.decision.latencyMs).toBe(42);
    expect(result.decision.tokens).toEqual({ in: 184, out: 32 });
  });

  test("maps healthy hierarchical strategy and move answers", () => {
    const responses = splitHierarchical(loadTranscript("jev-hierarchical-ok"));
    const result = parseJevResponses(input(JEV_HIERARCHICAL_MANIFEST), responses, 57);

    if (!result.ok) {
      throw new Error(`expected a valid hierarchical decision: ${result.reason}`);
    }
    expect(result.decision.move).toBe("g1f3");
    expect(result.decision.strategy).toBe("attack");
    expect(result.decision.confidence).toBe(0.68);
    expect(result.decision.distribution).toEqual({
      e2e4: 0.3,
      d2d4: 0.2,
      g1f3: 0.5,
    });
    expect(result.decision.latencyMs).toBe(57);
  });

  test("aggregates tokens only when every hierarchical response reports usage", () => {
    const [strategy, move] = splitHierarchical(
      loadTranscript("jev-hierarchical-ok"),
    );
    if (strategy === undefined || move === undefined) {
      throw new Error("expected strategy and move responses");
    }

    const complete = parseJevResponses(
      input(JEV_HIERARCHICAL_MANIFEST),
      [
        withTokens(strategy, { in: 100, out: 10 }),
        withTokens(move, { in: 200, out: 20 }),
      ],
      57,
    );
    if (!complete.ok) {
      throw new Error(`expected a valid hierarchical decision: ${complete.reason}`);
    }
    expect(complete.decision.tokens).toEqual({ in: 300, out: 30 });

    const partial = parseJevResponses(
      input(JEV_HIERARCHICAL_MANIFEST),
      [withTokens(strategy, { in: 100, out: 10 }), move],
      57,
    );
    if (!partial.ok) {
      throw new Error(`expected a valid hierarchical decision: ${partial.reason}`);
    }
    expect(partial.decision.tokens).toBeUndefined();
  });

  test("rejects negative token usage as a malformed response", () => {
    expectFailure(
      parseJevResponses(
        input(JEV_FLAT_MANIFEST),
        [withTokens(loadTranscript("jev-flat-ok"), { in: -1, out: 32 })],
        42,
      ),
      "malformed-response",
    );
    expectFailure(
      parseJevResponses(
        input(JEV_FLAT_MANIFEST),
        [withTokens(loadTranscript("jev-flat-ok"), { in: 184, out: -1 })],
        42,
      ),
      "malformed-response",
    );
  });

  test("classifies a move outside the legal list as illegal-output", () => {
    expectFailure(
      parseJevResponses(
        input(JEV_FLAT_MANIFEST),
        [loadTranscript("jev-illegal-move")],
        12,
      ),
      "illegal-output",
    );
  });

  test("classifies a strategy outside the manifest set as unknown-strategy", () => {
    const responses = splitHierarchical(loadTranscript("jev-unknown-strategy"));
    expectFailure(
      parseJevResponses(input(JEV_HIERARCHICAL_MANIFEST), responses, 12),
      "unknown-strategy",
    );
  });

  test("classifies probabilities summing to 1.4 as malformed-distribution", () => {
    expectFailure(
      parseJevResponses(
        input(JEV_FLAT_MANIFEST),
        [loadTranscript("jev-bad-probabilities")],
        12,
      ),
      "malformed-distribution",
    );
  });

  test("classifies a response without the expected question id as malformed-response", () => {
    expectFailure(
      parseJevResponses(
        input(JEV_FLAT_MANIFEST),
        [loadTranscript("jev-missing-answer")],
        12,
      ),
      "malformed-response",
    );
  });

  test("classifies a provider failure as provider-error", () => {
    expectFailure(
      parseJevResponses(
        input(JEV_FLAT_MANIFEST),
        [loadTranscript("error-500")],
        12,
      ),
      "provider-error",
    );
  });
});
