import { ContractViolation } from "../core/errors.ts";
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

function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/** Standard single-elimination seed placement, ranks 1..size, position order. */
function seedOrder(size: number): readonly number[] {
  if (size <= 1) return [1];
  const half = seedOrder(size / 2);
  const order: number[] = [];
  for (const s of half) {
    order.push(s, size + 1 - s);
  }
  return order;
}

function slotFor(rank: number, seeds: readonly string[]): MatchSlot {
  const seed = seeds[rank - 1];
  return seed === undefined ? { kind: "bye" } : { kind: "competitor", competitor: seed };
}

function gameIdsFor(matchId: string, bestOf: number): readonly string[] {
  return Array.from({ length: bestOf }, (_, index) => `${matchId}:g${index + 1}`);
}

/** Rebuilds a match with a possibly-new pair of slots and winner, keeping identity fields. */
function withResolution(
  match: Match,
  a: MatchSlot,
  b: MatchSlot,
  winner: string | undefined,
): Match {
  const base = {
    matchId: match.matchId,
    bracketId: match.bracketId,
    round: match.round,
    slot: match.slot,
    a,
    b,
    bestOf: match.bestOf,
    gameIds: match.gameIds,
  };
  return winner === undefined ? base : { ...base, winner };
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
  const { bracketId, seasonId, seeds, bestOf } = args;
  if (seeds.length < 2) {
    throw new ContractViolation(
      "match.bracket.buildBracket",
      `need at least two seeds, got ${seeds.length}`,
    );
  }

  const size = nextPowerOfTwo(seeds.length);
  const order = seedOrder(size);

  const round0: Match[] = [];
  for (let slot = 0; slot < size / 2; slot++) {
    const rankA = order[slot * 2]!;
    const rankB = order[slot * 2 + 1]!;
    const matchId = `${bracketId}:r0m${slot}`;
    round0.push({
      matchId,
      bracketId,
      round: 0,
      slot,
      a: slotFor(rankA, seeds),
      b: slotFor(rankB, seeds),
      bestOf,
      gameIds: gameIdsFor(matchId, bestOf),
    });
  }

  const rounds: Match[][] = [round0];
  let previous = round0;
  let round = 1;
  while (previous.length > 1) {
    const next: Match[] = [];
    for (let slot = 0; slot < previous.length / 2; slot++) {
      const feederA = previous[slot * 2]!;
      const feederB = previous[slot * 2 + 1]!;
      const matchId = `${bracketId}:r${round}m${slot}`;
      next.push({
        matchId,
        bracketId,
        round,
        slot,
        a: { kind: "winner-of", matchId: feederA.matchId },
        b: { kind: "winner-of", matchId: feederB.matchId },
        bestOf,
        gameIds: gameIdsFor(matchId, bestOf),
      });
    }
    rounds.push(next);
    previous = next;
    round++;
  }

  return { bracketId, seasonId, rounds };
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
  const knownIds = new Set(bracket.rounds.flat().map((match) => match.matchId));
  const outcomeByMatchId = new Map<string, MatchOutcome>();
  for (const outcome of outcomes) {
    if (!knownIds.has(outcome.matchId)) {
      throw new ContractViolation(
        "match.bracket.advanceBracket",
        `unknown match id ${outcome.matchId}`,
      );
    }
    outcomeByMatchId.set(outcome.matchId, outcome);
  }

  const rounds: Match[][] = [];
  for (const [roundIndex, matches] of bracket.rounds.entries()) {
    const resolved: Match[] = [];
    for (const [slot, match] of matches.entries()) {
      let a: MatchSlot;
      let b: MatchSlot;
      if (roundIndex === 0) {
        a = match.a;
        b = match.b;
      } else {
        const feederA = rounds[roundIndex - 1]![slot * 2]!;
        const feederB = rounds[roundIndex - 1]![slot * 2 + 1]!;
        a =
          feederA.winner === undefined
            ? { kind: "winner-of", matchId: feederA.matchId }
            : { kind: "competitor", competitor: feederA.winner };
        b =
          feederB.winner === undefined
            ? { kind: "winner-of", matchId: feederB.matchId }
            : { kind: "competitor", competitor: feederB.winner };
      }

      const byeWinner =
        a.kind === "bye" && b.kind === "competitor"
          ? b.competitor
          : b.kind === "bye" && a.kind === "competitor"
            ? a.competitor
            : undefined;
      const winner = byeWinner ?? outcomeByMatchId.get(match.matchId)?.winner;
      resolved.push(withResolution(match, a, b, winner));
    }
    rounds.push(resolved);
  }

  return { ...bracket, rounds };
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
  const revealed = new Set(revealedMatchIds);

  const rounds: Match[][] = [];
  for (const [roundIndex, matches] of bracket.rounds.entries()) {
    const resolved: Match[] = [];
    for (const [slot, match] of matches.entries()) {
      let a: MatchSlot;
      let b: MatchSlot;
      if (roundIndex === 0) {
        a = match.a;
        b = match.b;
      } else {
        const feederA = rounds[roundIndex - 1]![slot * 2]!;
        const feederB = rounds[roundIndex - 1]![slot * 2 + 1]!;
        a =
          feederA.winner === undefined
            ? { kind: "winner-of", matchId: feederA.matchId }
            : { kind: "competitor", competitor: feederA.winner };
        b =
          feederB.winner === undefined
            ? { kind: "winner-of", matchId: feederB.matchId }
            : { kind: "competitor", competitor: feederB.winner };
      }

      const winner = revealed.has(match.matchId) ? match.winner : undefined;
      resolved.push(withResolution(match, a, b, winner));
    }
    rounds.push(resolved);
  }

  return { ...bracket, rounds };
}

/** The name in a slot, or undefined when it is still a placeholder or a bye. */
export function resolveSlot(
  slot: MatchSlot,
  matches: readonly Match[],
): string | undefined {
  if (slot.kind === "competitor") return slot.competitor;
  if (slot.kind === "bye") return undefined;
  return matches.find((match) => match.matchId === slot.matchId)?.winner;
}
