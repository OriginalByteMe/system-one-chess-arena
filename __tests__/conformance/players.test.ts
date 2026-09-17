import { describe, expect, test } from "bun:test";

import type {
  CompetitorManifest,
  FallbackReason,
  MoveDecision,
  PositionInput,
} from "../../src/core/types.ts";
import { ALL_MANIFESTS } from "../fixtures/manifests.ts";
import { POSITIONS } from "../fixtures/positions.ts";
import {
  buildCases,
  inputFor,
  type PlayerCase,
} from "../helpers/conformance.ts";

const FALLBACK_REASONS = [
  "timeout",
  "illegal-output",
  "provider-error",
  "malformed-response",
  "malformed-distribution",
  "unknown-strategy",
] as const satisfies readonly FallbackReason[];

const PLAYABLE_POSITIONS = POSITIONS.filter(
  (fixture) => fixture.legalMoveCount > 0,
);

function manifestKey(manifest: CompetitorManifest): string {
  return `${manifest.name}@${manifest.version}`;
}

function assertValidDecision(
  decision: MoveDecision,
  input: PositionInput,
  manifest: CompetitorManifest,
): void {
  expect(input.legalMoves).toContain(decision.move);
  expect(manifest.strategies).toContain(decision.strategy);
  expect(Number.isFinite(decision.latencyMs)).toBe(true);
  expect(decision.latencyMs).toBeGreaterThanOrEqual(0);

  if (decision.fallback !== undefined) {
    expect(FALLBACK_REASONS).toContain(decision.fallback);
    expect(input.legalMoves).toContain(decision.move);
  }

  if (decision.distribution !== undefined) {
    for (const [move, probability] of Object.entries(decision.distribution)) {
      expect(input.legalMoves).toContain(move);
      expect(Number.isFinite(probability)).toBe(true);
      expect(probability).toBeGreaterThanOrEqual(0);
      expect(probability).toBeLessThanOrEqual(1);
    }
    const total = Object.values(decision.distribution).reduce(
      (sum, probability) => sum + probability,
      0,
    );
    expect(Math.abs(total - 1)).toBeLessThanOrEqual(1e-6);
  }

  if (decision.confidence !== undefined) {
    expect(decision.confidence).toBeGreaterThanOrEqual(0);
    expect(decision.confidence).toBeLessThanOrEqual(1);
  }
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }
  const properties = value as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(properties)) {
    deepFreeze(properties[key]);
  }
  Object.freeze(value);
}

function definePlayerConformance(playerCase: PlayerCase): void {
  describe(playerCase.name, () => {
    for (const fixture of PLAYABLE_POSITIONS) {
      test(`${fixture.id}: returns a valid deterministic decision`, async () => {
        const input = inputFor(fixture.id, playerCase.manifest);
        const seed = `conformance:${playerCase.name}:${fixture.id}`;
        const firstPlayer = playerCase.build(seed);
        const secondPlayer = playerCase.build(seed);

        const firstDecision = await firstPlayer.decide(input);
        const secondDecision = await secondPlayer.decide(input);

        assertValidDecision(firstDecision, input, firstPlayer.manifest);
        assertValidDecision(secondDecision, input, secondPlayer.manifest);
        expect(secondDecision).toEqual(firstDecision);
      });
    }

    test("does not mutate any supplied position input", async () => {
      for (const fixture of PLAYABLE_POSITIONS) {
        const input = structuredClone(inputFor(fixture.id, playerCase.manifest));
        deepFreeze(input);

        const player = playerCase.build(
          `immutable:${playerCase.name}:${fixture.id}`,
        );
        const decision = await player.decide(input);
        assertValidDecision(decision, input, player.manifest);
      }
    });
  });
}

test("conformance cases cover every manifest exactly once", () => {
  const actual = buildCases().map(({ manifest }) => manifestKey(manifest)).sort();
  const expected = ALL_MANIFESTS.map(manifestKey).sort();

  expect(actual).toEqual(expected);
  expect(new Set(actual).size).toBe(actual.length);
});

for (const playerCase of buildCases()) {
  definePlayerConformance(playerCase);
}
