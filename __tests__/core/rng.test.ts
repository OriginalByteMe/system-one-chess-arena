import { describe, expect, test } from "bun:test";
import { createRng } from "../../src/core/rng.ts";

describe("createRng", () => {
  test("the same seed produces the same sequence of 100 values", () => {
    const left = createRng("repeatable-seed");
    const right = createRng("repeatable-seed");

    const leftValues = Array.from({ length: 100 }, () => left.next());
    const rightValues = Array.from({ length: 100 }, () => right.next());

    expect(leftValues).toEqual(rightValues);
  });

  test("different seeds diverge within their first ten values", () => {
    const left = createRng("seed-alpha");
    const right = createRng("seed-beta");
    const leftValues = Array.from({ length: 10 }, () => left.next());
    const rightValues = Array.from({ length: 10 }, () => right.next());

    expect(leftValues.some((value, index) => value !== rightValues[index])).toBe(true);
  });

  test("next always returns a value in [0, 1)", () => {
    const rng = createRng("unit-interval");

    for (let draw = 0; draw < 1_000; draw += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("nextInt(4) stays in range and covers every bucket", () => {
    const rng = createRng("four-buckets");
    const seen = new Set<number>();

    for (let draw = 0; draw < 1_000; draw += 1) {
      const value = rng.nextInt(4);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(4);
      seen.add(value);
    }

    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });

  test("nextInt(1) always returns zero", () => {
    const rng = createRng("one-bucket");

    for (let draw = 0; draw < 100; draw += 1) {
      expect(rng.nextInt(1)).toBe(0);
    }
  });

  test("nextInt rejects a zero bound", () => {
    const rng = createRng("invalid-bound");

    expect(() => rng.nextInt(0)).toThrow();
  });

  test("pick returns the sole item from a one-element list", () => {
    const rng = createRng("single-pick");

    expect(rng.pick(["only"])).toBe("only");
  });

  test("pick rejects an empty list", () => {
    const rng = createRng("empty-pick");

    expect(() => rng.pick([])).toThrow();
  });

  test("pick reaches every item in a four-element list", () => {
    const rng = createRng("four-picks");
    const items = ["a", "b", "c", "d"] as const;
    const seen = new Set<string>();

    for (let draw = 0; draw < 1_000; draw += 1) {
      seen.add(rng.pick(items));
    }

    expect(seen).toEqual(new Set(items));
  });

  test("independent RNGs with the same seed produce the same pick sequence", () => {
    const items = ["a2a4", "b2b4", "c2c4", "d2d4"] as const;
    const left = createRng("repeatable-picks");
    const right = createRng("repeatable-picks");

    const leftPicks = Array.from({ length: 100 }, () => left.pick(items));
    const rightPicks = Array.from({ length: 100 }, () => right.pick(items));

    expect(leftPicks).toEqual(rightPicks);
  });
});
