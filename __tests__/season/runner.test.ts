import { describe, expect, test } from "bun:test";

import type {
  Clock,
  Competitor,
  CompetitorManifest,
  MoveDecision,
  Opening,
  PositionInput,
  Rng,
  SeasonConfig,
} from "../../src/core/types.ts";
import type { SeasonOutcome } from "../../src/season/runner.ts";
import { runSeason } from "../../src/season/runner.ts";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const START_OPENING: Opening = {
  id: "initial-position",
  name: "Initial position",
  moves: [],
  fen: START_FEN,
};

function manifest(name: string): CompetitorManifest {
  return {
    name,
    version: `${name}-v1`,
    model: "test",
    playstyle: "runner fixture",
    strategies: ["direct"],
    features: [],
    historyPlies: 8,
    fallback: "first-legal",
    budget: { maxMs: 100 },
    hierarchical: false,
  };
}

function firstLegalDecision(input: PositionInput): MoveDecision {
  const move = input.legalMoves[0];
  if (move === undefined) throw new Error("runner asked a player to move in a terminal position");
  return { move, strategy: "direct", latencyMs: 1 };
}

function firstLegalPlayer(name: string): Competitor {
  return {
    manifest: manifest(name),
    async decide(input: PositionInput): Promise<MoveDecision> {
      return firstLegalDecision(input);
    },
  };
}

function illegalPlayer(name: string): Competitor {
  return {
    manifest: manifest(name),
    async decide(): Promise<MoveDecision> {
      return { move: "a1a1", strategy: "direct", latencyMs: 1 };
    },
  };
}

function seededRng(seed: string): Rng {
  let state = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 16_777_619) >>> 0;
  }
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  return {
    next,
    nextInt(boundExclusive: number): number {
      if (!Number.isInteger(boundExclusive) || boundExclusive <= 0) {
        throw new Error("bound must be a positive integer");
      }
      return Math.floor(next() * boundExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("cannot pick from an empty list");
      const picked = items[Math.floor(next() * items.length)];
      if (picked === undefined) throw new Error("seeded selection was out of bounds");
      return picked;
    },
  };
}

function fixedClock(): Clock {
  return { now: () => 10_000 };
}

function seasonConfig(players: readonly Competitor[], maxPlies = 4, seed = "runner-seed"): SeasonConfig {
  return {
    seasonId: "runner-season",
    seed,
    competitors: players.map((player) => player.manifest),
    openings: [START_OPENING],
    roundsPerPair: 1,
    maxPlies,
  };
}

async function runLocalSeason(
  players: readonly Competitor[] = [firstLegalPlayer("alpha"), firstLegalPlayer("beta")],
  maxPlies = 4,
  seed = "runner-seed",
) {
  return runSeason(seasonConfig(players, maxPlies, seed), players, seededRng(seed), fixedClock());
}
function isSeasonOutcome(value: unknown): value is SeasonOutcome {
  if (
    typeof value !== "object" ||
    value === null ||
    !("standings" in value) ||
    !("decisions" in value) ||
    !("games" in value)
  ) {
    return false;
  }
  const standings = value.standings;
  return (
    typeof standings === "object" &&
    standings !== null &&
    "seasonId" in standings &&
    typeof standings.seasonId === "string" &&
    "rows" in standings &&
    Array.isArray(standings.rows) &&
    Array.isArray(value.decisions) &&
    Array.isArray(value.games)
  );
}


describe("runSeason", () => {
  test("completes every scheduled game with a result and terminal reason", async () => {
    const outcome = await runLocalSeason();

    expect(outcome.games).toHaveLength(2);
    expect(outcome.games.map((game) => ({ result: game.result, reason: game.reason }))).toEqual([
      { result: "draw", reason: "move-limit" },
      { result: "draw", reason: "move-limit" },
    ]);
  });

  test("records one decision per ply in increasing order with unique idempotency keys", async () => {
    const outcome = await runLocalSeason();

    expect(outcome.decisions).toHaveLength(8);
    expect(new Set(outcome.decisions.map((decision) => decision.idempotencyKey)).size).toBe(8);
    for (const game of outcome.games) {
      const decisions = outcome.decisions.filter((decision) => decision.gameId === game.gameId);
      expect(decisions).toHaveLength(game.plies);
      for (let index = 1; index < decisions.length; index += 1) {
        const previous = decisions[index - 1];
        const current = decisions[index];
        if (previous === undefined || current === undefined) {
          throw new Error("decision sequence unexpectedly sparse");
        }
        expect(current.ply).toBe(previous.ply + 1);
      }
    }
  });

  test("builds one standings row per competitor version and counts both sides", async () => {
    const outcome = await runLocalSeason();
    const identities = outcome.standings.rows
      .map((row) => `${row.competitor}@${row.version}`)
      .sort();
    const gamesPlayed = outcome.standings.rows.reduce((sum, row) => sum + row.games, 0);

    expect(identities).toEqual(["alpha@alpha-v1", "beta@beta-v1"]);
    expect(outcome.standings.rows.map((row) => row.games).sort()).toEqual([2, 2]);
    expect(gamesPlayed).toBe(outcome.games.length * 2);
    expect(gamesPlayed).toBe(4);
  });

  test("falls back on every illegal player decision and still completes the games", async () => {
    const players = [illegalPlayer("illegal-alpha"), illegalPlayer("illegal-beta")];
    const outcome = await runLocalSeason(players, 3);

    expect(outcome.games).toHaveLength(2);
    expect(outcome.decisions).toHaveLength(6);
    expect(outcome.decisions.map((decision) => decision.fallback)).toEqual([
      "illegal-output",
      "illegal-output",
      "illegal-output",
      "illegal-output",
      "illegal-output",
      "illegal-output",
    ]);
    expect(outcome.games.map((game) => game.reason)).toEqual(["move-limit", "move-limit"]);
  });

  test("ends a game at maxPlies with move-limit", async () => {
    const outcome = await runLocalSeason(undefined, 2);

    expect(outcome.games.map((game) => ({ plies: game.plies, result: game.result, reason: game.reason }))).toEqual([
      { plies: 2, result: "draw", reason: "move-limit" },
      { plies: 2, result: "draw", reason: "move-limit" },
    ]);
  });

  test("is deeply reproducible for the same config and seed", async () => {
    const first = await runLocalSeason(undefined, 4, "repeatable-seed");
    const second = await runLocalSeason(undefined, 4, "repeatable-seed");

    expect(second).toEqual(first);
  });

  test("matches the recorded golden season", async () => {
    const goldenFile = Bun.file(new URL("../fixtures/golden/season.json", import.meta.url));
    if (!(await goldenFile.exists())) {
      throw new Error("Golden season fixture is missing. Run `bun run season --record-golden` to create it.");
    }

    const expected: unknown = await goldenFile.json();
    if (!isSeasonOutcome(expected)) throw new Error("Golden season fixture is not a SeasonOutcome");
    const outcome = await runLocalSeason(undefined, 4, "golden-seed");
    expect(outcome).toEqual(expected);
  });
});
