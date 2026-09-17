import type { CompetitorManifest } from "../../src/core/types.ts";

export const RANDOM_MANIFEST: CompetitorManifest = {
  name: "random",
  model: "builtin-random",
  playstyle: "Choose uniformly from the legal moves.",
  strategies: ["direct"],
  features: [],
  historyPlies: 0,
  fallback: "random-legal",
  budget: { maxMs: 25 },
  hierarchical: false,
  version: "test-v1",
};

export const GREEDY_MANIFEST: CompetitorManifest = {
  name: "greedy",
  model: "builtin-greedy",
  playstyle: "Prefer the most valuable immediately available capture.",
  strategies: ["direct"],
  features: ["materialBalance", "hangingOpponentPieces"],
  historyPlies: 1,
  fallback: "greedy",
  budget: { maxMs: 25 },
  hierarchical: false,
  version: "test-v1",
};

export const SCRIPTED_MANIFEST: CompetitorManifest = {
  name: "scripted",
  model: "builtin-scripted",
  playstyle: "Attack concrete targets, defend urgent threats, and simplify when ahead.",
  strategies: ["attack", "defend", "simplify"],
  features: [
    "materialBalance",
    "hangingOwnPieces",
    "hangingOpponentPieces",
    "inCheck",
    "opponentMateInOne",
  ],
  historyPlies: 4,
  fallback: "first-legal",
  budget: { maxMs: 50 },
  hierarchical: true,
  version: "test-v1",
};

export const LLM_MANIFEST: CompetitorManifest = {
  name: "llm",
  model: "test-chat-model",
  playstyle: "Play concise tactical chess while respecting immediate threats.",
  strategies: ["direct"],
  features: ["materialBalance", "mobility", "inCheck", "phase"],
  historyPlies: 8,
  fallback: "first-legal",
  budget: { maxMs: 1_000, maxCostUsd: 0.01 },
  hierarchical: false,
  version: "test-v1",
};

export const JEV_FLAT_MANIFEST: CompetitorManifest = {
  name: "jev-flat",
  model: "test-jev-model",
  playstyle: "Choose a move directly from the legal options.",
  strategies: ["direct"],
  features: [
    "materialBalance",
    "hangingOpponentPieces",
    "kingSafety",
    "phase",
  ],
  historyPlies: 6,
  fallback: "random-legal",
  budget: { maxMs: 800, maxCostUsd: 0.005 },
  hierarchical: false,
  version: "test-v1",
};

export const JEV_HIERARCHICAL_MANIFEST: CompetitorManifest = {
  name: "jev-hierarchical",
  model: "test-jev-model",
  playstyle: "Select a strategic intent before choosing a legal move.",
  strategies: ["attack", "defend", "simplify"],
  features: [
    "materialBalance",
    "mobility",
    "hangingOwnPieces",
    "hangingOpponentPieces",
    "kingSafety",
    "inCheck",
    "opponentMateInOne",
    "phase",
  ],
  historyPlies: 12,
  fallback: "greedy",
  budget: { maxMs: 1_200, maxCostUsd: 0.01 },
  hierarchical: true,
  version: "test-v1",
};

export const ALL_MANIFESTS: readonly CompetitorManifest[] = [
  RANDOM_MANIFEST,
  GREEDY_MANIFEST,
  SCRIPTED_MANIFEST,
  LLM_MANIFEST,
  JEV_FLAT_MANIFEST,
  JEV_HIERARCHICAL_MANIFEST,
];
