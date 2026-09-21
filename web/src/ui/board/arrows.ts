// Turns a recorded decision's probability distribution into the arrow field
// drawn over the board. Three readings of the same decision: the whole field it
// weighed, only the candidate it ranked first, or only the move it played.
import type { DecisionRecord } from "../../../../src/core/types.ts";
import type { ArrowSpec } from "./BoardStage.tsx";

export interface Candidate {
  readonly move: string;
  readonly p: number;
}

export type ArrowMode = "all" | "top" | "played";

/**
 * The distribution as a ranked list. A decision carries one only when the
 * player returned one, so a fallback move — or any player that answers with a
 * move and nothing else — yields a single certain candidate.
 */
export function candidatesOf(decision: DecisionRecord): readonly Candidate[] {
  const distribution = decision.distribution;
  if (distribution === undefined) return [{ move: decision.move, p: 1 }];
  const ranked = Object.entries(distribution)
    .map(([move, p]) => ({ move, p }))
    .sort((a, b) => b.p - a.p);
  return ranked.length === 0 ? [{ move: decision.move, p: 1 }] : ranked;
}

/**
 * A real distribution can cover every legal move, and forty arrows is a
 * scribble rather than a reading. The field shows the heaviest candidates plus
 * the move actually played, which is the same set the mind panel lists.
 */
const FIELD_LIMIT = 6;

export function arrowsFor(
  decision: DecisionRecord,
  accent: string,
  mode: ArrowMode,
  limit: number = FIELD_LIMIT,
): readonly ArrowSpec[] {
  const candidates = candidatesOf(decision);
  const played = candidates.find((candidate) => candidate.move === decision.move);

  let pool: readonly Candidate[];
  if (mode === "all") {
    const top = candidates.slice(0, limit);
    pool = played === undefined || top.includes(played) ? top : [...top, played];
  } else if (mode === "top") {
    pool = candidates.slice(0, 1);
  } else {
    // A recorded move is not always in its own candidate list, because a
    // fallback policy can override it. Certainty is the honest weight there.
    pool = [played ?? { move: decision.move, p: 1 }];
  }

  return pool.map((candidate) => ({
    move: candidate.move,
    from: candidate.move.slice(0, 2),
    to: candidate.move.slice(2, 4),
    p: candidate.p,
    chosen: candidate.move === decision.move,
    color: accent,
  }));
}
