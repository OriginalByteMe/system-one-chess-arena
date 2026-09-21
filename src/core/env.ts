import type { GameDurableObject } from "../do/game.ts";
import type { SeasonDurableObject } from "../do/season.ts";

export interface Env {
  readonly GAME: DurableObjectNamespace<GameDurableObject>;
  readonly SEASON: DurableObjectNamespace<SeasonDurableObject>;
  readonly DB: D1Database;
  /** Request and decision events. Absent in tests, where nothing is written. */
  readonly ANALYTICS?: AnalyticsEngineDataset;
  readonly TYPESAFE_API_KEY: string;
  readonly TYPESAFE_BASE_URL: string;
  readonly ARENA_LLM_MODEL: string;
  readonly ARENA_JEV_MODEL: string;
  /** Bearer token for the scripted admin routes. Absent means they refuse. */
  readonly ARENA_ADMIN_TOKEN?: string;
  /**
   * The season the front page opens on. Absent means the most recently
   * scheduled season, which is the right answer until a season is pinned.
   */
  readonly ARENA_FEATURED_SEASON?: string;
  /** e.g. "system-one.cloudflareaccess.com". Absent means /api/admin refuses. */
  readonly CF_ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience tag of the Access app in front of /admin. */
  readonly CF_ACCESS_AUD?: string;
  /** Account id and a read-scoped API token, for querying Analytics Engine. */
  readonly CF_ACCOUNT_ID?: string;
  readonly CF_ANALYTICS_TOKEN?: string;
}
