import { ContractViolation } from "../core/errors.ts";
import { applyMove, initialPosition, legalMoves, positionFromFen } from "../core/rules.ts";
import type {
  DecisionRecord,
  EpochMs,
  Fen,
  RecordedGame,
  RevealWindow,
  RevealedGame,
  RevealedMoves,
} from "../core/types.ts";
import { revealWindow } from "./clock.ts";

/** Broadcast is immutable forever once finished: cache for a year. */
const IMMUTABLE_MAX_AGE_SECONDS = 31_536_000;

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
  const sorted = [...decisions].sort((a, b) => a.ply - b.ply);
  const window = revealWindow(game.schedule, sorted.length, now);
  const revealed = sorted.slice(0, window.revealedPlies);
  const lastRevealed = revealed[revealed.length - 1];
  const opening = sorted[0];

  let fen: Fen;
  if (lastRevealed === undefined) {
    fen = opening?.fen ?? initialPosition().fen;
  } else {
    fen = applyMove(positionFromFen(lastRevealed.fen), lastRevealed.move).fen;
  }

  const finished = window.status === "finished";
  const summary = game.summary;

  return {
    gameId: summary.gameId,
    seasonId: summary.seasonId,
    white: summary.white,
    black: summary.black,
    openingId: summary.openingId,
    window,
    fen,
    decisions: revealed,
    ...(finished ? { outcome: { result: summary.result, reason: summary.reason } } : {}),
    catchUp: finished,
  };
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
  const revealed = revealGame(game, decisions, now);
  return {
    gameId: revealed.gameId,
    ply: revealed.window.revealedPlies,
    fen: revealed.fen,
    legalMoves: legalMoves(positionFromFen(revealed.fen)),
  };
}

/**
 * Cache-Control for a gated response. A revealed prefix is immutable until the
 * next ply boundary, which is what makes many viewers on one game nearly free.
 * A finished broadcast is immutable forever.
 */
export function cacheControl(window: RevealWindow, now: EpochMs): string {
  if (window.status === "finished") {
    return `public, max-age=${IMMUTABLE_MAX_AGE_SECONDS}, immutable`;
  }

  const nextBoundaryAt = window.nextBoundaryAt;
  if (nextBoundaryAt === undefined) {
    throw new ContractViolation(
      "broadcast.gate.cacheControl",
      "nextBoundaryAt is required while the broadcast is not finished",
    );
  }

  const maxAge = Math.max(1, Math.ceil((nextBoundaryAt - now) / 1_000));
  return `public, max-age=${maxAge}`;
}
