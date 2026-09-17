import { describe, expect, test } from "bun:test";
import {
  applyFallback,
  validateDecision,
} from "../../src/core/validation.ts";
import type {
  CompetitorManifest,
  FallbackReason,
  MoveDecision,
  PositionInput,
  RawDecision,
  Rng,
  ValidationResult,
} from "../../src/core/types.ts";
import {
  GREEDY_MANIFEST,
  RANDOM_MANIFEST,
  SCRIPTED_MANIFEST,
} from "../fixtures/manifests.ts";

const START_FEN = "rn1qkbnr/pppbpppp/8/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq - 2 3";

function positionInput(
  persona: CompetitorManifest,
  fen: string = START_FEN,
  legalMoves: readonly string[] = ["e2e4", "d2d4"],
): PositionInput {
  return {
    seasonId: "season-validation",
    gameId: "game-validation",
    ply: 4,
    colour: "white",
    fen,
    history: ["d4", "d5", "Nf3", "Bd7"],
    legalMoves,
    features: {},
    persona,
    budget: persona.budget,
  };
}

function expectRejected(
  result: ValidationResult,
  reason: FallbackReason,
): void {
  if (result.ok) {
    throw new Error(`expected rejection ${reason}, received an accepted decision`);
  }
  expect(result.reason).toBe(reason);
}

function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  const nextInt = (boundExclusive: number): number => {
    if (!Number.isInteger(boundExclusive) || boundExclusive <= 0) {
      throw new RangeError("boundExclusive must be a positive integer");
    }
    return Math.floor(next() * boundExclusive);
  };

  return {
    next,
    nextInt,
    pick<T>(items: readonly T[]): T {
      const item = items[nextInt(items.length)];
      if (item === undefined) {
        throw new RangeError("cannot pick from an empty list");
      }
      return item;
    },
  };
}

function expectFallbackDecision(
  decision: MoveDecision,
  expected: MoveDecision,
): void {
  expect(decision).toEqual(expected);
}

describe("validateDecision", () => {
  const input = positionInput(SCRIPTED_MANIFEST);

  test("accepts a legal declared decision and preserves optional response data", () => {
    const raw: RawDecision = {
      move: "e2e4",
      strategy: "attack",
      confidence: 0.8,
      distribution: { e2e4: 0.75, d2d4: 0.25 },
      tokens: { in: 123, out: 17 },
      latencyMs: 42,
    };

    expect(validateDecision(input, raw)).toEqual({
      ok: true,
      decision: {
        move: "e2e4",
        strategy: "attack",
        confidence: 0.8,
        distribution: { e2e4: 0.75, d2d4: 0.25 },
        tokens: { in: 123, out: 17 },
        latencyMs: 42,
      },
    });
  });

  test("rejects a syntactically valid move absent from legalMoves", () => {
    expectRejected(
      validateDecision(input, {
        move: "a1a8",
        strategy: "attack",
        latencyMs: 10,
      }),
      "illegal-output",
    );
  });

  test("rejects a syntactically malformed move even when legalMoves contains it", () => {
    const malformedListedInput = positionInput(SCRIPTED_MANIFEST, START_FEN, [
      "e2e4",
      "e2-e4",
    ]);

    expectRejected(
      validateDecision(malformedListedInput, {
        move: "e2-e4",
        strategy: "attack",
        latencyMs: 10,
      }),
      "illegal-output",
    );
  });

  test("rejects a strategy outside the persona strategy set", () => {
    expectRejected(
      validateDecision(input, {
        move: "e2e4",
        strategy: "fortify",
        latencyMs: 10,
      }),
      "unknown-strategy",
    );
  });

  test("rejects a distribution containing a move outside legalMoves", () => {
    expectRejected(
      validateDecision(input, {
        move: "e2e4",
        strategy: "attack",
        distribution: { e2e4: 0.5, a1a8: 0.5 },
        latencyMs: 10,
      }),
      "malformed-distribution",
    );
  });

  test("rejects a distribution whose probabilities do not sum to one", () => {
    expectRejected(
      validateDecision(input, {
        move: "e2e4",
        strategy: "attack",
        distribution: { e2e4: 0.6, d2d4: 0.3 },
        latencyMs: 10,
      }),
      "malformed-distribution",
    );
  });

  test("rejects negative confidence", () => {
    expectRejected(
      validateDecision(input, {
        move: "e2e4",
        strategy: "attack",
        confidence: -0.01,
        latencyMs: 10,
      }),
      "malformed-response",
    );
  });

  test("rejects confidence greater than one", () => {
    expectRejected(
      validateDecision(input, {
        move: "e2e4",
        strategy: "attack",
        confidence: 1.01,
        latencyMs: 10,
      }),
      "malformed-response",
    );
  });
});

describe("applyFallback", () => {
  test("first-legal returns the first move with latency, first strategy, and reason", () => {
    const input = positionInput(SCRIPTED_MANIFEST);
    const decision = applyFallback(
      input,
      "provider-error",
      seededRng(7),
      91,
    );

    expectFallbackDecision(decision, {
      move: "e2e4",
      strategy: "attack",
      latencyMs: 91,
      fallback: "provider-error",
    });
  });

  test("greedy returns the highest-material-gain capture with fallback metadata", () => {
    const input = positionInput(
      GREEDY_MANIFEST,
      "3qk3/8/8/8/8/8/8/3RK3 w - - 0 1",
      ["d1d2", "d1d8", "e1e2"],
    );
    const decision = applyFallback(
      input,
      "malformed-response",
      seededRng(11),
      37,
    );

    expectFallbackDecision(decision, {
      move: "d1d8",
      strategy: "direct",
      latencyMs: 37,
      fallback: "malformed-response",
    });
  });

  test("random-legal is seed-reproducible and always returns a legal move", () => {
    const input = positionInput(RANDOM_MANIFEST, START_FEN, [
      "e2e4",
      "d2d4",
      "g1f3",
      "b1c3",
    ]);
    const first = applyFallback(input, "timeout", seededRng(29), 64);
    const repeated = applyFallback(input, "timeout", seededRng(29), 64);

    expect(repeated).toEqual(first);
    expect(input.legalMoves).toContain(first.move);
    expect(first.strategy).toBe("direct");
    expect(first.latencyMs).toBe(64);
    expect(first.fallback).toBe("timeout");

    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const decision = applyFallback(
        input,
        "illegal-output",
        seededRng(seed),
        65,
      );
      expect(input.legalMoves).toContain(decision.move);
      expect(decision.strategy).toBe("direct");
      expect(decision.latencyMs).toBe(65);
      expect(decision.fallback).toBe("illegal-output");
    }
  });
});
