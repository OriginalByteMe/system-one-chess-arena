import { NotImplemented } from "../core/errors.ts";
import type {
  CompetitorManifest,
  PlayerRecord,
  Provider,
  RevisionOutcome,
  RevisionProposal,
  SystemOneRequest,
} from "../core/types.ts";

export interface RevisionArgs {
  readonly manifest: CompetitorManifest;
  readonly record: PlayerRecord;
  readonly provider: Provider;
  readonly minSamplesPerStrategy: number;
}

export function buildCandidate(
  manifest: CompetitorManifest,
  record: PlayerRecord,
): RevisionProposal | undefined {
  throw new NotImplemented("season.revision.buildCandidate");
}

export function buildRevisionRequest(args: RevisionArgs): SystemOneRequest {
  throw new NotImplemented("season.revision.buildRevisionRequest");
}

export function reviseStrategies(args: RevisionArgs): Promise<RevisionOutcome> {
  throw new NotImplemented("season.revision.reviseStrategies");
}
