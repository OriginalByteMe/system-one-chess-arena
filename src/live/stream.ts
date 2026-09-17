import { NotImplemented } from "../core/errors.ts";
import type { Fen, LiveEvent, SpectatorState } from "../core/types.ts";

export function initialSpectatorState(gameId: string, fen: Fen): SpectatorState {
  throw new NotImplemented("live.stream.initialSpectatorState");
}

export function applyEvent(state: SpectatorState, event: LiveEvent): SpectatorState {
  throw new NotImplemented("live.stream.applyEvent");
}

export function resubscribeCursor(state: SpectatorState): number {
  throw new NotImplemented("live.stream.resubscribeCursor");
}
