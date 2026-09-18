import type {
  ArenaStore,
  CompetitorVersionRow,
  DecisionRecord,
  Match,
  RecordedGame,
} from "../../src/core/types.ts";

export interface MemoryStoreSeed {
  readonly games?: readonly RecordedGame[];
  readonly decisions?: readonly DecisionRecord[];
  readonly versions?: readonly CompetitorVersionRow[];
  readonly matches?: readonly Match[];
  /** bracketId -> seasonId, mirroring ArenaStore.bracketSeason. */
  readonly bracketSeasons?: { readonly [bracketId: string]: string };
}

/**
 * An ArenaStore over plain arrays, scoped exactly like the D1-backed store:
 * by season, game or competitor, and never by reveal state. Gating stays the
 * caller's job, so this deliberately returns everything it is given.
 */
export function memoryStore(seed: MemoryStoreSeed): ArenaStore {
  const games = seed.games ?? [];
  const decisions = seed.decisions ?? [];
  const versions = seed.versions ?? [];
  const matches = seed.matches ?? [];
  const bracketSeasons = seed.bracketSeasons ?? {};

  return {
    game: (seasonId, gameId) =>
      Promise.resolve(
        games.find(
          (candidate) =>
            candidate.summary.seasonId === seasonId &&
            candidate.summary.gameId === gameId,
        ),
      ),
    games: (seasonId) =>
      Promise.resolve(
        games.filter((candidate) => candidate.summary.seasonId === seasonId),
      ),
    decisions: (seasonId, gameId) =>
      Promise.resolve(
        decisions.filter(
          (decision) =>
            decision.seasonId === seasonId && decision.gameId === gameId,
        ),
      ),
    competitorDecisions: (competitor) =>
      Promise.resolve(
        decisions.filter((decision) => decision.competitor === competitor),
      ),
    versions: (competitor) =>
      Promise.resolve(versions.filter((row) => row.competitor === competitor)),
    matches: (bracketId) =>
      Promise.resolve(matches.filter((match) => match.bracketId === bracketId)),
    bracketSeason: (bracketId) => Promise.resolve(bracketSeasons[bracketId]),
  };
}

/**
 * Wraps a store to count every call across its methods, so a test can prove a
 * rejected request never reached it.
 */
export function countingStore(inner: ArenaStore): {
  readonly store: ArenaStore;
  readonly calls: () => number;
} {
  let count = 0;
  const store: ArenaStore = {
    game: (seasonId, gameId) => {
      count += 1;
      return inner.game(seasonId, gameId);
    },
    games: (seasonId) => {
      count += 1;
      return inner.games(seasonId);
    },
    decisions: (seasonId, gameId) => {
      count += 1;
      return inner.decisions(seasonId, gameId);
    },
    competitorDecisions: (competitor) => {
      count += 1;
      return inner.competitorDecisions(competitor);
    },
    versions: (competitor) => {
      count += 1;
      return inner.versions(competitor);
    },
    matches: (bracketId) => {
      count += 1;
      return inner.matches(bracketId);
    },
    bracketSeason: (bracketId) => {
      count += 1;
      return inner.bracketSeason(bracketId);
    },
  };
  return { store, calls: () => count };
}
