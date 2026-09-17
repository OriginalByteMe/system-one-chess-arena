import { NotImplemented } from "../core/errors";
import type { EloRating, GameScore, GameSummary } from "../core/types";

export const DEFAULT_ELO: number = 1500;
export const DEFAULT_K: number = 24;

export function expectedScore(ratingA: number, ratingB: number): number {
  throw new NotImplemented("elo.expectedScore");
}

export function updateElo(
  ratingA: number,
  ratingB: number,
  scoreA: GameScore,
  k?: number,
): { readonly a: number; readonly b: number } {
  throw new NotImplemented("elo.updateElo");
}

export function ratingsFromGames(
  games: readonly GameSummary[],
  k?: number,
): readonly EloRating[] {
  throw new NotImplemented("elo.ratingsFromGames");
}
