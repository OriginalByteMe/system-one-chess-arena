import type { DashboardEntry } from "../../src/core/types.ts";
import { TRAIT_RULES } from "../../src/rivalry/traits.ts";

export interface DashboardCard {
  readonly entry: DashboardEntry;
  /** "Nemesis" style chips, already resolved to labels. */
  readonly rivalryLabels: readonly string[];
  readonly subtitle: string;
}

const TRAIT_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  TRAIT_RULES.map((rule) => [rule.id, rule.label]),
);

function subtitleFor(entry: DashboardEntry): string {
  if (entry.strategy === undefined || entry.confidence === undefined) {
    return "Waiting for the game to start.";
  }
  const label = entry.strategy.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  const pct = Math.round(entry.confidence * 100);
  return `${label} · ${pct}% confidence`;
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
  return entries.map((entry) => ({
    entry,
    rivalryLabels: entry.rivalry
      .map((id) => TRAIT_LABELS[id])
      .filter((label): label is string => label !== undefined),
    subtitle: subtitleFor(entry),
  }));
}
