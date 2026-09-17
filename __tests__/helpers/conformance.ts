import { Chess } from "chess.js";

import type {
  Clock,
  Colour,
  Competitor,
  CompetitorManifest,
  PositionInput,
  Rng,
} from "../../src/core/types.ts";
import { createGreedyPlayer } from "../../src/players/greedy.ts";
import { createJevPlayer } from "../../src/players/jev.ts";
import { createLlmPlayer } from "../../src/players/llm.ts";
import { createRandomPlayer } from "../../src/players/random.ts";
import { createScriptedPlayer } from "../../src/players/scripted.ts";
import {
  GREEDY_MANIFEST,
  JEV_FLAT_MANIFEST,
  JEV_HIERARCHICAL_MANIFEST,
  LLM_MANIFEST,
  RANDOM_MANIFEST,
  SCRIPTED_MANIFEST,
} from "../fixtures/manifests.ts";
import {
  positionFixture,
  type PositionFixtureId,
} from "../fixtures/positions.ts";
import {
  createRecordedProvider,
  type TranscriptId,
} from "./recorded-provider.ts";

export interface PlayerCase {
  readonly name: string;
  readonly manifest: CompetitorManifest;
  readonly build: (seed: string) => Competitor;
}

const FIXED_CLOCK: Clock = {
  now: () => 1_000,
};

function createTestRng(seed: string): Rng {
  let state = 2_166_136_261;
  for (const character of seed) {
    state = Math.imul(state ^ character.charCodeAt(0), 16_777_619) >>> 0;
  }

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  return {
    next,
    nextInt(boundExclusive: number): number {
      if (!Number.isSafeInteger(boundExclusive) || boundExclusive <= 0) {
        throw new RangeError("boundExclusive must be a positive safe integer");
      }
      return Math.floor(next() * boundExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new RangeError("cannot pick from an empty list");
      }
      const selectedIndex = Math.floor(next() * items.length);
      for (const [index, item] of items.entries()) {
        if (index === selectedIndex) return item;
      }
      throw new RangeError("selected index was outside the list");
    },
  };
}

function repeatedTranscript(id: TranscriptId): readonly TranscriptId[] {
  return Array.from({ length: 64 }, () => id);
}

function caseFor(
  name: string,
  manifest: CompetitorManifest,
  build: (seed: string) => Competitor,
): PlayerCase {
  return { name, manifest, build };
}

export function buildCases(): readonly PlayerCase[] {
  return [
    caseFor("random", RANDOM_MANIFEST, (seed) =>
      createRandomPlayer(RANDOM_MANIFEST, createTestRng(seed), FIXED_CLOCK),
    ),
    caseFor("greedy", GREEDY_MANIFEST, (seed) =>
      createGreedyPlayer(GREEDY_MANIFEST, createTestRng(seed), FIXED_CLOCK),
    ),
    caseFor("scripted", SCRIPTED_MANIFEST, (seed) =>
      createScriptedPlayer(SCRIPTED_MANIFEST, createTestRng(seed), FIXED_CLOCK),
    ),
    caseFor("llm", LLM_MANIFEST, (seed) =>
      createLlmPlayer(
        LLM_MANIFEST,
        createRecordedProvider(repeatedTranscript("chat-ok")),
        FIXED_CLOCK,
        createTestRng(seed),
      ),
    ),
    caseFor("jev-flat", JEV_FLAT_MANIFEST, (seed) =>
      createJevPlayer(
        JEV_FLAT_MANIFEST,
        createRecordedProvider(repeatedTranscript("jev-flat-ok")),
        FIXED_CLOCK,
        createTestRng(seed),
      ),
    ),
    caseFor("jev-hierarchical", JEV_HIERARCHICAL_MANIFEST, (seed) =>
      createJevPlayer(
        JEV_HIERARCHICAL_MANIFEST,
        createRecordedProvider(repeatedTranscript("jev-hierarchical-ok")),
        FIXED_CLOCK,
        createTestRng(seed),
      ),
    ),
  ];
}

export function inputFor(
  fixtureId: PositionFixtureId,
  manifest: CompetitorManifest,
): PositionInput {
  const fixture = positionFixture(fixtureId);
  const chess = new Chess(fixture.fen);
  const legalMoves = chess.moves({ verbose: true }).map(
    (move) => `${move.from}${move.to}${move.promotion ?? ""}`,
  );
  const fullmoveField = fixture.fen.split(" ")[5];
  if (fullmoveField === undefined) {
    throw new Error(`fixture ${fixture.id} has no fullmove field`);
  }
  const fullmove = Number.parseInt(fullmoveField, 10);
  if (!Number.isSafeInteger(fullmove) || fullmove < 1) {
    throw new Error(`fixture ${fixture.id} has an invalid fullmove field`);
  }
  const colour: Colour = chess.turn() === "w" ? "white" : "black";

  return {
    seasonId: "conformance-season",
    gameId: `conformance-${fixture.id}`,
    ply: (fullmove - 1) * 2 + (chess.turn() === "b" ? 1 : 0),
    colour,
    fen: fixture.fen,
    history: [],
    legalMoves,
    features: {},
    persona: manifest,
    budget: manifest.budget,
  };
}

