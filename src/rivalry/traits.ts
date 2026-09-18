import { NotImplemented } from "../core/errors.ts";
import type {
  CompetitorManifest,
  HeadToHead,
  ResolvedManifest,
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
  rules?: readonly TraitRule[],
  cap?: number,
): readonly Trait[] {
  void h2h;
  void rules;
  void cap;
  throw new NotImplemented("rivalry.traits.activeTraits");
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
  rules?: readonly TraitRule[],
): ResolvedManifest {
  void base;
  void opponent;
  void h2h;
  void rules;
  throw new NotImplemented("rivalry.traits.resolveManifest");
}
