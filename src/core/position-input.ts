import { NotImplemented } from "./errors.ts";
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
  throw new NotImplemented("position-input.buildPositionInput");
}
