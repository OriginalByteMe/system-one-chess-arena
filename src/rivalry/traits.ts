import { buildManifest } from "../core/manifest.ts";
import { ContractViolation } from "../core/errors.ts";
import type {
  CompetitorManifest,
  HeadToHead,
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
 * Decided 2026-09-18: two rules to prove the mechanic before investing in it.
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
];

/**
 * Which traits are active in a matchup, as a pure function of recorded
 * head-to-head. Determinism has to come from history, because Jev is not
 * deterministic.
 *
 * Contract:
 * - "loss-streak" fires when the current run is losses and at least `atLeast`
 *   long.
 * - "broke-loss-streak" fires when the most recent result is a win immediately
 *   preceded by at least `atLeast` losses.
 * - At most `cap` traits, highest priority first, then rule order.
 * - Each trait carries the game ids that triggered it, so the rivalry page can
 *   show its evidence.
 */
export function activeTraits(
  h2h: HeadToHead,
  rules: readonly TraitRule[] = TRAIT_RULES,
  cap: number = MAX_ACTIVE_TRAITS,
): readonly Trait[] {
  const lastResult = h2h.recent[h2h.recent.length - 1];
  if (lastResult === undefined) return [];

  const matched: Trait[] = [];
  for (const rule of rules) {
    if (rule.when.kind === "loss-streak") {
      if (lastResult !== "loss" || h2h.streak < rule.when.atLeast) continue;
      matched.push({
        rule: rule.id,
        opponent: h2h.opponent,
        reason: rule.description,
        gameIds: h2h.gameIds.slice(-h2h.streak),
      });
      continue;
    }

    if (lastResult !== "win") continue;
    let lossRun = 0;
    for (
      let i = h2h.recent.length - 2;
      i >= 0 && h2h.recent[i] === "loss";
      i -= 1
    ) {
      lossRun += 1;
    }
    if (lossRun < rule.when.atLeast) continue;
    matched.push({
      rule: rule.id,
      opponent: h2h.opponent,
      reason: rule.description,
      gameIds: h2h.gameIds.slice(-(lossRun + 1)),
    });
  }

  return matched
    .map((trait, index) => ({ trait, index, priority: rules.find((r) => r.id === trait.rule)?.priority ?? 0 }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, cap)
    .map((entry) => entry.trait);
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
