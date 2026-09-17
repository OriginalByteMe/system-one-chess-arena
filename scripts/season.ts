import type {
  Clock,
  Competitor,
  CompetitorManifest,
  MoveDecision,
  Opening,
  PositionInput,
  Rng,
  SeasonConfig,
} from "../src/core/types.ts";
import { runSeason } from "../src/season/runner.ts";

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

function firstLegalPlayer(name: string): Competitor {
  return {
    manifest: manifest(name),
    async decide(input: PositionInput): Promise<MoveDecision> {
      const move = input.legalMoves[0];
      if (move === undefined) {
        throw new Error("runner asked a player to move in a terminal position");
      }
      return { move, strategy: "direct", latencyMs: 1 };
    },
  };
}

// Mirrors the Rng in __tests__/season/runner.test.ts, not src/core/rng.ts: the
// golden fixture must reproduce that suite's stream exactly.
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

const fixedClock: Clock = { now: () => 10_000 };

function seasonConfig(
  players: readonly Competitor[],
  maxPlies: number,
  seed: string,
): SeasonConfig {
  return {
    seasonId: "runner-season",
    seed,
    competitors: players.map((player) => player.manifest),
    openings: [START_OPENING],
    roundsPerPair: 1,
    maxPlies,
  };
}

const recordGolden = process.argv.includes("--record-golden");
const seed = recordGolden ? "golden-seed" : "runner-seed";
const players = [firstLegalPlayer("alpha"), firstLegalPlayer("beta")];
const outcome = await runSeason(
  seasonConfig(players, 4, seed),
  players,
  seededRng(seed),
  fixedClock,
);

if (recordGolden) {
  const path = new URL("../__tests__/fixtures/golden/season.json", import.meta.url);
  await Bun.write(path, `${JSON.stringify(outcome, null, 2)}\n`);
  console.log(`recorded ${outcome.games.length} games to ${path.pathname}`);
} else {
  console.log(JSON.stringify(outcome.standings, null, 2));
}
