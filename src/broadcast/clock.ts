import { NotImplemented } from "../core/errors.ts";
import type {
  BroadcastSchedule,
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
  void schedule;
  void moves;
  void now;
  throw new NotImplemented("broadcast.clock.revealWindow");
}

/** When the last recorded decision of a game becomes visible. */
export function broadcastEndsAt(
  schedule: BroadcastSchedule,
  moves: number,
): EpochMs {
  void schedule;
  void moves;
  throw new NotImplemented("broadcast.clock.broadcastEndsAt");
}
