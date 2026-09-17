import { Chess, type PieceSymbol } from "chess.js";
import { ContractViolation } from "../core/errors.ts";
import type {
  Clock,
  Competitor,
  CompetitorManifest,
  Fen,
  Rng,
  Uci,
} from "../core/types.ts";

const PIECE_VALUES = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
} satisfies Readonly<Record<PieceSymbol, number>>;

function toUci(move: {
  readonly from: string;
  readonly to: string;
  readonly promotion?: string;
}): Uci {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

export function chooseGreedyMove(
  fen: Fen,
  legalMoves: readonly Uci[],
  rng: Rng,
): Uci {
  if (legalMoves.length === 0) {
    throw new ContractViolation(
      "players.greedy.decide",
      "position must have a legal move",
    );
  }

  const allowed = new Set(legalMoves);
  let bestGain = Number.NEGATIVE_INFINITY;
  let bestMoves: Uci[] = [];

  for (const candidate of new Chess(fen).moves({ verbose: true })) {
    const move = toUci(candidate);
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
      "players.greedy.decide",
      "declared legal moves do not match the position",
    );
  }
  return rng.pick(bestMoves);
}

export function createGreedyPlayer(
  manifest: CompetitorManifest,
  rng: Rng,
  clock: Clock,
): Competitor {
  const strategy = manifest.strategies[0];
  if (strategy === undefined) {
    throw new ContractViolation(
      "players.greedy.createGreedyPlayer",
      "manifest must declare a strategy",
    );
  }

  return {
    manifest,
    async decide(input) {
      const startedAt = clock.now();
      const move = chooseGreedyMove(input.fen, input.legalMoves, rng);
      return {
        move,
        strategy,
        latencyMs: clock.now() - startedAt,
      };
    },
  };
}
