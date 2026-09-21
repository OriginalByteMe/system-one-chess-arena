// The board itself: pieces, the last-move glow, the weighted candidate
// arrows, and the piece that flies from origin to destination while a move
// commits. Everything is positioned in a shared 0..100 board-space so it
// scales cleanly from a 1280px stage down to a 460px comparison tile.
import type { JSX, ReactNode } from "react";
import { motion } from "motion/react";

import { buildBoard } from "../../board-model.ts";
import { boardInk } from "../board-ink.ts";
import { arrowPath, arrowWidth, clamp, squareCenter } from "./geometry.ts";
import { PIECE_GLYPHS, formatUci } from "./format.ts";

export interface ArrowSpec {
  readonly move: string;
  readonly from: string;
  readonly to: string;
  readonly p: number;
  readonly chosen: boolean;
  readonly color: string;
}

export interface FlightSpec {
  readonly from: string;
  readonly to: string;
}

export interface BoardStageProps {
  readonly fen: string;
  readonly lastMove: string | undefined;
  readonly lastMoveAccent: string | undefined;
  readonly arrows: readonly ArrowSpec[];
  readonly flight: FlightSpec | null;
  readonly hoveredMove: string | null;
  readonly onHoverMove: (move: string | null) => void;
  readonly reducedMotion: boolean;
  readonly children?: ReactNode;
}

// Candidate arrows read as pencil on the board's own greens, not as a second
// accent competing with the played move.
const GHOST_COLOR = "#2f2d2a";

export function BoardStage({
  fen,
  lastMove,
  lastMoveAccent,
  arrows,
  flight,
  hoveredMove,
  onHoverMove,
  reducedMotion,
  children,
}: BoardStageProps): JSX.Element {
  const cells = buildBoard(fen, "white", lastMove);
  const flightPiece = flight === null ? undefined : cells.find((c) => c.square === flight.from)?.piece;
  const hidden = flight === null || flightPiece === undefined ? null : new Set([flight.from, flight.to]);
  // Weakest first so the strong candidates, and the played move above all,
  // sit on top where they overlap.
  const ordered = [...arrows].sort((a, b) => Number(a.chosen) - Number(b.chosen) || a.p - b.p);
  return (
    <div className="relative aspect-square w-full max-w-full select-none [container-type:inline-size]">
      <div className="absolute inset-0 grid grid-cols-8 grid-rows-8 overflow-hidden rounded-lg shadow-[0_18px_44px_-26px_rgba(0,0,0,0.9)]">
        {cells.map((cell) => {
          const piece = hidden?.has(cell.square) === true ? undefined : cell.piece;
          const ink = lastMoveAccent === undefined ? undefined : boardInk(lastMoveAccent);
          const glow =
            cell.isLastMove && ink !== undefined
              ? {
                  boxShadow: `inset 0 0 0 3px ${ink}`,
                  backgroundColor: `color-mix(in oklab, ${ink} 22%, transparent)`,
                }
              : undefined;
          return (
            <div
              key={cell.square}
              data-square={cell.square}
              className={`relative flex items-center justify-center ${cell.isLight ? "bg-board-light" : "bg-board-dark"}`}
            >
              {glow === undefined ? null : (
                <div className="pointer-events-none absolute inset-0" style={glow} aria-hidden="true" />
              )}
              {piece !== undefined && (
                <span
                  className={`text-[9.4cqw] leading-none ${piece.colour === "white" ? "piece-light" : "piece-dark"}`}
                >
                  {PIECE_GLYPHS[piece.colour][piece.role]}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* No enter/exit animation here on purpose: the thinking phase is only
          700ms long, so a fade-in would spend half of it invisible, and any
          hiccup in the animation leaves the whole field unpainted. Opacity is
          a plain attribute that CSS eases when it changes. */}
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {ordered.map((arrow) => {
          const width = arrowWidth(arrow.p);
          const { d, head } = arrowPath(arrow.from, arrow.to, width);
          const isHovered = hoveredMove === arrow.move;
          const color = arrow.chosen ? boardInk(arrow.color) : GHOST_COLOR;
          // Weight reads through opacity as much as through thickness, so a
          // long-shot candidate stays a whisper instead of a thin black line.
          const resting = arrow.chosen ? 0.92 : clamp(0.26 + arrow.p * 0.45, 0.26, 0.68);
          return (
            <g
              key={arrow.move}
              tabIndex={0}
              role="button"
              aria-label={`${arrow.chosen ? "Played" : "Candidate"} move ${formatUci(arrow.move)}, ${Math.round(arrow.p * 100)} percent probability`}
              onMouseEnter={() => onHoverMove(arrow.move)}
              onMouseLeave={() => onHoverMove(null)}
              onFocus={() => onHoverMove(arrow.move)}
              onBlur={() => onHoverMove(null)}
              className={`pointer-events-auto cursor-pointer outline-none ${reducedMotion ? "" : "transition-opacity duration-200"}`}
              style={{ opacity: isHovered ? Math.max(resting, 0.95) : resting }}
            >
              <path d={d} fill="none" stroke="transparent" strokeWidth={6} strokeLinecap="round" />
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={isHovered ? width + 0.5 : width}
                strokeLinecap="butt"
                strokeLinejoin="round"
                style={arrow.chosen ? { filter: `drop-shadow(0 1px 2px rgba(28,26,24,0.45))` } : undefined}
              />
              <polygon points={head} fill={color} />
            </g>
          );
        })}
      </svg>

      {flight !== null && flightPiece !== undefined && (
        <motion.div
          className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center text-[9.4cqw] leading-none"
          initial={{ left: `${squareCenter(flight.from).x}%`, top: `${squareCenter(flight.from).y}%` }}
          animate={{ left: `${squareCenter(flight.to).x}%`, top: `${squareCenter(flight.to).y}%` }}
          transition={{ duration: reducedMotion ? 0.05 : 0.42, ease: "easeInOut" }}
        >
          <span className={flightPiece.colour === "white" ? "piece-light" : "piece-dark"}>
            {PIECE_GLYPHS[flightPiece.colour][flightPiece.role]}
          </span>
        </motion.div>
      )}

      {children !== undefined && <div className="pointer-events-none absolute inset-0">{children}</div>}
    </div>
  );
}
