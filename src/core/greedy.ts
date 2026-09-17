import { Chess, type PieceSymbol } from "chess.js";
import { ContractViolation } from "./errors.ts";
import type { Fen, Rng, Uci } from "./types.ts";

const PIECE_VALUES = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
} satisfies Readonly<Record<PieceSymbol, number>>;

function chessFromFen(fen: Fen): Chess {
  try {
    return new Chess(fen);
  } catch {
    throw new ContractViolation(
      "core.greedy.chooseGreedyMove",
      `invalid FEN: ${fen}`,
    );
  }
}

export function chooseGreedyMove(
  fen: Fen,
  legalMoves: readonly Uci[],
  rng: Rng,
): Uci {
  if (legalMoves.length === 0) {
    throw new ContractViolation(
      "core.greedy.chooseGreedyMove",
      "position must have a legal move",
    );
  }

  const allowed = new Set(legalMoves);
  let bestGain = Number.NEGATIVE_INFINITY;
  let bestMoves: Uci[] = [];

  for (const candidate of chessFromFen(fen).moves({ verbose: true })) {
    const move = `${candidate.from}${candidate.to}${candidate.promotion ?? ""}`;
    if (!allowed.has(move)) continue;

    const captureGain =
      candidate.captured === undefined ? 0 : PIECE_VALUES[candidate.captured];
    const promotionGain =
      candidate.promotion === undefined
        ? 0
        : PIECE_VALUES[candidate.promotion] - PIECE_VALUES.p;
    const gain = captureGain + promotionGain;

    if (gain > bestGain) {
      bestGain = gain;
      bestMoves = [move];
    } else if (gain === bestGain) {
      bestMoves.push(move);
    }
  }

  if (bestMoves.length === 0) {
    throw new ContractViolation(
      "core.greedy.chooseGreedyMove",
      "declared legal moves do not match the position",
    );
  }
  return rng.pick(bestMoves);
}
