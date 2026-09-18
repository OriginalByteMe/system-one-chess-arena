import type {
  CalibrationCurve,
  CompetitorProfile,
  CompetitorVersionRow,
  StrategyLabel,
  StrategyStats,
} from "../../src/core/types.ts";

export interface CalibrationPoint {
  /** Bucket midpoint, the stated confidence. */
  readonly stated: number;
  /** What actually happened, as a score in [0, 1]. */
  readonly actual: number;
  readonly decisions: number;
}

/**
 * Points for the calibration chart.
 *
 * Contract: empty buckets are dropped, because a point with no data is a lie on
 * a chart. The perfect line is `actual === stated`, and the caller draws it.
 */
export function calibrationPoints(
  curve: CalibrationCurve,
): readonly CalibrationPoint[] {
  return curve.buckets
    .filter((bucket) => bucket.decisions > 0)
    .map((bucket) => ({
      stated: (bucket.lower + bucket.upper) / 2,
      actual: bucket.meanScore,
      decisions: bucket.decisions,
    }));
}

export interface LineageStep {
  readonly version: string;
  readonly seasonId: string;
  readonly summary: string;
  /** Strategies added and removed against the parent version. */
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly playstyleChanged: boolean;
  readonly rationale?: string;
}

/**
 * What changed at each version and why, for the competitor page.
 *
 * Contract: oldest first, one step per version, diffed against its parent. The
 * first version has no diff and reads as the original entry.
 */
export function lineageSteps(
  lineage: readonly CompetitorVersionRow[],
): readonly LineageStep[] {
  const byVersion = new Map(lineage.map((row) => [row.version, row]));

  return lineage.map((row) => {
    const parent =
      row.parentVersion !== undefined ? byVersion.get(row.parentVersion) : undefined;
    const currentStrategies = new Set<string>(row.manifest.strategies);
    const parentStrategies = new Set<string>(parent?.manifest.strategies ?? []);
    const added =
      parent === undefined
        ? []
        : row.manifest.strategies.filter((strategy) => !parentStrategies.has(strategy));
    const removed =
      parent === undefined
        ? []
        : parent.manifest.strategies.filter((strategy) => !currentStrategies.has(strategy));
    const playstyleChanged =
      parent !== undefined && parent.manifest.playstyle !== row.manifest.playstyle;

    const summary =
      parent === undefined
        ? "Original entry."
        : playstyleChanged && (added.length > 0 || removed.length > 0)
          ? "Changed playstyle and strategy mix."
          : playstyleChanged
            ? "Changed playstyle."
            : added.length > 0 || removed.length > 0
              ? "Changed strategy mix."
              : "No changes.";

    return {
      version: row.version,
      seasonId: row.seasonId,
      summary,
      added,
      removed,
      playstyleChanged,
      rationale: row.rationale,
    };
  });
}

/** Strategy mix as percentages, most picked first. */
export function strategyMix(
  profile: CompetitorProfile,
): readonly { readonly strategy: string; readonly share: number }[] {
  const entries = Object.entries(profile.strategyMix) as readonly [
    StrategyLabel,
    StrategyStats | undefined,
  ][];
  const totalPicks = entries.reduce((sum, [, stats]) => sum + (stats?.picks ?? 0), 0);
  if (totalPicks === 0) return [];

  return entries
    .filter((entry): entry is [StrategyLabel, StrategyStats] => entry[1] !== undefined)
    .map(([strategy, stats]) => ({ strategy, share: stats.picks / totalPicks }))
    .sort((a, b) => b.share - a.share);
}
