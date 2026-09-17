import { ContractViolation } from "../core/errors.ts";
import { validateDistribution } from "../core/distribution.ts";
import {
  applyFallback,
  validateDecision,
} from "../core/validation.ts";
import type {
  ChoiceAnswer,
  Clock,
  Competitor,
  CompetitorManifest,
  MoveDistribution,
  PositionInput,
  Provider,
  ProviderResponse,
  Rng,
  StateDocument,
  SystemOneRequest,
  TokenUsage,
  ValidationResult,
} from "../core/types.ts";

const MAX_OPTIONS = 255;
const BUILD_LABEL = "players/jev.buildJevRequests";
const PARSE_LABEL = "players/jev.parseJevResponses";

function failure(
  reason: "provider-error" | "malformed-response" | "malformed-distribution" | "unknown-strategy" | "illegal-output",
  detail: string,
): ValidationResult {
  return { ok: false, reason, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbabilityMap(
  value: unknown,
): value is Readonly<Record<string, number>> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (probability) =>
        typeof probability === "number" && Number.isFinite(probability),
    )
  );
}

function isChoiceAnswer(value: unknown): value is ChoiceAnswer {
  return (
    isRecord(value) &&
    typeof value.choice === "string" &&
    isProbabilityMap(value.probabilities) &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence)
  );
}

function isTokenUsage(value: unknown): value is TokenUsage {
  return (
    isRecord(value) &&
    typeof value.in === "number" &&
    Number.isFinite(value.in) &&
    typeof value.out === "number" &&
    Number.isFinite(value.out)
  );
}

interface ParsedResponse {
  readonly answers: Readonly<Record<string, unknown>>;
  readonly tokens?: TokenUsage;
}

function parseResponse(
  response: unknown,
): ParsedResponse | ValidationResult {
  if (!isRecord(response)) {
    return failure("malformed-response", "provider response must be an object");
  }
  if (response.kind === "error") {
    const message =
      typeof response.message === "string" ? response.message : "provider failure";
    return failure("provider-error", message);
  }
  if (response.kind !== "systemone" || !isRecord(response.answers)) {
    return failure(
      "malformed-response",
      "expected a systemone response with an answers object",
    );
  }
  if (response.tokens !== undefined && !isTokenUsage(response.tokens)) {
    return failure("malformed-response", "response contained invalid token usage");
  }
  return response.tokens === undefined
    ? { answers: response.answers }
    : { answers: response.answers, tokens: response.tokens };
}

function stateFor(input: PositionInput): StateDocument {
  const state: Record<string, string | number | boolean | readonly string[]> = {
    playstyle: input.persona.playstyle,
    fen: input.fen,
    history: input.history.slice(-input.persona.historyPlies),
  };
  for (const feature of input.persona.features) {
    const value = input.features[feature];
    if (value !== undefined) {
      state[feature] = value;
    }
  }
  return state;
}

function request(
  input: PositionInput,
  id: "strategy" | "move",
  instructions: string,
  options: readonly string[],
): SystemOneRequest {
  return {
    kind: "systemone",
    model: input.persona.model,
    state: stateFor(input),
    questions: {
      [id]: { type: "choice", instructions, options },
    },
  };
}

function moveChunks(legalMoves: readonly string[]): readonly (readonly string[])[] {
  const chunks: string[][] = [];
  for (let offset = 0; offset < legalMoves.length; offset += MAX_OPTIONS) {
    chunks.push(legalMoves.slice(offset, offset + MAX_OPTIONS));
  }
  return chunks;
}

function addTokens(
  total: { in: number; out: number },
  usage: TokenUsage | undefined,
): void {
  if (usage !== undefined) {
    total.in += usage.in;
    total.out += usage.out;
  }
}

export function createJevPlayer(
  manifest: CompetitorManifest,
  provider: Provider,
  clock: Clock,
  rng: Rng,
): Competitor {
  return {
    manifest,
    async decide(input) {
      const startedAt = clock.now();
      const requests = buildJevRequests(input);
      const responses: ProviderResponse[] = [];
      try {
        for (const providerRequest of requests) {
          responses.push(await provider.ask(providerRequest));
        }
      } catch {
        const latencyMs = clock.now() - startedAt;
        return applyFallback(input, "provider-error", rng, latencyMs);
      }

      const latencyMs = clock.now() - startedAt;
      if (latencyMs > input.budget.maxMs) {
        return applyFallback(input, "timeout", rng, latencyMs);
      }

      const result = parseJevResponses(input, responses, latencyMs);
      return result.ok
        ? result.decision
        : applyFallback(input, result.reason, rng, latencyMs);
    },
  };
}

export function buildJevRequests(input: PositionInput): readonly SystemOneRequest[] {
  if (input.legalMoves.length === 0) {
    throw new ContractViolation(BUILD_LABEL, "legalMoves must not be empty");
  }
  if (input.persona.strategies.length === 0) {
    throw new ContractViolation(BUILD_LABEL, "strategies must not be empty");
  }

  const requests: SystemOneRequest[] = [];
  if (input.persona.hierarchical) {
    requests.push(
      request(
        input,
        "strategy",
        "Choose the strategy that best fits this position.",
        input.persona.strategies,
      ),
    );
  }
  for (const options of moveChunks(input.legalMoves)) {
    requests.push(
      request(input, "move", "Choose the best legal move.", options),
    );
  }
  return requests;
}

export function parseJevResponses(
  input: PositionInput,
  responses: readonly ProviderResponse[],
  latencyMs: number,
): ValidationResult {
  if (input.legalMoves.length === 0) {
    throw new ContractViolation(PARSE_LABEL, "legalMoves must not be empty");
  }

  const parsed: ParsedResponse[] = [];
  for (const response of responses) {
    const result = parseResponse(response);
    if ("ok" in result) {
      return result;
    }
    parsed.push(result);
  }

  const chunks = moveChunks(input.legalMoves);
  const expectedCount = chunks.length + (input.persona.hierarchical ? 1 : 0);
  if (parsed.length !== expectedCount) {
    return failure(
      "malformed-response",
      `expected ${expectedCount} response(s), received ${parsed.length}`,
    );
  }

  let strategy = input.persona.strategies[0];
  let responseOffset = 0;
  const tokens = { in: 0, out: 0 };
  let hasTokens = false;

  if (input.persona.hierarchical) {
    const strategyResponse = parsed[0];
    const strategyAnswer = strategyResponse?.answers.strategy;
    if (!isChoiceAnswer(strategyAnswer)) {
      return failure(
        "malformed-response",
        "strategy response did not contain a valid strategy answer",
      );
    }
    const declaredStrategy = input.persona.strategies.find(
      (candidate) => candidate === strategyAnswer.choice,
    );
    if (declaredStrategy === undefined) {
      return failure(
        "unknown-strategy",
        `provider chose undeclared strategy: ${strategyAnswer.choice}`,
      );
    }
    if (!validateDistribution(strategyAnswer.probabilities, input.persona.strategies)) {
      return failure(
        "malformed-distribution",
        "strategy probabilities did not form a distribution over declared strategies",
      );
    }
    strategy = declaredStrategy;
    responseOffset = 1;
    addTokens(tokens, strategyResponse?.tokens);
    hasTokens = strategyResponse?.tokens !== undefined;
  }

  if (strategy === undefined) {
    throw new ContractViolation(PARSE_LABEL, "strategies must not be empty");
  }

  let selectedAnswer: ChoiceAnswer | undefined;
  for (const [index, options] of chunks.entries()) {
    const moveResponse = parsed[index + responseOffset];
    const moveAnswer = moveResponse?.answers.move;
    if (!isChoiceAnswer(moveAnswer)) {
      return failure(
        "malformed-response",
        `move response ${index + 1} did not contain a valid move answer`,
      );
    }
    if (!options.includes(moveAnswer.choice)) {
      return failure(
        "illegal-output",
        `provider chose a move outside its legal option set: ${moveAnswer.choice}`,
      );
    }
    if (!validateDistribution(moveAnswer.probabilities, options)) {
      return failure(
        "malformed-distribution",
        `move response ${index + 1} probabilities did not form a legal distribution`,
      );
    }
    if (
      selectedAnswer === undefined ||
      moveAnswer.confidence > selectedAnswer.confidence
    ) {
      selectedAnswer = moveAnswer;
    }
    addTokens(tokens, moveResponse?.tokens);
    hasTokens ||= moveResponse?.tokens !== undefined;
  }

  if (selectedAnswer === undefined) {
    return failure("malformed-response", "no move answer was returned");
  }

  const distribution: MoveDistribution = selectedAnswer.probabilities;
  return validateDecision(input, {
    move: selectedAnswer.choice,
    strategy,
    confidence: selectedAnswer.confidence,
    distribution,
    latencyMs,
    ...(hasTokens ? { tokens } : {}),
  });
}
