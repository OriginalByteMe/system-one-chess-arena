import { env, reset, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Env } from "../src/core/env.ts";
import { buildManifest } from "../src/core/manifest.ts";
import type {
  CompetitorManifest,
  ManifestFields,
  Pairing,
  SeasonConfig,
} from "../src/core/types.ts";
import worker from "../src/index.ts";

const ORIGIN = "https://arena.test";
const INITIAL_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const OPENING = {
  id: "route-initial-position",
  name: "Initial position",
  moves: [],
  fen: INITIAL_FEN,
} as const;

function manifest(name: string): CompetitorManifest {
  const fields: ManifestFields = {
    name,
    model: "route-test-model",
    playstyle: "Exercise the Worker route contract.",
    strategies: ["direct"],
    features: [],
    historyPlies: 8,
    fallback: "first-legal",
    budget: { maxMs: 1_000 },
    hierarchical: false,
  };
  return buildManifest(fields);
}

const ALPHA = manifest("route-alpha");
const BETA = manifest("route-beta");
const arenaEnv = env as Env;

function configFor(seasonId: string): SeasonConfig {
  return {
    seasonId,
    seed: "route-test-seed",
    competitors: [ALPHA, BETA],
    openings: [OPENING],
    roundsPerPair: 1,
    maxPlies: 80,
  };
}

const ADMIN_TOKEN = "route-test-admin-token";

/** The admin routes spend provider money, so every POST carries the bearer. */
function adminHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${ADMIN_TOKEN}`,
  };
}

function startSeason(
  config: SeasonConfig,
  pathSeasonId = config.seasonId,
): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/seasons/${pathSeasonId}/start`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(config),
  });
}

function pairing(
  config: SeasonConfig,
  white: CompetitorManifest,
  black: CompetitorManifest,
): Pairing {
  return {
    gameId: `${config.seasonId}:0:${white.name}@${white.version}:${black.name}@${black.version}`,
    white: { name: white.name, version: white.version },
    black: { name: black.name, version: black.version },
    openingId: OPENING.id,
  };
}

// Starting a season files its competitors, so the route suite needs the tables
// that write touches. The pool's D1 binding starts schemaless.
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS competitor_versions (season_id TEXT NOT NULL, competitor TEXT NOT NULL, version TEXT NOT NULL, manifest_json TEXT NOT NULL, parent_version TEXT, traits_json TEXT, rationale TEXT, PRIMARY KEY (season_id, competitor, version))",
  "CREATE TABLE IF NOT EXISTS competitors (name TEXT NOT NULL PRIMARY KEY, first_season_id TEXT NOT NULL)",
] as const;

beforeEach(async () => {
  vi.restoreAllMocks();
  Object.assign(env, { ARENA_ADMIN_TOKEN: ADMIN_TOKEN });
  await reset();
  await env.DB.batch(SCHEMA.map((statement) => env.DB.prepare(statement)));
});

describe("Worker routes", () => {
  test("health reports the live phase", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, phase: 2 });
  });

  test("POST start accepts a valid config and returns its pairings", async () => {
    const config = configFor("route-valid-start");
    const response = await startSeason(config);
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body).toEqual(
      expect.arrayContaining([
        pairing(config, ALPHA, BETA),
        pairing(config, BETA, ALPHA),
      ]),
    );
  });

  test("POST start converts malformed JSON into a 400 response", async () => {
    const response = await SELF.fetch(
      `${ORIGIN}/api/seasons/route-malformed/start`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: "{",
      },
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("body must be valid JSON");
  });

  test("POST start without the admin bearer is refused before anything runs", async () => {
    const config = configFor("route-unauthenticated");
    const response = await SELF.fetch(
      `${ORIGIN}/api/seasons/${config.seasonId}/start`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      },
    );

    expect(response.status).toBe(401);
    // Nothing ran, so the season does not exist. Asking for its standings is a
    // 404 rather than a 500: the refusal must not leave a broken route behind.
    const standings = await SELF.fetch(`${ORIGIN}/api/seasons/${config.seasonId}/standings`);
    expect(standings.status).toBe(404);
  });

  test("POST start rejects a path and body seasonId mismatch", async () => {
    const response = await startSeason(
      configFor("route-body-season"),
      "route-path-season",
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "path seasonId must match body seasonId",
    );
  });

  test.each([
    ["GET", "/api/seasons/route-method/start"],
    ["POST", "/api/seasons/route-method/standings"],
    ["GET", "/api/not-a-route"],
  ])("%s %s is not a matching route", async (method, path) => {
    const response = await SELF.fetch(`${ORIGIN}${path}`, { method });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  test("spectate rejects a decoded game id outside the id contract", async () => {
    const response = await SELF.fetch(
      `${ORIGIN}/api/games/bad%2Fgame/spectate?cursor=3`,
      { headers: { Upgrade: "websocket" } },
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  test("GET standings returns the started season's rows", async () => {
    const config = configFor("route-standings");
    expect((await startSeason(config)).status).toBe(200);

    const response = await SELF.fetch(
      `${ORIGIN}/api/seasons/${config.seasonId}/standings`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      seasonId: config.seasonId,
      rows: [ALPHA, BETA].map((competitor) => ({
        competitor: competitor.name,
        version: competitor.version,
        games: 0,
        score: 0,
        elo: 1_500,
      })),
    });
  });

  test("spectate forwards the original query string to the Game object", async () => {
    const gameId = "route-forward-query";
    const stub = arenaEnv.GAME.get(arenaEnv.GAME.idFromName(gameId));
    let forwardedUrl: string | undefined;
    vi.spyOn(stub, "fetch").mockImplementation((input) => {
      forwardedUrl = input instanceof Request ? input.url : String(input);
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.spyOn(arenaEnv.GAME, "get").mockReturnValue(stub);

    const response = await worker.fetch(
      new Request(
        `${ORIGIN}/api/games/${gameId}/spectate?cursor=3&view=compact`,
        { headers: { Upgrade: "websocket" } },
      ),
      arenaEnv,
    );

    expect(response.status).toBe(204);
    expect(forwardedUrl).toBe(
      `${ORIGIN}/spectate?cursor=3&view=compact`,
    );
  });
});
