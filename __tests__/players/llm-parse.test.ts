import { describe, expect, test } from "bun:test";
import type {
  FallbackReason,
  PositionInput,
  ValidationResult,
} from "../../src/core/types.ts";
import { buildLlmRequest, parseLlmResponse } from "../../src/players/llm.ts";
import { LLM_MANIFEST } from "../fixtures/manifests.ts";
import { loadTranscript } from "../helpers/recorded-provider.ts";

const LEGAL_MOVES = ["e2e4", "d2d4", "g1f3"] as const;

function input(): PositionInput {
  return {
    seasonId: "season-provider-tests",
    gameId: "game-llm-1",
    ply: 8,
    colour: "white",
    fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3",
    history: ["e4", "e5", "Nc3", "Nc6"],
    legalMoves: LEGAL_MOVES,
    features: {
      materialBalance: 35,
      mobility: 27,
      inCheck: false,
      phase: "opening",
      kingSafety: 987654,
      opponentMateInOne: true,
    },
    persona: LLM_MANIFEST,
    budget: LLM_MANIFEST.budget,
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

describe("buildLlmRequest", () => {
  test("uses the manifest model and asks for JSON containing the legal position context", () => {
    const position = input();
    const request = buildLlmRequest(position);
    const prompt = request.messages.map((message) => message.content).join("\n");

    expect(request.kind).toBe("chat");
    expect(request.model).toBe(LLM_MANIFEST.model);
    expect(request.jsonOnly).toBe(true);
    expect(prompt.toLowerCase()).toContain("json");
    expect(prompt).toContain(position.fen);
    expect(prompt).toContain(LLM_MANIFEST.playstyle);
    for (const move of LEGAL_MOVES) {
      expect(prompt).toContain(move);
    }
  });

  test("includes every declared feature and excludes undeclared feature data", () => {
    const request = buildLlmRequest(input());
    const prompt = request.messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("materialBalance");
    expect(prompt).toContain("35");
    expect(prompt).toContain("mobility");
    expect(prompt).toContain("27");
    expect(prompt).toContain("inCheck");
    expect(prompt).toContain("false");
    expect(prompt).toContain("phase");
    expect(prompt).toContain("opening");
    expect(prompt).not.toContain("kingSafety");
    expect(prompt).not.toContain("987654");
    expect(prompt).not.toContain("opponentMateInOne");
  });
});

describe("parseLlmResponse", () => {
  test("accepts the healthy strict-JSON transcript", () => {
    const result = parseLlmResponse(input(), loadTranscript("chat-ok"), 24);

    if (!result.ok) {
      throw new Error(`expected a valid chat decision: ${result.reason}`);
    }
    expect(result.decision.move).toBe("e2e4");
    expect(result.decision.strategy).toBe("direct");
    expect(result.decision.confidence).toBe(0.82);
    expect(result.decision.distribution).toEqual({
      e2e4: 0.55,
      d2d4: 0.3,
      g1f3: 0.15,
    });
    expect(result.decision.latencyMs).toBe(24);
    expect(result.decision.tokens).toEqual({ in: 211, out: 45 });
  });

  test("recovers a JSON object wrapped in prose and a code fence", () => {
    const result = parseLlmResponse(input(), loadTranscript("chat-prose-wrapped"), 31);

    if (!result.ok) {
      throw new Error(`expected fenced JSON recovery: ${result.reason}`);
    }
    expect(result.decision.move).toBe("e2e4");
    expect(result.decision.strategy).toBe("direct");
    expect(result.decision.confidence).toBe(0.76);
    expect(result.decision.distribution).toEqual({
      e2e4: 0.5,
      d2d4: 0.3,
      g1f3: 0.2,
    });
  });

  test("classifies an illegal move as illegal-output", () => {
    expectFailure(
      parseLlmResponse(input(), loadTranscript("chat-illegal-move"), 18),
      "illegal-output",
    );
  });

  test("classifies empty response text as malformed-response", () => {
    expectFailure(
      parseLlmResponse(input(), loadTranscript("chat-empty"), 18),
      "malformed-response",
    );
  });

  test("classifies a numeric move field as malformed-response", () => {
    expectFailure(
      parseLlmResponse(input(), loadTranscript("chat-wrong-type"), 18),
      "malformed-response",
    );
  });

  test("rejects a distribution containing a __proto__ key", () => {
    expectFailure(
      parseLlmResponse(
        input(),
        {
          kind: "chat",
          text:
            '{"move":"e2e4","strategy":"direct","distribution":{"e2e4":1,"__proto__":7}}',
        },
        18,
      ),
      "malformed-distribution",
    );
  });

  test("rejects negative token counts as malformed-response", () => {
    expectFailure(
      parseLlmResponse(
        input(),
        {
          kind: "chat",
          text: '{"move":"e2e4","strategy":"direct"}',
          tokens: { in: -1, out: 12 },
        },
        18,
      ),
      "malformed-response",
    );
  });

  test("classifies HTTP 429 as provider-error", () => {
    expectFailure(
      parseLlmResponse(input(), loadTranscript("error-429"), 18),
      "provider-error",
    );
  });

  test("classifies HTTP 500 as provider-error", () => {
    expectFailure(
      parseLlmResponse(input(), loadTranscript("error-500"), 18),
      "provider-error",
    );
  });

  test("classifies a socket failure as provider-error", () => {
    expectFailure(
      parseLlmResponse(input(), loadTranscript("error-socket"), 18),
      "provider-error",
    );
  });
});
