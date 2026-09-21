// Operator console API, behind Cloudflare Access.
//
// Every route under /api/admin/* runs verifyAccessRequest first: no configured
// team domain/audience 503s the whole surface, and a bad or missing token
// 401s it, before any SQL runs. Nothing here is spoiler gated — the operator
// runs the broadcast, so seeing the true result and ply count is the point,
// unlike the public read API in read.ts.
import { verifyAccessRequest } from "./access.ts";
import { requireAdmin } from "./admin.ts";
import { analyticsSummary } from "./analytics-query.ts";
import {
  campaignReport,
  setCampaignPaused,
  startCampaign,
  stopCampaign,
  tickCampaign,
} from "./campaign.ts";
import type { CampaignReport } from "./campaign.ts";
import { revealWindow } from "../broadcast/clock.ts";
import { ContractViolation } from "../core/errors.ts";
import type { Env } from "../core/env.ts";
import type {
  BroadcastStatus,
  CompetitorRef,
  EpochMs,
  GameResult,
  TerminalReason,
} from "../core/types.ts";
import type { CalendarDay, CampaignPhase, CampaignPlan } from "../season/campaign.ts";

const SUBJECT = "api.admin-api";

const GAME_RESULTS = ["white", "black", "draw"] as const satisfies readonly GameResult[];
const TERMINAL_REASONS = [
  "checkmate",
  "stalemate",
  "insufficient-material",
  "fifty-move",
  "threefold",
  "move-limit",
] as const satisfies readonly TerminalReason[];

const ID_PATTERN = /^[A-Za-z0-9._:@-]+$/;
const FEATURED_SEASON_KEY = "featured_season";
const DEFAULT_ANALYTICS_DAYS = 7;
const MAX_ANALYTICS_DAYS = 90;

const GAME_COLUMNS =
  "game_id, white_competitor, white_version, black_competitor, black_version, result, reason, plies, broadcast_start_at, ms_per_ply";

function fail(detail: string): never {
  throw new ContractViolation(SUBJECT, detail);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: string, options: readonly T[]): value is T {
  return (options as readonly string[]).includes(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`${field} must be a string`);
  return value;
}

function requireOneOf<T extends string>(value: string, field: string, options: readonly T[]): T {
  if (!isOneOf(value, options)) fail(`${field} must be one of: ${options.join(", ")}`);
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(`${field} must be a positive integer`);
  }
  return value;
}

function decodeId(segment: string | undefined): string | undefined {
  if (segment === undefined) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  return ID_PATTERN.test(decoded) ? decoded : undefined;
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

function methodNotAllowed(): Response {
  return new Response(null, { status: 405 });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function badRequest(error: unknown): Response {
  if (error instanceof ContractViolation) {
    return new Response(error.message, { status: 400 });
  }
  throw error;
}

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    fail("body must be valid JSON");
  }
}

// ---------------------------------------------------------------------------
// Games, read straight off the games table. Never through ArenaStore: that
// store's job is the spoiler-gated read side, and this console deliberately
// shows the truth regardless of what has aired.
// ---------------------------------------------------------------------------

interface GameRow {
  readonly game_id: string;
  readonly white_competitor: string;
  readonly white_version: string;
  readonly black_competitor: string;
  readonly black_version: string;
  readonly result: string;
  readonly reason: string;
  readonly plies: number;
  readonly broadcast_start_at: number | null;
  readonly ms_per_ply: number | null;
}

function isGameRow(value: unknown): value is GameRow {
  if (!isObject(value)) return false;
  return (
    typeof value.game_id === "string" &&
    typeof value.white_competitor === "string" &&
    typeof value.white_version === "string" &&
    typeof value.black_competitor === "string" &&
    typeof value.black_version === "string" &&
    typeof value.result === "string" &&
    typeof value.reason === "string" &&
    typeof value.plies === "number" &&
    (value.broadcast_start_at === null || typeof value.broadcast_start_at === "number") &&
    (value.ms_per_ply === null || typeof value.ms_per_ply === "number")
  );
}

export type AdminGameStatus = BroadcastStatus | "unscheduled";

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

function adminGameFrom(row: GameRow, now: EpochMs): AdminGame {
  const base = {
    gameId: row.game_id,
    white: { name: row.white_competitor, version: row.white_version },
    black: { name: row.black_competitor, version: row.black_version },
    result: requireOneOf(row.result, "result", GAME_RESULTS),
    reason: requireOneOf(row.reason, "reason", TERMINAL_REASONS),
    plies: row.plies,
  };
  if (row.broadcast_start_at === null || row.ms_per_ply === null) {
    return { ...base, status: "unscheduled" };
  }
  const schedule = { startAt: row.broadcast_start_at, msPerPly: row.ms_per_ply };
  const window = revealWindow(schedule, row.plies, now);
  return { ...base, schedule, status: window.status };
}

async function loadGame(
  db: D1Database,
  seasonId: string,
  gameId: string,
  now: EpochMs,
): Promise<AdminGame | undefined> {
  const row = await db
    .prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE season_id = ? AND game_id = ?`)
    .bind(seasonId, gameId)
    .first();
  if (row === null) return undefined;
  if (!isGameRow(row)) fail("games row is missing a required column");
  return adminGameFrom(row, now);
}

// ---------------------------------------------------------------------------
// GET /api/admin/seasons
// ---------------------------------------------------------------------------

export interface AdminSeasonOverview {
  readonly seasonId: string;
  readonly gameCount: number;
  readonly firstBroadcastAt?: EpochMs;
  readonly scheduled: number;
  readonly onAir: number;
  readonly finished: number;
  readonly unscheduled: number;
}

interface ScheduleRow {
  readonly season_id: string;
  readonly broadcast_start_at: number | null;
  readonly ms_per_ply: number | null;
  readonly plies: number;
}

function isScheduleRow(value: unknown): value is ScheduleRow {
  if (!isObject(value)) return false;
  return (
    typeof value.season_id === "string" &&
    typeof value.plies === "number" &&
    (value.broadcast_start_at === null || typeof value.broadcast_start_at === "number") &&
    (value.ms_per_ply === null || typeof value.ms_per_ply === "number")
  );
}

interface SeasonAccumulator {
  gameCount: number;
  firstBroadcastAt?: EpochMs;
  scheduled: number;
  onAir: number;
  finished: number;
  unscheduled: number;
}

async function seasonsOverview(db: D1Database, now: EpochMs): Promise<readonly AdminSeasonOverview[]> {
  const { results } = await db
    .prepare("SELECT season_id, broadcast_start_at, ms_per_ply, plies FROM games")
    .all();

  const bySeason = new Map<string, SeasonAccumulator>();
  for (const raw of results) {
    if (!isScheduleRow(raw)) fail("games row is missing a required column");
    const accumulator: SeasonAccumulator = bySeason.get(raw.season_id) ?? {
      gameCount: 0,
      scheduled: 0,
      onAir: 0,
      finished: 0,
      unscheduled: 0,
    };
    accumulator.gameCount += 1;
    if (raw.broadcast_start_at === null || raw.ms_per_ply === null) {
      accumulator.unscheduled += 1;
    } else {
      if (accumulator.firstBroadcastAt === undefined || raw.broadcast_start_at < accumulator.firstBroadcastAt) {
        accumulator.firstBroadcastAt = raw.broadcast_start_at;
      }
      const schedule = { startAt: raw.broadcast_start_at, msPerPly: raw.ms_per_ply };
      const status = revealWindow(schedule, raw.plies, now).status;
      if (status === "scheduled") accumulator.scheduled += 1;
      else if (status === "on-air") accumulator.onAir += 1;
      else accumulator.finished += 1;
    }
    bySeason.set(raw.season_id, accumulator);
  }

  return [...bySeason.entries()]
    .map(([seasonId, accumulator]) => ({ seasonId, ...accumulator }))
    .sort((a, b) => a.seasonId.localeCompare(b.seasonId));
}

// ---------------------------------------------------------------------------
// GET /api/admin/seasons/:seasonId
// ---------------------------------------------------------------------------

export interface AdminCompetitorRegistration {
  readonly name: string;
  readonly version: string;
}

export interface AdminSeasonDetail {
  readonly seasonId: string;
  readonly games: readonly AdminGame[];
  readonly competitors: readonly AdminCompetitorRegistration[];
}

interface CompetitorRegistrationRow {
  readonly competitor: string;
  readonly version: string;
}

function isCompetitorRow(value: unknown): value is CompetitorRegistrationRow {
  return isObject(value) && typeof value.competitor === "string" && typeof value.version === "string";
}

async function seasonDetail(
  db: D1Database,
  seasonId: string,
  now: EpochMs,
): Promise<AdminSeasonDetail | undefined> {
  const [{ results: gameRows }, { results: competitorRows }] = await Promise.all([
    db.prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE season_id = ? ORDER BY game_id`).bind(seasonId).all(),
    db
      .prepare(
        "SELECT DISTINCT competitor, version FROM competitor_versions WHERE season_id = ? ORDER BY competitor, version",
      )
      .bind(seasonId)
      .all(),
  ]);

  if (gameRows.length === 0 && competitorRows.length === 0) return undefined;

  const games = gameRows.map((row) => {
    if (!isGameRow(row)) fail("games row is missing a required column");
    return adminGameFrom(row, now);
  });
  const competitors = competitorRows.map((row) => {
    if (!isCompetitorRow(row)) fail("competitor_versions row is missing a required column");
    return { name: row.competitor, version: row.version };
  });

  return { seasonId, games, competitors };
}

// ---------------------------------------------------------------------------
// GET/PUT /api/admin/settings
// ---------------------------------------------------------------------------

export interface AdminSetting {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: EpochMs;
}

export interface AdminSettings {
  readonly featuredSeason?: AdminSetting;
}

interface SettingRow {
  readonly key: string;
  readonly value: string;
  readonly updated_at: number;
}

function isSettingRow(value: unknown): value is SettingRow {
  return (
    isObject(value) &&
    typeof value.key === "string" &&
    typeof value.value === "string" &&
    typeof value.updated_at === "number"
  );
}

async function readSettings(db: D1Database): Promise<AdminSettings> {
  const row = await db
    .prepare("SELECT key, value, updated_at FROM site_settings WHERE key = ?")
    .bind(FEATURED_SEASON_KEY)
    .first();
  if (row === null) return {};
  if (!isSettingRow(row)) fail("site_settings row is missing a required column");
  return { featuredSeason: { key: row.key, value: row.value, updatedAt: row.updated_at } };
}

async function writeSetting(request: Request, db: D1Database, now: EpochMs): Promise<Response> {
  try {
    const body = await jsonBody(request);
    if (!isObject(body)) fail("body must be an object");
    const key = requireString(body.key, "key");
    if (key !== FEATURED_SEASON_KEY) fail(`unknown setting key: ${key}`);
    const value = requireString(body.value, "value");
    if (!ID_PATTERN.test(value)) fail("value must look like a season id");

    await db
      .prepare(
        "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind(key, value, now)
      .run();

    return json({ featuredSeason: { key, value, updatedAt: now } } satisfies AdminSettings);
  } catch (error) {
    return badRequest(error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/games/:seasonId/:gameId/schedule
// ---------------------------------------------------------------------------

async function rescheduleGame(
  request: Request,
  db: D1Database,
  seasonId: string,
  gameId: string,
  now: EpochMs,
): Promise<Response> {
  try {
    const body = await jsonBody(request);
    if (!isObject(body)) fail("body must be an object");
    const startAt = requirePositiveInteger(body.startAt, "startAt");
    const msPerPly = requirePositiveInteger(body.msPerPly, "msPerPly");

    const update = await db
      .prepare("UPDATE games SET broadcast_start_at = ?, ms_per_ply = ? WHERE season_id = ? AND game_id = ?")
      .bind(startAt, msPerPly, seasonId, gameId)
      .run();
    if (update.meta.changes === 0) return notFound();

    const game = await loadGame(db, seasonId, gameId, now);
    if (game === undefined) return notFound();
    return json(game);
  } catch (error) {
    return badRequest(error);
  }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function parseDays(raw: string | null): number {
  if (raw === null) return DEFAULT_ANALYTICS_DAYS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_ANALYTICS_DAYS) {
    return DEFAULT_ANALYTICS_DAYS;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// GET/POST/DELETE /api/admin/campaign, POST /api/admin/campaign/tick
// ---------------------------------------------------------------------------

/**
 * What the console shows about a campaign.
 *
 * Deliberately not the stored state: the bracket is the bulk of that row and
 * the console already reads matches through the seasons panel, so sending it
 * here would be the same data twice.
 */
export interface AdminCampaign {
  readonly campaignId: string;
  readonly plan: CampaignPlan;
  readonly entrants: number;
  readonly seasonIndex: number;
  readonly seasonId: string;
  readonly phase: CampaignPhase;
  readonly startedAt: EpochMs;
  readonly lastTickAt: EpochMs;
  readonly champion?: string;
  /** Matches in the current season that reach a board, so byes are excluded. */
  readonly matchesTotal: number;
  readonly matchesPlayed: number;
  readonly calendar: readonly CalendarDay[];
}

export type AdminCampaignState =
  | { readonly running: false }
  | { readonly running: true; readonly campaign: AdminCampaign };

function campaignView(report: CampaignReport | undefined): AdminCampaignState {
  if (report === undefined) return { running: false };
  const { state } = report;
  return {
    running: true,
    campaign: {
      campaignId: state.campaignId,
      plan: state.plan,
      entrants: state.entrants,
      seasonIndex: state.seasonIndex,
      seasonId: state.seasonId,
      phase: state.phase,
      startedAt: state.startedAt,
      lastTickAt: state.lastTickAt,
      ...(state.champion === undefined ? {} : { champion: state.champion }),
      matchesTotal: report.matchesTotal,
      matchesPlayed: report.matchesPlayed,
      calendar: report.calendar,
    },
  };
}

/**
 * Routes /api/admin/*.
 *
 * Contract:
 * - Undefined for any other path, so the Worker falls through to its other
 *   routes and static assets.
 * - Every matched path runs Access verification first: 503 unconfigured, 401
 *   rejected, before any handler sees the request.
 */
export type AdminEnv = Pick<
  Env,
  | "DB"
  | "SEASON"
  | "CF_ACCESS_TEAM_DOMAIN"
  | "CF_ACCESS_AUD"
  | "CF_ACCOUNT_ID"
  | "ARENA_ADMIN_TOKEN"
>;

export async function handleAdmin(
  request: Request,
  env: AdminEnv,
  now: number,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments[0] !== "api" || segments[1] !== "admin") return undefined;

  // The campaign routes take either credential. Access is how a human reaches
  // them from the console; the scripted bearer is the same token that already
  // gates /api/seasons/*/start, which spends provider money exactly as this
  // does, so it is the same trust boundary rather than a weaker one. It is
  // also the only way to start a campaign before Access is configured.
  const CAMPAIGN_ACTIONS = ["tick", "pause", "resume"];
  const campaignRoute =
    segments[2] === "campaign" &&
    (segments.length === 3 ||
      (segments.length === 4 && CAMPAIGN_ACTIONS.includes(segments[3] ?? "")));
  if (!(campaignRoute && requireAdmin(request, env.ARENA_ADMIN_TOKEN).ok)) {
    const access = await verifyAccessRequest(request, env, now);
    if (!access.ok) return access.response;
    if (segments.length === 3 && segments[2] === "whoami") {
      if (request.method !== "GET") return methodNotAllowed();
      return json(access.identity);
    }
  }

  if (segments.length === 3 && segments[2] === "seasons") {
    if (request.method !== "GET") return methodNotAllowed();
    return json(await seasonsOverview(env.DB, now));
  }

  if (segments.length === 4 && segments[2] === "seasons") {
    if (request.method !== "GET") return methodNotAllowed();
    const seasonId = decodeId(segments[3]);
    if (seasonId === undefined) return notFound();
    const detail = await seasonDetail(env.DB, seasonId, now);
    return detail === undefined ? notFound() : json(detail);
  }

  if (segments.length === 3 && segments[2] === "settings") {
    if (request.method === "GET") return json(await readSettings(env.DB));
    if (request.method === "PUT") return writeSetting(request, env.DB, now);
    return methodNotAllowed();
  }

  if (segments.length === 6 && segments[2] === "games" && segments[5] === "schedule") {
    if (request.method !== "POST") return methodNotAllowed();
    const seasonId = decodeId(segments[3]);
    const gameId = decodeId(segments[4]);
    if (seasonId === undefined || gameId === undefined) return notFound();
    return rescheduleGame(request, env.DB, seasonId, gameId, now);
  }

  if (segments.length === 3 && segments[2] === "campaign") {
    if (request.method === "GET") return json(campaignView(await campaignReport(env, now)));
    if (request.method === "POST") {
      try {
        await startCampaign(env, await jsonBody(request), now);
      } catch (error) {
        return badRequest(error);
      }
      return json(campaignView(await campaignReport(env, now)));
    }
    if (request.method === "DELETE") {
      await stopCampaign(env);
      return json(campaignView(undefined));
    }
    return methodNotAllowed();
  }

  if (segments.length === 4 && segments[2] === "campaign") {
    if (request.method !== "POST") return methodNotAllowed();
    // Tick from the console forces today's deal, which is the whole point of
    // the button: an operator should not wait until 17:00 to see it work.
    if (segments[3] === "tick") await tickCampaign(env, now, true);
    else if (segments[3] === "pause") await setCampaignPaused(env, true, now);
    else if (segments[3] === "resume") await setCampaignPaused(env, false, now);
    else return notFound();
    return json(campaignView(await campaignReport(env, now)));
  }

  if (segments.length === 3 && segments[2] === "analytics") {
    if (request.method !== "GET") return methodNotAllowed();
    return json(await analyticsSummary(env, parseDays(url.searchParams.get("days"))));
  }

  return notFound();
}
