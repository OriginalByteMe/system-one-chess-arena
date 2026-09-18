import type {
  AdaptationResult,
  CompetitorManifest,
  PlaystyleChange,
  PlayerRecord,
  Provider,
  SeasonConfig,
} from "../core/types.ts";
import { buildCandidate, reviseStrategies, revisePlaystyle } from "./revision.ts";

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
export async function adaptSeason(
  args: AdaptationArgs,
): Promise<readonly AdaptationResult[]> {
  const recordsByCompetitor = new Map(
    args.records.map((record) => [record.competitor, record]),
  );

  const results: AdaptationResult[] = [];
  for (const manifest of args.manifests) {
    const record = recordsByCompetitor.get(manifest.name);
    if (record === undefined) {
      results.push({
        competitor: manifest.name,
        fromVersion: manifest.version,
        outcome: {
          kind: "blocked",
          reason: "insufficient-samples",
          needed: args.minSamplesPerStrategy,
        },
        rationale: "no record to judge this competitor by",
      });
      continue;
    }

    const strategyOutcome = await reviseStrategies({
      manifest,
      record,
      provider: args.provider,
      minSamplesPerStrategy: args.minSamplesPerStrategy,
    });

    if (strategyOutcome.kind === "blocked") {
      results.push({
        competitor: manifest.name,
        fromVersion: manifest.version,
        outcome: strategyOutcome,
        rationale: `too few games to judge fairly, needs ${strategyOutcome.needed} more`,
      });
      continue;
    }

    let currentManifest =
      strategyOutcome.kind === "revised" ? strategyOutcome.manifest : manifest;
    let rationale =
      strategyOutcome.kind === "revised"
        ? (buildCandidate(manifest, record)?.rationale ?? "revised its strategy set")
        : "kept a strategy set that is already working";

    let playstyle: PlaystyleChange | undefined;
    if (args.revisePlaystyle) {
      const playstyleOutcome = await revisePlaystyle({
        manifest: currentManifest,
        record,
        provider: args.provider,
        minSamplesPerStrategy: args.minSamplesPerStrategy,
      });
      if (playstyleOutcome.kind === "revised") {
        playstyle = { from: manifest.playstyle, to: playstyleOutcome.manifest.playstyle };
        currentManifest = playstyleOutcome.manifest;
        rationale = `${rationale}; revised its playstyle sentence`;
      }
    }

    results.push({
      competitor: manifest.name,
      fromVersion: manifest.version,
      outcome:
        currentManifest === manifest
          ? { kind: "kept", version: manifest.version }
          : { kind: "revised", manifest: currentManifest },
      playstyle,
      rationale,
    });
  }

  return results;
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
  const resultByCompetitor = new Map(
    results.map((result) => [result.competitor, result]),
  );
  const competitors = previous.competitors.map((competitor) => {
    const result = resultByCompetitor.get(competitor.name);
    return result?.outcome.kind === "revised" ? result.outcome.manifest : competitor;
  });

  return { ...previous, seasonId, seed, competitors };
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
  const parents: Record<string, string> = {};
  const rationales: Record<string, string> = {};
  for (const result of results) {
    if (result.outcome.kind === "revised") {
      parents[result.competitor] = result.fromVersion;
      rationales[result.competitor] = result.rationale;
    }
  }
  return { parents, rationales };
}
