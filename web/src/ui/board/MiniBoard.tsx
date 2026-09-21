// The real state of play, framed by the cards rather than buried under them.
import type { JSX } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { buildBoard } from "../../board-model.ts";
import type { BoardOrientation, PieceRole } from "../../board-model.ts";
import { boardInk } from "../board-ink.ts";

const WHITE_GLYPH: Readonly<Record<PieceRole, string>> = {
  king: "\u265A",
  queen: "\u265B",
  rook: "\u265C",
  bishop: "\u265D",
  knight: "\u265E",
  pawn: "\u265F",
};

const BLACK_GLYPH: Readonly<Record<PieceRole, string>> = {
  king: "\u265A",
  queen: "\u265B",
  rook: "\u265C",
  bishop: "\u265D",
  knight: "\u265E",
  pawn: "\u265F",
};

export interface MiniBoardProps {
  readonly fen: string;
  readonly orientation: BoardOrientation;
  readonly lastMove?: string;
  readonly moverAccent: string;
}

export function MiniBoard({ fen, orientation, lastMove, moverAccent }: MiniBoardProps): JSX.Element {
  const reduced = useReducedMotion() ?? false;
  const cells = buildBoard(fen, orientation, lastMove);

  return (
    <div
      className="@container grid aspect-square w-full max-w-[420px] grid-cols-8 grid-rows-8 overflow-hidden rounded-lg"
      role="img"
      aria-label="Current board position"
    >
      {cells.map((cell) => {
        const glyph = cell.piece === undefined ? undefined : (cell.piece.colour === "white" ? WHITE_GLYPH : BLACK_GLYPH)[cell.piece.role];
        const pieceKey = cell.piece === undefined ? "empty" : `${cell.piece.colour}-${cell.piece.role}`;
        return (
          <div
            key={cell.square}
            className={`relative flex items-center justify-center ${cell.isLight ? "bg-board-light" : "bg-board-dark"}`}
          >
            {cell.isLastMove ? (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  boxShadow: `inset 0 0 0 2px ${boardInk(moverAccent)}`,
                  backgroundColor: `color-mix(in oklab, ${boardInk(moverAccent)} 22%, transparent)`,
                }}
                aria-hidden="true"
              />
            ) : null}
            <AnimatePresence mode="popLayout" initial={false}>
              {glyph === undefined ? null : (
                <motion.span
                  key={pieceKey}
                  initial={reduced ? false : { opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.3 }}
                  transition={{ duration: reduced ? 0.05 : 0.32, ease: "easeOut" }}
                  className={`select-none text-[9cqw] leading-none ${
                    cell.piece?.colour === "white" ? "piece-light" : "piece-dark"
                  }`}
                >
                  {glyph}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
