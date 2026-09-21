// Analytics summary for the operator console, queried straight from Workers
// Analytics Engine's SQL API rather than through the Worker's own binding
// (which can only write, never read). Every column reference goes through
// ANALYTICS_COLUMNS so this never drifts from what writeRequestEvent logs.
import { ANALYTICS_COLUMNS, ANALYTICS_DATASET } from "./analytics.ts";
import type { Env } from "../core/env.ts";

export interface AnalyticsCount {
  readonly label: string;
  readonly requests: number;
}

export interface AnalyticsDailyPoint {
  readonly date: string;
  readonly requests: number;
  /**
   * Count of distinct (country, device) combinations seen that day. The
   * dataset keeps no client identifier by design (see analytics.ts), so this
   * is a proxy for traffic diversity, not a visitor count, and the console
   * must label it as such.
   */
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

const TOP_LIMIT = 10;

interface AnalyticsQueryMetaColumn {
  readonly name: string;
  readonly type: string;
}

interface AnalyticsQueryResponse {
  readonly meta: readonly AnalyticsQueryMetaColumn[];
  readonly data: readonly Record<string, unknown>[];
  readonly rows: number;
}

function isMetaColumn(value: unknown): value is AnalyticsQueryMetaColumn {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.type === "string";
}

function isAnalyticsQueryResponse(value: unknown): value is AnalyticsQueryResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.meta) &&
    record.meta.every(isMetaColumn) &&
    Array.isArray(record.data) &&
    record.data.every((row) => typeof row === "object" && row !== null && !Array.isArray(row)) &&
    typeof record.rows === "number"
  );
}

/** Analytics Engine's SQL API stringifies some numeric columns; accept either. */
function numberField(row: Record<string, unknown>, name: string): number {
  const value = row[name];
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function stringField(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  return typeof value === "string" ? value : "";
}

async function runQuery(
  accountId: string,
  token: string,
  sql: string,
): Promise<AnalyticsQueryResponse> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: sql },
  );
  if (!response.ok) {
    throw new Error(`Analytics Engine SQL query failed with status ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isAnalyticsQueryResponse(body)) {
    throw new Error("Analytics Engine SQL query returned an unexpected shape");
  }
  return body;
}

function windowClause(days: number): string {
  return `timestamp > NOW() - INTERVAL '${days}' DAY`;
}

function topCountsSql(column: string, days: number, excludeEmpty: boolean): string {
  const filter = excludeEmpty ? ` AND ${column} != ''` : "";
  return `SELECT ${column} AS label, SUM(_sample_interval) AS requests FROM ${ANALYTICS_DATASET} WHERE ${windowClause(days)}${filter} GROUP BY label ORDER BY requests DESC LIMIT ${TOP_LIMIT}`;
}

function dailyContextSql(days: number): string {
  return `SELECT formatDateTime(timestamp, '%Y-%m-%d') AS day, ${ANALYTICS_COLUMNS.country} AS country, ${ANALYTICS_COLUMNS.device} AS device, SUM(_sample_interval) AS requests FROM ${ANALYTICS_DATASET} WHERE ${windowClause(days)} GROUP BY day, country, device ORDER BY day`;
}

function totalsSql(days: number): string {
  return `SELECT SUM(_sample_interval) AS requests, quantileExactWeighted(0.5)(${ANALYTICS_COLUMNS.durationMs}, _sample_interval) AS p50, quantileExactWeighted(0.95)(${ANALYTICS_COLUMNS.durationMs}, _sample_interval) AS p95, SUM(_sample_interval * if(${ANALYTICS_COLUMNS.status} >= 400, 1, 0)) AS errors FROM ${ANALYTICS_DATASET} WHERE ${windowClause(days)}`;
}

function dailyPointsFrom(rows: readonly Record<string, unknown>[]): readonly AnalyticsDailyPoint[] {
  const byDay = new Map<string, { requests: number; distinctContexts: number }>();
  for (const row of rows) {
    const date = stringField(row, "day");
    if (date.length === 0) continue;
    const accumulator = byDay.get(date) ?? { requests: 0, distinctContexts: 0 };
    accumulator.requests += numberField(row, "requests");
    accumulator.distinctContexts += 1;
    byDay.set(date, accumulator);
  }
  return [...byDay.entries()]
    .map(([date, point]) => ({ date, ...point }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function countsFrom(rows: readonly Record<string, unknown>[]): readonly AnalyticsCount[] {
  return rows.map((row) => ({ label: stringField(row, "label"), requests: numberField(row, "requests") }));
}

/**
 * Traffic over the last `days` days, or the unconfigured shape when the
 * account id or token secret is absent. Never throws for that case, so the
 * console can say "Analytics is not configured" instead of erroring.
 */
export type AnalyticsEnv = Pick<Env, "CF_ACCOUNT_ID" | "CF_ANALYTICS_TOKEN">;

export async function analyticsSummary(env: AnalyticsEnv, days: number): Promise<AnalyticsSummary> {
  const accountId = env.CF_ACCOUNT_ID;
  const token = env.CF_ANALYTICS_TOKEN;
  if (accountId === undefined || accountId.length === 0 || token === undefined || token.length === 0) {
    return { configured: false };
  }

  const [dailyRows, routeRows, countryRows, deviceRows, referrerRows, totalsRows] = await Promise.all([
    runQuery(accountId, token, dailyContextSql(days)),
    runQuery(accountId, token, topCountsSql(ANALYTICS_COLUMNS.route, days, false)),
    runQuery(accountId, token, topCountsSql(ANALYTICS_COLUMNS.country, days, true)),
    runQuery(accountId, token, topCountsSql(ANALYTICS_COLUMNS.device, days, false)),
    runQuery(accountId, token, topCountsSql(ANALYTICS_COLUMNS.referrer, days, true)),
    runQuery(accountId, token, totalsSql(days)),
  ]);

  const totals = totalsRows.data[0] ?? {};
  const requests = numberField(totals, "requests");
  const errors = numberField(totals, "errors");

  return {
    configured: true,
    days,
    totalRequests: requests,
    errorRate: requests > 0 ? errors / requests : 0,
    durationP50Ms: numberField(totals, "p50"),
    durationP95Ms: numberField(totals, "p95"),
    daily: dailyPointsFrom(dailyRows.data),
    topRoutes: countsFrom(routeRows.data),
    topCountries: countsFrom(countryRows.data),
    deviceSplit: countsFrom(deviceRows.data),
    referrers: countsFrom(referrerRows.data),
  };
}
