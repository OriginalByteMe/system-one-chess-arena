import { ContractViolation } from "../core/errors.ts";
import { manifestVersion } from "../core/manifest.ts";
import {
  STRATEGY_LABELS,
  type CompetitorManifest,
  type PlayerRecord,
  type Provider,
  type RevisionOutcome,
  type RevisionProposal,
  type StateValue,
  type StrategyLabel,
  type StrategyStats,
  type SystemOneRequest,
} from "../core/types.ts";

export interface RevisionArgs {
  readonly manifest: CompetitorManifest;
  readonly record: PlayerRecord;
  readonly provider: Provider;
  readonly minSamplesPerStrategy: number;
}

function statsFor(
  record: PlayerRecord,
  strategy: StrategyLabel,
  subject: string,
): StrategyStats {
  const stats = record.byStrategy[strategy];
  if (stats === undefined) {
    throw new ContractViolation(subject, `missing statistics for ${strategy}`);
  }
  return stats;
}

export function buildCandidate(
  manifest: CompetitorManifest,
  record: PlayerRecord,
): RevisionProposal | undefined {
  if (manifest.strategies.length <= 1) {
    return undefined;
  }

  const orderedStrategies = STRATEGY_LABELS.filter((strategy) =>
    manifest.strategies.includes(strategy),
  );
  let worst = orderedStrategies[0]!;
  let worstStats = statsFor(
    record,
    worst,
    "season.revision.buildCandidate",
  );

  for (const strategy of orderedStrategies.slice(1)) {
    const stats = statsFor(
      record,
      strategy,
      "season.revision.buildCandidate",
    );
    if (stats.score / stats.picks < worstStats.score / worstStats.picks) {
      worst = strategy;
      worstStats = stats;
    }
  }

  return {
    competitor: manifest.name,
    fromVersion: manifest.version,
    strategies: manifest.strategies.filter((strategy) => strategy !== worst),
    rationale: `${worst} scored ${worstStats.score / worstStats.picks}/pick over ${worstStats.picks} picks`,
  };
}

export function buildRevisionRequest(args: RevisionArgs): SystemOneRequest {
  const candidate = buildCandidate(args.manifest, args.record);
  if (candidate === undefined) {
    throw new ContractViolation(
      "season.revision.buildRevisionRequest",
      "a revision requires at least two strategies",
    );
  }

  const strategyState: Record<string, StateValue> = {};
  for (const strategy of args.manifest.strategies) {
    const stats = statsFor(
      args.record,
      strategy,
      "season.revision.buildRevisionRequest",
    );
    strategyState[`strategy.${strategy}.picks`] = stats.picks;
    strategyState[`strategy.${strategy}.score`] = stats.score;
    strategyState[`strategy.${strategy}.avgConfidence`] = stats.avgConfidence;
  }

  return {
    kind: "systemone",
    model: args.manifest.model,
    state: {
      competitor: args.manifest.name,
      recordVersion: args.record.version,
      playstyle: args.manifest.playstyle,
      games: args.record.games,
      wins: args.record.wins,
      draws: args.record.draws,
      losses: args.record.losses,
      whiteGames: args.record.byColour.white,
      blackGames: args.record.byColour.black,
      currentStrategies: args.manifest.strategies,
      proposedStrategies: candidate.strategies,
      proposalRationale: candidate.rationale,
      ...strategyState,
    },
    questions: {
      revision: {
        type: "choice",
        instructions:
          "Choose whether to keep the current strategy set or adopt the proposed set.",
        options: ["keep", "revise"],
      },
    },
  };
}

export async function reviseStrategies(
  args: RevisionArgs,
): Promise<RevisionOutcome> {
  const fewestPicks = Math.min(
    ...args.manifest.strategies.map(
      (strategy) =>
        args.record.byStrategy[strategy]?.picks ?? 0,
    ),
  );
  if (fewestPicks < args.minSamplesPerStrategy) {
    return {
      kind: "blocked",
      reason: "insufficient-samples",
      needed: args.minSamplesPerStrategy - fewestPicks,
    };
  }

  const candidate = buildCandidate(args.manifest, args.record);
  if (candidate === undefined) {
    return { kind: "kept", version: args.manifest.version };
  }

  let response;
  try {
    response = await args.provider.ask(buildRevisionRequest(args));
  } catch {
    return { kind: "kept", version: args.manifest.version };
  }

  if (
    response.kind !== "systemone" ||
    response.answers.revision?.choice !== "revise"
  ) {
    return { kind: "kept", version: args.manifest.version };
  }

  const { version: _version, ...fields } = args.manifest;
  const revisedFields = { ...fields, strategies: candidate.strategies };
  return {
    kind: "revised",
    manifest: {
      ...revisedFields,
      version: manifestVersion(revisedFields),
    },
  };
}

/**
 * Asks whether the playstyle sentence itself should change.
 *
 * Playstyle is the text Jev actually reads, and in the 2026-09-17 ablation it
 * moved answers more than any computed feature, so a competitor that never
 * revises it is barely adapting at all.
 *
 * Contract: the request offers the current sentence against a small set of
 * alternatives derived from the record, so the answer is a choice rather than
 * free text. Free text would let a persona rewrite itself into anything.
 */
export function buildPlaystyleRequest(args: RevisionArgs): SystemOneRequest {
  const alternative = playstyleAlternative(args.manifest, args.record);
  const options = [args.manifest.playstyle, alternative];

  const strategyState: Record<string, StateValue> = {};
  for (const strategy of args.manifest.strategies) {
    const stats = statsFor(
      args.record,
      strategy,
      "season.revision.buildPlaystyleRequest",
    );
    strategyState[`strategy.${strategy}.picks`] = stats.picks;
    strategyState[`strategy.${strategy}.score`] = stats.score;
    strategyState[`strategy.${strategy}.avgConfidence`] = stats.avgConfidence;
  }

  return {
    kind: "systemone",
    model: args.manifest.model,
    state: {
      competitor: args.manifest.name,
      recordVersion: args.record.version,
      playstyle: args.manifest.playstyle,
      games: args.record.games,
      wins: args.record.wins,
      draws: args.record.draws,
      losses: args.record.losses,
      ...strategyState,
    },
    questions: {
      playstyle: {
        type: "choice",
        instructions:
          "Choose whether to keep the current playstyle sentence or adopt the alternative.",
        options,
      },
    },
  };
}

/**
 * Revises the playstyle sentence.
 *
 * Contract: same sample-count guard as `reviseStrategies`; only `playstyle`
 * changes, so the strategy list, features, budget and fallback are identical;
 * the version is rehashed. A provider failure keeps the manifest.
 */
export async function revisePlaystyle(args: RevisionArgs): Promise<RevisionOutcome> {
  const fewestPicks = Math.min(
    ...args.manifest.strategies.map(
      (strategy) => args.record.byStrategy[strategy]?.picks ?? 0,
    ),
  );
  if (fewestPicks < args.minSamplesPerStrategy) {
    return {
      kind: "blocked",
      reason: "insufficient-samples",
      needed: args.minSamplesPerStrategy - fewestPicks,
    };
  }

  let response;
  try {
    response = await args.provider.ask(buildPlaystyleRequest(args));
  } catch {
    return { kind: "kept", version: args.manifest.version };
  }

  if (response.kind !== "systemone") {
    return { kind: "kept", version: args.manifest.version };
  }

  const answer = response.answers.playstyle;
  if (answer === undefined || answer.choice === args.manifest.playstyle) {
    return { kind: "kept", version: args.manifest.version };
  }

  const { version: _version, ...fields } = args.manifest;
  const revisedFields = { ...fields, playstyle: answer.choice };
  return {
    kind: "revised",
    manifest: {
      ...revisedFields,
      version: manifestVersion(revisedFields),
    },
  };
}

/**
 * A deterministic alternative playstyle sentence derived from which declared
 * strategy has scored best for this competitor so far. Never free text: the
 * sentence is one of a small, record-derived set.
 */
function playstyleAlternative(
  manifest: CompetitorManifest,
  record: PlayerRecord,
): string {
  const ordered = STRATEGY_LABELS.filter((strategy) =>
    manifest.strategies.includes(strategy),
  );
  const first = ordered[0];
  if (first === undefined) {
    return `${manifest.playstyle} Keep adapting as data allows.`;
  }

  let best = first;
  let bestStats = statsFor(record, best, "season.revision.buildPlaystyleRequest");
  for (const strategy of ordered.slice(1)) {
    const stats = statsFor(record, strategy, "season.revision.buildPlaystyleRequest");
    if (stats.score / stats.picks > bestStats.score / bestStats.picks) {
      best = strategy;
      bestStats = stats;
    }
  }

  return `Lean into ${best} play, the strategy scoring best over recent games.`;
}
