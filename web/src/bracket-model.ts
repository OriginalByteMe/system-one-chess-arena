import { NotImplemented } from "../../src/core/errors.ts";
import type { Bracket, Match } from "../../src/core/types.ts";

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
  void bracket;
  throw new NotImplemented("web.bracketModel.bracketColumns");
}
