import { describe, expect, test } from "bun:test";
import { buildManifest } from "../../src/core/manifest.ts";
import {
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  parseRecordRequest,
} from "../../src/core/record-request.ts";
import { ContractViolation } from "../../src/core/errors.ts";
import type {
  ManifestFields,
  Opening,
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
});
