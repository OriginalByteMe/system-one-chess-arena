import {
  env,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Env } from "../src/core/env.ts";
import type {
  BroadcastSchedule,
  CompetitorManifest,
  DecisionRecord,
  Opening,
  Pairing,
  SeasonConfig,
} from "../src/core/types.ts";
import { GameDurableObject, type GameSnapshot } from "../src/do/game.ts";

const WHITE_MANIFEST: CompetitorManifest = {
  name: "alpha",
  version: "alpha-v1",
  model: "llm-contract",
  playstyle: "Play the requested contract move.",
  strategies: ["direct"],
  features: [],
  historyPlies: 8,
  fallback: "first-legal",
  budget: { maxMs: 1_000 },
  hierarchical: false,
};

const BLACK_MANIFEST: CompetitorManifest = {
  name: "beta",
  version: "beta-v1",
  model: "llm-contract",
  playstyle: "Play the requested contract move.",
  strategies: ["direct"],
  features: [],
  historyPlies: 8,
  fallback: "first-legal",
  budget: { maxMs: 1_000 },
  hierarchical: false,
};

const START_OPENING: Opening = {
  id: "record-mode-start",
  name: "Initial position",
  moves: [],
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
};

const MATE_IN_ONE_OPENING: Opening = {
  id: "record-mode-mate-in-one",
  name: "White mates with Qg7",
  moves: [],
  fen: "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1",
};

const PRELUDE_MATE_OPENING: Opening = {
  id: "record-mode-prelude-mate",
  name: "Two plies already on the clock before a forced mate",
  moves: ["e4", "e5"],
  fen: "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1",
};

const FOOLS_MATE_MOVES = ["f2f3", "e7e5", "g2g4", "d8h4"] as const;

const arenaEnv = env as Env;

function gameStub(gameId: string): DurableObjectStub<GameDurableObject> {
  const namespace = arenaEnv.GAME as DurableObjectNamespace<GameDurableObject>;
  return namespace.get(namespace.idFromName(gameId));
}

function configFor(opening: Opening, maxPlies = 20): SeasonConfig {
  return {
    seasonId: "season-record-mode-contract",
    seed: "record-mode-seed",
    competitors: [WHITE_MANIFEST, BLACK_MANIFEST],
    openings: [opening],
    roundsPerPair: 1,
    maxPlies,
  };
}

function pairingFor(gameId: string, opening: Opening): Pairing {
  return {
    gameId,
    white: { name: WHITE_MANIFEST.name, version: WHITE_MANIFEST.version },
    black: { name: BLACK_MANIFEST.name, version: BLACK_MANIFEST.version },
    openingId: opening.id,
  };
}

function scheduleFor(
  startAt = Date.now() + 60_000,
  msPerPly = 4_000,
): BroadcastSchedule {
  return { startAt, msPerPly };
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

function mockProviderMoves(moves: readonly string[]) {
  let index = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    const move = moves[index] ?? moves[moves.length - 1];
    if (move === undefined) {
      return Promise.reject(new Error("provider move queue is empty"));
    }
    index += 1;
    return Promise.resolve(providerResponse(move));
  });
}

async function record(
  stub: DurableObjectStub<GameDurableObject>,
  pairing: Pairing,
  config: SeasonConfig,
  schedule: BroadcastSchedule,
): Promise<GameSnapshot> {
  return runInDurableObject(stub, (instance: GameDurableObject) =>
    instance.record(pairing, config, schedule),
  );
}

async function snapshotOf(
  stub: DurableObjectStub<GameDurableObject>,
): Promise<GameSnapshot> {
  return runInDurableObject(stub, (instance: GameDurableObject) =>
    instance.snapshot(),
  );
}

function isBroadcastSchedule(value: unknown): value is BroadcastSchedule {
  if (typeof value !== "object" || value === null) return false;
  const startAt = Reflect.get(value, "startAt");
  const msPerPly = Reflect.get(value, "msPerPly");
  return typeof startAt === "number" && typeof msPerPly === "number";
}

async function findStoredSchedule(
  stub: DurableObjectStub<GameDurableObject>,
): Promise<BroadcastSchedule | undefined> {
  const entries = await runInDurableObject(stub, (_instance, state) =>
    state.storage.list(),
  );
  for (const value of entries.values()) {
    if (isBroadcastSchedule(value)) return value;
  }
  return undefined;
}

function compactDecisions(decisions: readonly DecisionRecord[]) {
  return decisions.map((decision) => ({
    ply: decision.ply,
    colour: decision.colour,
    competitor: decision.competitor,
    move: decision.move,
  }));
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GameDurableObject.record", () => {
  test("plays a full game to a terminal state with one decision per ply, alternating colour", async () => {
    const gameId = "record-fools-mate";
    mockProviderMoves(FOOLS_MATE_MOVES);
    const stub = gameStub(gameId);

    const result = await record(
      stub,
      pairingFor(gameId, START_OPENING),
      configFor(START_OPENING),
      scheduleFor(),
    );

    expect(result.finished).toEqual({ result: "black", reason: "checkmate" });
    expect(result.ply).toBe(4);
    expect(compactDecisions(result.decisions)).toEqual([
      { ply: 0, colour: "white", competitor: "alpha", move: "f2f3" },
      { ply: 1, colour: "black", competitor: "beta", move: "e7e5" },
      { ply: 2, colour: "white", competitor: "alpha", move: "g2g4" },
      { ply: 3, colour: "black", competitor: "beta", move: "d8h4" },
    ]);
  });

  test("the decision count is the snapshot ply minus the opening ply, and matches snapshot()", async () => {
    const gameId = "record-prelude-mate";
    mockProviderMoves(["f7g7"]);
    const stub = gameStub(gameId);

    const result = await record(
      stub,
      pairingFor(gameId, PRELUDE_MATE_OPENING),
      configFor(PRELUDE_MATE_OPENING),
      scheduleFor(),
    );

    expect(result.ply).toBe(3);
    expect(result.decisions).toHaveLength(result.ply - PRELUDE_MATE_OPENING.moves.length);
    expect(result.decisions[0]?.ply).toBe(PRELUDE_MATE_OPENING.moves.length);

    const separateSnapshot = await snapshotOf(stub);
    expect(separateSnapshot).toEqual(result);
  });

  test("calling record again on a finished game returns an equal snapshot and makes no further provider calls", async () => {
    const gameId = "record-idempotent";
    const providerSpy = mockProviderMoves(["f7g7"]);
    const stub = gameStub(gameId);
    const pairing = pairingFor(gameId, MATE_IN_ONE_OPENING);
    const config = configFor(MATE_IN_ONE_OPENING);
    const schedule = scheduleFor();

    const first = await record(stub, pairing, config, schedule);
    expect(first.finished).toEqual({ result: "white", reason: "checkmate" });
    expect(providerSpy).toHaveBeenCalledTimes(1);

    const second = await record(stub, pairing, config, schedule);

    expect(second).toEqual(first);
    expect(providerSpy).toHaveBeenCalledTimes(1);
  });

  test("resumes from a position advanced through the one-ply alarm path without losing or duplicating plies", async () => {
    const gameId = "record-resumes-from-alarm";
    const pairing = pairingFor(gameId, START_OPENING);
    const config = configFor(START_OPENING);
    const stub = gameStub(gameId);

    mockProviderMoves([FOOLS_MATE_MOVES[0]]);
    await runInDurableObject(stub, (instance: GameDurableObject) =>
      instance.start(pairing, config),
    );
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const afterAlarm = await snapshotOf(stub);
    expect(afterAlarm.finished).toBeUndefined();
    expect(compactDecisions(afterAlarm.decisions)).toEqual([
      { ply: 0, colour: "white", competitor: "alpha", move: "f2f3" },
    ]);

    const resumeSpy = mockProviderMoves(FOOLS_MATE_MOVES.slice(1));
    // vi.spyOn returns the existing mock when the target is already spied, so
    // the alarm's call is still on the counter. Clear it to count the resume.
    resumeSpy.mockClear();
    const result = await record(stub, pairing, config, scheduleFor());

    expect(resumeSpy).toHaveBeenCalledTimes(3);
    expect(result.finished).toEqual({ result: "black", reason: "checkmate" });
    expect(result.decisions).toHaveLength(4);
    expect(result.decisions[0]).toEqual(afterAlarm.decisions[0]);
    expect(compactDecisions(result.decisions)).toEqual([
      { ply: 0, colour: "white", competitor: "alpha", move: "f2f3" },
      { ply: 1, colour: "black", competitor: "beta", move: "e7e5" },
      { ply: 2, colour: "white", competitor: "alpha", move: "g2g4" },
      { ply: 3, colour: "black", competitor: "beta", move: "d8h4" },
    ]);
  });

  test(
    "records immediately without waiting on a far-future schedule, and stores the schedule unchanged",
    async () => {
      const gameId = "record-does-not-wait";
      mockProviderMoves(["f7g7"]);
      const stub = gameStub(gameId);
      const farFutureSchedule = scheduleFor(Date.now() + 1_000 * 60 * 60 * 24 * 365 * 50, 4_000);

      const result = await record(
        stub,
        pairingFor(gameId, MATE_IN_ONE_OPENING),
        configFor(MATE_IN_ONE_OPENING),
        farFutureSchedule,
      );

      expect(result.finished).toEqual({ result: "white", reason: "checkmate" });
      expect(await findStoredSchedule(stub)).toEqual(farFutureSchedule);
    },
    2_000,
  );

  test("a provider failure on one ply does not lose the plies already recorded", async () => {
    const gameId = "record-partial-failure";
    const stub = gameStub(gameId);
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(providerResponse("f2f3")))
      .mockImplementation(() =>
        Promise.reject(new Error("provider unavailable mid-game")),
      );

    await expect(
      record(
        stub,
        pairingFor(gameId, START_OPENING),
        configFor(START_OPENING),
        scheduleFor(),
      ),
    ).rejects.toThrow("provider unavailable mid-game");

    const survived = await snapshotOf(stub);
    expect(survived.finished).toBeUndefined();
    expect(compactDecisions(survived.decisions)).toEqual([
      { ply: 0, colour: "white", competitor: "alpha", move: "f2f3" },
    ]);
  });
});
