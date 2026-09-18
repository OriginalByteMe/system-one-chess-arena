import { ContractViolation } from "../core/errors.ts";
import type {
  GameSummary,
  Match,
  MatchOutcome,
  MatchSlot,
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

function versionOf(versions: ReadonlyMap<string, string>, name: string): string {
  const version = versions.get(name);
  if (version === undefined) {
    throw new ContractViolation(
      "match.match.matchPairings",
      `no version recorded for ${name}`,
    );
  }
  return version;
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
  const { match, a, b, versions, openings } = args;
  const refA = { name: a, version: versionOf(versions, a) };
  const refB = { name: b, version: versionOf(versions, b) };

  const pairings: Pairing[] = [];
  for (let n = 1; n <= match.bestOf; n++) {
    const aIsWhite = n % 2 === 1;
    const opening = openings[(n - 1) % openings.length];
    if (opening === undefined) {
      throw new ContractViolation("match.match.matchPairings", "no openings supplied");
    }
    pairings.push({
      gameId: `${match.matchId}:g${n}`,
      white: aIsWhite ? refA : refB,
      black: aIsWhite ? refB : refA,
      openingId: opening.id,
    });
  }
  return pairings;
}

function competitorName(slot: MatchSlot): string {
  if (slot.kind !== "competitor") {
    throw new ContractViolation(
      "match.match.matchOutcome",
      `expected a resolved competitor slot, got ${slot.kind}`,
    );
  }
  return slot.competitor;
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
  const byId = new Map(games.map((game) => [game.gameId, game]));
  const played: GameSummary[] = [];
  for (const gameId of match.gameIds) {
    const game = byId.get(gameId);
    if (game === undefined) return undefined;
    played.push(game);
  }

  const nameA = competitorName(match.a);
  const nameB = competitorName(match.b);

  let scoreA = 0;
  let scoreB = 0;
  for (const game of played) {
    const aIsWhite = game.white.name === nameA;
    if (game.result === "draw") {
      scoreA += 0.5;
      scoreB += 0.5;
    } else if ((game.result === "white") === aIsWhite) {
      scoreA += 1;
    } else {
      scoreB += 1;
    }
  }

  if (scoreA >= scoreB) {
    return {
      matchId: match.matchId,
      winner: nameA,
      loser: nameB,
      scoreA,
      scoreB,
      decidedBy: scoreA === scoreB ? "seed" : "score",
    };
  }
  return {
    matchId: match.matchId,
    winner: nameB,
    loser: nameA,
    scoreA,
    scoreB,
    decidedBy: "score",
  };
}
