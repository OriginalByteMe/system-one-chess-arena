import { ContractViolation } from "../core/errors";
import {
  FEATURE_KEYS,
  STRATEGY_LABELS,
  type DecisionRecord,
  type FallbackReason,
} from "../core/types";

const COLOURS = ["white", "black"] as const;
const FALLBACK_REASONS = [
  "timeout",
  "illegal-output",
  "provider-error",
  "malformed-response",
  "malformed-distribution",
  "unknown-strategy",
] as const satisfies readonly FallbackReason[];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDistribution(value: unknown): boolean {
  return (
    isObject(value) &&
    Object.values(value).every((probability) => isFiniteNumber(probability))
  );
}

function isTokenUsage(value: unknown): boolean {
  return (
    isObject(value) &&
    isFiniteNumber(value.in) &&
    isFiniteNumber(value.out)
  );
}

function isDecisionRecord(value: unknown): value is DecisionRecord {
  return (
    isObject(value) &&
    typeof value.seasonId === "string" &&
    typeof value.gameId === "string" &&
    isFiniteNumber(value.ply) &&
    typeof value.competitor === "string" &&
    typeof value.version === "string" &&
    COLOURS.some((colour) => colour === value.colour) &&
    typeof value.fen === "string" &&
    isFiniteNumber(value.legalMoveCount) &&
    typeof value.move === "string" &&
    STRATEGY_LABELS.some((strategy) => strategy === value.strategy) &&
    (value.confidence === undefined || isFiniteNumber(value.confidence)) &&
    (value.distribution === undefined || isDistribution(value.distribution)) &&
    isFiniteNumber(value.latencyMs) &&
    (value.tokens === undefined || isTokenUsage(value.tokens)) &&
    (value.fallback === undefined ||
      FALLBACK_REASONS.some((reason) => reason === value.fallback)) &&
    Array.isArray(value.featuresSeen) &&
    value.featuresSeen.every((feature) =>
      FEATURE_KEYS.some((key) => key === feature),
    ) &&
    typeof value.idempotencyKey === "string"
  );
}

export function idempotencyKey(
  gameId: string,
  ply: number,
  version: string,
): string {
  return `${gameId}:${ply}:${version}`;
}

export function serialiseDecision(record: DecisionRecord): string {
  return JSON.stringify(record);
}

export function parseDecisionLine(line: string): DecisionRecord {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new ContractViolation(
      "log.parseDecisionLine",
      "line must be valid JSON",
    );
  }
  if (!isDecisionRecord(value)) {
    throw new ContractViolation(
      "log.parseDecisionLine",
      "line must contain a DecisionRecord",
    );
  }
  return value;
}

export function parseDecisionLog(text: string): readonly DecisionRecord[] {
  const records: DecisionRecord[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") {
      continue;
    }
    try {
      records.push(parseDecisionLine(line));
    } catch (error) {
      if (error instanceof ContractViolation) {
        throw new ContractViolation(
          "log.parseDecisionLog",
          `line ${index + 1}: ${error.message}`,
        );
      }
      throw error;
    }
  }
  return records;
}
