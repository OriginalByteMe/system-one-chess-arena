import { createHash } from "node:crypto";
import { ContractViolation } from "./errors.ts";
import {
  FEATURE_KEYS,
  STRATEGY_LABELS,
  type CompetitorManifest,
  type FallbackPolicy,
  type FeatureKey,
  type ManifestFields,
  type StrategyLabel,
} from "./types.ts";

const MANIFEST_KEYS = [
  "name",
  "model",
  "playstyle",
  "strategies",
  "features",
  "historyPlies",
  "fallback",
  "budget",
  "hierarchical",
  "version",
] as const;

const BUDGET_KEYS = ["maxMs", "maxCostUsd"] as const;
const FALLBACK_POLICIES = ["random-legal", "greedy", "first-legal"] as const;
const COMPETITOR_NAME_PATTERN = /^[A-Za-z0-9._:@-]+$/;


function hasOnlyKeys(
  value: object,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isStrategyLabel(value: unknown): value is StrategyLabel {
  return (
    typeof value === "string" &&
    STRATEGY_LABELS.some((label) => label === value)
  );
}

function isFeatureKey(value: unknown): value is FeatureKey {
  return (
    typeof value === "string" && FEATURE_KEYS.some((key) => key === value)
  );
}

function isFallbackPolicy(value: unknown): value is FallbackPolicy {
  return (
    typeof value === "string" &&
    FALLBACK_POLICIES.some((policy) => policy === value)
  );
}

function canonicalJson(fields: ManifestFields): string {
  return JSON.stringify({
    budget: {
      maxCostUsd: fields.budget.maxCostUsd,
      maxMs: fields.budget.maxMs,
    },
    fallback: fields.fallback,
    features: fields.features,
    hierarchical: fields.hierarchical,
    historyPlies: fields.historyPlies,
    model: fields.model,
    name: fields.name,
    playstyle: fields.playstyle,
    strategies: fields.strategies,
  });
}

function violation(detail: string): never {
  throw new ContractViolation("manifest.parseManifest", detail);
}

export function manifestVersion(fields: ManifestFields): string {
  return createHash("sha256").update(canonicalJson(fields)).digest("hex");
}

export function buildManifest(fields: ManifestFields): CompetitorManifest {
  return { ...fields, version: manifestVersion(fields) };
}

export function parseManifest(raw: unknown): CompetitorManifest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return violation("expected an object");
  }
  if (
    Object.keys(raw).length !== MANIFEST_KEYS.length ||
    !hasOnlyKeys(raw, MANIFEST_KEYS)
  ) {
    return violation("manifest fields do not match the contract");
  }

  const name: unknown = Reflect.get(raw, "name");
  const model: unknown = Reflect.get(raw, "model");
  const playstyle: unknown = Reflect.get(raw, "playstyle");
  const strategies: unknown = Reflect.get(raw, "strategies");
  const features: unknown = Reflect.get(raw, "features");
  const historyPlies: unknown = Reflect.get(raw, "historyPlies");
  const fallback: unknown = Reflect.get(raw, "fallback");
  const budget: unknown = Reflect.get(raw, "budget");
  const hierarchical: unknown = Reflect.get(raw, "hierarchical");
  const version: unknown = Reflect.get(raw, "version");

  if (
    typeof name !== "string" ||
    !COMPETITOR_NAME_PATTERN.test(name) ||
    typeof model !== "string" ||
    typeof playstyle !== "string" ||
    !Array.isArray(strategies) ||
    strategies.length === 0 ||
    !strategies.every(isStrategyLabel) ||
    !Array.isArray(features) ||
    !features.every(isFeatureKey) ||
    typeof historyPlies !== "number" ||
    !Number.isInteger(historyPlies) ||
    historyPlies < 0 ||
    !isFallbackPolicy(fallback) ||
    typeof hierarchical !== "boolean" ||
    typeof version !== "string"
  ) {
    return violation("manifest contains an invalid field");
  }

  if (
    typeof budget !== "object" ||
    budget === null ||
    Array.isArray(budget) ||
    !hasOnlyKeys(budget, BUDGET_KEYS)
  ) {
    return violation("budget contains an invalid field");
  }

  const maxMs: unknown = Reflect.get(budget, "maxMs");
  const maxCostUsd: unknown = Reflect.get(budget, "maxCostUsd");
  if (
    typeof maxMs !== "number" ||
    !Number.isFinite(maxMs) ||
    maxMs <= 0 ||
    (maxCostUsd !== undefined &&
      (typeof maxCostUsd !== "number" ||
        !Number.isFinite(maxCostUsd) ||
        maxCostUsd < 0))
  ) {
    return violation("budget contains an invalid field");
  }

  const fields: ManifestFields = {
    name,
    model,
    playstyle,
    strategies,
    features,
    historyPlies,
    fallback,
    budget:
      maxCostUsd === undefined
        ? { maxMs }
        : { maxMs, maxCostUsd },
    hierarchical,
  };

  if (version !== manifestVersion(fields)) {
    return violation("version does not match manifest fields");
  }
  return { ...fields, version };
}
