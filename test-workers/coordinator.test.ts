import { env, reset, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Env } from "../src/core/env.ts";
import type {
  CompetitorManifest,
  GameSummary,
  Opening,
  RecordRequest,
  SeasonConfig,
} from "../src/core/types.ts";
import { SeasonDurableObject } from "../src/do/season.ts";

const MATE_IN_ONE_OPENING: Opening = {
  id: "coordinator-mate-in-one",
  name: "White mates with Qg7",
  moves: [],
  fen: "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1",
};

const ALPHA: CompetitorManifest = {
  name: "alpha",
  version: "alpha-v1",
  model: "llm-contract",
  playstyle: "Choose the contract move.",
  strategies: ["direct"],
  features: [],
  historyPlies: 8,
  fallback: "first-legal",
  budget: { maxMs: 1_000 },
  hierarchical: false,
};

const BETA: CompetitorManifest = {
  name: "beta",
  version: "beta-v1",
  model: "llm-contract",
  playstyle: "Choose the contract move.",
  strategies: ["direct"],
  features: [],
  historyPlies: 8,
  fallback: "first-legal",
  budget: { maxMs: 1_000 },
  hierarchical: false,
};

const GAMMA: CompetitorManifest = {
  name: "gamma",
  version: "gamma-v1",
  model: "llm-contract",
  playstyle: "Choose the contract move.",
  strategies: ["direct"],
  features: [],
  historyPlies: 8,
  fallback: "first-legal",
  budget: { maxMs: 1_000 },
  hierarchical: false,
};

// 3 competitors, one round: 6 ordered pairings (alpha/beta/gamma round robin).
// The literal count in the assignment ("5 games") is unreachable: buildPairings
// produces n*(n-1)*roundsPerPair ordered pairs, which is always even. Flagged
// to Main; 6 games covers the same concurrency/staggering/idempotency ground.
function configFor(seasonId: string): SeasonConfig {
  return {
    seasonId,
    seed: `${seasonId}-seed`,
    competitors: [ALPHA, BETA, GAMMA],
    openings: [MATE_IN_ONE_OPENING],
    roundsPerPair: 1,
    maxPlies: 20,
  };
}

const GAME_COUNT = 6;

function requestFor(seasonId: string, concurrency = 2): RecordRequest {
  return {
    config: configFor(seasonId),
    broadcast: { startAt: Date.now() + 1_000, msPerPly: 4_000 },
    concurrency,
  };
}

const arenaEnv = env as Env;

function seasonStub(seasonId: string): DurableObjectStub<SeasonDurableObject> {
  const namespace = arenaEnv.SEASON as DurableObjectNamespace<SeasonDurableObject>;
  return namespace.get(namespace.idFromName(seasonId));
}

function providerResponse(move: string): Response {
  return Response.json({
    kind: "chat",
    text: JSON.stringify({
      move,
      strategy: "direct",
      confidence: 0.75,
    }),
  });
}

function mockMateProvider() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(providerResponse("f7g7")));
}

async function recordSeason(
  stub: DurableObjectStub<SeasonDurableObject>,
  request: RecordRequest,
): Promise<readonly GameSummary[]> {
  return runInDurableObject(stub, (instance: SeasonDurableObject) =>
    instance.record(request),
  );
}

interface CountRow {
  readonly n: number;
}

async function countRowsWhere(
  table: string,
  column: string,
  value: string,
): Promise<number> {
  const row = await arenaEnv.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`,
  )
    .bind(value)
    .first<CountRow>();
  if (row === null) throw new Error(`no count row for ${table}`);
  return row.n;
}

interface BroadcastRow {
  readonly broadcast_start_at: number | null;
}

async function broadcastStartTimes(seasonId: string): Promise<readonly number[]> {
  const result = await arenaEnv.DB.prepare(
    "SELECT broadcast_start_at FROM games WHERE season_id = ?",
  )
    .bind(seasonId)
    .all<BroadcastRow>();
  return result.results.map((row) => {
    if (row.broadcast_start_at === null) {
      throw new Error("game is missing a broadcast_start_at");
    }
    return row.broadcast_start_at;
  });
}

function sortedGameIds(summaries: readonly GameSummary[]): readonly string[] {
  return summaries.map((summary) => summary.gameId).toSorted((left, right) =>
    left.localeCompare(right),
  );
}

// vitest-pool-workers' D1 binding starts schemaless; migrations/*.sql are not
// auto-applied. Final phase-2 shape written directly (no ALTERs) so this stays
// idempotent no matter whether reset() drops tables or only clears rows.
const SCHEMA_STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS competitor_versions (season_id TEXT NOT NULL, competitor TEXT NOT NULL, version TEXT NOT NULL, manifest_json TEXT NOT NULL, parent_version TEXT, traits_json TEXT, rationale TEXT, PRIMARY KEY (season_id, competitor, version))",
  "CREATE TABLE IF NOT EXISTS games (season_id TEXT NOT NULL, game_id TEXT NOT NULL, white_competitor TEXT NOT NULL, white_version TEXT NOT NULL, black_competitor TEXT NOT NULL, black_version TEXT NOT NULL, opening_id TEXT NOT NULL, result TEXT NOT NULL, reason TEXT NOT NULL, plies INTEGER NOT NULL, pgn TEXT NOT NULL, match_id TEXT, broadcast_start_at INTEGER, ms_per_ply INTEGER, PRIMARY KEY (season_id, game_id))",
  "CREATE TABLE IF NOT EXISTS decisions (season_id TEXT NOT NULL, game_id TEXT NOT NULL, ply INTEGER NOT NULL, competitor TEXT NOT NULL, version TEXT NOT NULL, colour TEXT NOT NULL, fen TEXT NOT NULL, legal_move_count INTEGER NOT NULL, move TEXT NOT NULL, strategy TEXT NOT NULL, confidence REAL, distribution_json TEXT, latency_ms INTEGER NOT NULL, tokens_in INTEGER, tokens_out INTEGER, fallback TEXT, features_seen_json TEXT NOT NULL, idempotency_key TEXT NOT NULL, PRIMARY KEY (season_id, game_id, ply))",
  "CREATE INDEX IF NOT EXISTS decisions_by_competitor ON decisions (competitor, season_id, game_id, ply)",
  "CREATE TABLE IF NOT EXISTS competitors (name TEXT NOT NULL PRIMARY KEY, first_season_id TEXT NOT NULL)",
] as const;

beforeEach(async () => {
  vi.restoreAllMocks();
  await reset();
  await arenaEnv.DB.batch(
    SCHEMA_STATEMENTS.map((statement) => arenaEnv.DB.prepare(statement)),
  );
});

describe("SeasonDurableObject.record", () => {
  test("runs at most the requested concurrency at once and records every game", async () => {
    const seasonId = "coordinator-concurrency";
    let inFlight = 0;
    let maxInFlight = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
      return providerResponse("f7g7");
    });

    const summaries = await recordSeason(
      seasonStub(seasonId),
      requestFor(seasonId, 2),
    );

    expect(summaries).toHaveLength(GAME_COUNT);
    expect(new Set(summaries.map((summary) => summary.gameId)).size).toBe(
      GAME_COUNT,
    );
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  test("stages each game's broadcast start later than the last, derived from the request schedule", async () => {
    const seasonId = "coordinator-staggered";
    mockMateProvider();
    const request = requestFor(seasonId, 2);

    await recordSeason(seasonStub(seasonId), request);

    const startTimes = await broadcastStartTimes(seasonId);
    expect(startTimes).toHaveLength(GAME_COUNT);
    const sorted = [...startTimes].sort((left, right) => left - right);
    expect(new Set(sorted).size).toBe(GAME_COUNT);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index]).toBeGreaterThan(sorted[index - 1] ?? -Infinity);
    }
    expect(sorted[0]).toBeGreaterThanOrEqual(request.broadcast.startAt);
  });

  test("re-running record skips already-recorded games and returns the same summaries with no new provider calls", async () => {
    const seasonId = "coordinator-rerun-idempotent";
    const providerSpy = mockMateProvider();
    const request = requestFor(seasonId, 2);
    const stub = seasonStub(seasonId);

    const first = await recordSeason(stub, request);
    expect(first).toHaveLength(GAME_COUNT);
    expect(providerSpy).toHaveBeenCalledTimes(GAME_COUNT);

    const second = await recordSeason(stub, request);

    expect(providerSpy).toHaveBeenCalledTimes(GAME_COUNT);
    expect(sortedGameIds(second)).toEqual(sortedGameIds(first));
    expect([...second].sort((left, right) => left.gameId.localeCompare(right.gameId))).toEqual(
      [...first].sort((left, right) => left.gameId.localeCompare(right.gameId)),
    );
  });

  test("projects one decisions row per decision, one games row per game, and one competitors row per name", async () => {
    const seasonId = "coordinator-projection-counts";
    mockMateProvider();
    const request = requestFor(seasonId, 2);

    await recordSeason(seasonStub(seasonId), request);

    expect(await countRowsWhere("games", "season_id", seasonId)).toBe(
      GAME_COUNT,
    );
    // Every game here is a mate-in-one: exactly one decision per game.
    expect(await countRowsWhere("decisions", "season_id", seasonId)).toBe(
      GAME_COUNT,
    );
    expect(
      await countRowsWhere("competitors", "first_season_id", seasonId),
    ).toBe(3);
  });

  test("a single game failing does not abandon the rest of the season", async () => {
    const seasonId = "coordinator-partial-failure";
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call += 1;
      if (call === 3) {
        return Promise.reject(new Error("provider unavailable"));
      }
      return Promise.resolve(providerResponse("f7g7"));
    });

    await recordSeason(seasonStub(seasonId), requestFor(seasonId, 2)).catch(
      () => undefined,
    );

    expect(await countRowsWhere("games", "season_id", seasonId)).toBe(
      GAME_COUNT - 1,
    );
    expect(await countRowsWhere("decisions", "season_id", seasonId)).toBe(
      GAME_COUNT - 1,
    );
  });

  test("a season whose config differs from an already-started one is refused, matching start", async () => {
    const seasonId = "coordinator-config-mismatch";
    mockMateProvider();
    const stub = seasonStub(seasonId);
    const first = requestFor(seasonId, 2);
    const second: RecordRequest = {
      ...first,
      config: { ...first.config, roundsPerPair: 2 },
    };

    await recordSeason(stub, first);

    await expect(recordSeason(stub, second)).rejects.toThrow(
      "season has already been started with another config",
    );
  });
});
