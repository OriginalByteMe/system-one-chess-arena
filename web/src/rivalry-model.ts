import { ContractViolation } from "../../src/core/errors.ts";
import type {
  HeadToHead,
  HeadToHeadResult,
  RivalrySummary,
} from "../../src/core/types.ts";
import { TRAIT_RULES } from "../../src/rivalry/traits.ts";

export interface RivalryEvent {
  readonly gameId: string;
  readonly result: HeadToHeadResult;
  /** Trait ids that became active because of this game. */
  readonly triggered: readonly string[];
}

/**
 * The head-to-head timeline, oldest first.
 *
 * Contract: a trait is attributed to the game that completed its condition, so
 * "nemesis" appears on the third loss and not the first. Only games the server
 * revealed appear, since the summary is already gated.
 */
export function rivalryTimeline(
  summary: RivalrySummary,
): readonly RivalryEvent[] {
  const resultByGame = new Map<string, HeadToHeadResult>();
  summary.headToHead.gameIds.forEach((gameId, index) => {
    const result = summary.headToHead.recent[index];
    if (result !== undefined) resultByGame.set(gameId, result);
  });

  const triggeredByGame = new Map<string, string[]>();
  for (const trait of summary.traits) {
    const completingGame = trait.gameIds[trait.gameIds.length - 1];
    if (completingGame === undefined) continue;
    const list = triggeredByGame.get(completingGame) ?? [];
    list.push(trait.rule);
    triggeredByGame.set(completingGame, list);
  }

  return summary.gameIds.map((gameId) => {
    const result = resultByGame.get(gameId);
    if (result === undefined) {
      throw new ContractViolation(
        "web.rivalryModel.rivalryTimeline",
        `revealed game ${gameId} has no recorded head-to-head result`,
      );
    }
    return { gameId, result, triggered: triggeredByGame.get(gameId) ?? [] };
  });
}

function describeRecord(h2h: HeadToHead): string {
  const record = `${h2h.wins}-${h2h.losses}-${h2h.draws}`;
  if (h2h.wins > h2h.losses) return `${h2h.competitor} leads ${h2h.opponent} ${record}.`;
  if (h2h.losses > h2h.wins) return `${h2h.competitor} trails ${h2h.opponent} ${record}.`;
  return `${h2h.competitor} is even with ${h2h.opponent} ${record}.`;
}

/** One-line banner text, or undefined when the pair has no history worth it. */
export function rivalryBanner(summary: RivalrySummary): string | undefined {
  const hasActiveTrait = summary.traits.length > 0;
  if (summary.gameIds.length < 3 && !hasActiveTrait) return undefined;

  const labels = summary.traits
    .map((trait) => TRAIT_RULES.find((rule) => rule.id === trait.rule)?.label)
    .filter((label): label is string => label !== undefined);

  const record = describeRecord(summary.headToHead);
  return labels.length > 0 ? `${record} ${labels.join(", ")}.` : record;
}
