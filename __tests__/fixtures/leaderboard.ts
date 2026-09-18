import type {
  CompetitorRef,
  CompetitorVersionRow,
  DecisionRecord,
  GameResult,
  GameSummary,
} from "../../src/core/types.ts";
import { RANDOM_MANIFEST } from "./manifests.ts";

export function competitorRef(name: string, version: string): CompetitorRef {
  return { name, version };
}

export function game(
  gameId: string,
  white: CompetitorRef,
  black: CompetitorRef,
  result: GameResult,
  overrides: Partial<GameSummary> = {},
): GameSummary {
  return {
    seasonId: "season-1",
    gameId,
    white,
    black,
    openingId: "start",
    result,
    reason: result === "draw" ? "move-limit" : "checkmate",
    plies: 12,
    pgn: "1. e4 e5",
    ...overrides,
  };
}

export function decision(
  fields: Partial<DecisionRecord> &
    Pick<DecisionRecord, "gameId" | "competitor" | "version" | "colour">,
): DecisionRecord {
  const ply = fields.ply ?? 1;
  return {
    seasonId: "season-1",
    fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
    legalMoveCount: 3,
    move: "a1a2",
    strategy: "direct",
    latencyMs: 20,
    featuresSeen: [],
    idempotencyKey: `${fields.gameId}:${ply}:${fields.version}`,
    ...fields,
    ply,
  };
}

export function versionRow(
  competitor: string,
  version: string,
  overrides: Partial<CompetitorVersionRow> = {},
): CompetitorVersionRow {
  return {
    competitor,
    version,
    seasonId: "season-1",
    manifest: { ...RANDOM_MANIFEST, name: competitor, version },
    traits: [],
    ...overrides,
  };
}
