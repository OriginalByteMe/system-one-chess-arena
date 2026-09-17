import type { Fen, LiveEvent, SpectatorState } from "../core/types.ts";

export function initialSpectatorState(gameId: string, fen: Fen): SpectatorState {
  return { gameId, fen, cursor: 0 };
}

export function applyEvent(state: SpectatorState, event: LiveEvent): SpectatorState {
  if (state.finished !== undefined) {
    return state;
  }

  if (event.type === "result") {
    return event.ply === state.cursor ? { ...state, finished: event } : state;
  }

  return event.ply === state.cursor + 1
    ? { ...state, fen: event.fen, cursor: event.ply, lastMove: event }
    : state;
}

export function resubscribeCursor(state: SpectatorState): number {
  return state.cursor;
}
