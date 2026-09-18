import type {
  CompetitorVersionRow,
  DecisionRecord,
  EpochMs,
  GameSummary,
  Leaderboard,
  LeaderboardRow,
} from "../core/types.ts";
import { brierScore } from "./calibration.ts";
import { costUsd } from "./cost.ts";
import { DEFAULT_ELO, DEFAULT_K, ratingsByCompetitor } from "./elo.ts";

export interface LeaderboardArgs {
  /** Revealed games only. Passing an unrevealed game is a spoiler bug. */
  readonly games: readonly GameSummary[];
  /** Revealed decisions only, for the confidence, fallback and cost columns. */
  readonly decisions: readonly DecisionRecord[];
  /** Version rows, so cost can find each decision's model. */
  readonly versions: readonly CompetitorVersionRow[];
  /** The reveal boundary this was computed at. */
  readonly asOf: EpochMs;
  readonly k?: number;
}

/**
 * One row per competitor name, versions rolled up, as decided on 2026-09-18.
 *
 * Contract:
 * - Rating is Elo over the given games keyed by name, so a competitor keeps one
 *   rating across its whole evolution, starting from DEFAULT_ELO.
 * - `versions` lists every version that played, oldest first by first
 *   appearance.
 * - A competitor with rows but no games still appears, at DEFAULT_ELO with zero
 *   games, so a new entrant is visible before its first reveal.
 * - Sorted by Elo descending, then score descending, then name ascending, so
 *   the order is stable.
 * - Every column is computed from the arguments only. There is no stored
 *   rating, by design: a stored one could spoil an unaired result.
 */
export function leaderboardFrom(args: LeaderboardArgs): Leaderboard {
  const { games, decisions, versions, asOf, k } = args;

  const gameIds = new Set(games.map((entry) => entry.gameId));

  const versionsByName = new Map<string, string[]>();
  function recordVersion(name: string, version: string): void {
    let seen = versionsByName.get(name);
    if (seen === undefined) {
      seen = [];
      versionsByName.set(name, seen);
    }
    if (!seen.includes(version)) {
      seen.push(version);
    }
  }
  for (const entry of games) {
    recordVersion(entry.white.name, entry.white.version);
    recordVersion(entry.black.name, entry.black.version);
  }
  for (const row of versions) {
    recordVersion(row.competitor, row.version);
  }

  interface Tally {
    games: number;
    wins: number;
    draws: number;
    losses: number;
    score: number;
  }
  const tallies = new Map<string, Tally>();
  function tallyFor(name: string): Tally {
    let tally = tallies.get(name);
    if (tally === undefined) {
      tally = { games: 0, wins: 0, draws: 0, losses: 0, score: 0 };
      tallies.set(name, tally);
    }
    return tally;
  }
  for (const entry of games) {
    const white = tallyFor(entry.white.name);
    const black = tallyFor(entry.black.name);
    white.games += 1;
    black.games += 1;
    if (entry.result === "white") {
      white.wins += 1;
      white.score += 1;
      black.losses += 1;
    } else if (entry.result === "black") {
      black.wins += 1;
      black.score += 1;
      white.losses += 1;
    } else {
      white.draws += 1;
      white.score += 0.5;
      black.draws += 1;
      black.score += 0.5;
    }
  }

  const eloByName = new Map(
    ratingsByCompetitor(games, k ?? DEFAULT_K).map((rating) => [rating.competitor, rating.rating]),
  );

  const models = new Map<string, string>();
  for (const row of versions) {
    models.set(row.version, row.manifest.model);
  }

  const rows: LeaderboardRow[] = [];
  for (const name of versionsByName.keys()) {
    const tally = tallyFor(name);
    const relevant = decisions.filter(
      (entry) => entry.competitor === name && gameIds.has(entry.gameId),
    );

    const confidences = relevant
      .map((entry) => entry.confidence)
      .filter((value): value is number => value !== undefined);
    const meanConfidence =
      confidences.length === 0
        ? 0
        : confidences.reduce((sum, value) => sum + value, 0) / confidences.length;

    const fallbackRate =
      relevant.length === 0
        ? 0
        : relevant.filter((entry) => entry.fallback !== undefined).length / relevant.length;

    const meanLatencyMs =
      relevant.length === 0
        ? 0
        : relevant.reduce((sum, entry) => sum + entry.latencyMs, 0) / relevant.length;

    rows.push({
      competitor: name,
      versions: versionsByName.get(name) ?? [],
      games: tally.games,
      wins: tally.wins,
      draws: tally.draws,
      losses: tally.losses,
      score: tally.score,
      elo: eloByName.get(name) ?? DEFAULT_ELO,
      meanConfidence,
      calibrationError: brierScore(relevant, games),
      fallbackRate,
      meanLatencyMs,
      costUsd: costUsd(relevant, models),
    });
  }

  rows.sort((a, b) => {
    if (a.elo !== b.elo) return b.elo - a.elo;
    if (a.score !== b.score) return b.score - a.score;
    return a.competitor < b.competitor ? -1 : a.competitor > b.competitor ? 1 : 0;
  });

  return { rows, asOf };
}
