import { NotImplemented } from "./errors.ts";
import type { FeatureKey, FeatureSet, FeatureSubset, Uci } from "./types.ts";
import type { Position } from "./rules.ts";

export function computeFeatures(position: Position, lastMove?: Uci): FeatureSet {
  throw new NotImplemented("features.computeFeatures");
}

export function filterFeatures(
  all: FeatureSet,
  declared: readonly FeatureKey[],
): FeatureSubset {
  throw new NotImplemented("features.filterFeatures");
}
