import { Chess } from "chess.js";
import { ContractViolation } from "./errors";
import { PIECE_VALUES } from "./features";
import type { Colour, Fen, Opening, San, TerminalState, Uci } from "./types";

export interface Position {
  readonly fen: Fen;
  readonly ply: number;
  readonly turn: Colour;
  readonly history: readonly San[];
}

function colour(turn: "w" | "b"): Colour {
  return turn === "w" ? "white" : "black";
}

function chessFromFen(fen: Fen, subject: string): Chess {
  try {
    return new Chess(fen);
  } catch {
    throw new ContractViolation(subject, `invalid FEN: ${fen}`);
  }
}

function uciParts(move: Uci):
  | { readonly from: string; readonly to: string; readonly promotion?: string }
  | undefined {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]$/.test(move) &&
      !/^[a-h][1-8][a-h][1-8]$/.test(move)) {
    return undefined;
  }

  const promotion = move[4];
  return promotion === undefined
    ? { from: move.slice(0, 2), to: move.slice(2, 4) }
    : { from: move.slice(0, 2), to: move.slice(2, 4), promotion };
}

function replay(history: readonly San[]): Chess | undefined {
  const chess = new Chess();
  try {
    for (const move of history) chess.move(move);
    return chess;
  } catch {
    return undefined;
  }
}

export function initialPosition(): Position {
  const chess = new Chess();
  return {
    fen: chess.fen(),
    history: [],
    ply: 0,
    turn: colour(chess.turn()),
  };
}

export function positionFromFen(
  fen: Fen,
  ply = 0,
  history: readonly San[] = [],
): Position {
  const chess = chessFromFen(fen, "rules.positionFromFen");
  return {
    fen,
    history: [...history],
    ply,
    turn: colour(chess.turn()),
  };
}

export function positionFromOpening(opening: Opening): Position {
  const chess = replay(opening.moves);
  if (chess === undefined || chess.fen() !== opening.fen) {
    throw new ContractViolation(
      "rules.positionFromOpening",
      `moves do not reach declared FEN for opening: ${opening.id}`,
    );
  }

  return {
    fen: opening.fen,
    history: [...opening.moves],
    ply: opening.moves.length,
    turn: colour(chess.turn()),
  };
}

export function legalMoves(position: Position): readonly Uci[] {
  return chessFromFen(position.fen, "rules.legalMoves")
    .moves({ verbose: true })
    .map((move) => `${move.from}${move.to}${move.promotion ?? ""}`)
    .sort();
}

export function isLegal(position: Position, move: Uci): boolean {
  return uciParts(move) !== undefined && legalMoves(position).includes(move);
}

export function applyMove(position: Position, move: Uci): Position {
  const parts = uciParts(move);
  if (parts === undefined) {
    throw new ContractViolation("rules.applyMove", `malformed UCI move: ${move}`);
  }

  const chess = chessFromFen(position.fen, "rules.applyMove");
  try {
    const played = chess.move(parts);
    return {
      fen: chess.fen(),
      history: [...position.history, played.san],
      ply: position.ply + 1,
      turn: colour(chess.turn()),
    };
  } catch {
    throw new ContractViolation("rules.applyMove", `illegal move: ${move}`);
  }
}

/**
 * How far ahead a side must be, in centipawns, before a game with no progress
 * is awarded rather than drawn. A pawn is not a win; a knight is.
 */
export const ADJUDICATION_BAND_CP = 150;

/** Material balance from white's side, in centipawns, kings excluded. */
function materialBalanceCp(chess: Chess): number {
  let balance = 0;
  for (const row of chess.board()) {
    for (const square of row) {
      if (square === null || square.type === "k") continue;
      const value = PIECE_VALUES[square.type];
      balance += square.color === "w" ? value : -value;
    }
  }
  return balance;
}

/**
 * Decides a game that ended without progress.
 *
 * Measured 2026-09-18: six of six recorded games drew by repetition or move
 * limit, so honouring those draws leaves every rating at its starting value
 * forever. Final material is lopsided and informative where the result is not,
 * so a no-progress game is awarded to whoever is clearly ahead.
 *
 * `adjudicatedCp` is present only when the rule actually decided a winner, so
 * a genuine drawn ending stays indistinguishable from one the rule declined.
 */
function adjudicate(chess: Chess, reason: "threefold" | "move-limit"): TerminalState {
  const balance = materialBalanceCp(chess);
  if (Math.abs(balance) <= ADJUDICATION_BAND_CP) {
    return { reason, result: "draw" };
  }
  return {
    reason,
    result: balance > 0 ? "white" : "black",
    adjudicatedCp: balance,
  };
}

export function terminalState(
  position: Position,
  maxPlies: number,
): TerminalState | undefined {
  const chess = chessFromFen(position.fen, "rules.terminalState");

  if (chess.isCheckmate()) {
    return {
      reason: "checkmate",
      result: chess.turn() === "w" ? "black" : "white",
    };
  }
  if (chess.isStalemate()) return { reason: "stalemate", result: "draw" };
  if (chess.isInsufficientMaterial()) {
    return { reason: "insufficient-material", result: "draw" };
  }
  if (chess.isDrawByFiftyMoves()) {
    return { reason: "fifty-move", result: "draw" };
  }

  const played = replay(position.history);
  if (played !== undefined &&
      played.fen() === position.fen &&
      played.isThreefoldRepetition()) {
    return adjudicate(chess, "threefold");
  }
  if (position.ply >= maxPlies) {
    return adjudicate(chess, "move-limit");
  }
  return undefined;
}

export function toSan(position: Position, move: Uci): San {
  const parts = uciParts(move);
  if (parts === undefined) {
    throw new ContractViolation("rules.toSan", `malformed UCI move: ${move}`);
  }

  const chess = chessFromFen(position.fen, "rules.toSan");
  try {
    return chess.move(parts).san;
  } catch {
    throw new ContractViolation("rules.toSan", `illegal move: ${move}`);
  }
}

export function toPgn(position: Position): string {
  const chess = replay(position.history);
  if (chess === undefined) {
    throw new ContractViolation("rules.toPgn", "history contains an illegal SAN move");
  }
  return chess.pgn();
}
