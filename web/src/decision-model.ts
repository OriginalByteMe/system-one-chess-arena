import type { MoveEvent } from "../../src/core/types.ts";

export interface DecisionPanelModel {
  readonly move: string;
  readonly strategy: string;
  readonly confidence: string;
  readonly latency: string;
  readonly competitor: string;
  readonly ply: string;
}

const WAITING_DECISION: DecisionPanelModel = {
  move: "—",
  strategy: "Awaiting move",
  confidence: "—",
  latency: "—",
  competitor: "No competitor yet",
  ply: "Pre-game",
};

export function formatDecision(event?: MoveEvent): DecisionPanelModel {
  if (event === undefined) return WAITING_DECISION;

  const strategy = event.strategy.replaceAll("-", " ");
  return {
    move: `${event.move.slice(0, 2)} → ${event.move.slice(2, 4)}`,
    strategy: strategy.charAt(0).toUpperCase() + strategy.slice(1),
    confidence:
      event.confidence === undefined
        ? "Not reported"
        : `${Math.round(event.confidence * 100)}%`,
    latency:
      event.latencyMs < 1_000
        ? `${event.latencyMs} ms`
        : `${(event.latencyMs / 1_000).toFixed(2)} s`,
    competitor: event.competitor.name,
    ply: `Ply ${event.ply}`,
  };
}
