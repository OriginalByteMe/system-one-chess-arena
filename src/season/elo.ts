import type {
  CompetitorRef,
  EloRating,
  GameScore,
  GameSummary,
} from "../core/types";

export const DEFAULT_ELO: number = 1500;
export const DEFAULT_K: number = 24;

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function updateElo(
  ratingA: number,
  ratingB: number,
  scoreA: GameScore,
  k: number = DEFAULT_K,
): { readonly a: number; readonly b: number } {
  const delta = k * (scoreA - expectedScore(ratingA, ratingB));
  return { a: ratingA + delta, b: ratingB - delta };
}

export function ratingsFromGames(
  games: readonly GameSummary[],
  k: number = DEFAULT_K,
): readonly EloRating[] {
  type MutableEloRating = {
    -readonly [Key in keyof EloRating]: EloRating[Key];
  };
  const byCompetitor = new Map<string, Map<string, MutableEloRating>>();
  const ratings: MutableEloRating[] = [];

  function getRating(competitor: CompetitorRef): MutableEloRating {
    let versions = byCompetitor.get(competitor.name);
    if (versions === undefined) {
      versions = new Map();
      byCompetitor.set(competitor.name, versions);
    }

    let rating = versions.get(competitor.version);
    if (rating === undefined) {
      rating = {
        competitor: competitor.name,
        version: competitor.version,
        rating: DEFAULT_ELO,
        games: 0,
      };
      versions.set(competitor.version, rating);
      ratings.push(rating);
    }
    return rating;
  }

  for (const game of games) {
    const white = getRating(game.white);
    const black = getRating(game.black);
    const whiteScore: GameScore =
      game.result === "white" ? 1 : game.result === "black" ? 0 : 0.5;
    const updated = updateElo(white.rating, black.rating, whiteScore, k);

    white.rating = updated.a;
    white.games += 1;
    black.rating = updated.b;
    black.games += 1;
  }

  return ratings;
}

/**
 * Ratings rolled up by competitor name, as decided on 2026-09-18: a revised or
 * trait-modified version keeps the same rating line.
 *
 * Contract: identical to `ratingsFromGames` except that all versions of a name
 * share one rating, and the returned `version` is the latest version that name
 * played. Games are applied in the order given, which is the revealed order.
 */
export function ratingsByCompetitor(
  games: readonly GameSummary[],
  k: number = DEFAULT_K,
): readonly EloRating[] {
  type MutableEloRating = {
    -readonly [Key in keyof EloRating]: EloRating[Key];
  };
  const byName = new Map<string, MutableEloRating>();
  const ratings: MutableEloRating[] = [];

  function getRating(competitor: CompetitorRef): MutableEloRating {
    let rating = byName.get(competitor.name);
    if (rating === undefined) {
      rating = {
        competitor: competitor.name,
        version: competitor.version,
        rating: DEFAULT_ELO,
        games: 0,
      };
      byName.set(competitor.name, rating);
      ratings.push(rating);
    } else {
      rating.version = competitor.version;
    }
    return rating;
  }

  for (const game of games) {
    const white = getRating(game.white);
    const black = getRating(game.black);
    const whiteScore: GameScore =
      game.result === "white" ? 1 : game.result === "black" ? 0 : 0.5;
    const updated = updateElo(white.rating, black.rating, whiteScore, k);

    white.rating = updated.a;
    white.games += 1;
    black.rating = updated.b;
    black.games += 1;
  }

  return ratings;
}
