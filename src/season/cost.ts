import type { DecisionRecord, ModelPricing } from "../core/types.ts";

/**
 * Measured 2026-09-17 against api.typesafe.ai: Jev bills input tokens only.
 * Keys are matched as prefixes, longest first, so "jev-1.13.0" finds "jev".
 */
export const PRICING: { readonly [model: string]: ModelPricing } = {
  jev: { inputUsdPerMillion: 0.042, outputUsdPerMillion: 0 },
};

/** Zero-cost pricing for a model we have no published price for. */
export const UNPRICED: ModelPricing = {
  inputUsdPerMillion: 0,
  outputUsdPerMillion: 0,
};

/** Longest matching prefix in PRICING, or UNPRICED. */
export function pricingFor(model: string): ModelPricing {
  let bestKey: string | undefined;
  let bestPricing: ModelPricing = UNPRICED;
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(key) && (bestKey === undefined || key.length > bestKey.length)) {
      bestKey = key;
      bestPricing = pricing;
    }
  }
  return bestPricing;
}

/**
 * Spend across decisions. `models` maps a manifest version to its model id;
 * a decision from an unknown version costs nothing rather than breaking a
 * leaderboard.
 */
export function costUsd(
  decisions: readonly DecisionRecord[],
  models: ReadonlyMap<string, string>,
): number {
  let total = 0;
  for (const decision of decisions) {
    const model = models.get(decision.version);
    const tokens = decision.tokens;
    if (model === undefined || tokens === undefined) continue;
    const pricing = pricingFor(model);
    total += (tokens.in / 1_000_000) * pricing.inputUsdPerMillion;
    total += (tokens.out / 1_000_000) * pricing.outputUsdPerMillion;
  }
  return total;
}
