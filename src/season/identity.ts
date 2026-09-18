import { NotImplemented } from "../core/errors.ts";
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
  void args;
  throw new NotImplemented("season.identity.registerVersions");
}

/**
 * A competitor's version chain, oldest first, following `parentVersion`.
 * Throws ContractViolation on a cycle or a missing parent.
 */
export function lineageOf(
  competitor: string,
  rows: readonly CompetitorVersionRow[],
): readonly CompetitorVersionRow[] {
  void competitor;
  void rows;
  throw new NotImplemented("season.identity.lineageOf");
}
