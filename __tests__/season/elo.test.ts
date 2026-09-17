import { describe, expect, test } from "bun:test";
import type { CompetitorRef, EloRating, GameSummary } from "../../src/core/types";
import {
  DEFAULT_ELO,
  expectedScore,
  ratingsFromGames,
  updateElo,
} from "../../src/season/elo";

const ALPHA_V1: CompetitorRef = { name: "Alpha", version: "v1" };
const ALPHA_V2: CompetitorRef = { name: "Alpha", version: "v2" };
const BETA_V1: CompetitorRef = { name: "Beta", version: "v1" };

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
    plies: 12,
    pgn: "1. e4 e5",
  };
}

function findRating(
  ratings: readonly EloRating[],
  competitor: CompetitorRef,
): EloRating {
  const found = ratings.find(
    (rating) =>
      rating.competitor === competitor.name && rating.version === competitor.version,
  );
  if (found === undefined) {
    throw new Error(`missing rating for ${competitor.name}@${competitor.version}`);
  }
  return found;
}

describe("expectedScore", () => {
  test("is one half when ratings are equal", () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
  });

  test("is about 0.76 for a 200-point advantage", () => {
    expect(Math.abs(expectedScore(1700, 1500) - 0.76)).toBeLessThan(0.01);
  });

  test("gives complementary expectations to the two sides", () => {
    const a = expectedScore(1637, 1422);
    const b = expectedScore(1422, 1637);

    expect(a + b).toBeCloseTo(1, 12);
  });
});

describe("updateElo", () => {
  test("leaves equal ratings unchanged after a draw", () => {
    expect(updateElo(1500, 1500, 0.5)).toEqual({ a: 1500, b: 1500 });
  });

  test("rewards an upset more than an expected win", () => {
    const upset = updateElo(1300, 1500, 1);
    const favouriteWin = updateElo(1500, 1300, 1);

    expect(upset.a - 1300).toBeGreaterThan(favouriteWin.a - 1500);
  });

  test("conserves the sum of both ratings", () => {
    const updated = updateElo(1325, 1675, 1);

    expect(updated.a + updated.b).toBeCloseTo(3000, 12);
  });

  test("scales the rating delta linearly with k", () => {
    const k12 = updateElo(1400, 1600, 1, 12);
    const k48 = updateElo(1400, 1600, 1, 48);

    expect(k48.a - 1400).toBeCloseTo(4 * (k12.a - 1400), 12);
    expect(1600 - k48.b).toBeCloseTo(4 * (1600 - k12.b), 12);
  });
});

describe("ratingsFromGames", () => {
  test("returns no ratings for an empty game list", () => {
    expect(ratingsFromGames([])).toEqual([]);
  });

  test("returns each competitor version once with its game count", () => {
    const games = [
      game("g1", ALPHA_V1, BETA_V1, "white"),
      game("g2", BETA_V1, ALPHA_V1, "draw"),
      game("g3", ALPHA_V2, BETA_V1, "black"),
    ];

    const ratings = ratingsFromGames(games);
    const identities = ratings
      .map((rating) => `${rating.competitor}@${rating.version}`)
      .sort();

    expect(identities).toEqual(["Alpha@v1", "Alpha@v2", "Beta@v1"]);
    expect(findRating(ratings, ALPHA_V1).games).toBe(2);
    expect(findRating(ratings, ALPHA_V2).games).toBe(1);
    expect(findRating(ratings, BETA_V1).games).toBe(3);
  });

  test("moves a perpetual winner above default and its opponent below", () => {
    const games = [
      game("g1", ALPHA_V1, BETA_V1, "white"),
      game("g2", ALPHA_V1, BETA_V1, "white"),
      game("g3", ALPHA_V1, BETA_V1, "white"),
    ];

    const ratings = ratingsFromGames(games);

    expect(findRating(ratings, ALPHA_V1).rating).toBeGreaterThan(DEFAULT_ELO);
    expect(findRating(ratings, BETA_V1).rating).toBeLessThan(DEFAULT_ELO);
  });

  test("rates two versions of the same competitor separately", () => {
    const ratings = ratingsFromGames([
      game("g1", ALPHA_V1, BETA_V1, "white"),
      game("g2", ALPHA_V2, BETA_V1, "black"),
    ]);

    expect(findRating(ratings, ALPHA_V1)).toMatchObject({
      competitor: "Alpha",
      version: "v1",
      games: 1,
    });
    expect(findRating(ratings, ALPHA_V2)).toMatchObject({
      competitor: "Alpha",
      version: "v2",
      games: 1,
    });
  });

  test("is pure for the same immutable game history", () => {
    const games = [
      game("g1", ALPHA_V1, BETA_V1, "white"),
      game("g2", BETA_V1, ALPHA_V1, "draw"),
    ] as const;

    expect(ratingsFromGames(games)).toEqual(ratingsFromGames(games));
  });
});
