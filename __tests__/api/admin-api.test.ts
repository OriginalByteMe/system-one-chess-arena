import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handleAdmin, type AdminEnv } from "../../src/api/admin-api.ts";

const AUDIENCE = "test-audience-tag";
const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Only the campaign routes reach a Durable Object, and nothing in this file
 * calls them. A stub that throws keeps that true: if a test ever does reach
 * the namespace, it says so rather than quietly passing against a fake.
 */
const NO_SEASONS = new Proxy(
  {},
  {
    get(): never {
      throw new Error("admin-api routing tests must not reach the SEASON namespace");
    },
  },
) as AdminEnv["SEASON"];

// ---------------------------------------------------------------------------
// A minimal signed Access token, so routing tests can get past the boundary
// without re-deriving every case access.test.ts already covers.
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRsaPublicJwk(value: unknown): value is { readonly kty: string; readonly n: string; readonly e: string } {
  return isObject(value) && typeof value.kty === "string" && typeof value.n === "string" && typeof value.e === "string";
}

let domainCounter = 0;

function nextDomain(): string {
  domainCounter += 1;
  return `arena-admin-test-${domainCounter}.cloudflareaccess.com`;
}

let restoreFetch: (() => void) | undefined;

interface AccessFixture {
  readonly env: AdminEnv;
  readonly token: string;
}

/** A fresh Access app, a fresh signing key, and a token that verifies against it. */
async function accessFixture(db: FakeDatabase): Promise<AccessFixture> {
  const domain = nextDomain();
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const exported: unknown = await crypto.subtle.exportKey("jwk", publicKey);
  if (!isRsaPublicJwk(exported)) throw new Error("expected a JWK export with kty, n and e");
  const jwk = { kty: exported.kty, n: exported.n, e: exported.e, kid: "key-1" };

  const certsUrl = `https://${domain}/cdn-cgi/access/certs`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const requested = typeof input === "string" ? input : input.toString();
    if (requested === certsUrl) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch during test: ${requested}`);
  }) as typeof fetch;
  restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };

  const nowSeconds = Math.floor(NOW / 1000);
  const claims = {
    aud: AUDIENCE,
    iss: `https://${domain}`,
    exp: nowSeconds + 3600,
    iat: nowSeconds - 10,
    nbf: nowSeconds - 10,
    email: "operator@example.com",
    sub: "user-123",
  };
  const header = { alg: "RS256", kid: "key-1" };
  const signingInput = `${encodeJson(header)}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  const token = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;

  return {
    env: { DB: db, SEASON: NO_SEASONS, CF_ACCESS_TEAM_DOMAIN: domain, CF_ACCESS_AUD: AUDIENCE },
    token,
  };
}

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

function adminRequest(path: string, token?: string, init: RequestInit = {}): Request {
  const headers: Record<string, string> = {};
  const initHeaders = init.headers;
  if (Array.isArray(initHeaders)) {
    for (const [name, value] of initHeaders) headers[name] = value;
  } else if (initHeaders !== undefined && !(initHeaders instanceof Headers)) {
    Object.assign(headers, initHeaders);
  }
  if (token !== undefined) headers["Cf-Access-Jwt-Assertion"] = token;
  return new Request(new URL(path, "https://arena.test").toString(), { ...init, headers });
}

// ---------------------------------------------------------------------------
// A fake D1Database that answers exactly the queries admin-api.ts issues.
// ---------------------------------------------------------------------------

interface GameFixture {
  season_id: string;
  game_id: string;
  white_competitor: string;
  white_version: string;
  black_competitor: string;
  black_version: string;
  result: string;
  reason: string;
  plies: number;
  broadcast_start_at: number | null;
  ms_per_ply: number | null;
}

interface CompetitorVersionFixture {
  season_id: string;
  competitor: string;
  version: string;
}

interface SettingFixture {
  key: string;
  value: string;
  updated_at: number;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`expected ${field} to be a string in a test query`);
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number") throw new Error(`expected ${field} to be a number in a test query`);
  return value;
}

function meta(changes: number): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    last_row_id: 0,
    changed_db: changes > 0,
    changes,
  };
}

class FakeStatement implements D1PreparedStatement {
  private values: readonly unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly db: FakeDatabase,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  private rows(): readonly Record<string, unknown>[] {
    const sql = this.sql;

    if (sql.startsWith("SELECT season_id, broadcast_start_at, ms_per_ply, plies FROM games")) {
      return this.db.games.map((game) => ({
        season_id: game.season_id,
        broadcast_start_at: game.broadcast_start_at,
        ms_per_ply: game.ms_per_ply,
        plies: game.plies,
      }));
    }

    if (sql.includes("FROM games") && sql.includes("AND game_id = ?")) {
      const seasonId = asString(this.values[0], "season_id");
      const gameId = asString(this.values[1], "game_id");
      const game = this.db.games.find((row) => row.season_id === seasonId && row.game_id === gameId);
      return game === undefined ? [] : [gameRow(game)];
    }

    if (sql.includes("FROM games") && sql.includes("ORDER BY game_id")) {
      const seasonId = asString(this.values[0], "season_id");
      return this.db.games.filter((row) => row.season_id === seasonId).map(gameRow);
    }

    if (sql.includes("FROM competitor_versions")) {
      const seasonId = asString(this.values[0], "season_id");
      const seen = new Set<string>();
      const rows: Record<string, unknown>[] = [];
      for (const entry of this.db.competitorVersions) {
        if (entry.season_id !== seasonId) continue;
        const key = `${entry.competitor}@${entry.version}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ competitor: entry.competitor, version: entry.version });
      }
      rows.sort((a, b) => `${a.competitor}@${a.version}`.localeCompare(`${b.competitor}@${b.version}`));
      return rows;
    }

    if (sql.startsWith("SELECT key, value, updated_at FROM site_settings")) {
      const key = asString(this.values[0], "key");
      return this.db.settings
        .filter((row) => row.key === key)
        .map((row) => ({ key: row.key, value: row.value, updated_at: row.updated_at }));
    }

    // src/api/campaign.ts reads the stored campaign through this same table.
    if (sql.startsWith("SELECT value FROM site_settings")) {
      const key = asString(this.values[0], "key");
      return this.db.settings.filter((row) => row.key === key).map((row) => ({ value: row.value }));
    }

    throw new Error(`FakeStatement.rows: unrecognized query in test: ${sql}`);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.rows()[0] ?? null) as T | null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { success: true, meta: meta(0), results: [...this.rows()] as T[] };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (this.sql.startsWith("UPDATE games")) {
      const startAt = asNumber(this.values[0], "startAt");
      const msPerPly = asNumber(this.values[1], "msPerPly");
      const seasonId = asString(this.values[2], "season_id");
      const gameId = asString(this.values[3], "game_id");
      const game = this.db.games.find((row) => row.season_id === seasonId && row.game_id === gameId);
      if (game === undefined) return { success: true, meta: meta(0), results: [] };
      game.broadcast_start_at = startAt;
      game.ms_per_ply = msPerPly;
      return { success: true, meta: meta(1), results: [] };
    }

    if (this.sql.startsWith("INSERT INTO site_settings")) {
      const key = asString(this.values[0], "key");
      const value = asString(this.values[1], "value");
      const updatedAt = asNumber(this.values[2], "updated_at");
      const existing = this.db.settings.find((row) => row.key === key);
      if (existing === undefined) {
        this.db.settings.push({ key, value, updated_at: updatedAt });
      } else {
        existing.value = value;
        existing.updated_at = updatedAt;
      }
      return { success: true, meta: meta(1), results: [] };
    }

    throw new Error(`FakeStatement.run: unrecognized query in test: ${this.sql}`);
  }

  raw(): Promise<never> {
    throw new Error("raw() is unused by admin-api");
  }
}

function gameRow(game: GameFixture): Record<string, unknown> {
  return {
    game_id: game.game_id,
    white_competitor: game.white_competitor,
    white_version: game.white_version,
    black_competitor: game.black_competitor,
    black_version: game.black_version,
    result: game.result,
    reason: game.reason,
    plies: game.plies,
    broadcast_start_at: game.broadcast_start_at,
    ms_per_ply: game.ms_per_ply,
  };
}

class FakeDatabase implements D1Database {
  games: GameFixture[] = [];
  competitorVersions: CompetitorVersionFixture[] = [];
  settings: SettingFixture[] = [];

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(sql, this);
  }

  batch(): Promise<never> {
    throw new Error("batch() is unused by admin-api");
  }

  exec(): Promise<never> {
    throw new Error("exec() is unused by admin-api");
  }

  withSession(): never {
    throw new Error("withSession() is unused by admin-api");
  }

  dump(): Promise<never> {
    throw new Error("dump() is unused by admin-api");
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function game(overrides: Partial<GameFixture> & Pick<GameFixture, "game_id" | "season_id">): GameFixture {
  return {
    white_competitor: "Alpha",
    white_version: "alpha-v1",
    black_competitor: "Beta",
    black_version: "beta-v1",
    result: "white",
    reason: "checkmate",
    plies: 40,
    broadcast_start_at: null,
    ms_per_ply: null,
    ...overrides,
  };
}

let db: FakeDatabase;

beforeEach(() => {
  db = new FakeDatabase();
});

describe("handleAdmin routing", () => {
  test("returns undefined for a path outside /api/admin, regardless of Access configuration", async () => {
    const env: AdminEnv = { DB: db, SEASON: NO_SEASONS, CF_ACCESS_TEAM_DOMAIN: undefined, CF_ACCESS_AUD: undefined };
    const response = await handleAdmin(adminRequest("/api/site"), env, NOW);
    expect(response).toBeUndefined();
  });

  test("503s every admin route when Access is not configured", async () => {
    const env: AdminEnv = { DB: db, SEASON: NO_SEASONS, CF_ACCESS_TEAM_DOMAIN: undefined, CF_ACCESS_AUD: undefined };
    const response = await handleAdmin(adminRequest("/api/admin/whoami"), env, NOW);
    expect(response?.status).toBe(503);
  });

  test("401s a configured route given a garbage token", async () => {
    const env: AdminEnv = {
      DB: db,
      SEASON: NO_SEASONS,
      CF_ACCESS_TEAM_DOMAIN: "arena-admin-test-unused.cloudflareaccess.com",
      CF_ACCESS_AUD: AUDIENCE,
    };
    const response = await handleAdmin(adminRequest("/api/admin/whoami", "not-a-jwt"), env, NOW);
    expect(response?.status).toBe(401);
  });

  test("whoami returns the verified identity", async () => {
    const { env, token } = await accessFixture(db);
    const response = await handleAdmin(adminRequest("/api/admin/whoami", token), env, NOW);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ email: "operator@example.com", sub: "user-123" });
  });

  // The campaign routes accept the scripted bearer as well as an Access
  // session. That is a trust boundary, so what matters is not only that the
  // token works but that it opens nothing else.
  describe("the campaign bearer fallback", () => {
    const ADMIN_TOKEN = "campaign-bearer-token";

    function unconfiguredEnv(): AdminEnv {
      return {
        DB: db,
        SEASON: NO_SEASONS,
        CF_ACCESS_TEAM_DOMAIN: undefined,
        CF_ACCESS_AUD: undefined,
        ARENA_ADMIN_TOKEN: ADMIN_TOKEN,
      };
    }

    function bearerRequest(path: string, token: string, method = "GET"): Request {
      return new Request(new URL(path, "https://arena.test").toString(), {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    test("reads the campaign with the bearer even when Access is unconfigured", async () => {
      const response = await handleAdmin(
        bearerRequest("/api/admin/campaign", ADMIN_TOKEN),
        unconfiguredEnv(),
        NOW,
      );
      expect(response?.status).toBe(200);
      expect(await response?.json()).toEqual({ running: false });
    });

    test("opens no route other than campaign", async () => {
      for (const path of ["/api/admin/whoami", "/api/admin/seasons", "/api/admin/settings"]) {
        const response = await handleAdmin(bearerRequest(path, ADMIN_TOKEN), unconfiguredEnv(), NOW);
        expect(response?.status).toBe(503);
      }
    });

    test("a wrong bearer falls through to Access rather than passing", async () => {
      const response = await handleAdmin(
        bearerRequest("/api/admin/campaign", "wrong-token"),
        unconfiguredEnv(),
        NOW,
      );
      // 503 is the Access answer, not the bearer's 401: the fallback did not
      // authorise, so the normal boundary decided.
      expect(response?.status).toBe(503);
    });

    test("no configured bearer leaves the campaign routes on Access alone", async () => {
      const response = await handleAdmin(
        bearerRequest("/api/admin/campaign", ADMIN_TOKEN),
        { ...unconfiguredEnv(), ARENA_ADMIN_TOKEN: undefined },
        NOW,
      );
      expect(response?.status).toBe(503);
    });
  });
});

describe("GET /api/admin/seasons", () => {
  test("counts games by broadcast status, derived from the schedule and now, not stored", async () => {
    const { env, token } = await accessFixture(db);
    db.games = [
      game({ season_id: "season-1", game_id: "g1", broadcast_start_at: NOW + DAY_MS, ms_per_ply: 1000 }), // scheduled
      game({
        season_id: "season-1",
        game_id: "g2",
        broadcast_start_at: NOW - 1000,
        ms_per_ply: 1000,
        plies: 40,
      }), // on-air: only 1 ply elapsed of 40
      game({
        season_id: "season-1",
        game_id: "g3",
        broadcast_start_at: NOW - 100 * DAY_MS,
        ms_per_ply: 1000,
        plies: 10,
      }), // finished long ago
      game({ season_id: "season-1", game_id: "g4" }), // unscheduled
      game({ season_id: "season-2", game_id: "g5", broadcast_start_at: NOW - 100 * DAY_MS, ms_per_ply: 1000, plies: 5 }),
    ];

    const response = await handleAdmin(adminRequest("/api/admin/seasons", token), env, NOW);
    const body = (await response?.json()) as unknown;

    expect(response?.status).toBe(200);
    expect(body).toEqual([
      {
        seasonId: "season-1",
        gameCount: 4,
        firstBroadcastAt: NOW - 100 * DAY_MS,
        scheduled: 1,
        onAir: 1,
        finished: 1,
        unscheduled: 1,
      },
      {
        seasonId: "season-2",
        gameCount: 1,
        firstBroadcastAt: NOW - 100 * DAY_MS,
        scheduled: 0,
        onAir: 0,
        finished: 1,
        unscheduled: 0,
      },
    ]);
  });
});

describe("GET /api/admin/seasons/:seasonId", () => {
  test("404s a season with no games and no registered competitors", async () => {
    const { env, token } = await accessFixture(db);
    const response = await handleAdmin(adminRequest("/api/admin/seasons/ghost-season", token), env, NOW);
    expect(response?.status).toBe(404);
  });

  test("returns the season's games and its registered competitors", async () => {
    const { env, token } = await accessFixture(db);
    db.games = [game({ season_id: "season-1", game_id: "g1" })];
    db.competitorVersions = [
      { season_id: "season-1", competitor: "Alpha", version: "alpha-v1" },
      { season_id: "season-1", competitor: "Alpha", version: "alpha-v1" }, // duplicate row, must not double up
      { season_id: "season-1", competitor: "Beta", version: "beta-v1" },
    ];

    const response = await handleAdmin(adminRequest("/api/admin/seasons/season-1", token), env, NOW);
    const body = (await response?.json()) as { games: unknown[]; competitors: unknown[] };

    expect(response?.status).toBe(200);
    expect(body.games).toHaveLength(1);
    expect(body.competitors).toEqual([
      { name: "Alpha", version: "alpha-v1" },
      { name: "Beta", version: "beta-v1" },
    ]);
  });
});

describe("GET/PUT /api/admin/settings", () => {
  test("PUT rejects an unknown setting key with 400 and does not write it", async () => {
    const { env, token } = await accessFixture(db);

    const response = await handleAdmin(
      adminRequest("/api/admin/settings", token, {
        method: "PUT",
        body: JSON.stringify({ key: "site_title", value: "Anything" }),
      }),
      env,
      NOW,
    );

    expect(response?.status).toBe(400);
    expect(db.settings).toHaveLength(0);
  });

  test("PUT accepts the featured_season key and GET reflects it back", async () => {
    const { env, token } = await accessFixture(db);

    const put = await handleAdmin(
      adminRequest("/api/admin/settings", token, {
        method: "PUT",
        body: JSON.stringify({ key: "featured_season", value: "season-9" }),
      }),
      env,
      NOW,
    );
    expect(put?.status).toBe(200);

    const get = await handleAdmin(adminRequest("/api/admin/settings", token), env, NOW);
    expect(await get?.json()).toEqual({
      featuredSeason: { key: "featured_season", value: "season-9", updatedAt: NOW },
    });
  });
});

describe("POST /api/admin/games/:seasonId/:gameId/schedule", () => {
  test("rejects a non-integer startAt with 400 and leaves the game untouched", async () => {
    const { env, token } = await accessFixture(db);
    db.games = [game({ season_id: "season-1", game_id: "g1" })];

    const response = await handleAdmin(
      adminRequest("/api/admin/games/season-1/g1/schedule", token, {
        method: "POST",
        body: JSON.stringify({ startAt: 1.5, msPerPly: 1000 }),
      }),
      env,
      NOW,
    );

    expect(response?.status).toBe(400);
    expect(db.games[0]?.broadcast_start_at).toBeNull();
  });

  test("rejects a non-integer msPerPly with 400", async () => {
    const { env, token } = await accessFixture(db);
    db.games = [game({ season_id: "season-1", game_id: "g1" })];

    const response = await handleAdmin(
      adminRequest("/api/admin/games/season-1/g1/schedule", token, {
        method: "POST",
        body: JSON.stringify({ startAt: NOW, msPerPly: "fast" }),
      }),
      env,
      NOW,
    );

    expect(response?.status).toBe(400);
  });

  test("404s an unknown game", async () => {
    const { env, token } = await accessFixture(db);

    const response = await handleAdmin(
      adminRequest("/api/admin/games/season-1/ghost/schedule", token, {
        method: "POST",
        body: JSON.stringify({ startAt: NOW, msPerPly: 1000 }),
      }),
      env,
      NOW,
    );

    expect(response?.status).toBe(404);
  });

  test("moves an existing game's broadcast and returns its recomputed status", async () => {
    const { env, token } = await accessFixture(db);
    db.games = [game({ season_id: "season-1", game_id: "g1", plies: 10 })];

    const response = await handleAdmin(
      adminRequest("/api/admin/games/season-1/g1/schedule", token, {
        method: "POST",
        body: JSON.stringify({ startAt: NOW + DAY_MS, msPerPly: 500 }),
      }),
      env,
      NOW,
    );
    const body = (await response?.json()) as { schedule?: { startAt: number; msPerPly: number }; status: string };

    expect(response?.status).toBe(200);
    expect(body.schedule).toEqual({ startAt: NOW + DAY_MS, msPerPly: 500 });
    expect(body.status).toBe("scheduled");
    expect(db.games[0]?.broadcast_start_at).toBe(NOW + DAY_MS);
  });
});

describe("GET /api/admin/analytics", () => {
  test("reports not configured rather than throwing when no account id or token is set", async () => {
    const { env, token } = await accessFixture(db);

    const response = await handleAdmin(adminRequest("/api/admin/analytics", token), env, NOW);

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ configured: false });
  });
});
