import { NotImplemented } from "./errors";
import type { Colour, Fen, Opening, San, TerminalState, Uci } from "./types";

export interface Position {
  readonly fen: Fen;
  readonly ply: number;
  readonly turn: Colour;
  readonly history: readonly San[];
}

export function initialPosition(): Position {
  throw new NotImplemented("rules.initialPosition");
}

export function positionFromFen(
  fen: Fen,
  ply?: number,
  history?: readonly San[],
): Position {
  throw new NotImplemented("rules.positionFromFen");
}

export function positionFromOpening(opening: Opening): Position {
  throw new NotImplemented("rules.positionFromOpening");
}

export function legalMoves(position: Position): readonly Uci[] {
  throw new NotImplemented("rules.legalMoves");
}

export function isLegal(position: Position, move: Uci): boolean {
  throw new NotImplemented("rules.isLegal");
}

export function applyMove(position: Position, move: Uci): Position {
  throw new NotImplemented("rules.applyMove");
}

export function terminalState(
  position: Position,
  maxPlies: number,
): TerminalState | undefined {
  throw new NotImplemented("rules.terminalState");
}

export function toSan(position: Position, move: Uci): San {
  throw new NotImplemented("rules.toSan");
}

export function toPgn(position: Position): string {
  throw new NotImplemented("rules.toPgn");
}
