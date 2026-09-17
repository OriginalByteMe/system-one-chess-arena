import { NotImplemented } from "../core/errors.ts";
import type {
  ChatRequest,
  Clock,
  Competitor,
  CompetitorManifest,
  PositionInput,
  Provider,
  ProviderResponse,
  Rng,
  ValidationResult,
} from "../core/types.ts";

export function createLlmPlayer(
  manifest: CompetitorManifest,
  provider: Provider,
  clock: Clock,
  rng: Rng,
): Competitor {
  throw new NotImplemented("players/llm.createLlmPlayer");
}

export function buildLlmRequest(input: PositionInput): ChatRequest {
  throw new NotImplemented("players/llm.buildLlmRequest");
}

export function parseLlmResponse(
  input: PositionInput,
  response: ProviderResponse,
  latencyMs: number,
): ValidationResult {
  throw new NotImplemented("players/llm.parseLlmResponse");
}
