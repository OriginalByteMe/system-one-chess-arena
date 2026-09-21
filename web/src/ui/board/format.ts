import type { PieceRole } from "../../board-model.ts";

export const PIECE_GLYPHS: Readonly<Record<"white" | "black", Readonly<Record<PieceRole, string>>>> = {
  white: { king: "♚", queen: "♛", rook: "♜", bishop: "♝", knight: "♞", pawn: "♟" },
  black: { king: "♚", queen: "♛", rook: "♜", bishop: "♝", knight: "♞", pawn: "♟" },
};

/** "g8f6" -> "g8 → f6", ignoring an underpromotion suffix. */
export function formatUci(uci: string): string {
  return `${uci.slice(0, 2)} → ${uci.slice(2, 4)}`;
}
