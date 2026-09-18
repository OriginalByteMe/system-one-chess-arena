import { NotImplemented } from "../core/errors.ts";
import type {
  DecisionRecord,
  EpochMs,
  RecordedGame,
  RevealWindow,
  RevealedGame,
  RevealedMoves,
} from "../core/types.ts";

/**
 * The only place that may hold an unrevealed decision. Slices a recorded game
 * down to what the broadcast clock allows.
 *
 * Contract:
 * - `decisions` may arrive in any order and is sorted by ply here.
 * - The returned `decisions` are the first `window.revealedPlies` of them.
 * - `fen` is the position after the last revealed decision, or the game's
 *   opening position when nothing is revealed. No chess engine ships to the
 *   client, so this must always be correct.
 * - `outcome` is present only when the status is "finished". A game still on
 *   air never carries its result, its total length, or any later decision.
 * - `catchUp` is true only when the status is "finished": a game on air is
 *   never watchable from the start, or the shared clock means nothing.
 */
export function revealGame(
  game: RecordedGame,
  decisions: readonly DecisionRecord[],
  now: EpochMs,
): RevealedGame {
  void game;
  void decisions;
  void now;
  throw new NotImplemented("broadcast.gate.revealGame");
}

/**
 * Legal moves at the revealed position, so the browser can offer
 * guess-the-move without an engine and without seeing the played move.
 */
export function revealedMoves(
  game: RecordedGame,
  decisions: readonly DecisionRecord[],
  now: EpochMs,
): RevealedMoves {
  void game;
  void decisions;
  void now;
  throw new NotImplemented("broadcast.gate.revealedMoves");
}

/**
 * Cache-Control for a gated response. A revealed prefix is immutable until the
 * next ply boundary, which is what makes many viewers on one game nearly free.
 * A finished broadcast is immutable forever.
 */
export function cacheControl(window: RevealWindow, now: EpochMs): string {
  void window;
  void now;
  throw new NotImplemented("broadcast.gate.cacheControl");
}
