import { NotImplemented } from "../core/errors";
import type { DecisionRecord } from "../core/types";

export function idempotencyKey(gameId: string, ply: number, version: string): string {
  throw new NotImplemented("log.idempotencyKey");
}

export function serialiseDecision(record: DecisionRecord): string {
  throw new NotImplemented("log.serialiseDecision");
}

export function parseDecisionLine(line: string): DecisionRecord {
  throw new NotImplemented("log.parseDecisionLine");
}

export function parseDecisionLog(text: string): readonly DecisionRecord[] {
  throw new NotImplemented("log.parseDecisionLog");
}
