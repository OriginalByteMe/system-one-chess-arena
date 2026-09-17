import { computeFeatures, filterFeatures } from "./features.ts";
import { legalMoves } from "./rules.ts";
import type { Position } from "./rules.ts";
import type {
  CompetitorManifest,
  PlayerRecord,
  PositionInput,
  Uci,
} from "./types.ts";

export interface PositionInputArgs {
  readonly seasonId: string;
  readonly gameId: string;
  readonly position: Position;
  readonly persona: CompetitorManifest;
  readonly lastMove?: Uci;
  readonly record?: PlayerRecord;
}

export function buildPositionInput(args: PositionInputArgs): PositionInput {
  const input = {
    seasonId: args.seasonId,
    gameId: args.gameId,
    ply: args.position.ply,
    colour: args.position.turn,
    fen: args.position.fen,
    history: args.position.history.slice(
      Math.max(0, args.position.history.length - args.persona.historyPlies),
    ),
    legalMoves: legalMoves(args.position),
    features: filterFeatures(
      computeFeatures(args.position, args.lastMove),
      args.persona.features,
    ),
    persona: args.persona,
    budget: args.persona.budget,
  };

  return args.record === undefined
    ? input
    : { ...input, record: args.record };
}
