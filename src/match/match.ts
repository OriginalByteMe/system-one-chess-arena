import { NotImplemented } from "../core/errors.ts";
import type {
  GameSummary,
  Match,
  MatchOutcome,
  Opening,
  Pairing,
} from "../core/types.ts";

export interface MatchPairingArgs {
  readonly match: Match;
  /** Resolved names. A match with an unresolved slot cannot be played. */
  readonly a: string;
  readonly b: string;
  /** Version each side plays this match with, keyed by name. */
  readonly versions: ReadonlyMap<string, string>;
  readonly openings: readonly Opening[];
}

/**
 * The games of one match.
 *
 * Contract:
 * - Exactly `bestOf` pairings, all of them, so a match is never cut short. The
 *   games are recorded up front anyway, and playing them all keeps the score
 *   line honest.
 * - Colours alternate, starting with `a` as white, so an odd `bestOf` gives the
 *   first side one extra white. That is why `bestOf` should be even or the
 *   tiebreak documented.
 * - Openings cycle in order, so both sides meet the same openings.
 * - Game ids are `<matchId>:g<n>` with n from 1, stable across replays.
 */
export function matchPairings(args: MatchPairingArgs): readonly Pairing[] {
  void args;
  throw new NotImplemented("match.match.matchPairings");
}

/**
 * Who won a match, or undefined while any of its games is unrevealed.
 *
 * Contract:
 * - Undefined unless every one of the match's `gameIds` appears in `games`.
 *   This is the spoiler gate for the bracket: a partially revealed match has no
 *   winner yet.
 * - Score counts 1 for a win and 0.5 for a draw, per side, over all games.
 * - Equal scores are decided by seed, meaning slot `a`, with `decidedBy` set to
 *   "seed" so the site can say so.
 */
export function matchOutcome(
  match: Match,
  games: readonly GameSummary[],
): MatchOutcome | undefined {
  void match;
  void games;
  throw new NotImplemented("match.match.matchOutcome");
}
