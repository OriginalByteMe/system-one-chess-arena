import { NotImplemented } from "../core/errors.ts";
import type {
  Bracket,
  Match,
  MatchOutcome,
  MatchSlot,
} from "../core/types.ts";

export interface BracketArgs {
  readonly bracketId: string;
  readonly seasonId: string;
  /** Seeds in leaderboard order, strongest first. */
  readonly seeds: readonly string[];
  readonly bestOf: number;
}

/**
 * A single-elimination bracket.
 *
 * Contract:
 * - Seeds are padded with byes up to the next power of two, so every round is
 *   full. Fewer than two seeds is a ContractViolation.
 * - Standard seeding: the top seed meets the weakest live opponent, and the top
 *   two seeds can only meet in the final.
 * - Round 0 holds "competitor" and "bye" slots. Every later round holds
 *   "winner-of" slots pointing at the two matches that feed it.
 * - Match ids are `<bracketId>:r<round>m<slot>`, both from 0, stable across
 *   rebuilds so recorded games keep pointing at the right match.
 */
export function buildBracket(args: BracketArgs): Bracket {
  void args;
  throw new NotImplemented("match.bracket.buildBracket");
}

/**
 * Fills in decided winners and resolves the slots they feed.
 *
 * Contract:
 * - A match facing a bye is won by the live side with no games played.
 * - A later round's slot becomes "competitor" only when its feeder match has a
 *   winner; otherwise it stays "winner-of".
 * - Idempotent: applying the same outcomes twice gives the same bracket.
 * - An outcome for a match not in the bracket is a ContractViolation.
 */
export function advanceBracket(
  bracket: Bracket,
  outcomes: readonly MatchOutcome[],
): Bracket {
  void bracket;
  void outcomes;
  throw new NotImplemented("match.bracket.advanceBracket");
}

/**
 * The spoiler gate for the bracket, and the requirement most likely to be
 * missed.
 *
 * Contract: every match whose id is not in `revealedMatchIds` loses its winner,
 * and every slot fed by such a match reverts to "winner-of". A viewer must be
 * able to see the shape of the bracket without learning a result the broadcast
 * has not reached.
 */
export function revealBracket(
  bracket: Bracket,
  revealedMatchIds: readonly string[],
): Bracket {
  void bracket;
  void revealedMatchIds;
  throw new NotImplemented("match.bracket.revealBracket");
}

/** The name in a slot, or undefined when it is still a placeholder or a bye. */
export function resolveSlot(
  slot: MatchSlot,
  matches: readonly Match[],
): string | undefined {
  void slot;
  void matches;
  throw new NotImplemented("match.bracket.resolveSlot");
}
