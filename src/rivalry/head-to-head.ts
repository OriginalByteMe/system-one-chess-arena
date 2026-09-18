import type { GameSummary, HeadToHead, HeadToHeadResult } from "../core/types.ts";

/** How many recent results a trait rule may look at. */
export const RECENT_LIMIT: number = 8;

/** Order-independent key for a pair, for maps and cache keys. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("\u0000");
}

interface Accumulator {
  readonly competitor: string;
  readonly opponent: string;
  wins: number;
  losses: number;
  draws: number;
  readonly results: HeadToHeadResult[];
  readonly gameIds: string[];
}

function streakOf(results: readonly HeadToHeadResult[]): number {
  const last = results[results.length - 1];
  if (last === undefined) return 0;
  let streak = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === last; i -= 1) {
    streak += 1;
  }
  return streak;
}

/**
 * Head-to-head history in both directions.
 *
 * Contract:
 * - Games are read in the order given, which is the revealed order, so a
 *   rivalry is always history as of the broadcast rather than as of the record.
 * - `recent` holds the last RECENT_LIMIT results, oldest first, and `gameIds`
 *   matches it position for position.
 * - `streak` is the length of the current run of identical results and is zero
 *   with no history.
 * - Both directions are returned, and the loss column of one is the win column
 *   of the other.
 */
export function headToHeadFrom(
  games: readonly GameSummary[],
): readonly HeadToHead[] {
  const byDirection = new Map<string, Accumulator>();

  function record(competitor: string, opponent: string, result: HeadToHeadResult, gameId: string): void {
    const key = `${competitor}\u0000${opponent}`;
    let acc = byDirection.get(key);
    if (!acc) {
      acc = { competitor, opponent, wins: 0, losses: 0, draws: 0, results: [], gameIds: [] };
      byDirection.set(key, acc);
    }
    if (result === "win") acc.wins += 1;
    else if (result === "loss") acc.losses += 1;
    else acc.draws += 1;
    acc.results.push(result);
    acc.gameIds.push(gameId);
  }

  for (const game of games) {
    const white = game.white.name;
    const black = game.black.name;
    const whiteResult: HeadToHeadResult =
      game.result === "draw" ? "draw" : game.result === "white" ? "win" : "loss";
    const blackResult: HeadToHeadResult =
      game.result === "draw" ? "draw" : game.result === "white" ? "loss" : "win";
    record(white, black, whiteResult, game.gameId);
    record(black, white, blackResult, game.gameId);
  }

  return Array.from(byDirection.values(), (acc) => ({
    competitor: acc.competitor,
    opponent: acc.opponent,
    wins: acc.wins,
    losses: acc.losses,
    draws: acc.draws,
    recent: acc.results.slice(-RECENT_LIMIT),
    gameIds: acc.gameIds.slice(-RECENT_LIMIT),
    streak: streakOf(acc.results),
  }));
}

/** One direction, with an empty history when the pair has never met. */
export function headToHeadFor(
  competitor: string,
  opponent: string,
  games: readonly GameSummary[],
): HeadToHead {
  const relevant = games.filter((game) => {
    const names = [game.white.name, game.black.name];
    return names.includes(competitor) && names.includes(opponent);
  });
  const found = headToHeadFrom(relevant).find(
    (h) => h.competitor === competitor && h.opponent === opponent,
  );
  return (
    found ?? {
      competitor,
      opponent,
      wins: 0,
      losses: 0,
      draws: 0,
      recent: [],
      gameIds: [],
      streak: 0,
    }
  );
}
