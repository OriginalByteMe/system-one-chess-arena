import {
  env,
  listDurableObjectIds,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Env } from "../src/core/env.ts";
import type {
  Colour,
  CompetitorManifest,
  GameResult,
  Opening,
  Pairing,
  SeasonConfig,
  SeasonStandings,
} from "../src/core/types.ts";
import {
  GameDurableObject,
  type GameSnapshot,
} from "../src/do/game.ts";
import { SeasonDurableObject } from "../src/do/season.ts";

const MATE_IN_ONE_OPENING: Opening = {
  id: "season-mate-in-one",
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

const CONFIG: SeasonConfig = {
  seasonId: "season-do-contract",
  seed: "season-do-seed",
  competitors: [ALPHA, BETA],
  openings: [MATE_IN_ONE_OPENING],
  roundsPerPair: 1,
  maxPlies: 20,
};

const PROJECTION_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS competitor_versions (season_id TEXT NOT NULL, competitor TEXT NOT NULL, version TEXT NOT NULL, manifest_json TEXT NOT NULL, PRIMARY KEY (season_id, competitor, version))",
  "CREATE TABLE IF NOT EXISTS games (season_id TEXT NOT NULL, game_id TEXT NOT NULL, white_competitor TEXT NOT NULL, white_version TEXT NOT NULL, black_competitor TEXT NOT NULL, black_version TEXT NOT NULL, opening_id TEXT NOT NULL, result TEXT NOT NULL, reason TEXT NOT NULL, plies INTEGER NOT NULL, pgn TEXT NOT NULL, PRIMARY KEY (season_id, game_id))",
  "CREATE TABLE IF NOT EXISTS strategy_outcomes (season_id TEXT NOT NULL, competitor TEXT NOT NULL, version TEXT NOT NULL, strategy TEXT NOT NULL, picks INTEGER NOT NULL, score REAL NOT NULL, avg_confidence REAL NOT NULL, PRIMARY KEY (season_id, competitor, version, strategy))",
] as const;

const arenaEnv = env as Env;

interface ProjectionCounts {
  readonly games: number;
  readonly outcomes: number;
}

interface StrategyProjectionRow {
  readonly competitor: string;
  readonly version: string;
  readonly strategy: string;
  readonly picks: number;
  readonly score: number;
  readonly avgConfidence: number;
}

interface StrategyAccumulator {
  competitor: string;
  version: string;
  strategy: string;
  picks: number;
  score: number;
  confidenceTotal: number;
}

function gameNamespace(): DurableObjectNamespace<GameDurableObject> {
  return arenaEnv.GAME as DurableObjectNamespace<GameDurableObject>;
}

function seasonNamespace(): DurableObjectNamespace<SeasonDurableObject> {
  return arenaEnv.SEASON as DurableObjectNamespace<SeasonDurableObject>;
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

async function startSeason(
  objectName: string,
): Promise<DurableObjectStub<SeasonDurableObject>> {
  const namespace = seasonNamespace();
  const stub = namespace.get(namespace.idFromName(objectName));
  await runInDurableObject(stub, (instance: SeasonDurableObject) =>
    instance.start(CONFIG),
  );
  return stub;
}

async function gameStubs(): Promise<
  readonly DurableObjectStub<GameDurableObject>[]
> {
  const namespace = gameNamespace();
  const ids = await listDurableObjectIds(namespace);
  return ids.map((id) => namespace.get(id));
}

async function storedPairing(
  stub: DurableObjectStub<GameDurableObject>,
): Promise<Pairing> {
  const pairing = await runInDurableObject(stub, (_instance, state) =>
    state.storage.get<Pairing>("pairing"),
  );
  if (pairing === undefined) {
    throw new Error("Game Durable Object did not persist its pairing");
  }
  return pairing;
}

async function gameWithWhite(
  competitor: string,
): Promise<DurableObjectStub<GameDurableObject>> {
  for (const stub of await gameStubs()) {
    const pairing = await storedPairing(stub);
    if (pairing.white.name === competitor) return stub;
  }
  throw new Error(`no game has ${competitor} as white`);
}

async function gameSnapshot(
  stub: DurableObjectStub<GameDurableObject>,
): Promise<GameSnapshot> {
  return runInDurableObject(stub, (instance: GameDurableObject) =>
    instance.snapshot(),
  );
}

async function finishEveryGame(): Promise<readonly GameSnapshot[]> {
  const snapshots: GameSnapshot[] = [];
  for (const stub of await gameStubs()) {
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    snapshots.push(await gameSnapshot(stub));
  }
  return snapshots;
}

function compactStandings(standings: SeasonStandings) {
  return standings.rows
    .map((row) => ({
      competitor: row.competitor,
      version: row.version,
      games: row.games,
      score: row.score,
      elo: row.elo,
    }))
    .sort((left, right) => left.competitor.localeCompare(right.competitor));
}

async function projectionCounts(): Promise<ProjectionCounts> {
  const row = await arenaEnv.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM games) AS games,
       (SELECT COUNT(*) FROM strategy_outcomes) AS outcomes`,
  ).first<ProjectionCounts>();
  if (row === null) throw new Error("projection count query returned no row");
  return row;
}

function scoreFor(result: GameResult, colour: Colour): number {
  if (result === "draw") return 0.5;
  return result === colour ? 1 : 0;
}

function recountStrategies(
  snapshots: readonly GameSnapshot[],
): readonly StrategyProjectionRow[] {
  const totals = new Map<string, StrategyAccumulator>();
  for (const snapshot of snapshots) {
    if (snapshot.finished === undefined) {
      throw new Error("cannot recount an unfinished game");
    }
    for (const decision of snapshot.decisions) {
      const key = `${decision.competitor}\u0000${decision.version}\u0000${decision.strategy}`;
      const total = totals.get(key) ?? {
        competitor: decision.competitor,
        version: decision.version,
        strategy: decision.strategy,
        picks: 0,
        score: 0,
        confidenceTotal: 0,
      };
      total.picks += 1;
      total.score += scoreFor(snapshot.finished.result, decision.colour);
      total.confidenceTotal += decision.confidence ?? 0;
      totals.set(key, total);
    }
  }

  return [...totals.values()]
    .map((total) => ({
      competitor: total.competitor,
      version: total.version,
      strategy: total.strategy,
      picks: total.picks,
      score: total.score,
      avgConfidence: total.confidenceTotal / total.picks,
    }))
    .sort((left, right) => left.competitor.localeCompare(right.competitor));
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await reset();
  await arenaEnv.DB.batch(
    PROJECTION_SCHEMA.map((statement) => arenaEnv.DB.prepare(statement)),
  );
});

describe("SeasonDurableObject", () => {
  test("start creates exactly one Game object for every ordered pairing", async () => {
    await startSeason("season-start-pairings");

    const ids = await listDurableObjectIds(gameNamespace());
    const pairings = await Promise.all(
      (await gameStubs()).map((stub) => storedPairing(stub)),
    );
    const compactPairings = pairings
      .map((pairing) => ({
        white: pairing.white.name,
        black: pairing.black.name,
        openingId: pairing.openingId,
      }))
      .sort((left, right) => left.white.localeCompare(right.white));

    expect(ids).toHaveLength(2);
    expect(new Set(ids.map((id) => id.toString())).size).toBe(2);
    expect(compactPairings).toEqual([
      { white: "alpha", black: "beta", openingId: "season-mate-in-one" },
      { white: "beta", black: "alpha", openingId: "season-mate-in-one" },
    ]);
  });

  test("standings before completion include the finished game and exclude the unfinished game", async () => {
    mockMateProvider();
    const season = await startSeason("season-partial-standings");
    const alphaWhite = await gameWithWhite("alpha");

    expect(await runDurableObjectAlarm(alphaWhite)).toBe(true);

    const standings = await runInDurableObject(
      season,
      (instance: SeasonDurableObject) => instance.standings(),
    );
    expect(compactStandings(standings)).toEqual([
      {
        competitor: "alpha",
        version: "alpha-v1",
        games: 1,
        score: 1,
        elo: 1512,
      },
      {
        competitor: "beta",
        version: "beta-v1",
        games: 1,
        score: 0,
        elo: 1488,
      },
    ]);
  });

  test("complete is idempotent and a second call does not count games or ratings twice", async () => {
    mockMateProvider();
    const season = await startSeason("season-idempotent-complete");
    await finishEveryGame();

    const first = await runInDurableObject(
      season,
      (instance: SeasonDurableObject) => instance.complete(),
    );
    const countsAfterFirst = await projectionCounts();
    const second = await runInDurableObject(
      season,
      (instance: SeasonDurableObject) => instance.complete(),
    );
    const countsAfterSecond = await projectionCounts();

    expect(
      compactStandings(second).map(({ competitor, version, games, score }) => ({
        competitor,
        version,
        games,
        score,
      })),
    ).toEqual([
      { competitor: "alpha", version: "alpha-v1", games: 2, score: 1 },
      { competitor: "beta", version: "beta-v1", games: 2, score: 1 },
    ]);
    expect(compactStandings(second)).toEqual(compactStandings(first));
    expect(countsAfterFirst).toEqual({ games: 2, outcomes: 2 });
    expect(countsAfterSecond).toEqual({ games: 2, outcomes: 2 });
  });

  test("a D1 projection failure leaves authoritative Durable Object standings intact", async () => {
    mockMateProvider();
    const season = await startSeason("season-d1-failure");
    await finishEveryGame();
    await arenaEnv.DB.prepare("DROP TABLE strategy_outcomes").run();
    await arenaEnv.DB.prepare(
      "CREATE TABLE strategy_outcomes (season_id TEXT NOT NULL, competitor TEXT NOT NULL, version TEXT NOT NULL, strategy TEXT NOT NULL, picks INTEGER NOT NULL CHECK (picks < 0), score REAL NOT NULL, avg_confidence REAL NOT NULL, PRIMARY KEY (season_id, competitor, version, strategy))",
    ).run();

    await expect(
      runInDurableObject(season, (instance: SeasonDurableObject) =>
        instance.complete(),
      ),
    ).rejects.toThrow();

    const authoritative = await runInDurableObject(
      season,
      (instance: SeasonDurableObject) => instance.standings(),
    );
    expect(
      compactStandings(authoritative).map(
        ({ competitor, version, games, score }) => ({
          competitor,
          version,
          games,
          score,
        }),
      ),
    ).toEqual([
      { competitor: "alpha", version: "alpha-v1", games: 2, score: 1 },
      { competitor: "beta", version: "beta-v1", games: 2, score: 1 },
    ]);
  });

  test("D1 per-strategy outcomes equal a recount of the Game objects' decision records", async () => {
    mockMateProvider();
    const season = await startSeason("season-strategy-projection");
    const snapshots = await finishEveryGame();
    await runInDurableObject(season, (instance: SeasonDurableObject) =>
      instance.complete(),
    );

    const projection = await arenaEnv.DB.prepare(
      `SELECT competitor, version, strategy, picks, score,
              avg_confidence AS avgConfidence
         FROM strategy_outcomes
        WHERE season_id = ?
        ORDER BY competitor, version, strategy`,
    )
      .bind(CONFIG.seasonId)
      .all<StrategyProjectionRow>();
    const projected = projection.results;
    const recounted = recountStrategies(snapshots);

    expect(projected).toEqual(recounted);
    expect(projected).toEqual([
      {
        competitor: "alpha",
        version: "alpha-v1",
        strategy: "direct",
        picks: 1,
        score: 1,
        avgConfidence: 0.75,
      },
      {
        competitor: "beta",
        version: "beta-v1",
        strategy: "direct",
        picks: 1,
        score: 1,
        avgConfidence: 0.75,
      },
    ]);
  });
});
