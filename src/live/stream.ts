import type { Fen, LiveEvent, SpectatorState } from "../core/types.ts";

export function initialSpectatorState(gameId: string, fen: Fen): SpectatorState {
  return { gameId, fen, cursor: 0, decisions: [] };
}

export function applyEvent(state: SpectatorState, event: LiveEvent): SpectatorState {
  if (state.finished !== undefined) {
    return state;
  }

  if (event.type === "result") {
    return event.ply === state.cursor ? { ...state, finished: event } : state;
  }

  // A game played from an opening begins at the opening's ply, and a fresh
  // spectator has no way to know that ply before its first event. The first
  // move applied to an untouched stream therefore sets the baseline; every
  // move after it must be contiguous, so a gap still waits to be filled.
  const expected = state.lastMove === undefined ? event.ply : state.cursor + 1;
  if (event.ply !== expected) return state;
  return {
    ...state,
    fen: event.fen,
    cursor: event.ply,
    lastMove: event,
    decisions: [...state.decisions, event.decision],
  };
}

export function resubscribeCursor(state: SpectatorState): number {
  return state.cursor;
}
