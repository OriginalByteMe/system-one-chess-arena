import { DurableObject } from "cloudflare:workers";

import { NotImplemented } from "../core/errors.ts";
import type { Env } from "../core/env.ts";
import type { SeasonConfig, SeasonStandings } from "../core/types.ts";

export class SeasonDurableObject extends DurableObject<Env> {
  async start(config: SeasonConfig): Promise<void> {
    throw new NotImplemented("do/season.SeasonDurableObject.start");
  }

  async alarm(): Promise<void> {
    throw new NotImplemented("do/season.SeasonDurableObject.alarm");
  }

  async complete(): Promise<SeasonStandings> {
    throw new NotImplemented("do/season.SeasonDurableObject.complete");
  }

  async standings(): Promise<SeasonStandings> {
    throw new NotImplemented("do/season.SeasonDurableObject.standings");
  }
}
