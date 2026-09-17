import { describe, expect, test } from "bun:test";
import {
  FEATURE_KEYS,
  type ChoiceQuestion,
  type CompetitorManifest,
  type PositionInput,
  type SystemOneRequest,
  type Uci,
} from "../../src/core/types.ts";
import { buildJevRequests } from "../../src/players/jev.ts";
import {
  JEV_FLAT_MANIFEST,
  JEV_HIERARCHICAL_MANIFEST,
} from "../fixtures/manifests.ts";

const LEGAL_MOVES = ["e2e4", "d2d4", "g1f3"] as const;
const HISTORY = [
  "e4",
  "e5",
  "Nf3",
  "Nc6",
  "Bb5",
  "a6",
  "Ba4",
  "Nf6",
  "O-O",
  "Be7",
  "Re1",
  "b5",
  "Bb3",
  "d6",
  "c3",
] as const;

function input(persona: CompetitorManifest, legalMoves: readonly Uci[] = LEGAL_MOVES): PositionInput {
  return {
    seasonId: "season-provider-tests",
    gameId: `game-${persona.name}`,
    ply: 15,
    colour: "black",
    fen: "r1bqk2r/1pppbppp/p1np1n2/1B2p3/4P3/2P2N2/PP1P1PPP/RNBQR1K1 b kq - 0 8",
    history: HISTORY,
    legalMoves,
    features: {
      materialBalance: -100,
      mobility: 31,
      opponentMobility: 28,
      hangingOwnPieces: 1,
      hangingOpponentPieces: 2,
      kingSafety: 4,
      inCheck: false,
      opponentMateInOne: false,
      lastMoveAttacks: 1,
      lastMoveThreatValue: 987654,
      lastMoveWasCapture: false,
      development: 3,
      phase: "opening",
    },
    persona,
    budget: persona.budget,
  };
}

function questions(request: SystemOneRequest): readonly ChoiceQuestion[] {
  return Object.values(request.questions);
}

function onlyQuestion(request: SystemOneRequest): ChoiceQuestion {
  const found = questions(request);
  expect(found).toHaveLength(1);
  const question = found[0];
  if (question === undefined) {
    throw new Error("expected exactly one question");
  }
  return question;
}

describe("buildJevRequests", () => {
  test("builds one flat move question preserving legal-move order", () => {
    const requests = buildJevRequests(input(JEV_FLAT_MANIFEST));

    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (request === undefined) {
      throw new Error("expected one flat request");
    }
    expect(request.kind).toBe("systemone");
    expect(request.model).toBe(JEV_FLAT_MANIFEST.model);
    expect(onlyQuestion(request).options).toEqual(LEGAL_MOVES);
  });

  test("builds a strategy request followed by a move request for a hierarchical persona", () => {
    const requests = buildJevRequests(input(JEV_HIERARCHICAL_MANIFEST));

    expect(requests).toHaveLength(2);
    const strategyRequest = requests[0];
    const moveRequest = requests[1];
    if (strategyRequest === undefined || moveRequest === undefined) {
      throw new Error("expected strategy and move requests");
    }
    expect(strategyRequest.model).toBe(JEV_HIERARCHICAL_MANIFEST.model);
    expect(moveRequest.model).toBe(JEV_HIERARCHICAL_MANIFEST.model);
    expect(onlyQuestion(strategyRequest).options).toEqual(
      JEV_HIERARCHICAL_MANIFEST.strategies,
    );
    expect(onlyQuestion(moveRequest).options).toEqual(LEGAL_MOVES);
  });

  test("exposes capped history and only persona-declared features in state", () => {
    const position = input(JEV_HIERARCHICAL_MANIFEST);
    const requests = buildJevRequests(position);
    const expectedHistory = HISTORY.slice(-JEV_HIERARCHICAL_MANIFEST.historyPlies);

    for (const request of requests) {
      expect(request.state.playstyle).toBe(JEV_HIERARCHICAL_MANIFEST.playstyle);
      expect(request.state.fen).toBe(position.fen);
      expect(request.state.history).toEqual(expectedHistory);
      for (const key of FEATURE_KEYS) {
        if (JEV_HIERARCHICAL_MANIFEST.features.includes(key)) {
          expect(request.state[key]).toEqual(position.features[key]);
        } else {
          expect(Object.hasOwn(request.state, key)).toBe(false);
        }
      }
    }
    expect(requests[0]?.state.lastMoveThreatValue).not.toBe(987654);
  });

  test("splits 300 moves without exceeding the provider's 255-option limit", () => {
    const legalMoves = Array.from(
      { length: 300 },
      (_, index): Uci => `synthetic-${index.toString().padStart(3, "0")}`,
    );
    const requests = buildJevRequests(input(JEV_FLAT_MANIFEST, legalMoves));
    const moveQuestions = requests.flatMap((request) => questions(request));
    const offeredMoves = moveQuestions.flatMap((question) => question.options);

    expect(moveQuestions.length).toBeGreaterThan(1);
    for (const question of moveQuestions) {
      expect(question.options.length).toBeLessThanOrEqual(255);
    }
    expect(offeredMoves).toEqual(legalMoves);
    expect(new Set(offeredMoves).size).toBe(300);
  });
});
