import {
  env,
  evictDurableObject,
  listDurableObjectIds,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Env } from "../src/core/env.ts";
import type {
  CompetitorManifest,
  Opening,
  Pairing,
  SeasonConfig,
} from "../src/core/types.ts";
import {
  GameDurableObject,
  type GameSnapshot,
} from "../src/do/game.ts";

const INITIAL_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const AFTER_E4_E5_FEN =
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

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
  id: "contract-start",
  name: "Initial position",
  moves: [],
  fen: INITIAL_FEN,
};

const MATE_IN_ONE_OPENING: Opening = {
  id: "contract-mate-in-one",
  name: "White mates with Qg7",
  moves: [],
  fen: "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1",
};

const arenaEnv = env as Env;

function gameNamespace(): DurableObjectNamespace<GameDurableObject> {
  return arenaEnv.GAME as DurableObjectNamespace<GameDurableObject>;
}

function configFor(opening: Opening, budgetMaxMs = 1_000): SeasonConfig {
  return {
    seasonId: "season-workers-contract",
    seed: "workers-contract-seed",
    competitors: [
      { ...WHITE_MANIFEST, budget: { maxMs: budgetMaxMs } },
      { ...BLACK_MANIFEST, budget: { maxMs: budgetMaxMs } },
    ],
    openings: [opening],
    roundsPerPair: 1,
    maxPlies: 80,
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

async function startGame(
  gameId: string,
  opening: Opening = START_OPENING,
  budgetMaxMs = 1_000,
): Promise<DurableObjectStub<GameDurableObject>> {
  const namespace = gameNamespace();
  const id = namespace.idFromName(gameId);
  const stub = namespace.get(id);
  await runInDurableObject(stub, (instance: GameDurableObject) =>
    instance.start(pairingFor(gameId, opening), configFor(opening, budgetMaxMs)),
  );
  return stub;
}

async function snapshot(
  stub: DurableObjectStub<GameDurableObject>,
): Promise<GameSnapshot> {
  return runInDurableObject(stub, (instance: GameDurableObject) =>
    instance.snapshot(),
  );
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

async function openSpectator(
  stub: DurableObjectStub<GameDurableObject>,
  cursor?: number,
): Promise<WebSocket> {
  const query = cursor === undefined ? "" : `?cursor=${cursor}`;
  const response = await stub.fetch(
    new Request(`https://arena.test/spectate${query}`, {
      headers: { Upgrade: "websocket" },
    }),
  );
  const socket = response.webSocket;
  if (response.status !== 101 || socket === null) {
    throw new Error(`expected WebSocket upgrade, received ${response.status}`);
  }
  socket.accept();
  return socket;
}

function nextSocketMessage(socket: WebSocket): Promise<unknown> {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  socket.addEventListener(
    "message",
    (event) => {
      if (typeof event.data !== "string") {
        reject(new Error("expected a text WebSocket message"));
        return;
      }
      const parsed: unknown = JSON.parse(event.data);
      resolve(parsed);
    },
    { once: true },
  );
  return promise;
}

function collectSocketMessages(
  socket: WebSocket,
  count: number,
): Promise<readonly unknown[]> {
  const { promise, resolve, reject } =
    Promise.withResolvers<readonly unknown[]>();
  const messages: unknown[] = [];
  const onMessage = (event: MessageEvent): void => {
    if (typeof event.data !== "string") {
      socket.removeEventListener("message", onMessage);
      reject(new Error("expected a text WebSocket message"));
      return;
    }
    const parsed: unknown = JSON.parse(event.data);
    messages.push(parsed);
    if (messages.length === count) {
      socket.removeEventListener("message", onMessage);
      resolve(messages);
    }
  };
  socket.addEventListener("message", onMessage);
  return promise;
}

function receivesMessageWithin(
  socket: WebSocket,
  waitMs: number,
): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const onMessage = (): void => {
    clearTimeout(timer);
    resolve(true);
  };
  const timer = setTimeout(() => {
    socket.removeEventListener("message", onMessage);
    resolve(false);
  }, waitMs);
  socket.addEventListener("message", onMessage, { once: true });
  return promise;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GameDurableObject", () => {
  test("start persists its pairing and schedules the first alarm", async () => {
    const gameId = "game-start-persists";
    const namespace = gameNamespace();
    const id = namespace.idFromName(gameId);
    const stub = await startGame(gameId);

    const persisted = await runInDurableObject(stub, async (_instance, state) => ({
      pairing: await state.storage.get<Pairing>("pairing"),
      alarm: await state.storage.getAlarm(),
    }));
    const ids = await listDurableObjectIds(namespace);

    expect(persisted.pairing).toEqual(pairingFor(gameId, START_OPENING));
    expect(typeof persisted.alarm).toBe("number");
    expect(ids).toHaveLength(1);
    expect(ids[0]?.equals(id)).toBe(true);
  });

  test("an unstarted game refuses a spectator upgrade", async () => {
    const namespace = gameNamespace();
    const stub = namespace.get(namespace.idFromName("game-not-started"));

    const response = await stub.fetch(
      new Request("https://arena.test/spectate", {
        headers: { Upgrade: "websocket" },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();
  });

  test("one alarm advances exactly one ply and schedules the next", async () => {
    mockProviderMoves(["e2e4"]);
    const stub = await startGame("game-one-ply");

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const committed = await snapshot(stub);
    const nextAlarm = await runInDurableObject(stub, (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect({
      fen: committed.fen,
      ply: committed.ply,
      decisions: committed.decisions.map((decision) => ({
        ply: decision.ply,
        move: decision.move,
        competitor: decision.competitor,
      })),
    }).toEqual({
      fen: AFTER_E4_FEN,
      ply: 1,
      decisions: [{ ply: 0, move: "e2e4", competitor: "alpha" }],
    });
    expect(typeof nextAlarm).toBe("number");
  });

  test("duplicate delivery for one game, ply, and version commits one identical move and calls the provider once", async () => {
    const providerSpy = mockProviderMoves(["e2e4"]);
    const stub = await startGame("game-duplicate-alarm");

    await runInDurableObject(stub, async (instance: GameDurableObject) => {
      await Promise.all([instance.alarm(), instance.alarm()]);
    });

    const committed = await snapshot(stub);
    expect(providerSpy).toHaveBeenCalledTimes(1);
    expect(committed.ply).toBe(1);
    expect(
      committed.decisions.map((decision) => ({
        ply: decision.ply,
        move: decision.move,
        version: decision.version,
      })),
    ).toEqual([{ ply: 0, move: "e2e4", version: "alpha-v1" }]);
  });

  test("a provider failure leaves the snapshot unchanged and a rescheduled alarm retries it", async () => {
    const providerSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        Promise.reject(new Error("provider unavailable before commit")),
      )
      .mockImplementation(() => Promise.resolve(providerResponse("e2e4")));
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stub = await startGame("game-provider-retry");
    const before = await snapshot(stub);

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    expect(await snapshot(stub)).toEqual(before);
    const retryAlarm = await runInDurableObject(stub, (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect(typeof retryAlarm).toBe("number");
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "game-alarm-failed",
        gameId: "game-provider-retry",
        failureCount: 1,
        retryDelayMs: 1_000,
        error: expect.objectContaining({
          message: "provider unavailable before commit",
        }),
      }),
    );

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const retried = await snapshot(stub);
    expect(providerSpy).toHaveBeenCalledTimes(2);
    expect({
      fen: retried.fen,
      ply: retried.ply,
      moves: retried.decisions.map((decision) => decision.move),
    }).toEqual({ fen: AFTER_E4_FEN, ply: 1, moves: ["e2e4"] });
  });

  test("an over-budget provider call aborts and commits the timeout fallback", async () => {
    const providerSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) {
          return Promise.reject(new Error("provider request has no abort signal"));
        }
        return new Promise<Response>((_resolve, reject) => {
          const abort = (): void => reject(signal.reason);
          if (signal.aborted) {
            abort();
          } else {
            signal.addEventListener("abort", abort, { once: true });
          }
        });
      });
    const stub = await startGame("game-provider-timeout", START_OPENING, 5);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const committed = await snapshot(stub);
    expect(providerSpy).toHaveBeenCalledTimes(1);
    expect({
      ply: committed.ply,
      fallback: committed.decisions[0]?.fallback,
    }).toEqual({ ply: 1, fallback: "timeout" });
  });

  test("fen, ply, and decisions survive eviction and reload through a fresh stub", async () => {
    mockProviderMoves(["e2e4"]);
    const namespace = gameNamespace();
    const id = namespace.idFromName("game-eviction");
    const stub = await startGame("game-eviction");
    await runDurableObjectAlarm(stub);
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.deleteAlarm();
    });
    await evictDurableObject(stub);

    const freshStub = namespace.get(id);
    const restored = await snapshot(freshStub);
    expect({
      fen: restored.fen,
      ply: restored.ply,
      decisions: restored.decisions.map((decision) => ({
        ply: decision.ply,
        move: decision.move,
        competitor: decision.competitor,
      })),
    }).toEqual({
      fen: AFTER_E4_FEN,
      ply: 1,
      decisions: [{ ply: 0, move: "e2e4", competitor: "alpha" }],
    });
  });

  test("spectators receive committed moves in ply order and no rolled-back move", async () => {
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve(providerResponse("e2e4"));
      if (call === 2) return Promise.resolve(providerResponse("e7e5"));
      return Promise.reject(new Error("provider failed before third commit"));
    });
    const gameId = "game-spectator-order";
    const stub = await startGame(gameId);
    const socket = await openSpectator(stub);

    const firstMessage = nextSocketMessage(socket);
    await runDurableObjectAlarm(stub);
    const afterFirstCommit = await snapshot(stub);
    const firstEvent = await firstMessage;

    const secondMessage = nextSocketMessage(socket);
    await runDurableObjectAlarm(stub);
    const afterSecondCommit = await snapshot(stub);
    const secondEvent = await secondMessage;

    expect(firstEvent).toEqual(
      expect.objectContaining({
        type: "move",
        gameId,
        ply: 1,
        move: "e2e4",
        fen: AFTER_E4_FEN,
        competitor: { name: "alpha", version: "alpha-v1" },
        strategy: "direct",
        confidence: 0.75,
      }),
    );
    expect(secondEvent).toEqual(
      expect.objectContaining({
        type: "move",
        gameId,
        ply: 2,
        move: "e7e5",
        fen: AFTER_E4_E5_FEN,
        competitor: { name: "beta", version: "beta-v1" },
        strategy: "direct",
        confidence: 0.75,
      }),
    );
    expect([afterFirstCommit.ply, afterSecondCommit.ply]).toEqual([1, 2]);

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers();
    const rolledBackMessage = receivesMessageWithin(socket, 25);
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(25);
    expect(await rolledBackMessage).toBe(false);
    vi.useRealTimers();
    const afterRollback = await snapshot(stub);
    expect({
      fen: afterRollback.fen,
      ply: afterRollback.ply,
      moves: afterRollback.decisions.map((decision) => decision.move),
    }).toEqual({
      fen: AFTER_E4_E5_FEN,
      ply: 2,
      moves: ["e2e4", "e7e5"],
    });

    socket.close(1000, "test complete");
  });

  test("a late spectator replays only committed moves after its cursor", async () => {
    mockProviderMoves(["e2e4", "e7e5"]);
    const gameId = "game-spectator-resume";
    const stub = await startGame(gameId);
    await runDurableObjectAlarm(stub);
    await runDurableObjectAlarm(stub);
    const current = await snapshot(stub);

    const socket = await openSpectator(stub, 1);
    const replayed = await nextSocketMessage(socket);

    expect(replayed).toEqual(
      expect.objectContaining({
        type: "move",
        gameId,
        ply: 2,
        move: "e7e5",
        fen: current.fen,
        competitor: { name: "beta", version: "beta-v1" },
      }),
    );

    socket.close(1000, "test complete");
  });

  test("a terminal move clears the alarm and emits a result event", async () => {
    mockProviderMoves(["f7g7"]);
    const gameId = "game-terminal";
    const stub = await startGame(gameId, MATE_IN_ONE_OPENING);
    const socket = await openSpectator(stub);
    const messages = collectSocketMessages(socket, 2);

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const terminal = await snapshot(stub);
    const nextAlarm = await runInDurableObject(stub, (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect(terminal.ply).toBe(1);
    expect(terminal.finished).toEqual({
      result: "white",
      reason: "checkmate",
    });
    expect(nextAlarm).toBeNull();
    await expect(messages).resolves.toEqual([
      expect.objectContaining({
        type: "move",
        gameId,
        ply: 1,
        move: "f7g7",
      }),
      {
        type: "result",
        gameId,
        ply: 1,
        result: "white",
        reason: "checkmate",
      },
    ]);

    socket.close(1000, "test complete");
  });

  test("a late spectator receives the terminal move followed by the result", async () => {
    mockProviderMoves(["f7g7"]);
    const gameId = "game-terminal-replay";
    const stub = await startGame(gameId, MATE_IN_ONE_OPENING);
    await runDurableObjectAlarm(stub);

    const socket = await openSpectator(stub);
    const messages = await collectSocketMessages(socket, 2);

    expect(messages).toEqual([
      expect.objectContaining({
        type: "move",
        gameId,
        ply: 1,
        move: "f7g7",
      }),
      {
        type: "result",
        gameId,
        ply: 1,
        result: "white",
        reason: "checkmate",
      },
    ]);

    socket.close(1000, "test complete");
  });
});

