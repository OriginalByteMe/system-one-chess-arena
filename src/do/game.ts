import { DurableObject } from "cloudflare:workers";

import { NotImplemented } from "../core/errors.ts";
import type { Env } from "../core/env.ts";
import type {
  DecisionRecord,
  Fen,
  Pairing,
  SeasonConfig,
  TerminalState,
} from "../core/types.ts";

export interface GameSnapshot {
  readonly fen: Fen;
  readonly ply: number;
  readonly decisions: readonly DecisionRecord[];
  readonly finished?: TerminalState;
}

export class GameDurableObject extends DurableObject<Env> {
  async start(pairing: Pairing, config: SeasonConfig): Promise<void> {
    throw new NotImplemented("do/game.GameDurableObject.start");
  }

  async alarm(): Promise<void> {
    throw new NotImplemented("do/game.GameDurableObject.alarm");
  }

  async fetch(request: Request): Promise<Response> {
    throw new NotImplemented("do/game.GameDurableObject.fetch");
  }

  async snapshot(): Promise<GameSnapshot> {
    throw new NotImplemented("do/game.GameDurableObject.snapshot");
  }
}
