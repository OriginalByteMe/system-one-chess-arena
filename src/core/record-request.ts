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

  return { config, broadcast: { startAt, msPerPly }, concurrency };
}
