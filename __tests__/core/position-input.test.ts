import { describe, expect, test } from "bun:test";
import { positionFixture } from "../fixtures/positions.ts";
import { RANDOM_MANIFEST } from "../fixtures/manifests.ts";
import { buildPositionInput } from "../../src/core/position-input.ts";
import { legalMoves } from "../../src/core/rules.ts";
import type { Position } from "../../src/core/rules.ts";
import type {
  CompetitorManifest,
  PlayerRecord,
} from "../../src/core/types.ts";

const START = positionFixture("start");

const TWO_FEATURE_PERSONA: CompetitorManifest = {
  ...RANDOM_MANIFEST,
  name: "two-feature",
  version: "two-feature-v1",
  features: ["mobility", "phase"],
  historyPlies: 2,
  budget: { maxMs: 75, maxCostUsd: 0.01 },
};

const RECORD: PlayerRecord = {
  competitor: TWO_FEATURE_PERSONA.name,
  version: TWO_FEATURE_PERSONA.version,
  games: 4,
  wins: 2,
  draws: 1,
  losses: 1,
  byColour: { white: 3, black: 1 },
  byStrategy: {},
};

function startPosition(overrides: Partial<Position> = {}): Position {
  return {
    fen: START.fen,
    ply: 0,
    turn: START.turn,
    history: [],
    ...overrides,
  };
}

function build(position: Position, record?: PlayerRecord) {
  const args = {
    seasonId: "season-2026",
    gameId: "game-7",
    position,
    persona: TWO_FEATURE_PERSONA,
  };

  return record === undefined
    ? buildPositionInput(args)
    : buildPositionInput({ ...args, record });
}

describe("buildPositionInput", () => {
  test("copies the rules layer's complete legal move list", () => {
    const position = startPosition();
    const expectedMoves = legalMoves(position);

    const input = build(position);

    expect(input.legalMoves).toEqual(expectedMoves);
    expect(input.legalMoves).toHaveLength(START.legalMoveCount);
  });

  test("keeps only the most recent configured history plies in chronological order", () => {
    const input = build(
      startPosition({
        ply: 6,
        history: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
      }),
    );

    expect(input.history).toEqual(["Bb5", "a6"]);
    expect(input.ply).toBe(6);
  });

  test("exposes exactly the feature keys declared by the persona", () => {
    const input = build(startPosition());

    expect(input.features).toEqual({ mobility: START.legalMoveCount, phase: "opening" });
    expect(Object.keys(input.features)).toEqual(["mobility", "phase"]);
    expect(Object.keys(input.features)).toHaveLength(2);
  });

  test("sets colour from the position turn and carries the persona budget", () => {
    const input = build(startPosition({ turn: "black" }));

    expect(input.colour).toBe("black");
    expect(input.budget).toEqual({ maxMs: 75, maxCostUsd: 0.01 });
  });

  test("omits record when none is supplied", () => {
    const input = build(startPosition());

    expect("record" in input).toBe(false);
  });

  test("includes the supplied player record unchanged", () => {
    const input = build(startPosition(), RECORD);

    expect(input.record).toEqual(RECORD);
  });
});
