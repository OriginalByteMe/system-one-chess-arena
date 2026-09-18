import type { PieceSymbol } from "chess.js";
import { PIECE_VALUES } from "../core/features.ts";
import { pairKey } from "../rivalry/head-to-head.ts";
import type {
  DashboardEntry,
  DecisionRecord,
  Fen,
  RevealedGame,
  Trait,
} from "../core/types.ts";

const LOWER_PIECE_SYMBOLS = ["p", "n", "b", "r", "q", "k"] as const;

function isPieceSymbol(value: string): value is PieceSymbol {
  return (LOWER_PIECE_SYMBOLS as readonly string[]).includes(value);
}

/** White material minus black material, in centipawns, from a FEN. */
function materialBalance(fen: Fen): number {
  const board = fen.split(" ")[0] ?? "";
  let balance = 0;
  for (const char of board) {
    const symbol = char.toLowerCase();
    if (!isPieceSymbol(symbol)) continue;
    const value = PIECE_VALUES[symbol];
    balance += char === symbol ? -value : value;
  }
  return balance;
}

/**
 * Material swing over the last few revealed plies, in centipawns, from the
 * point of view of whoever is now to move. Positive means the position just
 * moved in their favour.
 */
export function materialSwing(decisions: readonly DecisionRecord[]): number {
  const sorted = [...decisions].sort((a, b) => a.ply - b.ply);
  if (sorted.length < 2) return 0;
  const previous = sorted[sorted.length - 2];
  const current = sorted[sorted.length - 1];
  if (previous === undefined || current === undefined) return 0;
  const swing = materialBalance(current.fen) - materialBalance(previous.fen);
  return current.colour === "white" ? swing : -swing;
}

/** Fixed bonus for an active rivalry trait, on the same scale as a small swing. */
const RIVALRY_BONUS = 200;
/** Weight turning a 0..1 uncertainty into the same scale as a small swing. */
const UNCERTAINTY_WEIGHT = 200;

/**
 * How interesting a board looks right now: recent material swing, a rivalry
 * flag, and low confidence. Deliberately simple and documented, because an
 * ordering nobody can explain is worse than an obvious one.
 */
export function interestScore(
  game: RevealedGame,
  traits: readonly Trait[],
): number {
  const swing = Math.abs(materialSwing(game.decisions));
  const rivalry = traits.length > 0 ? RIVALRY_BONUS : 0;
  const lastDecision = game.decisions[game.decisions.length - 1];
  const confidence = lastDecision?.confidence ?? 1;
  const uncertainty = (1 - confidence) * UNCERTAINTY_WEIGHT;
  return swing + rivalry + uncertainty;
}

/**
 * The revealed head of every game, most interesting first.
 *
 * Contract: every field comes from the already-gated RevealedGame, so this
 * cannot leak. `traits` is keyed by `pairKey`. Finished games are included and
 * sort last among equal interest, so the dashboard shows what just ended.
 */
export function dashboardFrom(
  games: readonly RevealedGame[],
  traits: ReadonlyMap<string, readonly Trait[]>,
): readonly DashboardEntry[] {
  const entries = games.map((game): DashboardEntry => {
    const pairTraits = traits.get(pairKey(game.white.name, game.black.name)) ?? [];
    const lastDecision = game.decisions[game.decisions.length - 1];

    return {
      gameId: game.gameId,
      seasonId: game.seasonId,
      white: game.white,
      black: game.black,
      fen: game.fen,
      ply: game.window.revealedPlies,
      status: game.window.status,
      ...(lastDecision?.move === undefined ? {} : { lastMove: lastDecision.move }),
      ...(lastDecision?.strategy === undefined ? {} : { strategy: lastDecision.strategy }),
      ...(lastDecision?.confidence === undefined ? {} : { confidence: lastDecision.confidence }),
      rivalry: pairTraits.map((trait) => trait.rule),
      interest: interestScore(game, pairTraits),
    };
  });

  return entries.slice().sort((a, b) => {
    if (a.interest !== b.interest) return b.interest - a.interest;
    return Number(a.status === "finished") - Number(b.status === "finished");
  });
}
