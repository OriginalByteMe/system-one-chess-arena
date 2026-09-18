import { NotImplemented } from "../core/errors.ts";
import type {
  AdaptationResult,
  CompetitorManifest,
  PlayerRecord,
  Provider,
  SeasonConfig,
} from "../core/types.ts";

export interface AdaptationArgs {
  readonly manifests: readonly CompetitorManifest[];
  readonly records: readonly PlayerRecord[];
  readonly provider: Provider;
  readonly minSamplesPerStrategy: number;
  /**
   * Revise the playstyle sentence as well as the strategy list. Playstyle is
   * the text Jev actually reads, and text moved its answers most in testing.
   */
  readonly revisePlaystyle: boolean;
}

/**
 * Runs one round of self-revision for every competitor.
 *
 * Contract:
 * - A competitor with no record, or too few samples on its worst strategy, is
 *   returned "blocked" and its manifest is untouched. Nobody rewrites their
 *   identity off three games.
 * - A provider failure for one competitor leaves that competitor kept, with the
 *   reason in `rationale`, and never fails the whole round.
 * - Every result carries a rationale, because the site shows why a competitor
 *   changed.
 */
export function adaptSeason(
  args: AdaptationArgs,
): Promise<readonly AdaptationResult[]> {
  void args;
  throw new NotImplemented("season.adaptation.adaptSeason");
}

/**
 * The next season's config: revised manifests where revision happened, the
 * previous manifest where it did not, same openings, new id and seed.
 */
export function nextSeasonConfig(
  previous: SeasonConfig,
  results: readonly AdaptationResult[],
  seasonId: string,
  seed: string,
): SeasonConfig {
  void previous;
  void results;
  void seasonId;
  void seed;
  throw new NotImplemented("season.adaptation.nextSeasonConfig");
}

/**
 * Parent version and rationale for each competitor that actually changed, for
 * `registerVersions`.
 *
 * Contract: `parents[competitor]` is `result.fromVersion`, the version it came
 * from, never the new one. Kept and blocked competitors are omitted, because
 * nothing new needs registering for them.
 */
export function lineageFrom(results: readonly AdaptationResult[]): {
  readonly parents: { readonly [competitor: string]: string };
  readonly rationales: { readonly [competitor: string]: string };
} {
  void results;
  throw new NotImplemented("season.adaptation.lineageFrom");
}
