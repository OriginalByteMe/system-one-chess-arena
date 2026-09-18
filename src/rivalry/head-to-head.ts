import { NotImplemented } from "../core/errors.ts";
import type { GameSummary, HeadToHead } from "../core/types.ts";

/** How many recent results a trait rule may look at. */
export const RECENT_LIMIT: number = 8;

/** Order-independent key for a pair, for maps and cache keys. */
export function pairKey(a: string, b: string): string {
  void a;
  void b;
  throw new NotImplemented("rivalry.headToHead.pairKey");
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
  void games;
  throw new NotImplemented("rivalry.headToHead.headToHeadFrom");
}

/** One direction, with an empty history when the pair has never met. */
export function headToHeadFor(
  competitor: string,
  opponent: string,
  games: readonly GameSummary[],
): HeadToHead {
  void competitor;
  void opponent;
  void games;
  throw new NotImplemented("rivalry.headToHead.headToHeadFor");
}
