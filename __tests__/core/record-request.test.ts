import { describe, expect, test } from "bun:test";
import { buildManifest } from "../../src/core/manifest.ts";
import {
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  parseRecordRequest,
  parseStartRequest,
} from "../../src/core/record-request.ts";
import { ContractViolation } from "../../src/core/errors.ts";
import type {
  ManifestFields,
  Opening,
  Pairing,
  RecordRequest,
  SeasonConfig,
} from "../../src/core/types.ts";

const MANIFEST_FIELDS: ManifestFields = {
  name: "record-request-player",
  model: "test-model",
  playstyle: "Control the centre.",
  strategies: ["develop"],
  features: ["materialBalance"],
  historyPlies: 8,
  fallback: "first-legal",
  budget: { maxMs: 750 },
  hierarchical: false,
};

const OPENING: Opening = {
  id: "initial-position",
  name: "Initial position",
  moves: [],
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
};

const CONFIG: SeasonConfig = {
  seasonId: "record-request-season",
  seed: "deterministic-seed",
  competitors: [buildManifest(MANIFEST_FIELDS)],
  openings: [OPENING],
  roundsPerPair: 1,
  maxPlies: 80,
};

const VALID_REQUEST: RecordRequest = {
  config: CONFIG,
  broadcast: { startAt: 1_000_000, msPerPly: 500 },
  concurrency: 5,
};

function validRaw(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(VALID_REQUEST)) as Record<string, unknown>;
}

function rawBroadcast(overrides: Record<string, unknown>): Record<string, unknown> {
  const raw = validRaw();
  const broadcast = raw.broadcast;
  if (typeof broadcast !== "object" || broadcast === null) {
    throw new Error("fixture broadcast must be an object");
  }
  return { ...raw, broadcast: { ...broadcast, ...overrides } };
}

function expectViolation(raw: unknown, fieldPattern: RegExp): void {
  expect(() => parseRecordRequest(raw)).toThrow(ContractViolation);
  expect(() => parseRecordRequest(raw)).toThrow(fieldPattern);
}

describe("parseRecordRequest", () => {
  test("parses a valid body, delegating the season to parseSeasonConfig", () => {
    const raw: unknown = JSON.parse(JSON.stringify(VALID_REQUEST));

    expect(parseRecordRequest(raw)).toEqual(VALID_REQUEST);
  });

  test("defaults concurrency to DEFAULT_CONCURRENCY when absent", () => {
    const raw = validRaw();
    delete raw.concurrency;

    expect(parseRecordRequest(raw).concurrency).toBe(DEFAULT_CONCURRENCY);
  });

  test.each([
    ["zero", 0],
    ["above MAX_CONCURRENCY", MAX_CONCURRENCY + 1],
    ["negative", -1],
    ["not an integer", 2.5],
  ])("rejects a concurrency that is %s", (_description, concurrency) => {
    expectViolation({ ...validRaw(), concurrency }, /concurrency/);
  });

  test("accepts concurrency at the MAX_CONCURRENCY boundary", () => {
    const raw = { ...validRaw(), concurrency: MAX_CONCURRENCY };

    expect(parseRecordRequest(raw).concurrency).toBe(MAX_CONCURRENCY);
  });

  test("accepts concurrency at the lower boundary of one", () => {
    const raw = { ...validRaw(), concurrency: 1 };

    expect(parseRecordRequest(raw).concurrency).toBe(1);
  });

  test.each([
    ["not an integer", 100.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("rejects a broadcast.startAt that is %s", (_description, startAt) => {
    expectViolation(rawBroadcast({ startAt }), /startAt/);
  });

  test.each([
    ["zero", 0],
    ["negative", -500],
    ["not an integer", 100.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects a broadcast.msPerPly that is %s", (_description, msPerPly) => {
    expectViolation(rawBroadcast({ msPerPly }), /msPerPly/);
  });

  test("accepts a startAt of zero and a negative startAt", () => {
    expect(parseRecordRequest(rawBroadcast({ startAt: 0 })).broadcast.startAt).toBe(0);
    expect(parseRecordRequest(rawBroadcast({ startAt: -1_000 })).broadcast.startAt).toBe(
      -1_000,
    );
  });

  test.each([
    ["a string", "not-a-request"],
    ["null", null],
    ["an array", []],
  ])("rejects %s instead of an object", (_description, raw) => {
    expect(() => parseRecordRequest(raw)).toThrow(ContractViolation);
  });

  test("rejects a body missing broadcast", () => {
    const raw = validRaw();
    delete raw.broadcast;

    expectViolation(raw, /broadcast/);
  });

  test("rejects a body missing config", () => {
    const raw = validRaw();
    delete raw.config;

    expectViolation(raw, /config/);
  });

  test("rejects a body whose config is not a valid season config", () => {
    const raw = { ...validRaw(), config: { ...CONFIG, seasonId: 1 } };

    expect(() => parseRecordRequest(raw)).toThrow(ContractViolation);
  });

  test("carries the lineage maps adaptation produces", () => {
    const raw = {
      ...validRaw(),
      parents: { "record-request-player": "v1" },
      rationales: { "record-request-player": "swapped its worst strategy" },
    };

    const parsed = parseRecordRequest(raw);

    expect(parsed.parents).toEqual({ "record-request-player": "v1" });
    expect(parsed.rationales).toEqual({
      "record-request-player": "swapped its worst strategy",
    });
  });

  test("leaves the lineage maps absent when the roster has not changed", () => {
    const parsed = parseRecordRequest(validRaw());

    expect(Object.hasOwn(parsed, "parents")).toBe(false);
    expect(Object.hasOwn(parsed, "rationales")).toBe(false);
  });

  test.each([
    ["parents", { parents: { player: "" } }],
    ["parents", { parents: { player: 7 } }],
    ["parents", { parents: [] }],
    ["rationales", { rationales: { player: null } }],
    ["rationales", { rationales: "why" }],
  ])("rejects a malformed %s map", (field, overrides) => {
    expectViolation({ ...validRaw(), ...overrides }, new RegExp(field));
  });
});

const SECOND_MANIFEST_FIELDS: ManifestFields = {
  name: "record-request-opponent",
  model: "test-model",
  playstyle: "Trade down into a favourable endgame.",
  strategies: ["trade-down"],
  features: ["materialBalance"],
  historyPlies: 8,
  fallback: "first-legal",
  budget: { maxMs: 750 },
  hierarchical: false,
};

const SECOND_OPENING: Opening = {
  id: "second-opening",
  name: "Second opening",
  moves: [],
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
};

const PLAYER_A = buildManifest(MANIFEST_FIELDS);
const PLAYER_B = buildManifest(SECOND_MANIFEST_FIELDS);

const PAIRINGS_CONFIG: SeasonConfig = {
  seasonId: "start-request-season",
  seed: "deterministic-seed",
  competitors: [PLAYER_A, PLAYER_B],
  openings: [OPENING, SECOND_OPENING],
  roundsPerPair: 1,
  maxPlies: 80,
};

const VALID_PAIRING: Pairing = {
  gameId: "start-request-season:r0m0:g1",
  white: { name: PLAYER_A.name, version: PLAYER_A.version },
  black: { name: PLAYER_B.name, version: PLAYER_B.version },
  openingId: OPENING.id,
};

function validPairingsRaw(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(PAIRINGS_CONFIG)) as Record<string, unknown>;
}

function expectStartViolation(raw: unknown, fieldPattern: RegExp): void {
  expect(() => parseStartRequest(raw)).toThrow(ContractViolation);
  expect(() => parseStartRequest(raw)).toThrow(fieldPattern);
}

describe("parseStartRequest", () => {
  test("parses a bare season config with no pairings field, pairings left absent", () => {
    const raw = validPairingsRaw();

    const parsed = parseStartRequest(raw);

    expect(parsed.config).toEqual(PAIRINGS_CONFIG);
    expect(Object.hasOwn(parsed, "pairings")).toBe(false);
  });

  test("parses explicit pairings alongside the season config", () => {
    const raw = { ...validPairingsRaw(), pairings: [VALID_PAIRING] };

    const parsed = parseStartRequest(raw);

    expect(parsed.pairings).toEqual([VALID_PAIRING]);
  });

  test("rejects a pairing with an empty gameId", () => {
    const raw = { ...validPairingsRaw(), pairings: [{ ...VALID_PAIRING, gameId: "" }] };

    expectStartViolation(raw, /gameId/);
  });

  test("rejects a pairings array with a duplicated gameId", () => {
    const raw = { ...validPairingsRaw(), pairings: [VALID_PAIRING, VALID_PAIRING] };

    expectStartViolation(raw, /duplicated/);
  });

  test("rejects a white ref whose name is not in config.competitors", () => {
    const raw = {
      ...validPairingsRaw(),
      pairings: [{ ...VALID_PAIRING, white: { name: "nobody", version: "v1" } }],
    };

    expectStartViolation(raw, /pairings\.white/);
  });

  test("rejects a black ref whose version does not match the registered competitor", () => {
    const raw = {
      ...validPairingsRaw(),
      pairings: [
        { ...VALID_PAIRING, black: { name: PLAYER_B.name, version: "stale-version" } },
      ],
    };

    expectStartViolation(raw, /pairings\.black/);
  });

  test("rejects an openingId not present in config.openings", () => {
    const raw = {
      ...validPairingsRaw(),
      pairings: [{ ...VALID_PAIRING, openingId: "unknown-opening" }],
    };

    expectStartViolation(raw, /openingId/);
  });

  test("rejects a pairings value that is not an array", () => {
    const raw = { ...validPairingsRaw(), pairings: "not-an-array" };

    expectStartViolation(raw, /pairings/);
  });

  test("rejects a season config that fails its own contract", () => {
    const raw = { ...validPairingsRaw(), seasonId: 1 };

    expect(() => parseStartRequest(raw)).toThrow(ContractViolation);
  });
});
