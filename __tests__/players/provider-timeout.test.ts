import { describe, expect, test } from "bun:test";
import { createFixedClock } from "../../src/core/clock.ts";
import type {
  ChatRequest,
  PositionInput,
  Provider,
  Rng,
} from "../../src/core/types.ts";
import { createLlmPlayer } from "../../src/players/llm.ts";
import { LLM_MANIFEST } from "../fixtures/manifests.ts";
import {
  createCountingProvider,
  createRecordedProvider,
  loadTranscript,
} from "../helpers/recorded-provider.ts";

const rng: Rng = {
  next: () => 0,
  nextInt(boundExclusive) {
    if (boundExclusive <= 0) {
      throw new Error("bound must be positive");
    }
    return 0;
  },
  pick<T>(items: readonly T[]): T {
    const first = items[0];
    if (first === undefined) {
      throw new Error("cannot pick from an empty list");
    }
    return first;
  },
};

function input(): PositionInput {
  return {
    seasonId: "season-provider-tests",
    gameId: "game-timeout",
    ply: 2,
    colour: "white",
    fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    history: ["e4", "e5"],
    legalMoves: ["e2e4", "d2d4", "g1f3"],
    features: {
      materialBalance: 0,
      mobility: 29,
      inCheck: false,
      phase: "opening",
    },
    persona: LLM_MANIFEST,
    budget: LLM_MANIFEST.budget,
  };
}

describe("provider timing and failures", () => {
  test("uses the declared fallback when provider latency exceeds maxMs", async () => {
    const clock = createFixedClock(1_000);
    const recorded = createCountingProvider(loadTranscript("chat-ok"));
    const provider: Provider = {
      async ask(request) {
        clock.advance(LLM_MANIFEST.budget.maxMs + 1);
        return recorded.ask(request);
      },
    };
    const player = createLlmPlayer(LLM_MANIFEST, provider, clock, rng);

    const decision = await player.decide(input());

    expect(recorded.calls()).toBe(1);
    expect(decision.move).toBe("e2e4");
    expect(decision.strategy).toBe("direct");
    expect(decision.fallback).toBe("timeout");
    expect(decision.latencyMs).toBeGreaterThanOrEqual(LLM_MANIFEST.budget.maxMs);
  });

  test("does not tag a provider response that resolves within budget", async () => {
    const clock = createFixedClock(2_000);
    const recorded = createCountingProvider(loadTranscript("chat-ok"));
    const provider: Provider = {
      async ask(request) {
        clock.advance(LLM_MANIFEST.budget.maxMs - 1);
        return recorded.ask(request);
      },
    };
    const player = createLlmPlayer(LLM_MANIFEST, provider, clock, rng);

    const decision = await player.decide(input());

    expect(recorded.calls()).toBe(1);
    expect(decision.move).toBe("e2e4");
    expect(decision.fallback).toBeUndefined();
    expect(decision.latencyMs).toBe(LLM_MANIFEST.budget.maxMs - 1);
  });

  test("converts a thrown provider error into provider-error fallback", async () => {
    const clock = createFixedClock(3_000);
    const provider: Provider = {
      async ask() {
        clock.advance(7);
        throw new Error("connection reset by peer");
      },
    };
    const player = createLlmPlayer(LLM_MANIFEST, provider, clock, rng);

    const decision = await player.decide(input());

    expect(decision.move).toBe("e2e4");
    expect(decision.strategy).toBe("direct");
    expect(decision.fallback).toBe("provider-error");
    expect(decision.latencyMs).toBe(7);
  });
});

describe("recorded provider helper", () => {
  test("replays transcripts in order and throws a clear exhaustion error", async () => {
    const provider = createRecordedProvider(["error-429", "chat-ok"]);
    const request: ChatRequest = {
      kind: "chat",
      model: "test-chat-model",
      messages: [{ role: "user", content: "choose a move" }],
      jsonOnly: true,
    };

    expect(await provider.ask(request)).toEqual(loadTranscript("error-429"));
    expect(await provider.ask(request)).toEqual(loadTranscript("chat-ok"));
    await expect(provider.ask(request)).rejects.toThrow(
      "recorded provider exhausted after 2 response(s)",
    );
  });
});
