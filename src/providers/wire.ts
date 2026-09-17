// The TypeSafe HTTP wire format, kept apart from the provider seam. Our
// SystemOneRequest is what the arena wants to ask; this is how api.typesafe.ai
// accepts it (POST /v1/systemone, one rubric entry per option) and how its
// answers come back. Verified against jev-1.13.0 on 2026-09-17.
import { ContractViolation } from "../core/errors.ts";
import type {
  ProviderFailure,
  SystemOneRequest,
  SystemOneResponse,
  TokenUsage,
} from "../core/types.ts";

const LABEL = "providers/wire";

/** Widest rounding the live model has shown on a summed distribution. */
const WIRE_ROUNDING_TOLERANCE = 0.05;

function probabilities(
  value: unknown,
): { readonly [option: string]: number } | undefined {
  if (!isObject(value)) return undefined;
  const entries: [string, number][] = [];
  let total = 0;
  for (const [option, probability] of Object.entries(value)) {
    if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0) {
      return undefined;
    }
    entries.push([option, probability]);
    total += probability;
  }
  if (entries.length === 0) return undefined;
  // The live model rounds each probability to two decimals, so a 20-option
  // answer sums to 0.99 or 1.01 at random. Renormalise plain rounding drift and
  // leave anything wider for the core validator to reject.
  if (total <= 0 || Math.abs(total - 1) > WIRE_ROUNDING_TOLERANCE) {
    return Object.fromEntries(entries);
  }
  return Object.fromEntries(
    entries.map(([option, probability]) => [option, probability / total]),
  );
}

/**
 * Options become a criteria map. The rubric text is what makes a decision model
 * competent here: bare UCI strings measurably degrade its answers.
 */
export function toSystemOneBody(request: SystemOneRequest): unknown {
  const questions: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(request.questions)) {
    const criteria: Record<string, string | null> = {};
    for (const option of question.options) {
      criteria[option] = question.rubric?.[option] ?? null;
    }
    questions[id] = {
      type: "choice",
      instructions: question.instructions,
      criteria,
    };
  }
  return { model: request.model, state: request.state, questions };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokensFrom(value: unknown): TokenUsage | undefined {
  if (!isObject(value)) return undefined;
  const input = value.input_tokens;
  const output = value.output_tokens;
  if (
    typeof input !== "number" ||
    typeof output !== "number" ||
    !Number.isFinite(input) ||
    !Number.isFinite(output) ||
    input < 0 ||
    output < 0
  ) {
    return undefined;
  }
  return { in: input, out: output };
}

export function parseSystemOneResponse(
  value: unknown,
  status: number,
): SystemOneResponse | ProviderFailure {
  if (!isObject(value)) {
    throw new ContractViolation(LABEL, "provider response must be an object");
  }
  if (status !== 200) {
    const message =
      typeof value.message === "string"
        ? value.message
        : typeof value.detail === "string"
          ? value.detail
          : `provider returned HTTP ${status}`;
    return { kind: "error", status, message };
  }
  if (!isObject(value.answers)) {
    return { kind: "error", status, message: "provider response had no answers" };
  }

  const answers: Record<
    string,
    { choice: string; probabilities: { readonly [option: string]: number }; confidence: number }
  > = {};
  for (const [id, answer] of Object.entries(value.answers)) {
    if (!isObject(answer)) {
      return { kind: "error", status, message: `answer ${id} was not an object` };
    }
    const distribution = probabilities(answer.probabilities);
    if (
      typeof answer.choice !== "string" ||
      distribution === undefined ||
      typeof answer.confidence !== "number" ||
      !Number.isFinite(answer.confidence)
    ) {
      return { kind: "error", status, message: `answer ${id} was not a choice answer` };
    }
    answers[id] = {
      choice: answer.choice,
      probabilities: distribution,
      confidence: answer.confidence,
    };
  }

  const tokens = tokensFrom(value.usage);
  return tokens === undefined
    ? { kind: "systemone", answers }
    : { kind: "systemone", answers, tokens };
}
