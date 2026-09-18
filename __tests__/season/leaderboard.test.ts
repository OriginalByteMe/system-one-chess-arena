import { describe, expect, test } from "bun:test";
import type { EpochMs, Leaderboard, LeaderboardRow } from "../../src/core/types.ts";
import { brierScore } from "../../src/season/calibration.ts";
import { costUsd } from "../../src/season/cost.ts";
import { DEFAULT_ELO, DEFAULT_K, ratingsFromGames, updateElo } from "../../src/season/elo.ts";
import { leaderboardFrom } from "../../src/season/leaderboard.ts";
import { competitorRef, decision, game, versionRow } from "../fixtures/leaderboard.ts";

const ASOF: EpochMs = 1_726_500_000_000;

function findRow(board: Leaderboard, competitor: string): LeaderboardRow {
  const row = board.rows.find((candidate) => candidate.competitor === competitor);
  if (row === undefined) {
    throw new Error(`missing row for ${competitor}`);
  }
  return row;
}

describe("leaderboardFrom", () => {
  test("rolls three versions of one competitor into a single row, oldest version first", () => {
    const nova1 = competitorRef("Nova", "v1");
    const nova2 = competitorRef("Nova", "v2");
    const nova3 = competitorRef("Nova", "v3");
    const rival = competitorRef("Rival", "v1");

    const games = [
      game("g1", nova1, rival, "white"),
      game("g2", nova2, rival, "black"),
      game("g3", nova3, rival, "draw"),
    ];

    const board = leaderboardFrom({
      games,
      decisions: [],
      versions: [
        versionRow("Nova", "v3"),
        versionRow("Nova", "v1"),
        versionRow("Nova", "v2"),
      ],
      asOf: ASOF,
    });

    const novaRows = board.rows.filter((row) => row.competitor === "Nova");
    expect(novaRows).toHaveLength(1);
    expect(novaRows[0]?.versions).toEqual(["v1", "v2", "v3"]);
  });

  test("shows the combined name-level rating, not the isolated per-version rating", () => {
    const nova1 = competitorRef("Nova", "v1");
    const nova2 = competitorRef("Nova", "v2");
    const rival = competitorRef("Rival", "v1");

    const games = [
      game("g1", rival, nova1, "white"),
      game("g2", nova2, rival, "white"),
    ];

    const board = leaderboardFrom({ games, decisions: [], versions: [], asOf: ASOF });
    const novaRow = findRow(board, "Nova");

    let novaRating = DEFAULT_ELO;
    let rivalRating = DEFAULT_ELO;
    const afterGame1 = updateElo(rivalRating, novaRating, 1, DEFAULT_K);
    rivalRating = afterGame1.a;
    novaRating = afterGame1.b;
    const afterGame2 = updateElo(novaRating, rivalRating, 1, DEFAULT_K);
    novaRating = afterGame2.a;

    expect(novaRow.elo).toBeCloseTo(novaRating, 6);
    expect(novaRow.elo).not.toBeCloseTo(DEFAULT_ELO, 1);

    const isolated = ratingsFromGames(games).find(
      (rating) => rating.competitor === "Nova" && rating.version === "v2",
    );
    expect(isolated).toBeDefined();
    expect(novaRow.elo).not.toBeCloseTo(isolated!.rating, 3);
  });

  test("counts wins, draws and losses from the competitor's own colour in each game", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");

    const games = [
      game("g1", nova, rival, "white"),
      game("g2", rival, nova, "draw"),
      game("g3", rival, nova, "white"),
    ];

    const board = leaderboardFrom({ games, decisions: [], versions: [], asOf: ASOF });
    const novaRow = findRow(board, "Nova");

    expect(novaRow.games).toBe(3);
    expect(novaRow.wins).toBe(1);
    expect(novaRow.draws).toBe(1);
    expect(novaRow.losses).toBe(1);
    expect(novaRow.score).toBeCloseTo(1.5, 6);
  });

  test("shows a version row with no games at default elo and zero games", () => {
    const board = leaderboardFrom({
      games: [],
      decisions: [],
      versions: [versionRow("Rookie", "v1")],
      asOf: ASOF,
    });

    const rookieRow = findRow(board, "Rookie");
    expect(rookieRow.games).toBe(0);
    expect(rookieRow.elo).toBe(DEFAULT_ELO);
    expect(rookieRow.wins).toBe(0);
    expect(rookieRow.draws).toBe(0);
    expect(rookieRow.losses).toBe(0);
  });

  test("averages confidence only over decisions that stated one", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "white"), game("g2", rival, nova, "black")];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 0.4, ply: 1 }),
      decision({ gameId: "g2", competitor: "Nova", version: "v1", colour: "black", confidence: 0.8, ply: 1 }),
      decision({ gameId: "g2", competitor: "Nova", version: "v1", colour: "black", ply: 2 }),
    ];

    const board = leaderboardFrom({ games, decisions, versions: [], asOf: ASOF });
    const novaRow = findRow(board, "Nova");

    expect(novaRow.meanConfidence).toBeCloseTo(0.6, 6);
  });

  test("computes a zero fallback rate when nothing fell back", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "white")];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", ply: 1 }),
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", ply: 2 }),
    ];

    const board = leaderboardFrom({ games, decisions, versions: [], asOf: ASOF });
    expect(findRow(board, "Nova").fallbackRate).toBe(0);
  });

  test("computes the fallback rate as fallback decisions over all decisions", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "white")];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", ply: 1, fallback: "timeout" }),
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", ply: 2 }),
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", ply: 3 }),
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", ply: 4 }),
    ];

    const board = leaderboardFrom({ games, decisions, versions: [], asOf: ASOF });
    expect(findRow(board, "Nova").fallbackRate).toBeCloseTo(0.25, 6);
  });

  test("averages latency over the competitor's own decisions", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "white")];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", ply: 1, latencyMs: 10 }),
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", ply: 2, latencyMs: 30 }),
    ];

    const board = leaderboardFrom({ games, decisions, versions: [], asOf: ASOF });
    expect(findRow(board, "Nova").meanLatencyMs).toBeCloseTo(20, 6);
  });

  test("matches the standalone brierScore for calibrationError", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "white"), game("g2", rival, nova, "white")];
    const decisions = [
      decision({ gameId: "g1", competitor: "Nova", version: "v1", colour: "white", confidence: 0.9, ply: 1 }),
      decision({ gameId: "g2", competitor: "Nova", version: "v1", colour: "black", confidence: 0.2, ply: 1 }),
    ];

    const board = leaderboardFrom({ games, decisions, versions: [], asOf: ASOF });
    const expected = brierScore(decisions, games);

    expect(findRow(board, "Nova").calibrationError).toBeCloseTo(expected, 10);
  });

  test("matches the standalone costUsd, finding the model through the version rows", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "white")];
    const decisions = [
      decision({
        gameId: "g1",
        competitor: "Nova",
        version: "v1",
        colour: "white",
        ply: 1,
        tokens: { in: 500_000, out: 200_000 },
      }),
    ];
    const versions = [versionRow("Nova", "v1", { manifest: { ...versionRow("Nova", "v1").manifest, model: "jev" } })];

    const board = leaderboardFrom({ games, decisions, versions, asOf: ASOF });
    const expected = costUsd(decisions, new Map([["v1", "jev"]]));

    expect(findRow(board, "Nova").costUsd).toBeCloseTo(expected, 10);
    expect(findRow(board, "Nova").costUsd).toBeGreaterThan(0);
  });

  test("sorts by elo descending, then score descending, then name ascending", () => {
    const charlie = competitorRef("Charlie", "v1");
    const outclassed = competitorRef("Outclassed", "v1");
    const bravo = competitorRef("Bravo", "v1");
    const neutral = competitorRef("Neutral", "v1");

    const games = [
      game("g1", charlie, outclassed, "white"),
      game("g2", bravo, neutral, "draw"),
    ];

    const board = leaderboardFrom({
      games,
      decisions: [],
      versions: [versionRow("Alpha", "v1"), versionRow("Zulu", "v1")],
      asOf: ASOF,
    });

    const names = board.rows.map((row) => row.competitor);
    const charlieIndex = names.indexOf("Charlie");
    const bravoIndex = names.indexOf("Bravo");
    const alphaIndex = names.indexOf("Alpha");
    const zuluIndex = names.indexOf("Zulu");

    expect(charlieIndex).toBeGreaterThanOrEqual(0);
    expect(bravoIndex).toBeGreaterThanOrEqual(0);
    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(zuluIndex).toBeGreaterThanOrEqual(0);

    expect(findRow(board, "Bravo").elo).toBeCloseTo(DEFAULT_ELO, 6);
    expect(findRow(board, "Alpha").elo).toBe(DEFAULT_ELO);
    expect(findRow(board, "Zulu").elo).toBe(DEFAULT_ELO);
    expect(findRow(board, "Bravo").score).toBeGreaterThan(findRow(board, "Alpha").score);

    expect(charlieIndex).toBeLessThan(bravoIndex);
    expect(bravoIndex).toBeLessThan(alphaIndex);
    expect(alphaIndex).toBeLessThan(zuluIndex);
  });

  test("ignores a decision whose game was never revealed", () => {
    const nova = competitorRef("Nova", "v1");
    const rival = competitorRef("Rival", "v1");
    const games = [game("g1", nova, rival, "white")];
    const revealedDecision = decision({
      gameId: "g1",
      competitor: "Nova",
      version: "v1",
      colour: "white",
      ply: 1,
      confidence: 0.9,
      latencyMs: 10,
      tokens: { in: 1000, out: 0 },
    });
    const spoilerDecision = decision({
      gameId: "unrevealed-game",
      competitor: "Nova",
      version: "v1",
      colour: "white",
      ply: 1,
      confidence: 0.01,
      latencyMs: 9999,
      fallback: "timeout",
      tokens: { in: 999_999, out: 999_999 },
    });

    const withoutSpoiler = leaderboardFrom({
      games,
      decisions: [revealedDecision],
      versions: [],
      asOf: ASOF,
    });
    const withSpoiler = leaderboardFrom({
      games,
      decisions: [revealedDecision, spoilerDecision],
      versions: [],
      asOf: ASOF,
    });

    expect(findRow(withSpoiler, "Nova")).toEqual(findRow(withoutSpoiler, "Nova"));
    expect(findRow(withSpoiler, "Nova").meanConfidence).toBeCloseTo(0.9, 6);
    expect(findRow(withSpoiler, "Nova").fallbackRate).toBe(0);
  });

  test("echoes asOf unchanged", () => {
    const board = leaderboardFrom({ games: [], decisions: [], versions: [], asOf: ASOF });
    expect(board.asOf).toBe(ASOF);
  });
});
