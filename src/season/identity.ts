import { ContractViolation } from "../core/errors.ts";
import type {
  CompetitorVersionRow,
  NameViolation,
  SeasonConfig,
} from "../core/types.ts";

/**
 * Names the bracket uses for empty or undecided slots, so no competitor may
 * claim one.
 */
export const RESERVED_NAMES: readonly string[] = ["bye", "tbd", "winner"];

export interface RegistrationArgs {
  readonly config: SeasonConfig;
  /** Every version already known, across all seasons. */
  readonly known: readonly CompetitorVersionRow[];
  /** Competitor name to the version its new manifest descends from. */
  readonly parents?: { readonly [competitor: string]: string };
  readonly rationales?: { readonly [competitor: string]: string };
}

export interface Registration {
  /** Rows to insert. Already-known versions are not repeated. */
  readonly rows: readonly CompetitorVersionRow[];
  readonly violations: readonly NameViolation[];
}

/**
 * Names are the cross-season identity, so this is a trust boundary.
 *
 * Contract:
 * - Two competitors with the same name in one config is "duplicate-in-season".
 * - A reserved name, case-insensitively, is "reserved-name".
 * - A name already known, presenting a version that is neither already in its
 *   lineage nor declared as descending from a version in it, is
 *   "version-not-derived". This is what stops a name being reused by an
 *   unrelated lineage.
 * - Violations are returned, never thrown: the caller decides the status code.
 * - `rows` is empty when there is any violation.
 */
export function registerVersions(args: RegistrationArgs): Registration {
  const { config, known, parents, rationales } = args;
  const violations: NameViolation[] = [];
  const rows: CompetitorVersionRow[] = [];

  const nameCounts = new Map<string, number>();
  for (const competitor of config.competitors) {
    nameCounts.set(competitor.name, (nameCounts.get(competitor.name) ?? 0) + 1);
  }

  for (const competitor of config.competitors) {
    const name = competitor.name;
    let invalid = false;

    if ((nameCounts.get(name) ?? 0) > 1) {
      violations.push({
        competitor: name,
        reason: "duplicate-in-season",
        detail: `${name} appears more than once in season ${config.seasonId}`,
      });
      invalid = true;
    }

    if (RESERVED_NAMES.includes(name.toLowerCase())) {
      violations.push({
        competitor: name,
        reason: "reserved-name",
        detail: `${name} is a reserved name`,
      });
      invalid = true;
    }

    if (invalid) continue;

    const priorVersions = known.filter((r) => r.competitor === name);

    if (priorVersions.length === 0) {
      rows.push({
        competitor: name,
        version: competitor.version,
        seasonId: config.seasonId,
        manifest: competitor,
        parentVersion: undefined,
        traits: [],
        rationale: rationales?.[name],
      });
      continue;
    }

    if (priorVersions.some((r) => r.version === competitor.version)) {
      // Already known: replaying a season is idempotent.
      continue;
    }

    const lineage = lineageOf(name, known);
    const declaredParent = parents?.[name];
    const parentInLineage =
      declaredParent !== undefined && lineage.some((r) => r.version === declaredParent);

    if (!parentInLineage) {
      violations.push({
        competitor: name,
        reason: "version-not-derived",
        detail: `${name} version ${competitor.version} does not descend from a known version of ${name}`,
      });
      continue;
    }

    rows.push({
      competitor: name,
      version: competitor.version,
      seasonId: config.seasonId,
      manifest: competitor,
      parentVersion: declaredParent,
      traits: [],
      rationale: rationales?.[name],
    });
  }

  return {
    rows: violations.length === 0 ? rows : [],
    violations,
  };
}

/**
 * A competitor's version chain, oldest first, following `parentVersion`.
 * Throws ContractViolation on a cycle or a missing parent.
 */
export function lineageOf(
  competitor: string,
  rows: readonly CompetitorVersionRow[],
): readonly CompetitorVersionRow[] {
  const own = rows.filter((r) => r.competitor === competitor);
  if (own.length === 0) return [];

  const byVersion = new Map(own.map((r) => [r.version, r]));
  const childOf = new Map<string, CompetitorVersionRow>();
  let root: CompetitorVersionRow | undefined;

  for (const r of own) {
    if (r.parentVersion === undefined) {
      root = r;
      continue;
    }
    if (!byVersion.has(r.parentVersion)) {
      throw new ContractViolation(
        "season.identity.lineageOf",
        `${competitor} version ${r.version} has a missing parent ${r.parentVersion}`,
      );
    }
    childOf.set(r.parentVersion, r);
  }

  if (root === undefined) {
    throw new ContractViolation(
      "season.identity.lineageOf",
      `${competitor} has a version cycle: no root version found`,
    );
  }

  const chain: CompetitorVersionRow[] = [root];
  const seen = new Set<string>([root.version]);
  let current = root;
  for (let next = childOf.get(current.version); next !== undefined; next = childOf.get(current.version)) {
    if (seen.has(next.version)) {
      throw new ContractViolation(
        "season.identity.lineageOf",
        `${competitor} has a version cycle involving ${next.version}`,
      );
    }
    chain.push(next);
    seen.add(next.version);
    current = next;
  }

  return chain;
}
