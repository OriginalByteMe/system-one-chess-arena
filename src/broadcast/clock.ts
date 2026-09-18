import { ContractViolation } from "../core/errors.ts";
import type {
  BroadcastSchedule,
  BroadcastStatus,
  EpochMs,
  RevealWindow,
} from "../core/types.ts";

/**
 * How much of a recorded game a viewer may see at `now`.
 *
 * `moves` is the number of recorded decisions, not an absolute ply number:
 * games start from an opening, so the first decision's ply is not zero.
 *
 * Contract:
 * - `revealedPlies` is `floor((now - startAt) / msPerPly)`, clamped to
 *   `[0, moves]`, so at exactly `startAt` nothing has been played yet.
 * - `status` is "scheduled" before `startAt`, "finished" once every recorded
 *   decision is revealed, and "on-air" in between.
 * - `nextBoundaryAt` is when `revealedPlies` next increases, and is absent only
 *   when the status is "finished".
 * - `msPerPly` must be a positive integer and `moves` a non-negative integer,
 *   otherwise this is a ContractViolation.
 */
export function revealWindow(
  schedule: BroadcastSchedule,
  moves: number,
  now: EpochMs,
): RevealWindow {
  if (!Number.isInteger(schedule.msPerPly) || schedule.msPerPly <= 0) {
    throw new ContractViolation(
      "broadcast.clock.revealWindow",
      `msPerPly must be a positive integer: ${schedule.msPerPly}`,
    );
  }
  if (!Number.isInteger(moves) || moves < 0) {
    throw new ContractViolation(
      "broadcast.clock.revealWindow",
      `moves must be a non-negative integer: ${moves}`,
    );
  }

  const elapsedPlies = Math.floor((now - schedule.startAt) / schedule.msPerPly);
  const revealedPlies = Math.min(moves, Math.max(0, elapsedPlies));
  const status: BroadcastStatus = now < schedule.startAt
    ? "scheduled"
    : revealedPlies >= moves
      ? "finished"
      : "on-air";

  if (status === "finished") return { status, revealedPlies };

  return {
    status,
    revealedPlies,
    nextBoundaryAt: schedule.startAt + (revealedPlies + 1) * schedule.msPerPly,
  };
}

/** When the last recorded decision of a game becomes visible. */
export function broadcastEndsAt(
  schedule: BroadcastSchedule,
  moves: number,
): EpochMs {
  return schedule.startAt + moves * schedule.msPerPly;
}
