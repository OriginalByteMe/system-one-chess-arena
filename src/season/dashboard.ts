import { NotImplemented } from "../core/errors.ts";
import type {
  DashboardEntry,
  DecisionRecord,
  RevealedGame,
  Trait,
} from "../core/types.ts";

/**
 * Material swing over the last few revealed plies, in centipawns, from the
 * point of view of whoever is now to move. Positive means the position just
 * moved in their favour.
 */
export function materialSwing(decisions: readonly DecisionRecord[]): number {
  void decisions;
  throw new NotImplemented("season.dashboard.materialSwing");
}

/**
 * How interesting a board looks right now: recent material swing, a rivalry
 * flag, and low confidence. Deliberately simple and documented, because an
 * ordering nobody can explain is worse than an obvious one.
 */
export function interestScore(
  game: RevealedGame,
  traits: readonly Trait[],
): number {
  void game;
  void traits;
  throw new NotImplemented("season.dashboard.interestScore");
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
  void games;
  void traits;
  throw new NotImplemented("season.dashboard.dashboardFrom");
}
