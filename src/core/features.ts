import { Chess } from "chess.js";
import type { Color, PieceSymbol, Square } from "chess.js";
import { ContractViolation } from "./errors.ts";
import type { FeatureKey, FeatureSet, FeatureSubset, Uci } from "./types.ts";
import type { Position } from "./rules.ts";

export const PIECE_VALUES: Readonly<Record<PieceSymbol, number>> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20_000,
};

function isSquare(value: string): value is Square {
  return /^[a-h][1-8]$/.test(value);
}

interface BoardSquare {
  readonly square: Square;
  readonly type: PieceSymbol;
  readonly color: Color;
}

type Board = readonly (BoardSquare | null)[][];

function openChess(caller: string, position: Position): Chess {
  try {
    return new Chess(position.fen);
  } catch {
    throw new ContractViolation(caller, `invalid FEN: ${position.fen}`);
  }
}

interface BoardScalars {
  readonly materialBalance: number;
  readonly hangingOwnPieces: number;
  readonly hangingOpponentPieces: number;
  readonly development: number;
  readonly kingSafety: number;
}

function computeBoardScalars(
  chess: Chess,
  board: Board,
  own: Color,
  opponent: Color,
  minorHomeSquares: readonly string[],
): BoardScalars {
  let materialBalance = 0;
  let hangingOwnPieces = 0;
  let hangingOpponentPieces = 0;
  let development = 0;
  let kingSquare: Square | undefined;

  for (const row of board) {
    for (const piece of row) {
      if (piece === null) continue;

      const value = PIECE_VALUES[piece.type];
      materialBalance += piece.color === own ? value : -value;

      if (piece.color === own && piece.type === "k") kingSquare = piece.square;
      if (
        piece.color === own &&
        (piece.type === "b" || piece.type === "n") &&
        !minorHomeSquares.includes(piece.square)
      ) {
        development++;
      }

      if (piece.type === "k") continue;
      const attacker = piece.color === own ? opponent : own;
      const favourablyAttacked = chess
        .attackers(piece.square, attacker)
        .some((square) => {
          const attackingPiece = chess.get(square);
          return attackingPiece !== undefined &&
            PIECE_VALUES[attackingPiece.type] <= value;
        });
      if (
        favourablyAttacked &&
        chess.attackers(piece.square, piece.color).length === 0
      ) {
        if (piece.color === own) hangingOwnPieces++;
        else hangingOpponentPieces++;
      }
    }
  }

  if (kingSquare === undefined) {
    throw new ContractViolation("features.computeFeatures", "missing moving king");
  }

  let kingSafety = 0;
  const kingFile = kingSquare.charCodeAt(0);
  const kingRank = Number(kingSquare[1]);
  for (const row of board) {
    for (const piece of row) {
      if (
        piece !== null &&
        piece.color === own &&
        piece.type === "p" &&
        Math.abs(piece.square.charCodeAt(0) - kingFile) <= 1 &&
        Math.abs(Number(piece.square[1]) - kingRank) <= 1
      ) {
        kingSafety++;
      }
    }
  }

  return { materialBalance, hangingOwnPieces, hangingOpponentPieces, development, kingSafety };
}

function computeOpponentMobility(position: Position, opponent: Color): number {
  const opponentPositionFields = position.fen.split(" ");
  opponentPositionFields[1] = opponent;
  opponentPositionFields[3] = "-";
  return new Chess(opponentPositionFields.join(" ")).moves().length;
}

function computeOpponentMateInOne(chess: Chess): boolean {
  let opponentMateInOne = false;
  for (const move of chess.moves({ verbose: true })) {
    chess.move(move);
    for (const reply of chess.moves({ verbose: true })) {
      chess.move(reply);
      const isMate = chess.isCheckmate();
      chess.undo();
      if (isMate) {
        opponentMateInOne = true;
        break;
      }
    }
    chess.undo();
    if (opponentMateInOne) break;
  }
  return opponentMateInOne;
}

interface LastMoveScalars {
  readonly lastMoveAttacks: number;
  readonly lastMoveThreatValue: number;
  readonly lastMoveWasCapture: boolean;
}

const NEUTRAL_LAST_MOVE_SCALARS: LastMoveScalars = {
  lastMoveAttacks: 0,
  lastMoveThreatValue: 0,
  lastMoveWasCapture: false,
};

function computeLastMoveScalars(
  chess: Chess,
  board: Board,
  own: Color,
  opponent: Color,
  position: Position,
  lastMove: Uci,
  opponentMateInOne: boolean,
): LastMoveScalars {
  const destination = lastMove.slice(2, 4);
  if (
    !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(lastMove) ||
    !isSquare(destination) ||
    chess.get(destination)?.color !== opponent
  ) {
    throw new ContractViolation(
      "features.computeFeatures",
      `invalid last move: ${lastMove}`,
    );
  }

  let lastMoveAttacks = 0;
  let lastMoveThreatValue = 0;
  for (const row of board) {
    for (const piece of row) {
      if (
        piece !== null &&
        piece.color === own &&
        chess.attackers(piece.square, opponent).includes(destination)
      ) {
        lastMoveAttacks++;
        lastMoveThreatValue = Math.max(
          lastMoveThreatValue,
          PIECE_VALUES[piece.type],
        );
      }
    }
  }
  if (opponentMateInOne) lastMoveThreatValue = PIECE_VALUES.k;
  const lastMoveWasCapture =
    position.history[position.history.length - 1]?.includes("x") ?? false;

  return { lastMoveAttacks, lastMoveThreatValue, lastMoveWasCapture };
}

export function computeFeatures(position: Position, lastMove?: Uci): FeatureSet {
  const chess = openChess("features.computeFeatures", position);
  const own = chess.turn();
  const opponent: Color = own === "w" ? "b" : "w";
  const board = chess.board();
  const minorHomeSquares: readonly string[] = own === "w"
    ? ["b1", "c1", "f1", "g1"]
    : ["b8", "c8", "f8", "g8"];

  const scalars = computeBoardScalars(chess, board, own, opponent, minorHomeSquares);
  const opponentMobility = computeOpponentMobility(position, opponent);
  const opponentMateInOne = computeOpponentMateInOne(chess);
  const lastMoveScalars = lastMove === undefined
    ? NEUTRAL_LAST_MOVE_SCALARS
    : computeLastMoveScalars(chess, board, own, opponent, position, lastMove, opponentMateInOne);

  return {
    ...scalars,
    mobility: chess.moves().length,
    opponentMobility,
    inCheck: chess.inCheck(),
    opponentMateInOne,
    ...lastMoveScalars,
    phase: position.ply < 20
      ? "opening"
      : position.ply < 60
        ? "middlegame"
        : "endgame",
  };
}

export function filterFeatures(
  all: FeatureSet,
  declared: readonly FeatureKey[],
): FeatureSubset {
  return Object.fromEntries(declared.map((key) => [key, all[key]]));
}

/**
 * Computes only the features a manifest declares.
 *
 * This exists because `computeFeatures` always runs the `opponentMateInOne`
 * search, a 2-ply scan over every move crossed with every reply, which measured
 * about 200 ms per position on 2026-09-18 and is essentially the whole cost of
 * feature computation. A persona that does not declare it should not pay for
 * it, and at 60 plies a game that difference is the precompute ceiling.
 *
 * Contract:
 * - The returned object's own keys are exactly `declared`, in that order, and
 *   every value equals what `computeFeatures` would have produced.
 * - No undeclared feature is computed. The expensive searches in particular
 *   must be reachable only when asked for.
 * - Duplicate keys in `declared` appear once.
 */
export function computeDeclaredFeatures(
  position: Position,
  declared: readonly FeatureKey[],
  lastMove?: Uci,
): FeatureSubset {
  const dedupedKeys: FeatureKey[] = [];
  const wanted = new Set<FeatureKey>();
  for (const key of declared) {
    if (wanted.has(key)) continue;
    wanted.add(key);
    dedupedKeys.push(key);
  }

  const result: { [K in FeatureKey]?: FeatureSet[K] } = {};
  if (dedupedKeys.length === 0) return result;

  const chess = openChess("features.computeDeclaredFeatures", position);
  const own = chess.turn();
  const opponent: Color = own === "w" ? "b" : "w";
  const board = chess.board();
  const minorHomeSquares: readonly string[] = own === "w"
    ? ["b1", "c1", "f1", "g1"]
    : ["b8", "c8", "f8", "g8"];

  let scalars: BoardScalars | undefined;
  const boardScalarsValue = (): BoardScalars => {
    if (scalars === undefined) {
      scalars = computeBoardScalars(chess, board, own, opponent, minorHomeSquares);
    }
    return scalars;
  };

  let mateInOne: boolean | undefined;
  const opponentMateInOneValue = (): boolean => {
    if (mateInOne === undefined) mateInOne = computeOpponentMateInOne(chess);
    return mateInOne;
  };

  let lastMoveResult: LastMoveScalars | undefined;
  const lastMoveScalarsValue = (): LastMoveScalars => {
    if (lastMoveResult === undefined) {
      lastMoveResult = lastMove === undefined
        ? NEUTRAL_LAST_MOVE_SCALARS
        : computeLastMoveScalars(
          chess,
          board,
          own,
          opponent,
          position,
          lastMove,
          opponentMateInOneValue(),
        );
    }
    return lastMoveResult;
  };

  for (const key of dedupedKeys) {
    switch (key) {
      case "materialBalance":
        result.materialBalance = boardScalarsValue().materialBalance;
        break;
      case "hangingOwnPieces":
        result.hangingOwnPieces = boardScalarsValue().hangingOwnPieces;
        break;
      case "hangingOpponentPieces":
        result.hangingOpponentPieces = boardScalarsValue().hangingOpponentPieces;
        break;
      case "development":
        result.development = boardScalarsValue().development;
        break;
      case "kingSafety":
        result.kingSafety = boardScalarsValue().kingSafety;
        break;
      case "mobility":
        result.mobility = chess.moves().length;
        break;
      case "opponentMobility":
        result.opponentMobility = computeOpponentMobility(position, opponent);
        break;
      case "inCheck":
        result.inCheck = chess.inCheck();
        break;
      case "opponentMateInOne":
        result.opponentMateInOne = opponentMateInOneValue();
        break;
      case "lastMoveAttacks":
        result.lastMoveAttacks = lastMoveScalarsValue().lastMoveAttacks;
        break;
      case "lastMoveThreatValue":
        result.lastMoveThreatValue = lastMoveScalarsValue().lastMoveThreatValue;
        break;
      case "lastMoveWasCapture":
        result.lastMoveWasCapture = lastMoveScalarsValue().lastMoveWasCapture;
        break;
      case "phase":
        result.phase = position.ply < 20
          ? "opening"
          : position.ply < 60
            ? "middlegame"
            : "endgame";
        break;
    }
  }

  return result;
}
