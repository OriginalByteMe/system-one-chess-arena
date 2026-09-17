import { describe, expect, test } from "bun:test";
import { argmax, sumProbabilities, validateDistribution } from "../../src/core/distribution.ts";
import { createRng } from "../../src/core/rng.ts";
import type { MoveDistribution, Uci } from "../../src/core/types.ts";

describe("sumProbabilities", () => {
  test("sums a known move distribution", () => {
    const distribution: MoveDistribution = {
      e2e4: 0.25,
      d2d4: 0.5,
      g1f3: 0.25,
    };

    expect(sumProbabilities(distribution)).toBe(1);
  });
});

describe("validateDistribution", () => {
  const legalMoves: readonly Uci[] = ["e2e4", "d2d4", "g1f3"];

  test("accepts a normalised distribution containing only legal moves", () => {
    expect(
      validateDistribution(
        { e2e4: 0.2, d2d4: 0.3, g1f3: 0.5 },
        legalMoves,
      ),
    ).toBe(true);
  });

  test("rejects a distribution whose probabilities sum to 0.5", () => {
    expect(validateDistribution({ e2e4: 0.2, d2d4: 0.3 }, legalMoves)).toBe(false);
  });

  test("rejects a distribution whose probabilities sum to 1.5", () => {
    expect(validateDistribution({ e2e4: 0.75, d2d4: 0.75 }, legalMoves)).toBe(false);
  });

  test("rejects a move that is not legal", () => {
    expect(validateDistribution({ e2e4: 0.5, a1a8: 0.5 }, legalMoves)).toBe(false);
  });

  test("rejects a negative probability", () => {
    expect(validateDistribution({ e2e4: 1.1, d2d4: -0.1 }, legalMoves)).toBe(false);
  });

  test("rejects an empty distribution", () => {
    expect(validateDistribution({}, legalMoves)).toBe(false);
  });

  test("accepts probability drift of 1e-7", () => {
    expect(validateDistribution({ e2e4: 0.5, d2d4: 0.5000001 }, legalMoves)).toBe(true);
  });

  test("rejects probability drift of 1e-3", () => {
    expect(validateDistribution({ e2e4: 0.5, d2d4: 0.501 }, legalMoves)).toBe(false);
  });
});

describe("argmax", () => {
  test("returns the single highest-probability move", () => {
    expect(
      argmax(
        { e2e4: 0.2, d2d4: 0.7, g1f3: 0.1 },
        createRng("single-maximum"),
      ),
    ).toBe("d2d4");
  });

  test("an exact tie is reproducible for the same seed", () => {
    const distribution: MoveDistribution = { e2e4: 0.5, d2d4: 0.5 };

    const first = argmax(distribution, createRng("repeatable-tie"));
    const second = argmax(distribution, createRng("repeatable-tie"));

    expect(first).toBe(second);
    expect(["e2e4", "d2d4"]).toContain(first);
  });

  test("different seeded draws can select either move in an exact tie", () => {
    const tiedMoves: readonly Uci[] = ["e2e4", "d2d4"];
    const distribution: MoveDistribution = { e2e4: 0.5, d2d4: 0.5 };
    let firstSeed: string | undefined;
    let secondSeed: string | undefined;
    let firstDraw: Uci | undefined;

    for (let candidate = 0; candidate < 1_000; candidate += 1) {
      const seed = `tie-candidate-${candidate}`;
      const draw = createRng(seed).pick(tiedMoves);
      if (firstSeed === undefined) {
        firstSeed = seed;
        firstDraw = draw;
      } else if (draw !== firstDraw) {
        secondSeed = seed;
        break;
      }
    }

    if (firstSeed === undefined || secondSeed === undefined) {
      throw new Error("expected two seeds with different tied draws");
    }

    const first = argmax(distribution, createRng(firstSeed));
    const second = argmax(distribution, createRng(secondSeed));

    expect(first).not.toBe(second);
    expect(tiedMoves).toContain(first);
    expect(tiedMoves).toContain(second);
    expect(new Set([first, second])).toEqual(new Set(tiedMoves));
  });

  test("rejects an empty distribution", () => {
    expect(() => argmax({}, createRng("empty-argmax"))).toThrow();
  });
});
