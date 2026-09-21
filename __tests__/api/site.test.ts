import { describe, expect, test } from "bun:test";

import { d1SiteStore } from "../../src/api/site-store.ts";
import { featuredGame, highlightsOf, siteView } from "../../src/api/site.ts";
import type { SeasonRef, SiteGame, SiteRecentGame, SiteStore } from "../../src/api/site.ts";
import { applyMove, legalMoves, positionFromOpening, terminalState } from "../../src/core/rules.ts";
import type {
  BroadcastSchedule,
  CompetitorManifest,
  CompetitorRef,
  DecisionRecord,
  EpochMs,
  GameSummary,
  Opening,
  RecordedGame,
  Uci,
} from "../../src/core/types.ts";
import { GREEDY_MANIFEST, RANDOM_MANIFEST } from "../fixtures/manifests.ts";
import { memoryStore } from "../helpers/memory-store.ts";

// The front page bundle answers three questions a bug would get wrong: which
// season is on, which game the page opens on, and how much of a game on air is
// allowed to leave the server.

const OPENING: Opening = {
  id: "site-test-opening",
  name: "Initial position",
  moves: [],
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
};

/** Fool's mate: four plies, black mates. */
const FOOLS_MATE: readonly Uci[] = ["f2f3", "e7e5", "g2g4", "d8h4"];
const MS_PER_PLY = 1_000;

interface Built {
  readonly recorded: RecordedGame;
  readonly decisions: readonly DecisionRecord[];
}

function buildGame(
  seasonId: string,
  gameId: string,
  white: CompetitorManifest,
  black: CompetitorManifest,
  schedule: BroadcastSchedule,
): Built {
  const whiteRef: CompetitorRef = { name: white.name, version: white.version };
  const blackRef: CompetitorRef = { name: black.name, version: black.version };
  let position = positionFromOpening(OPENING);
  const decisions: DecisionRecord[] = [];

  for (const move of FOOLS_MATE) {
    const ref = position.turn === "white" ? whiteRef : blackRef;
    decisions.push({
      seasonId,
      gameId,
      ply: position.ply,
      competitor: ref.name,
      version: ref.version,
      colour: position.turn,
      fen: position.fen,
      legalMoveCount: legalMoves(position).length,
      move,
      strategy: "direct",
      confidence: 0.5,
      latencyMs: 10,
      featuresSeen: [],
      idempotencyKey: `${gameId}:${position.ply}:${ref.version}`,
    });
    position = applyMove(position, move);
  }

  const outcome = terminalState(position, 200);
  if (outcome === undefined) throw new Error("fixture must terminate");
  const summary: GameSummary = {
    seasonId,
    gameId,
    white: whiteRef,
    black: blackRef,
    openingId: OPENING.id,
    result: outcome.result,
    reason: outcome.reason,
    plies: decisions.length,
    pgn: "1. f3 e5 2. g4 Qh4#",
  };
  return { recorded: { summary, schedule }, decisions };
}

function siteStore(overrides: {
  readonly seasons: readonly SeasonRef[];
  readonly manifests?: readonly CompetitorManifest[];
  readonly setting?: string;
  readonly bracketId?: string;
  readonly recentGames?: readonly SiteRecentGame[];
}): SiteStore {
  return {
    seasons: () => Promise.resolve(overrides.seasons),
    manifests: () => Promise.resolve(overrides.manifests ?? []),
    bracket: () => Promise.resolve(overrides.bracketId),
    setting: () => Promise.resolve(overrides.setting),
    recentGames: () => Promise.resolve(overrides.recentGames ?? []),
  };
}

function game(
  gameId: string,
  status: SiteGame["status"],
  startAt: EpochMs,
): SiteGame {
  return {
    gameId,
    seasonId: "s",
    white: { name: "a", version: "1" },
    black: { name: "b", version: "1" },
    status,
    revealedPlies: 0,
    startAt,
    msPerPly: MS_PER_PLY,
    fen: OPENING.fen,
  };
}

interface RecentGameRow {
  readonly season_id: string;
  readonly game_id: string;
  readonly white_competitor: string;
  readonly black_competitor: string;
  readonly result: string;
  readonly reason: string;
  readonly plies: number;
  readonly broadcast_start_at: number | null;
  readonly ms_per_ply: number | null;
}

function recentGameRow(overrides: {
  readonly gameId: string;
  readonly broadcastStartAt: number | null;
  readonly plies: number;
  readonly msPerPly: number | null;
}): RecentGameRow {
  return {
    season_id: "s",
    game_id: overrides.gameId,
    white_competitor: "Vex",
    black_competitor: "Cinder",
    result: "white",
    reason: "checkmate",
    plies: overrides.plies,
    broadcast_start_at: overrides.broadcastStartAt,
    ms_per_ply: overrides.msPerPly,
  };
}

// Same finish math as the WHERE and ORDER BY clauses in
// d1SiteStore.recentGames, reproduced here rather than trusted, exactly like
// the FakeDatabase in admin-api.test.ts answers the games table.
function recentGameFinishedAt(row: RecentGameRow): number {
  return row.broadcast_start_at === null ? 0 : row.broadcast_start_at + row.plies * (row.ms_per_ply ?? 0);
}

class RecentGamesStatement implements D1PreparedStatement {
  private values: readonly unknown[] = [];

  constructor(private readonly rows: readonly RecentGameRow[]) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const now = typeof this.values[0] === "number" ? this.values[0] : 0;
    const limit = typeof this.values[1] === "number" ? this.values[1] : this.rows.length;
    const results = this.rows
      .filter((row) => row.broadcast_start_at === null || recentGameFinishedAt(row) <= now)
      .sort((a, b) => recentGameFinishedAt(b) - recentGameFinishedAt(a))
      .slice(0, limit)
      .map((row) => ({ ...row }));
    return {
      success: true,
      meta: {
        duration: 0,
        size_after: 0,
        rows_read: 0,
        rows_written: 0,
        last_row_id: 0,
        changed_db: false,
        changes: 0,
      },
      results: results as T[],
    };
  }

  first(): Promise<never> {
    throw new Error("first() is unused by recentGames");
  }

  run(): Promise<never> {
    throw new Error("run() is unused by recentGames");
  }

  raw(): Promise<never> {
    throw new Error("raw() is unused by recentGames");
  }
}

class RecentGamesDatabase implements D1Database {
  constructor(private readonly rows: readonly RecentGameRow[]) {}

  prepare(sql: string): D1PreparedStatement {
    if (!sql.includes("FROM games")) throw new Error(`RecentGamesDatabase: unrecognized query in test: ${sql}`);
    return new RecentGamesStatement(this.rows);
  }

  batch(): Promise<never> {
    throw new Error("batch() is unused by recentGames");
  }

  exec(): Promise<never> {
    throw new Error("exec() is unused by recentGames");
  }

  withSession(): never {
    throw new Error("withSession() is unused by recentGames");
  }

  dump(): Promise<never> {
    throw new Error("dump() is unused by recentGames");
  }
}

function siteRecentGame(overrides: { readonly gameId: string; readonly plies: number }): SiteRecentGame {
  return {
    gameId: overrides.gameId,
    seasonId: "s",
    white: "Vex",
    black: "Cinder",
    result: "white",
    reason: "checkmate",
    plies: overrides.plies,
    finishedAt: 0,
  };
}

describe("featuredGame", () => {
  const NOW: EpochMs = 5_000;

  test("a game on air outranks one scheduled and one finished", () => {
    const games = [
      game("finished", "finished", 0),
      game("scheduled", "scheduled", 9_000),
      game("live", "on-air", 4_000),
    ];
    expect(featuredGame(games, NOW)?.gameId).toBe("live");
  });

  test("with nothing on air, the next scheduled game is next up", () => {
    const games = [
      game("finished", "finished", 0),
      game("later", "scheduled", 20_000),
      game("sooner", "scheduled", 9_000),
    ];
    expect(featuredGame(games, NOW)?.gameId).toBe("sooner");
  });

  test("with nothing ahead, the most recent finished game stands", () => {
    const games = [
      game("old", "finished", 0),
      game("recent", "finished", 4_000),
    ];
    expect(featuredGame(games, NOW)?.gameId).toBe("recent");
  });
});

describe("siteView", () => {
  const SEASONS: readonly SeasonRef[] = [
    { seasonId: "latest", startAt: 900, games: 1 },
    { seasonId: "older", startAt: 100, games: 1 },
  ];

  function context(built: readonly Built[], now: EpochMs) {
    return {
      store: memoryStore({
        games: built.map((item) => item.recorded),
        decisions: built.flatMap((item) => [...item.decisions]),
      }),
      now,
    };
  }

  test("falls back to the most recent season when nothing is pinned", async () => {
    const built = buildGame("latest", "g1", RANDOM_MANIFEST, GREEDY_MANIFEST, {
      startAt: 0,
      msPerPly: MS_PER_PLY,
    });
    const view = await siteView(context([built], 10_000), siteStore({ seasons: SEASONS }), undefined);
    expect(view?.seasonId).toBe("latest");
  });

  test("an operator pin wins, and an unknown pin is ignored", async () => {
    const built = buildGame("older", "g1", RANDOM_MANIFEST, GREEDY_MANIFEST, {
      startAt: 0,
      msPerPly: MS_PER_PLY,
    });
    const store = siteStore({ seasons: SEASONS });
    expect((await siteView(context([built], 10_000), store, "older"))?.seasonId).toBe("older");
    expect((await siteView(context([built], 10_000), store, "ghost"))?.seasonId).toBe("latest");
  });

  test("the saved setting is used when no pin is set", async () => {
    const built = buildGame("older", "g1", RANDOM_MANIFEST, GREEDY_MANIFEST, {
      startAt: 0,
      msPerPly: MS_PER_PLY,
    });
    const store = siteStore({ seasons: SEASONS, setting: "older" });
    expect((await siteView(context([built], 10_000), store, undefined))?.seasonId).toBe("older");
  });

  test("a game on air carries no result, no reason and no ply count", async () => {
    const built = buildGame("latest", "g1", RANDOM_MANIFEST, GREEDY_MANIFEST, {
      startAt: 0,
      msPerPly: MS_PER_PLY,
    });
    // Two plies in: the broadcast has aired half of a four-ply game.
    const view = await siteView(context([built], 2_500), siteStore({ seasons: SEASONS }), undefined);
    const onAir = view?.games[0];

    expect(onAir?.status).toBe("on-air");
    expect(onAir?.revealedPlies).toBe(2);
    expect(onAir?.result).toBeUndefined();
    expect(onAir?.reason).toBeUndefined();
    expect(onAir?.plies).toBeUndefined();
    expect(view?.decisionsRevealed).toBe(2);
    expect(JSON.stringify(view)).not.toContain("checkmate");
  });

  test("a finished game carries its result and length", async () => {
    const built = buildGame("latest", "g1", RANDOM_MANIFEST, GREEDY_MANIFEST, {
      startAt: 0,
      msPerPly: MS_PER_PLY,
    });
    const view = await siteView(context([built], 60_000), siteStore({ seasons: SEASONS }), undefined);
    const finished = view?.games[0];

    expect(finished?.status).toBe("finished");
    expect(finished?.result).toBe("black");
    expect(finished?.reason).toBe("checkmate");
    expect(finished?.plies).toBe(4);
    expect(view?.decisionsRevealed).toBe(4);
  });

  test("no seasons at all means no front page, not an empty one", async () => {
    const view = await siteView(context([], 1_000), siteStore({ seasons: [] }), undefined);
    expect(view).toBeUndefined();
  });
});

describe("d1SiteStore.recentGames", () => {
  test("a broadcast still on air is absent while a finished one is present", async () => {
    const db = new RecentGamesDatabase([
      recentGameRow({ gameId: "onair", broadcastStartAt: 1_000, plies: 4, msPerPly: 500 }),
      recentGameRow({ gameId: "aired", broadcastStartAt: 0, plies: 4, msPerPly: 500 }),
    ]);
    // "aired" finishes at 2_000; "onair" not until 3_000. 2_500 sits between
    // them, which is the reveal boundary this predicate exists to enforce.
    const recent = await d1SiteStore(db).recentGames(2_500, 12);
    expect(recent.map((game) => game.gameId)).toEqual(["aired"]);
  });
});

describe("highlightsOf", () => {
  test("picks the fewest-ply decisive game as the shortest highlight", () => {
    const games: readonly SiteRecentGame[] = [
      siteRecentGame({ gameId: "g1", plies: 40 }),
      siteRecentGame({ gameId: "g2", plies: 12 }),
      siteRecentGame({ gameId: "g3", plies: 80 }),
    ];
    const shortest = highlightsOf(games).find((highlight) => highlight.kind === "shortest");
    expect(shortest?.gameId).toBe("g2");
  });

  test("returns nothing for an empty pool of games", () => {
    expect(highlightsOf([])).toEqual([]);
  });
});
