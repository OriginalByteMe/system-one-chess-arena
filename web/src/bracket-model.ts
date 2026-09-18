import { ContractViolation } from "../../src/core/errors.ts";
import type { Bracket, Match, MatchSlot } from "../../src/core/types.ts";

export interface BracketCell {
  readonly match: Match;
  /** What to print for each side, placeholders included. */
  readonly a: string;
  readonly b: string;
  readonly winner?: string;
  readonly decided: boolean;
}

export interface BracketColumn {
  readonly round: number;
  readonly title: string;
  readonly cells: readonly BracketCell[];
}

function roundTitle(round: number, totalRounds: number): string {
  const offsetFromEnd = totalRounds - 1 - round;
  if (offsetFromEnd === 0) return "Final";
  if (offsetFromEnd === 1) return "Semi-finals";
  if (offsetFromEnd === 2) return "Quarter-finals";
  return `Round of ${2 ** (offsetFromEnd + 1)}`;
}

function slotText(slot: MatchSlot, feederSlots: Readonly<Record<string, number>>): string {
  switch (slot.kind) {
    case "competitor":
      return slot.competitor;
    case "bye":
      return "Bye";
    case "winner-of": {
      const feederSlot = feederSlots[slot.matchId];
      if (feederSlot === undefined) {
        throw new ContractViolation(
          "web.bracketModel.bracketColumns",
          `winner-of references unknown match ${slot.matchId}`,
        );
      }
      return `Winner of match ${feederSlot + 1}`;
    }
  }
}

/**
 * Columns for the bracket page.
 *
 * Contract:
 * - A "winner-of" slot prints "Winner of match N" using the feeder's slot
 *   number, never a name. The server has already gated this; the client must
 *   not try to resolve it either.
 * - A bye prints "Bye".
 * - Round titles count back from the last round: "Final", "Semi-finals",
 *   "Quarter-finals", then "Round of N".
 */
export function bracketColumns(bracket: Bracket): readonly BracketColumn[] {
  const feederSlots: Record<string, number> = {};
  for (const round of bracket.rounds) {
    for (const match of round) {
      feederSlots[match.matchId] = match.slot;
    }
  }

  const totalRounds = bracket.rounds.length;
  return bracket.rounds.map((matches, round) => ({
    round,
    title: roundTitle(round, totalRounds),
    cells: [...matches]
      .sort((x, y) => x.slot - y.slot)
      .map((match) => ({
        match,
        a: slotText(match.a, feederSlots),
        b: slotText(match.b, feederSlots),
        winner: match.winner,
        decided: match.winner !== undefined,
      })),
  }));
}
