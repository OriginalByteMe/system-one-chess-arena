import { NotImplemented } from "../../src/core/errors.ts";
import type { DashboardEntry } from "../../src/core/types.ts";

export interface DashboardCard {
  readonly entry: DashboardEntry;
  /** "Nemesis" style chips, already resolved to labels. */
  readonly rivalryLabels: readonly string[];
  readonly subtitle: string;
}

/**
 * Cards for the multi-board dashboard.
 *
 * Contract:
 * - Order is the server's, which is already the interest order. The client does
 *   not re-rank, so everyone sees the same dashboard.
 * - The subtitle names the strategy and confidence when the server revealed
 *   them, and says the game is waiting when it has not started.
 * - Unknown trait ids are dropped rather than shown raw.
 */
export function dashboardCards(
  entries: readonly DashboardEntry[],
): readonly DashboardCard[] {
  void entries;
  throw new NotImplemented("web.dashboardModel.dashboardCards");
}
