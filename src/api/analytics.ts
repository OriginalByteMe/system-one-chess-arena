// Request analytics, written to Workers Analytics Engine.
//
// The privacy shape is deliberate and is what the /privacy page promises:
// nothing here identifies a person. No cookie, no client id, no raw IP, no
// full user-agent string, no query string. What is kept is what makes the
// league legible to its operator — which page, which season, which game, from
// which country, on what kind of device, how fast the Worker answered.
import type { Env } from "../core/env.ts";

/** Also the table name in the Analytics Engine SQL API. */
export const ANALYTICS_DATASET = "arena_events";

export type EventKind = "page" | "api";

export interface RequestEvent {
  readonly kind: EventKind;
  /** Route name, never an id-bearing path: "watch", "home", "api.game". */
  readonly route: string;
  readonly seasonId: string;
  readonly gameId: string;
  /** Two-letter country from Cloudflare, or "" when it is unknown. */
  readonly country: string;
  readonly device: DeviceClass;
  /** Referring host only, never the full URL. */
  readonly referrer: string;
  readonly status: number;
  readonly durationMs: number;
  /** 1 when the Worker served this from its own cache decision, else 0. */
  readonly cached: boolean;
}

export type DeviceClass = "mobile" | "tablet" | "desktop" | "bot" | "unknown";

const BOT = /bot|crawler|spider|crawling|headlesschrome|lighthouse|curl|wget/i;
const TABLET = /ipad|tablet|playbook|silk|android(?!.*mobile)/i;
const MOBILE = /mobile|iphone|ipod|android|blackberry|iemobile|opera mini/i;

/** A coarse class, not a fingerprint: four buckets and nothing else is kept. */
export function deviceClass(userAgent: string | null): DeviceClass {
  if (userAgent === null || userAgent === "") return "unknown";
  if (BOT.test(userAgent)) return "bot";
  if (TABLET.test(userAgent)) return "tablet";
  if (MOBILE.test(userAgent)) return "mobile";
  return "desktop";
}

/** The referring host, dropped entirely when it is this site or unparseable. */
export function referrerHost(referer: string | null, self: string): string {
  if (referer === null || referer === "") return "";
  try {
    const host = new URL(referer).hostname;
    return host === self ? "" : host;
  } catch {
    return "";
  }
}

export function countryOf(request: Request): string {
  const country = request.headers.get("CF-IPCountry");
  return country === null || country === "XX" || country === "T1" ? "" : country;
}

/**
 * One datapoint per request. Blobs are the dimensions you group by, doubles
 * the numbers you aggregate, and the index is the cardinality-bounded key
 * Analytics Engine samples on — route, because "how is each page doing" is the
 * question this dataset exists to answer.
 */
export function writeRequestEvent(env: Env, event: RequestEvent): void {
  const dataset = env.ANALYTICS;
  if (dataset === undefined) return;
  dataset.writeDataPoint({
    blobs: [
      event.kind,
      event.route,
      event.seasonId,
      event.gameId,
      event.country,
      event.device,
      event.referrer,
    ],
    doubles: [event.status, event.durationMs, event.cached ? 1 : 0],
    indexes: [event.route],
  });
}

/** Column names in the same order as `writeRequestEvent` writes them. */
export const ANALYTICS_COLUMNS = {
  kind: "blob1",
  route: "blob2",
  seasonId: "blob3",
  gameId: "blob4",
  country: "blob5",
  device: "blob6",
  referrer: "blob7",
  status: "double1",
  durationMs: "double2",
  cached: "double3",
} as const;

/** Names an API request without letting an id into the route dimension. */
export function apiRouteName(pathname: string): string {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments[0] !== "api") return "asset";
  const parts: string[] = ["api"];
  for (let i = 1; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === undefined) continue;
    // Even path positions after a collection name hold ids.
    const isCollection = i % 2 === 1;
    parts.push(isCollection ? segment : ":id");
  }
  return parts.join(".");
}
