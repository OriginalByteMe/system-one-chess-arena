import { NotImplemented } from "../../src/core/errors.ts";
import type {
  CalibrationCurve,
  CompetitorProfile,
  CompetitorVersionRow,
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
  void curve;
  throw new NotImplemented("web.competitorModel.calibrationPoints");
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
  void lineage;
  throw new NotImplemented("web.competitorModel.lineageSteps");
}

/** Strategy mix as percentages, most picked first. */
export function strategyMix(
  profile: CompetitorProfile,
): readonly { readonly strategy: string; readonly share: number }[] {
  void profile;
  throw new NotImplemented("web.competitorModel.strategyMix");
}
