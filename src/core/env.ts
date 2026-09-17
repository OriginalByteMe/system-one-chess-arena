export interface Env {
  readonly GAME: DurableObjectNamespace;
  readonly SEASON: DurableObjectNamespace;
  readonly DB: D1Database;
  readonly TYPESAFE_API_KEY: string;
  readonly TYPESAFE_BASE_URL: string;
  readonly ARENA_LLM_MODEL: string;
  readonly ARENA_JEV_MODEL: string;
}
