import { describe, expect, test } from "bun:test";
import type {
  Colour,
  CompetitorRef,
  DecisionRecord,
  FallbackReason,
  GameSummary,
  StrategyLabel,
} from "../../src/core/types";
import { rebuildRecord, rebuildRecords } from "../../src/season/record";

const ALPHA_V1: CompetitorRef = { name: "Alpha", version: "v1" };
const ALPHA_V2: CompetitorRef = { name: "Alpha", version: "v2" };
const BETA_V1: CompetitorRef = { name: "Beta", version: "v1" };
const GAMMA_V1: CompetitorRef = { name: "Gamma", version: "v1" };

interface DecisionExtras {
  readonly confidence?: number;
  readonly fallback?: FallbackReason;
}

function game(
  gameId: string,
  white: CompetitorRef,
  black: CompetitorRef,
  result: GameSummary["result"],
): GameSummary {
  return {
    seasonId: "season-1",
    gameId,
    white,
    black,
    openingId: "start",
    result,
    reason: result === "draw" ? "move-limit" : "checkmate",
    plies: 20,
    pgn: "1. e4 e5",
  };
}

function decision(
  gameId: string,
  ply: number,
  competitor: CompetitorRef,
  colour: Colour,
  strategy: StrategyLabel,
  extras: DecisionExtras = {},
): DecisionRecord {
  return {
    seasonId: "season-1",
    gameId,
    ply,
    competitor: competitor.name,
    version: competitor.version,
    colour,
    fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
    legalMoveCount: 3,
    move: colour === "white" ? "a1a2" : "h1h2",
    strategy,
    ...(extras.confidence === undefined
      ? {}
      : { confidence: extras.confidence }),
    latencyMs: 10,
    ...(extras.fallback === undefined ? {} : { fallback: extras.fallback }),
    featuresSeen: ["materialBalance"],
    idempotencyKey: `${gameId}:${ply}:${competitor.version}`,
  };
}

const GAME_1 = game("g1", ALPHA_V1, BETA_V1, "white");
const GAME_2 = game("g2", BETA_V1, ALPHA_V1, "white");
const GAME_3 = game("g3", ALPHA_V1, BETA_V1, "draw");
const GAMES: readonly GameSummary[] = [GAME_1, GAME_2, GAME_3];

const DECISIONS: readonly DecisionRecord[] = [
  decision("g1", 1, ALPHA_V1, "white", "direct", { confidence: 0.8 }),
  decision("g1", 2, BETA_V1, "black", "defend", { confidence: 0.4 }),
  decision("g2", 2, ALPHA_V1, "black", "direct", { fallback: "timeout" }),
  decision("g2", 1, BETA_V1, "white", "attack", { confidence: 0.7 }),
  decision("g3", 1, ALPHA_V1, "white", "attack", { confidence: 0.6 }),
  decision("g3", 2, BETA_V1, "black", "attack"),
];

describe("rebuildRecord", () => {
  test("derives outcomes, colour scores, and hand-checkable strategy totals", () => {
    expect(rebuildRecord(ALPHA_V1, DECISIONS, GAMES)).toEqual({
      competitor: "Alpha",
      version: "v1",
      games: 3,
      wins: 1,
      draws: 1,
      losses: 1,
      byColour: {
        white: 1.5,
        black: 0,
      },
      byStrategy: {
        direct: {
          picks: 2,
          score: 1,
          avgConfidence: 0.8,
        },
        attack: {
          picks: 1,
          score: 0.5,
          avgConfidence: 0.6,
        },
      },
    });
  });

  test("ignores decisions belonging to another competitor", () => {
    const unrelated = decision("g1", 3, GAMMA_V1, "white", "king-hunt", {
      confidence: 1,
    });

    expect(rebuildRecord(ALPHA_V1, [...DECISIONS, unrelated], GAMES)).toEqual(
      rebuildRecord(ALPHA_V1, DECISIONS, GAMES),
    );
  });

  test("returns a zeroed record for a competitor with no games", () => {
    expect(rebuildRecord(GAMMA_V1, DECISIONS, GAMES)).toEqual({
      competitor: "Gamma",
      version: "v1",
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      byColour: { white: 0, black: 0 },
      byStrategy: {},
    });
  });

  test("keeps two versions of the same competitor separate", () => {
    const versionGame = game("version-game", ALPHA_V2, ALPHA_V1, "white");

    expect(rebuildRecord(ALPHA_V2, [], [versionGame])).toMatchObject({
      competitor: "Alpha",
      version: "v2",
      games: 1,
      wins: 1,
      losses: 0,
      byColour: { white: 1, black: 0 },
    });
    expect(rebuildRecord(ALPHA_V1, [], [versionGame])).toMatchObject({
      competitor: "Alpha",
      version: "v1",
      games: 1,
      wins: 0,
      losses: 1,
      byColour: { white: 0, black: 0 },
    });
  });

  test("ignores absent confidences and reports zero when none are present", () => {
    const fallbackDecisions = [
      decision("g1", 1, ALPHA_V1, "white", "direct", {
        fallback: "provider-error",
      }),
      decision("g3", 1, ALPHA_V1, "white", "direct", {
        fallback: "illegal-output",
      }),
    ];

    expect(rebuildRecord(ALPHA_V1, fallbackDecisions, [GAME_1, GAME_3])).toMatchObject({
        byStrategy: {
          direct: {
            picks: 2,
            score: 1.5,
            avgConfidence: 0,
          },
        },
      });
  });

  test("counts fallback decisions as strategy picks", () => {
    const fallbackDecision = decision(
      "g1",
      1,
      ALPHA_V1,
      "white",
      "fortify",
      { confidence: 0.25, fallback: "malformed-response" },
    );

    expect(rebuildRecord(ALPHA_V1, [fallbackDecision], [GAME_1])).toMatchObject({
      byStrategy: {
        fortify: {
          picks: 1,
          score: 1,
          avgConfidence: 0.25,
        },
      },
    });
  });
});

describe("rebuildRecords", () => {
  const versionGame = game("g4", ALPHA_V2, BETA_V1, "black");
  const allGames = [versionGame, GAME_3, GAME_1, GAME_2];
  const allDecisions = [
    ...DECISIONS,
    decision("g4", 1, ALPHA_V2, "white", "develop", { confidence: 0.9 }),
  ];

  test("returns one record per competitor version in deterministic order", () => {
    const identities = rebuildRecords(allDecisions, allGames).map(
      (record) => `${record.competitor}@${record.version}`,
    );

    expect(identities).toEqual(["Alpha@v1", "Alpha@v2", "Beta@v1"]);
  });

  test("is idempotent because records are derived from immutable history", () => {
    expect(rebuildRecords(allDecisions, allGames)).toEqual(
      rebuildRecords(allDecisions, allGames),
    );
  });
});
