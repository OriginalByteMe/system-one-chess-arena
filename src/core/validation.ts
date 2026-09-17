import { validateDistribution } from "./distribution.ts";
import { ContractViolation } from "./errors.ts";
import { chooseGreedyMove } from "./greedy.ts";
import type {
  FallbackReason,
  MoveDecision,
  PositionInput,
  RawDecision,
  Rng,
  ValidationResult,
} from "./types.ts";

const UCI_PATTERN = /^[a-h][1-8][a-h][1-8](?:[qrbn])?$/;

function rejected(
  reason: FallbackReason,
  detail: string,
): ValidationResult {
  return { ok: false, reason, detail };
}

function violation(detail: string): never {
  throw new ContractViolation("validation.applyFallback", detail);
}

export function validateDecision(
  input: PositionInput,
  raw: RawDecision,
): ValidationResult {
  if (!UCI_PATTERN.test(raw.move) || !input.legalMoves.includes(raw.move)) {
    return rejected("illegal-output", `move is not legal: ${raw.move}`);
  }

  const strategy = input.persona.strategies.find(
    (declared) => declared === raw.strategy,
  );
  if (strategy === undefined) {
    return rejected(
      "unknown-strategy",
      `strategy is not declared: ${raw.strategy ?? "missing"}`,
    );
  }

  if (
    raw.confidence !== undefined &&
    (!Number.isFinite(raw.confidence) ||
      raw.confidence < 0 ||
      raw.confidence > 1)
  ) {
    return rejected(
      "malformed-response",
      "confidence must be finite and between zero and one",
    );
  }

  if (
    raw.distribution !== undefined &&
    !validateDistribution(raw.distribution, input.legalMoves)
  ) {
    return rejected(
      "malformed-distribution",
      "distribution must assign legal moves non-negative probabilities summing to one",
    );
  }

  return { ok: true, decision: { ...raw, strategy } };
}

export function applyFallback(
  input: PositionInput,
  reason: FallbackReason,
  rng: Rng,
  latencyMs: number,
): MoveDecision {
  const strategy = input.persona.strategies[0];
  if (strategy === undefined) {
    violation("manifest must declare at least one strategy");
  }

  const firstMove = input.legalMoves[0];
  if (firstMove === undefined) {
    violation("position must have at least one legal move");
  }

  let move = firstMove;
  if (input.persona.fallback === "random-legal") {
    move = rng.pick(input.legalMoves);
  } else if (input.persona.fallback === "greedy") {
    move = chooseGreedyMove(input.fen, input.legalMoves, rng);
  }

  return { move, strategy, latencyMs, fallback: reason };
}
