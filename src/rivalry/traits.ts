import { buildManifest } from "../core/manifest.ts";
import { ContractViolation } from "../core/errors.ts";
import type {
  CompetitorManifest,
  HeadToHead,
  HeadToHeadResult,
  ManifestFields,
  ResolvedManifest,
  StrategyLabel,
  Trait,
  TraitRule,
} from "../core/types.ts";

/** Cap on simultaneous traits in one matchup, so this cannot become creep. */
export const MAX_ACTIVE_TRAITS: number = 2;

/**
 * The shipped catalogue, as data. Adding a trait is configuration, not code.
 * Decided 2026-09-18: two rules (nemesis, avenger) to prove the mechanic.
 * Extended 2026-09-19: six more once the mechanic proved out, one per shape
 * of history `HeadToHead` can report - a current win/loss/draw run, a run the
 * opponent just broke, a long even record, and a first-ever meeting. Every
 * rule still only appends to `playstyle` and reorders declared `strategies`;
 * budget, features and fallback stay off limits.
 */
export const TRAIT_RULES: readonly TraitRule[] = [
  {
    id: "nemesis",
    label: "Nemesis",
    description: "Lost three in a row to this opponent.",
    when: { kind: "loss-streak", atLeast: 3 },
    playstyleSuffix:
      " This opponent has beaten you three times running; take more risk to break the pattern.",
    promote: ["attack", "king-hunt"],
    priority: 10,
  },
  {
    id: "avenger",
    label: "Avenger",
    description: "Broke a losing streak against this opponent.",
    when: { kind: "broke-loss-streak", atLeast: 3 },
    playstyleSuffix:
      " You have just broken a long losing run against this opponent; keep the approach that worked.",
    promote: ["attack", "develop"],
    priority: 5,
  },
  {
    id: "dominant",
    label: "Dominant",
    description: "Won five in a row against this opponent.",
    when: { kind: "win-streak", atLeast: 5 },
    playstyleSuffix:
      " You have won five straight games against this opponent; keep playing the way that has worked.",
    promote: ["simplify", "trade-down"],
    priority: 9,
  },
  {
    id: "cold-snap",
    label: "Cold Snap",
    description: "Opponent just ended a run of at least three wins.",
    when: { kind: "broke-win-streak", atLeast: 3 },
    playstyleSuffix:
      " This opponent just ended a winning run of yours; steady the position before pushing again.",
    promote: ["fortify", "defend"],
    priority: 8,
  },
  {
    id: "stonewall",
    label: "Stonewall",
    description: "Drawn four in a row against this opponent.",
    when: { kind: "draw-streak", atLeast: 4 },
    playstyleSuffix:
      " Your last four games with this opponent were draws; look harder for a decisive line.",
    promote: ["attack", "king-hunt"],
    priority: 7,
  },
  {
    id: "hot-streak",
    label: "Hot Streak",
    description: "Won three in a row against this opponent.",
    when: { kind: "win-streak", atLeast: 3 },
    playstyleSuffix:
      " You have won three straight against this opponent; keep applying the same pressure.",
    promote: ["attack", "direct"],
    priority: 6,
  },
  {
    id: "dead-heat",
    label: "Dead Heat",
    description: "Equal wins and losses over at least six recorded games.",
    when: { kind: "even-record", atLeast: 6 },
    playstyleSuffix:
      " Your record against this opponent is even over a real sample; play for a technical edge rather than a swing.",
    promote: ["endgame", "trade-down"],
    priority: 3,
  },
  {
    id: "clean-slate",
    label: "Clean Slate",
    description: "No recorded games against this opponent.",
    when: { kind: "first-meeting" },
    playstyleSuffix:
      " You have no recorded history against this opponent; play principled chess rather than guessing at a weakness.",
    promote: ["develop", "direct"],
    priority: 1,
  },
];

/**
 * Game ids for a run of `result` ending the history, or null when the current
 * run is not that result or does not reach `atLeast`.
 */
function streakGameIds(
  h2h: HeadToHead,
  result: HeadToHeadResult,
  atLeast: number,
): readonly string[] | null {
  const last = h2h.recent[h2h.recent.length - 1];
  if (last !== result || h2h.streak < atLeast) return null;
  return h2h.gameIds.slice(-h2h.streak);
}

/**
 * Game ids for a run of `brokenResult` immediately ended by the opposite
 * result, or null when the history does not end that way or the broken run
 * does not reach `atLeast`.
 */
function brokenStreakGameIds(
  h2h: HeadToHead,
  brokenResult: "win" | "loss",
  atLeast: number,
): readonly string[] | null {
  const breakingResult: HeadToHeadResult = brokenResult === "loss" ? "win" : "loss";
  if (h2h.recent[h2h.recent.length - 1] !== breakingResult) return null;

  let run = 0;
  for (
    let i = h2h.recent.length - 2;
    i >= 0 && h2h.recent[i] === brokenResult;
    i -= 1
  ) {
    run += 1;
  }
  if (run < atLeast) return null;
  return h2h.gameIds.slice(-(run + 1));
}

/**
 * The game ids a rule's condition matched against `h2h`, or null when the
 * condition does not hold. The only place that reads `TraitCondition.kind`.
 */
function matchGameIds(h2h: HeadToHead, rule: TraitRule): readonly string[] | null {
  const when = rule.when;
  switch (when.kind) {
    case "loss-streak":
      return streakGameIds(h2h, "loss", when.atLeast);
    case "win-streak":
      return streakGameIds(h2h, "win", when.atLeast);
    case "draw-streak":
      return streakGameIds(h2h, "draw", when.atLeast);
    case "broke-loss-streak":
      return brokenStreakGameIds(h2h, "loss", when.atLeast);
    case "broke-win-streak":
      return brokenStreakGameIds(h2h, "win", when.atLeast);
    case "even-record": {
      const played = h2h.wins + h2h.losses + h2h.draws;
      if (played < when.atLeast || h2h.wins !== h2h.losses) return null;
      return h2h.gameIds;
    }
    case "first-meeting":
      return h2h.recent.length === 0 ? [] : null;
    default: {
      const exhaustive: never = when;
      throw new ContractViolation(
        "rivalry.traits.matchGameIds",
        `unknown trait condition: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/**
 * Which traits are active in a matchup, as a pure function of recorded
 * head-to-head. Determinism has to come from history, because Jev is not
 * deterministic.
 *
 * Contract:
 * - "loss-streak" / "win-streak" / "draw-streak" fire when the current run
 *   (`h2h.streak`) is that result and at least `atLeast` long.
 * - "broke-loss-streak" fires when the most recent result is a win
 *   immediately preceded by at least `atLeast` losses; "broke-win-streak" is
 *   the mirror image, a loss immediately preceded by at least `atLeast` wins.
 * - "even-record" fires when lifetime wins equal lifetime losses over at
 *   least `atLeast` recorded games (draws count toward the total, not the
 *   balance).
 * - "first-meeting" fires when there is no recorded history at all.
 * - At most `cap` traits, highest priority first, then rule order.
 * - Each trait carries the game ids that triggered it, so the rivalry page
 *   can show its evidence. "even-record" carries the whole recorded window as
 *   its evidence and "first-meeting" carries none, since neither is a run.
 */
export function activeTraits(
  h2h: HeadToHead,
  rules: readonly TraitRule[] = TRAIT_RULES,
  cap: number = MAX_ACTIVE_TRAITS,
): readonly Trait[] {
  const matched: Array<{ rule: TraitRule; index: number; gameIds: readonly string[] }> = [];
  rules.forEach((rule, index) => {
    const gameIds = matchGameIds(h2h, rule);
    if (gameIds !== null) matched.push({ rule, index, gameIds });
  });

  return matched
    .sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index)
    .slice(0, cap)
    .map((entry) => ({
      rule: entry.rule.id,
      opponent: h2h.opponent,
      reason: entry.rule.description,
      gameIds: entry.gameIds,
    }));
}

/**
 * A base manifest resolved for one opponent.
 *
 * Contract, and this is the integrity of the whole league:
 * - Only `playstyle` and the order of `strategies` may change. Model, name,
 *   features, historyPlies, fallback, budget and hierarchical are identical to
 *   the base, and the strategy set is identical as a set.
 * - Promoted strategies move to the front in rule order; strategies a manifest
 *   does not declare are never added.
 * - The version is a real content hash of the resolved fields, so an audit can
 *   always tell which text played.
 * - With no active traits the base manifest is returned unchanged, same version
 *   and no lineage churn.
 */
export function resolveManifest(
  base: CompetitorManifest,
  opponent: string,
  h2h: HeadToHead,
  rules: readonly TraitRule[] = TRAIT_RULES,
): ResolvedManifest {
  if (h2h.opponent !== opponent) {
    throw new ContractViolation(
      "rivalry.traits.resolveManifest",
      `head-to-head is for ${h2h.opponent}, not ${opponent}`,
    );
  }

  const traits = activeTraits(h2h, rules);
  if (traits.length === 0) {
    return { manifest: base, baseVersion: base.version, traits: [] };
  }

  const activeRules: TraitRule[] = [];
  for (const trait of traits) {
    const rule = rules.find((r) => r.id === trait.rule);
    if (rule) activeRules.push(rule);
  }

  const playstyle =
    base.playstyle + activeRules.map((rule) => rule.playstyleSuffix).join("");

  const promoted: StrategyLabel[] = [];
  for (const rule of activeRules) {
    for (const strategy of rule.promote) {
      if (base.strategies.includes(strategy) && !promoted.includes(strategy)) {
        promoted.push(strategy);
      }
    }
  }
  const strategies = [
    ...promoted,
    ...base.strategies.filter((strategy) => !promoted.includes(strategy)),
  ];

  const fields: ManifestFields = {
    name: base.name,
    model: base.model,
    playstyle,
    strategies,
    features: base.features,
    historyPlies: base.historyPlies,
    fallback: base.fallback,
    budget: base.budget,
    hierarchical: base.hierarchical,
  };

  return {
    manifest: buildManifest(fields),
    baseVersion: base.version,
    traits,
  };
}
