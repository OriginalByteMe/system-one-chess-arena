import { describe, expect, test } from "bun:test";
import type { ModelPricing } from "../../src/core/types.ts";
import { PRICING, UNPRICED, costUsd, pricingFor } from "../../src/season/cost.ts";
import { decision } from "../fixtures/leaderboard.ts";

function jevPricing(): ModelPricing {
  const pricing = PRICING.jev;
  if (pricing === undefined) {
    throw new Error("PRICING is missing the jev fixture entry");
  }
  return pricing;
}

describe("pricingFor", () => {
  test("matches a patch version by its longest prefix", () => {
    expect(pricingFor("jev-1.13.0")).toEqual(jevPricing());
  });

  test("matches a rolling alias by the same prefix", () => {
    expect(pricingFor("jev-latest")).toEqual(jevPricing());
  });

  test("matches the bare model name exactly", () => {
    expect(pricingFor("jev")).toEqual(jevPricing());
  });

  test("is unpriced for a model with no published entry", () => {
    expect(pricingFor("gpt-9000")).toEqual(UNPRICED);
  });

  test("requires a real prefix, not just a shared substring", () => {
    expect(pricingFor("not-jev")).toEqual(UNPRICED);
  });
});

describe("costUsd", () => {
  test("bills input tokens at the per-million rate for a known model", () => {
    const decisions = [
      decision({
        gameId: "g1",
        competitor: "Nova",
        version: "jev-v1",
        colour: "white",
        tokens: { in: 500_000, out: 200_000 },
      }),
    ];

    expect(costUsd(decisions, new Map([["jev-v1", "jev"]]))).toBeCloseTo(0.021, 6);
  });

  test("sums cost across every decision", () => {
    const decisions = [
      decision({
        gameId: "g1",
        competitor: "Nova",
        version: "jev-v1",
        colour: "white",
        ply: 1,
        tokens: { in: 500_000, out: 0 },
      }),
      decision({
        gameId: "g1",
        competitor: "Nova",
        version: "jev-v1",
        colour: "white",
        ply: 2,
        tokens: { in: 250_000, out: 0 },
      }),
    ];

    expect(costUsd(decisions, new Map([["jev-v1", "jev"]]))).toBeCloseTo(0.0315, 6);
  });

  test("costs nothing for a decision with no recorded token usage", () => {
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "jev-v1", colour: "white" }),
    ];

    expect(costUsd(decisions, new Map([["jev-v1", "jev"]]))).toBe(0);
  });

  test("costs nothing, without throwing, for a decision whose version is unmapped", () => {
    const decisions = [
      decision({
        gameId: "g1",
        competitor: "Nova",
        version: "unknown-version",
        colour: "white",
        tokens: { in: 500_000, out: 500_000 },
      }),
    ];

    expect(() => costUsd(decisions, new Map())).not.toThrow();
    expect(costUsd(decisions, new Map())).toBe(0);
  });

  test("only the unmapped decision is excluded when others are priced", () => {
    const decisions = [
      decision({
        gameId: "g1",
        competitor: "Nova",
        version: "jev-v1",
        colour: "white",
        ply: 1,
        tokens: { in: 1_000_000, out: 0 },
      }),
      decision({
        gameId: "g1",
        competitor: "Nova",
        version: "unmapped-v1",
        colour: "white",
        ply: 2,
        tokens: { in: 1_000_000, out: 0 },
      }),
    ];

    expect(costUsd(decisions, new Map([["jev-v1", "jev"]]))).toBeCloseTo(0.042, 6);
  });
});
