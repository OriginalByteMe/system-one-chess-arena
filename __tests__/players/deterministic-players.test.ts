import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { createFixedClock } from "../../src/core/clock.ts";
import { createRng } from "../../src/core/rng.ts";
import type {
  Clock,
  Competitor,
  CompetitorManifest,
  FeatureSubset,
  PositionInput,
  Rng,
  Uci,
} from "../../src/core/types.ts";
import { createGreedyPlayer } from "../../src/players/greedy.ts";
import { createRandomPlayer } from "../../src/players/random.ts";
import { createScriptedPlayer } from "../../src/players/scripted.ts";
import {
  GREEDY_MANIFEST,
  RANDOM_MANIFEST,
  SCRIPTED_MANIFEST,
} from "../fixtures/manifests.ts";
import {
  POSITIONS,
  positionFixture,
  type PositionFixture,
} from "../fixtures/positions.ts";

type PlayerFactory = (
  manifest: CompetitorManifest,
  rng: Rng,
  clock: Clock,
) => Competitor;

interface PlayerCase {
  readonly name: string;
  readonly manifest: CompetitorManifest;
  readonly create: PlayerFactory;
}

const PLAYER_CASES: readonly PlayerCase[] = [
  { name: "random", manifest: RANDOM_MANIFEST, create: createRandomPlayer },
  { name: "greedy", manifest: GREEDY_MANIFEST, create: createGreedyPlayer },
  { name: "scripted", manifest: SCRIPTED_MANIFEST, create: createScriptedPlayer },
];

function toUci(move: { readonly from: string; readonly to: string; readonly promotion?: string }): Uci {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

function legalMovesFor(fen: string): readonly Uci[] {
  return new Chess(fen).moves({ verbose: true }).map(toUci);
}

function featuresFor(
  fixture: PositionFixture,
  manifest: CompetitorManifest,
): FeatureSubset {
  const hangingOpponentPieces = fixture.id === "hanging-queen" ? 1 : 0;

  if (manifest === GREEDY_MANIFEST) {
    return {
      materialBalance: 0,
      hangingOpponentPieces,
    };
  }

  if (manifest === SCRIPTED_MANIFEST) {
    return {
      materialBalance: 0,
      hangingOwnPieces: 0,
      hangingOpponentPieces,
      inCheck: false,
      opponentMateInOne: fixture.id === "opponent-threatens-mate",
    };
  }

  return {};
}

function inputFor(fixture: PositionFixture, manifest: CompetitorManifest): PositionInput {
  const legalMoves = legalMovesFor(fixture.fen);
  return {
    seasonId: "deterministic-test-season",
    gameId: `game-${fixture.id}`,
    ply: 0,
    colour: fixture.turn,
    fen: fixture.fen,
    history: [],
    legalMoves,
    features: featuresFor(fixture, manifest),
    persona: manifest,
    budget: manifest.budget,
  };
}

function fixedClockWithElapsed(elapsedMs: number): Clock {
  const fixed = createFixedClock(10_000);
  let reads = 0;

  return {
    now(): number {
      reads += 1;
      if (reads === 2) {
        fixed.advance(elapsedMs);
      }
      return fixed.now();
    },
  };
}

function captureMoves(fixture: PositionFixture): readonly Uci[] {
  return new Chess(fixture.fen)
    .moves({ verbose: true })
    .filter((move) => move.captured !== undefined)
    .map(toUci);
}

for (const playerCase of PLAYER_CASES) {
  describe(`${playerCase.name} player contract`, () => {
    test("returns a legal move and a declared strategy for every playable position fixture", async () => {
      for (const fixture of POSITIONS) {
        const input = inputFor(fixture, playerCase.manifest);
        if (input.legalMoves.length === 0) {
          expect(fixture.legalMoveCount).toBe(0);
          continue;
        }

        const player = playerCase.create(
          playerCase.manifest,
          createRng(`${playerCase.name}-${fixture.id}`),
          createFixedClock(1_000),
        );
        const decision = await player.decide(input);

        expect(input.legalMoves).toContain(decision.move);
        expect(playerCase.manifest.strategies).toContain(decision.strategy);
      }
    });

    test("reports the exact elapsed fixed-clock time", async () => {
      const fixture = positionFixture("start");
      const elapsedMs = 37;
      const player = playerCase.create(
        playerCase.manifest,
        createRng(`${playerCase.name}-latency`),
        fixedClockWithElapsed(elapsedMs),
      );

      const decision = await player.decide(inputFor(fixture, playerCase.manifest));

      expect(decision.latencyMs).toBe(elapsedMs);
    });

    test("returns the same move from independently created players with the same seed", async () => {
      const fixture = positionFixture("start");
      const input = inputFor(fixture, playerCase.manifest);
      const firstPlayer = playerCase.create(
        playerCase.manifest,
        createRng(`${playerCase.name}-same-seed`),
        createFixedClock(500),
      );
      const secondPlayer = playerCase.create(
        playerCase.manifest,
        createRng(`${playerCase.name}-same-seed`),
        createFixedClock(500),
      );

      const first = await firstPlayer.decide(input);
      const second = await secondPlayer.decide(input);

      expect(first.move).toBe(second.move);
    });
  });
}

describe("random player", () => {
  test("selects multiple legal start-position moves over 200 draws", async () => {
    const fixture = positionFixture("start");
    const input = inputFor(fixture, RANDOM_MANIFEST);
    const player = createRandomPlayer(
      RANDOM_MANIFEST,
      createRng("random-variety"),
      createFixedClock(0),
    );
    const seen = new Set<Uci>();

    for (let draw = 0; draw < 200; draw += 1) {
      const decision = await player.decide(input);
      expect(input.legalMoves).toContain(decision.move);
      seen.add(decision.move);
    }

    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("greedy player", () => {
  test("captures the hanging queen", async () => {
    const fixture = positionFixture("hanging-queen");
    const queenCaptures = new Chess(fixture.fen)
      .moves({ verbose: true })
      .filter((move) => move.captured === "q")
      .map(toUci);
    const player = createGreedyPlayer(
      GREEDY_MANIFEST,
      createRng("greedy-hanging-queen"),
      createFixedClock(0),
    );

    const decision = await player.decide(inputFor(fixture, GREEDY_MANIFEST));

    expect(queenCaptures).toContain(decision.move);
    expect(GREEDY_MANIFEST.strategies).toContain(decision.strategy);
  });

  test("returns a legal move when no capture is available", async () => {
    const fixture = positionFixture("start");
    expect(captureMoves(fixture)).toEqual([]);
    const input = inputFor(fixture, GREEDY_MANIFEST);
    const player = createGreedyPlayer(
      GREEDY_MANIFEST,
      createRng("greedy-no-capture"),
      createFixedClock(0),
    );

    const decision = await player.decide(input);

    expect(input.legalMoves).toContain(decision.move);
    expect(GREEDY_MANIFEST.strategies).toContain(decision.strategy);
  });
});

describe("scripted player", () => {
  test("chooses a defensive strategy when the opponent threatens mate", async () => {
    const fixture = positionFixture("opponent-threatens-mate");
    const player = createScriptedPlayer(
      SCRIPTED_MANIFEST,
      createRng("scripted-defence"),
      createFixedClock(0),
    );

    const decision = await player.decide(inputFor(fixture, SCRIPTED_MANIFEST));

    expect(["defend", "fortify"]).toContain(decision.strategy);
    expect(SCRIPTED_MANIFEST.strategies).toContain(decision.strategy);
  });

  test("chooses attack and a capturing move for the hanging queen", async () => {
    const fixture = positionFixture("hanging-queen");
    const captures = captureMoves(fixture);
    const player = createScriptedPlayer(
      SCRIPTED_MANIFEST,
      createRng("scripted-attack"),
      createFixedClock(0),
    );

    const decision = await player.decide(inputFor(fixture, SCRIPTED_MANIFEST));

    expect(decision.strategy).toBe("attack");
    expect(captures).toContain(decision.move);
  });

  test("repeats the same strategy-consistent move with the same seed", async () => {
    const fixture = positionFixture("hanging-queen");
    const input = inputFor(fixture, SCRIPTED_MANIFEST);
    const captures = captureMoves(fixture);
    const firstPlayer = createScriptedPlayer(
      SCRIPTED_MANIFEST,
      createRng("scripted-repeat"),
      createFixedClock(0),
    );
    const secondPlayer = createScriptedPlayer(
      SCRIPTED_MANIFEST,
      createRng("scripted-repeat"),
      createFixedClock(0),
    );

    const first = await firstPlayer.decide(input);
    const second = await secondPlayer.decide(input);

    expect(first.strategy).toBe("attack");
    expect(second.strategy).toBe("attack");
    expect(first.move).toBe(second.move);
    expect(captures).toContain(first.move);
  });
});
