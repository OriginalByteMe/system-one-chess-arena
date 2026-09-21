import { ContractViolation } from "./errors.ts";
import { parseSeasonConfig } from "./season-config.ts";
import type { CompetitorRef, Pairing, RecordRequest, SeasonConfig } from "./types.ts";

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

const START_SUBJECT = "core.recordRequest.parseStartRequest";
const PAIRING_SUBJECT = "core.recordRequest.parsePairings";

function startViolation(detail: string): never {
  throw new ContractViolation(START_SUBJECT, detail);
}

function pairingViolation(detail: string): never {
  throw new ContractViolation(PAIRING_SUBJECT, detail);
}

/** Body accepted by the live start endpoint: a season plus optional explicit games. */
export interface StartRequest {
  readonly config: SeasonConfig;
  /**
   * Explicit games to start, in place of the round-robin `buildPairings`
   * would derive. Needed for a knockout, where each round is a distinct set
   * of games rather than every ordered pair.
   */
  readonly pairings?: readonly Pairing[];
}

function parseCompetitorRef(
  value: unknown,
  field: string,
  knownIdentities: ReadonlySet<string>,
): CompetitorRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    pairingViolation(`${field} must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const name = raw.name;
  const version = raw.version;
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    typeof version !== "string" ||
    version.length === 0
  ) {
    pairingViolation(`${field} must have a non-empty name and version`);
  }
  if (!knownIdentities.has(`${name}\0${version}`)) {
    pairingViolation(`${field} must reference a competitor in config.competitors: ${name}@${version}`);
  }
  return { name, version };
}

/**
 * Validates explicit pairings against a parsed season config.
 *
 * Contract:
 * - Must be an array. Each entry needs a non-empty, unique `gameId`, `white`
 *   and `black` refs naming a competitor (with matching version) present in
 *   `config.competitors`, and an `openingId` present in `config.openings`.
 * - Anything else is a ContractViolation naming the field. This is the same
 *   check `do/game.ts`'s `manifestFor` performs at play time, run early so a
 *   malformed request fails before any game durable object is touched.
 */
export function parsePairings(value: unknown, config: SeasonConfig): readonly Pairing[] {
  if (!Array.isArray(value)) {
    pairingViolation("pairings must be an array");
  }
  const knownIdentities = new Set(
    config.competitors.map((competitor) => `${competitor.name}\0${competitor.version}`),
  );
  const openingIds = new Set(config.openings.map((opening) => opening.id));
  const seenGameIds = new Set<string>();

  return value.map((entry): Pairing => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      pairingViolation("pairings entries must be objects");
    }
    const raw = entry as Record<string, unknown>;
    const gameId = raw.gameId;
    if (typeof gameId !== "string" || gameId.length === 0) {
      pairingViolation("pairings.gameId must be a non-empty string");
    }
    if (seenGameIds.has(gameId)) {
      pairingViolation(`pairings.gameId is duplicated: ${gameId}`);
    }
    seenGameIds.add(gameId);

    const white = parseCompetitorRef(raw.white, "pairings.white", knownIdentities);
    const black = parseCompetitorRef(raw.black, "pairings.black", knownIdentities);

    const openingId = raw.openingId;
    if (typeof openingId !== "string" || !openingIds.has(openingId)) {
      pairingViolation(`pairings.openingId must reference a configured opening: ${String(openingId)}`);
    }

    return { gameId, white, black, openingId };
  });
}

/**
 * Narrows the body of the live start endpoint: a bare season config, with an
 * optional sibling `pairings` field carrying an explicit set of games.
 *
 * Contract:
 * - Delegates the season to parseSeasonConfig once `pairings` (if present)
 *   has been separated out, so the config's exact-key contract is unaffected.
 * - `pairings`, when present, is validated by parsePairings against the
 *   parsed config.
 * - Anything else is a ContractViolation naming the field.
 */
export function parseStartRequest(value: unknown): StartRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    startViolation("expected an object");
  }
  const raw = value as Record<string, unknown>;
  const { pairings: pairingsRaw, ...configRaw } = raw;
  const config = parseSeasonConfig(configRaw);

  if (!("pairings" in raw)) {
    return { config };
  }
  return { config, pairings: parsePairings(pairingsRaw, config) };
}
