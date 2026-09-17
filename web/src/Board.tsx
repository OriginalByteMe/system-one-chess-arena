import type { Colour } from "../../src/core/types.ts";
import {
  buildBoard,
  type BoardOrientation,
  type PieceRole,
} from "./board-model.ts";

interface BoardProps {
  readonly fen: string;
  readonly orientation: BoardOrientation;
  readonly lastMove?: string;
}

const PIECES: Readonly<Record<Colour, Readonly<Record<PieceRole, string>>>> = {
  white: {
    king: "♔",
    queen: "♕",
    rook: "♖",
    bishop: "♗",
    knight: "♘",
    pawn: "♙",
  },
  black: {
    king: "♚",
    queen: "♛",
    rook: "♜",
    bishop: "♝",
    knight: "♞",
    pawn: "♟",
  },
};

export function Board({ fen, orientation, lastMove }: BoardProps) {
  const cells = buildBoard(fen, orientation, lastMove);

  return (
    <div className="board-frame">
      <div className="board" role="grid" aria-label={`Chessboard, ${orientation} orientation`}>
        {cells.map((cell, index) => {
          const label =
            cell.piece === undefined
              ? `${cell.square}, empty`
              : `${cell.square}, ${cell.piece.colour} ${cell.piece.role}`;
          return (
            <div
              className={`square ${cell.isLight ? "square--light" : "square--dark"}${cell.isLastMove ? " square--last" : ""}`}
              key={cell.square}
              role="gridcell"
              aria-label={label}
            >
              {index >= 56 && <span className="coordinate coordinate--file">{cell.square[0]}</span>}
              {index % 8 === 0 && <span className="coordinate coordinate--rank">{cell.square[1]}</span>}
              {cell.piece !== undefined && (
                <span
                  className={`piece piece--${cell.piece.colour}`}
                  aria-hidden="true"
                >
                  {PIECES[cell.piece.colour][cell.piece.role]}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
