import { ContractViolation } from "./errors.ts";
import { parseSeasonConfig } from "./season-config.ts";
import type { RecordRequest } from "./types.ts";

/** Games recorded at once when the body does not say. */
export const DEFAULT_CONCURRENCY: number = 10;

/** Upper bound, until the provider's rate limit has actually been measured. */
export const MAX_CONCURRENCY: number = 100;

const SUBJECT = "core.recordRequest.parseRecordRequest";

function violation(detail: string): never {
  throw new ContractViolation(SUBJECT, detail);
}

/**
 * Narrows an admin record request.
 *
 * Contract:
 * - Delegates the season to parseSeasonConfig, so one parser owns that shape.
 * - `broadcast.startAt` must be a finite integer and `msPerPly` a positive
 *   integer.
 * - `concurrency` defaults to DEFAULT_CONCURRENCY and must be between 1 and
 *   MAX_CONCURRENCY.
 * - `parents` and `rationales` are optional maps of competitor name to string,
 *   carrying lineage from adaptation into registration.
 * - Anything else is a ContractViolation with a message naming the field.
 */
export function parseRecordRequest(value: unknown): RecordRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    violation("expected an object");
  }
  const raw = value as Record<string, unknown>;

  if (!("config" in raw)) {
    violation("missing config");
  }
  const config = parseSeasonConfig(raw.config);

  if (!("broadcast" in raw)) {
    violation("missing broadcast");
  }
  const broadcastRaw = raw.broadcast;
  if (typeof broadcastRaw !== "object" || broadcastRaw === null || Array.isArray(broadcastRaw)) {
    violation("broadcast must be an object");
  }
  const startAt: unknown = Reflect.get(broadcastRaw, "startAt");
  const msPerPly: unknown = Reflect.get(broadcastRaw, "msPerPly");
  if (typeof startAt !== "number" || !Number.isFinite(startAt) || !Number.isInteger(startAt)) {
    violation("broadcast.startAt must be a finite integer");
  }
  if (typeof msPerPly !== "number" || !Number.isInteger(msPerPly) || msPerPly <= 0) {
    violation("broadcast.msPerPly must be a positive integer");
  }

  let concurrency = DEFAULT_CONCURRENCY;
  if ("concurrency" in raw) {
    const rawConcurrency = raw.concurrency;
    if (
      typeof rawConcurrency !== "number" ||
      !Number.isInteger(rawConcurrency) ||
      rawConcurrency < 1 ||
      rawConcurrency > MAX_CONCURRENCY
    ) {
      violation("concurrency must be an integer between 1 and MAX_CONCURRENCY");
    }
    concurrency = rawConcurrency;
  }

  const parents = parseNameMap(raw.parents, "parents");
  const rationales = parseNameMap(raw.rationales, "rationales");

  return {
    config,
    broadcast: { startAt, msPerPly },
    concurrency,
    ...(parents === undefined ? {} : { parents }),
    ...(rationales === undefined ? {} : { rationales }),
  };
}

/**
 * An optional map of competitor name to a single string. Absent stays absent,
 * so an unchanged roster does not have to send empty objects.
 */
function parseNameMap(
  value: unknown,
  field: string,
): { readonly [competitor: string]: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    violation(`${field} must be an object`);
  }
  const entries = Object.entries(value);
  for (const [name, entry] of entries) {
    if (typeof entry !== "string" || entry.length === 0) {
      violation(`${field}.${name} must be a non-empty string`);
    }
  }
  return Object.fromEntries(
    entries.map(([name, entry]) => [name, String(entry)]),
  );
}
