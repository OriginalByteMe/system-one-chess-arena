import { ContractViolation } from "../../src/core/errors";
import type { Colour, Fen, Uci } from "../../src/core/types";

export type PositionFixtureId =
  | "start"
  | "mate-in-one-white"
  | "back-rank-mate"
  | "stalemate"
  | "insufficient-material"
  | "promotion-choice"
  | "en-passant-available"
  | "castling-rights-lost"
  | "forced-recapture"
  | "hanging-queen"
  | "opponent-threatens-mate"
  | "endgame-kp";

export interface PositionFixture {
  readonly id: PositionFixtureId;
  readonly fen: Fen;
  readonly note: string;
  readonly turn: Colour;
  readonly legalMoveCount: number;
  readonly lastMove?: Uci;
}

export const POSITIONS = [
  {
    id: "start",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    note: "The standard initial position has twenty legal moves for White.",
    turn: "white",
    legalMoveCount: 20,
  },
  {
    id: "mate-in-one-white",
    fen: "7k/8/5KQ1/8/8/8/8/8 w - - 0 1",
    note: "White has Qg7 checkmate in one move.",
    turn: "white",
    legalMoveCount: 23,
  },
  {
    id: "back-rank-mate",
    fen: "6k1/5ppp/8/8/8/8/8/K3R3 w - - 0 1",
    note: "White has Re8 checkmate against the boxed-in king.",
    turn: "white",
    legalMoveCount: 16,
  },
  {
    id: "stalemate",
    fen: "7k/5K2/6Q1/8/8/8/8/8 b - - 0 1",
    note: "Black is not in check and has no legal move.",
    turn: "black",
    legalMoveCount: 0,
  },
  {
    id: "insufficient-material",
    fen: "4k3/8/8/8/8/8/8/4K3 w - - 0 1",
    note: "Two bare kings are insufficient mating material.",
    turn: "white",
    legalMoveCount: 5,
  },
  {
    id: "promotion-choice",
    fen: "7k/P7/8/8/8/8/8/K7 w - - 0 1",
    note: "The pawn on a7 has exactly four promotion choices on a8.",
    turn: "white",
    legalMoveCount: 7,
  },
  {
    id: "en-passant-available",
    fen: "7k/8/8/3pP3/8/8/8/K7 w - d6 0 2",
    note: "White can capture the pawn on d5 en passant with e5d6.",
    turn: "white",
    legalMoveCount: 5,
  },
  {
    id: "castling-rights-lost",
    fen: "r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1",
    note: "Home-square kings and rooks cannot castle without castling rights.",
    turn: "white",
    legalMoveCount: 24,
  },
  {
    id: "forced-recapture",
    fen: "7k/8/8/8/8/8/4q3/4K3 w - - 0 2",
    note: "After c2e2, White's only legal move is the recapture Kxe2.",
    turn: "white",
    legalMoveCount: 1,
    lastMove: "c2e2",
  },
  {
    id: "hanging-queen",
    fen: "4q2k/8/8/8/8/8/8/K3R3 w - - 0 2",
    note: "After e7e8, the undefended black queen is capturable by Rxe8.",
    turn: "white",
    legalMoveCount: 16,
    lastMove: "e7e8",
  },
  {
    id: "opponent-threatens-mate",
    fen: "4r1k1/8/8/8/8/8/5PPP/1R4K1 w - - 0 2",
    note: "After e7e8, Black threatens Re1 checkmate if White plays Rb2.",
    turn: "white",
    legalMoveCount: 20,
    lastMove: "e7e8",
  },
  {
    id: "endgame-kp",
    fen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1",
    note: "This king-and-pawn endgame has only three pieces.",
    turn: "white",
    legalMoveCount: 6,
  },
] as const satisfies readonly PositionFixture[];

export function positionFixture(id: PositionFixtureId): PositionFixture {
  const fixture = POSITIONS.find((candidate) => candidate.id === id);
  if (fixture === undefined) {
    throw new ContractViolation("positionFixture", `unknown fixture: ${id}`);
  }
  return fixture;
}
