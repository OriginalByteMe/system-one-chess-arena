import { applyFallback, validateDecision } from "../core/validation.ts";
import type {
  ChatRequest,
  Clock,
  Competitor,
  CompetitorManifest,
  MoveDistribution,
  PositionInput,
  Provider,
  ProviderResponse,
  RawDecision,
  Rng,
  ValidationResult,
} from "../core/types.ts";

function malformed(detail: string): ValidationResult {
  return { ok: false, reason: "malformed-response", detail };
}

function parseJsonObject(text: string): object | undefined {
  const candidates = [text.trim()];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const body = match[1];
    if (body !== undefined) {
      candidates.push(body.trim());
    }
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    if (candidate.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

export function createLlmPlayer(
  manifest: CompetitorManifest,
  provider: Provider,
  clock: Clock,
  rng: Rng,
): Competitor {
  return {
    manifest,
    async decide(input) {
      const startedAt = clock.now();
      let response: ProviderResponse;
      try {
        response = await provider.ask(buildLlmRequest(input));
      } catch {
        const latencyMs = clock.now() - startedAt;
        return applyFallback(
          input,
          latencyMs > manifest.budget.maxMs ? "timeout" : "provider-error",
          rng,
          latencyMs,
        );
      }

      const latencyMs = clock.now() - startedAt;
      if (latencyMs > manifest.budget.maxMs) {
        return applyFallback(input, "timeout", rng, latencyMs);
      }

      const parsed = parseLlmResponse(input, response, latencyMs);
      return parsed.ok
        ? parsed.decision
        : applyFallback(input, parsed.reason, rng, latencyMs);
    },
  };
}

export function buildLlmRequest(input: PositionInput): ChatRequest {
  const features: Record<string, string | number | boolean> = {};
  for (const feature of input.persona.features) {
    const value = input.features[feature];
    if (value !== undefined) {
      features[feature] = value;
    }
  }

  return {
    kind: "chat",
    model: input.persona.model,
    jsonOnly: true,
    messages: [
      {
        role: "system",
        content:
          "Choose one legal chess move. Return only JSON with a legalMoves move, a strategies strategy, confidence from 0 to 1, and legal-move probabilities in distribution that sum to 1.",
      },
      {
        role: "user",
        content: JSON.stringify({
          playstyle: input.persona.playstyle,
          strategies: input.persona.strategies,
          colour: input.colour,
          fen: input.fen,
          history: input.history,
          legalMoves: input.legalMoves,
          features,
        }),
      },
    ],
  };
}

export function parseLlmResponse(
  input: PositionInput,
  response: ProviderResponse,
  latencyMs: number,
): ValidationResult {
  if (response.kind === "error") {
    const status = response.status === undefined ? "" : `HTTP ${response.status}: `;
    return {
      ok: false,
      reason: "provider-error",
      detail: `${status}${response.message}`,
    };
  }
  if (response.kind !== "chat") {
    return malformed(`expected a chat response, received ${response.kind}`);
  }

  const parsed = parseJsonObject(response.text);
  if (parsed === undefined) {
    return malformed("response did not contain a JSON object");
  }

  const move: unknown = Reflect.get(parsed, "move");
  if (typeof move !== "string") {
    return malformed("move must be a string");
  }

  const strategy: unknown = Reflect.get(parsed, "strategy");
  if (strategy !== undefined && typeof strategy !== "string") {
    return malformed("strategy must be a string");
  }

  const confidence: unknown = Reflect.get(parsed, "confidence");
  if (
    confidence !== undefined &&
    (typeof confidence !== "number" || !Number.isFinite(confidence))
  ) {
    return malformed("confidence must be a finite number");
  }

  const distributionValue: unknown = Reflect.get(parsed, "distribution");
  let distribution: MoveDistribution | undefined;
  if (distributionValue !== undefined) {
    if (
      typeof distributionValue !== "object" ||
      distributionValue === null ||
      Array.isArray(distributionValue)
    ) {
      return malformed("distribution must be an object");
    }
    const probabilities: Record<string, number> = {};
    for (const candidate of Object.keys(distributionValue)) {
      const probability: unknown = Reflect.get(distributionValue, candidate);
      if (typeof probability !== "number" || !Number.isFinite(probability)) {
        return malformed(
          `distribution probability for ${candidate} must be a finite number`,
        );
      }
      probabilities[candidate] = probability;
    }
    distribution = probabilities;
  }

  const raw: RawDecision = {
    move,
    latencyMs,
    ...(strategy === undefined ? {} : { strategy }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(distribution === undefined ? {} : { distribution }),
    ...(response.tokens === undefined ? {} : { tokens: response.tokens }),
  };
  return validateDecision(input, raw);
}
