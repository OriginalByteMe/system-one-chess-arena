// The small rules layer the lab page needs on top of src/core/rules.ts.
import { legalMoves, toSan, type Position } from "../../../src/core/rules.ts";
import type { Uci } from "../../../src/core/types.ts";

/** Plies after which a lab game is called off, like a league game's move limit. */
export const LAB_MAX_PLIES = 160;

function bare(san: string): string {
  return san.replace(/[+#!?]/g, "");
}

/**
 * Reads a typed move as either UCI ("g1f3") or SAN ("Nf3", "O-O", "exd5").
 * Returns the legal UCI move it names, or undefined when it names none or is
 * ambiguous. Check marks and castling zeros are forgiven. Case is only
 * forgiven when it leaves a single candidate, because "Bxc3" and "bxc3" are
 * different moves.
 */
export function parseMoveInput(position: Position, text: string): Uci | undefined {
  const typed = text.trim();
  if (typed === "") return undefined;
  const legal = legalMoves(position);

  const asUci = typed.toLowerCase();
  const direct = legal.find((move) => move === asUci);
  if (direct !== undefined) return direct;

  const wanted = bare(typed).replace(/0/g, "O");
  const named = legal.map((move) => [move, bare(toSan(position, move))] as const);
  const exact = named.filter(([, san]) => san === wanted);
  if (exact.length === 1) return exact[0]?.[0];
  if (exact.length > 1) return undefined;
  const loose = named.filter(([, san]) => san.toLowerCase() === wanted.toLowerCase());
  return loose.length === 1 ? loose[0]?.[0] : undefined;
}

/** Moves with their SAN, in the order the model was shown them. */
export function sanFor(position: Position, moves: readonly Uci[]): ReadonlyMap<Uci, string> {
  return new Map(moves.map((move) => [move, toSan(position, move)]));
}
