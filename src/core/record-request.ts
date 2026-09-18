import { NotImplemented } from "../core/errors.ts";
import type { RecordRequest } from "./types.ts";

/** Games recorded at once when the body does not say. */
export const DEFAULT_CONCURRENCY: number = 10;

/** Upper bound, until the provider's rate limit has actually been measured. */
export const MAX_CONCURRENCY: number = 100;

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
  void value;
  throw new NotImplemented("core.recordRequest.parseRecordRequest");
}
