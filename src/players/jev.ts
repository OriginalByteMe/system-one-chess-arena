import { NotImplemented } from "../core/errors.ts";
import type {
  Clock,
  Competitor,
  CompetitorManifest,
  PositionInput,
  Provider,
  ProviderResponse,
  Rng,
  SystemOneRequest,
  ValidationResult,
} from "../core/types.ts";

export function createJevPlayer(
  manifest: CompetitorManifest,
  provider: Provider,
  clock: Clock,
  rng: Rng,
): Competitor {
  throw new NotImplemented("players/jev.createJevPlayer");
}

export function buildJevRequests(input: PositionInput): readonly SystemOneRequest[] {
  throw new NotImplemented("players/jev.buildJevRequests");
}

export function parseJevResponses(
  input: PositionInput,
  responses: readonly ProviderResponse[],
  latencyMs: number,
): ValidationResult {
  throw new NotImplemented("players/jev.parseJevResponses");
}
