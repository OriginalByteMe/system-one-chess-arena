// Typed client for /api/admin/*. Every response shape here mirrors the JSON
// src/api/admin-api.ts and src/api/analytics-query.ts actually send; it is
// kept in sync by hand rather than imported, because those server modules
// pull in Cloudflare's ambient Workers types (D1Database, DurableObject...)
// that the browser build must never need to resolve.
import { apiPath, getJson } from "./api.ts";
import type { CompetitorRef, EpochMs, GameResult, TerminalReason } from "../../src/core/types.ts";

/**
 * The console's two failure modes are worth naming, because both are setup
 * states rather than faults: 503 means Cloudflare Access is not configured on
 * this deployment, 401 means the Access session has expired.
 */
async function adminGet<T>(path: string): Promise<T> {
  try {
    return await getJson<T>(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("503")) {
      throw new Error(
        "Cloudflare Access is not configured for this deployment. See DEPLOY.md, step 5.",
      );
    }
    if (message.includes("401")) {
      throw new Error("Your Access session has expired. Reload the page to sign in again.");
    }
    throw error;
  }
}

export interface AdminIdentity {
  readonly email: string;
  readonly sub: string;
}

export type AdminGameStatus = "scheduled" | "on-air" | "finished" | "unscheduled";

export interface AdminGame {
  readonly gameId: string;
  readonly white: CompetitorRef;
  readonly black: CompetitorRef;
  readonly result: GameResult;
  readonly reason: TerminalReason;
  readonly plies: number;
  readonly schedule?: { readonly startAt: EpochMs; readonly msPerPly: number };
  readonly status: AdminGameStatus;
}

export interface AdminSeasonOverview {
  readonly seasonId: string;
  readonly gameCount: number;
  readonly firstBroadcastAt?: EpochMs;
  readonly scheduled: number;
  readonly onAir: number;
  readonly finished: number;
  readonly unscheduled: number;
}

export interface AdminCompetitorRegistration {
  readonly name: string;
  readonly version: string;
}

export interface AdminSeasonDetail {
  readonly seasonId: string;
  readonly games: readonly AdminGame[];
  readonly competitors: readonly AdminCompetitorRegistration[];
}

export interface AdminSetting {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: EpochMs;
}

export interface AdminSettings {
  readonly featuredSeason?: AdminSetting;
}

export interface AnalyticsCount {
  readonly label: string;
  readonly requests: number;
}

export interface AnalyticsDailyPoint {
  readonly date: string;
  readonly requests: number;
  readonly distinctContexts: number;
}

export type AnalyticsSummary =
  | { readonly configured: false }
  | {
      readonly configured: true;
      readonly days: number;
      readonly totalRequests: number;
      readonly errorRate: number;
      readonly durationP50Ms: number;
      readonly durationP95Ms: number;
      readonly daily: readonly AnalyticsDailyPoint[];
      readonly topRoutes: readonly AnalyticsCount[];
      readonly topCountries: readonly AnalyticsCount[];
      readonly deviceSplit: readonly AnalyticsCount[];
      readonly referrers: readonly AnalyticsCount[];
    };

/** PUT/POST counterpart to getJson: same error contract, a JSON body out instead of none. */
async function sendJson<T>(method: "PUT" | "POST", path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail.length > 0 ? detail : `The console answered ${response.status}.`);
  }
  return (await response.json()) as T;
}

/** DELETE has no body and no JSON in, but the same error contract. */
async function deleteJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: "DELETE", headers: { accept: "application/json" } });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail.length > 0 ? detail : `The console answered ${response.status}.`);
  }
  return (await response.json()) as T;
}

export function whoami(): Promise<AdminIdentity> {
  return adminGet<AdminIdentity>(apiPath("admin", "whoami"));
}

export function seasons(): Promise<readonly AdminSeasonOverview[]> {
  return adminGet<readonly AdminSeasonOverview[]>(apiPath("admin", "seasons"));
}

export function seasonDetail(seasonId: string): Promise<AdminSeasonDetail> {
  return adminGet<AdminSeasonDetail>(apiPath("admin", "seasons", seasonId));
}

export function settings(): Promise<AdminSettings> {
  return adminGet<AdminSettings>(apiPath("admin", "settings"));
}

export function saveFeaturedSeason(seasonId: string): Promise<AdminSettings> {
  return sendJson<AdminSettings>("PUT", apiPath("admin", "settings"), {
    key: "featured_season",
    value: seasonId,
  });
}

export function rescheduleGame(
  seasonId: string,
  gameId: string,
  startAt: number,
  msPerPly: number,
): Promise<AdminGame> {
  return sendJson<AdminGame>("POST", apiPath("admin", "games", seasonId, gameId, "schedule"), {
    startAt,
    msPerPly,
  });
}

export function analytics(days: number): Promise<AnalyticsSummary> {
  return adminGet<AnalyticsSummary>(`${apiPath("admin", "analytics")}?days=${days}`);
}

// These four have no Cloudflare ambient dependency, so they are imported
// rather than mirrored. The scheduler and the console disagreeing about what
// a plan is would be a silent bug, and the type system can just prevent it.
export type {
  CalendarDay,
  CampaignPhase,
  CampaignPlan,
  ScheduledMatch,
} from "../../src/season/campaign.ts";
import type { CalendarDay, CampaignPhase, CampaignPlan } from "../../src/season/campaign.ts";

export interface AdminCampaign {
  readonly campaignId: string;
  readonly plan: CampaignPlan;
  readonly entrants: number;
  readonly seasonIndex: number;
  readonly seasonId: string;
  readonly phase: CampaignPhase;
  readonly startedAt: number;
  readonly lastTickAt: number;
  readonly champion?: string;
  readonly matchesTotal: number;
  readonly matchesPlayed: number;
  readonly calendar: readonly CalendarDay[];
}

export type AdminCampaignState =
  | { readonly running: false }
  | { readonly running: true; readonly campaign: AdminCampaign };

export function campaign(): Promise<AdminCampaignState> {
  return adminGet<AdminCampaignState>(apiPath("admin", "campaign"));
}

export function startCampaign(plan: CampaignPlan): Promise<AdminCampaignState> {
  return sendJson<AdminCampaignState>("POST", apiPath("admin", "campaign"), plan);
}

/** Plays the next due round now, instead of waiting for the daily cron. */
export function tickCampaign(): Promise<AdminCampaignState> {
  return sendJson<AdminCampaignState>("POST", apiPath("admin", "campaign", "tick"), {});
}

export function pauseCampaign(): Promise<AdminCampaignState> {
  return sendJson<AdminCampaignState>("POST", apiPath("admin", "campaign", "pause"), {});
}

export function resumeCampaign(): Promise<AdminCampaignState> {
  return sendJson<AdminCampaignState>("POST", apiPath("admin", "campaign", "resume"), {});
}

export function stopCampaign(): Promise<AdminCampaignState> {
  return deleteJson<AdminCampaignState>(apiPath("admin", "campaign"));
}
