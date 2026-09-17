import type { GameDurableObject } from "../do/game.ts";
import type { SeasonDurableObject } from "../do/season.ts";

export interface Env {
  readonly GAME: DurableObjectNamespace<GameDurableObject>;
  readonly SEASON: DurableObjectNamespace<SeasonDurableObject>;
  readonly DB: D1Database;
  readonly TYPESAFE_API_KEY: string;
  readonly TYPESAFE_BASE_URL: string;
  readonly ARENA_LLM_MODEL: string;
  readonly ARENA_JEV_MODEL: string;
}
