import { NotImplemented } from "./errors.ts";
import type {
  FallbackReason,
  MoveDecision,
  PositionInput,
  RawDecision,
  Rng,
  ValidationResult,
} from "./types.ts";

export function validateDecision(
  input: PositionInput,
  raw: RawDecision,
): ValidationResult {
  throw new NotImplemented("validation.validateDecision");
}

export function applyFallback(
  input: PositionInput,
  reason: FallbackReason,
  rng: Rng,
  latencyMs: number,
): MoveDecision {
  throw new NotImplemented("validation.applyFallback");
}
