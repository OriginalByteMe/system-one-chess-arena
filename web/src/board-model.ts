import { Chess, SQUARES, type PieceSymbol, type Square } from "chess.js";

import { ContractViolation } from "../../src/core/errors.ts";
import type { Colour, Fen, Uci } from "../../src/core/types.ts";

export type BoardOrientation = Colour;
export type PieceRole = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

export interface BoardPiece {
  readonly colour: Colour;
  readonly role: PieceRole;
}

export interface BoardCell {
  readonly square: Square;
  readonly piece?: BoardPiece;
  readonly isLight: boolean;
  readonly isLastMove: boolean;
}

const BLACK_SQUARES = [...SQUARES].reverse();
const ROLES: Readonly<Record<PieceSymbol, PieceRole>> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
const UCI_MOVE = /^([a-h][1-8])([a-h][1-8])(?:[qrbn])?$/;

export function squaresFor(orientation: BoardOrientation): readonly Square[] {
  return orientation === "white" ? SQUARES : BLACK_SQUARES;
}

export function mapFen(fen: Fen): ReadonlyMap<Square, BoardPiece> {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    throw new ContractViolation("web/board-model.mapFen", `invalid FEN: ${fen}`);
  }

  const pieces = new Map<Square, BoardPiece>();
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece !== null) {
        pieces.set(piece.square, {
          colour: piece.color === "w" ? "white" : "black",
          role: ROLES[piece.type],
        });
      }
    }
  }
  return pieces;
}

function lastMoveSquares(move: Uci | undefined): ReadonlySet<Square> {
  if (move === undefined) return new Set();
  const match = UCI_MOVE.exec(move);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new ContractViolation("web/board-model.lastMoveSquares", `invalid UCI move: ${move}`);
  }
  return new Set([match[1] as Square, match[2] as Square]);
}

export function buildBoard(
  fen: Fen,
  orientation: BoardOrientation,
  lastMove?: Uci,
): readonly BoardCell[] {
  const pieces = mapFen(fen);
  const highlighted = lastMoveSquares(lastMove);
  return squaresFor(orientation).map((square) => {
    const piece = pieces.get(square);
    return {
      square,
      ...(piece === undefined ? {} : { piece }),
      isLight: (square.charCodeAt(0) - 97 + Number(square[1])) % 2 === 0,
      isLastMove: highlighted.has(square),
    };
  });
}
