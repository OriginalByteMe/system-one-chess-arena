import { DurableObject } from "cloudflare:workers";

import { createSystemClock } from "../core/clock.ts";
import { ContractViolation } from "../core/errors.ts";
import type { Env } from "../core/env.ts";
import { buildPositionInput } from "../core/position-input.ts";
import { createRng } from "../core/rng.ts";
import {
  applyMove,
  positionFromFen,
  terminalState,
  type Position,
} from "../core/rules.ts";
import type {
  BroadcastSchedule,
  ChatResponse,
  CompetitorManifest,
  CompetitorRef,
  DecisionRecord,
  Fen,
  LiveEvent,
  MoveEvent,
  MoveDecision,
  Pairing,
  ProviderFailure,
  ResultEvent,
  SeasonConfig,
  TerminalState,
  TokenUsage,
  Uci,
} from "../core/types.ts";
import { applyFallback } from "../core/validation.ts";
import { buildJevRequests, parseJevResponses } from "../players/jev.ts";
import { buildLlmRequest, parseLlmResponse } from "../players/llm.ts";
import { parseSystemOneResponse, toSystemOneBody } from "../providers/wire.ts";
import { idempotencyKey } from "../season/log.ts";

const DECISION_PREFIX = "decision:";
const ALARM_FAILURE_COUNT = "alarm-failure-count";
const ALARM_DELAY_MS = 1_000;
const MAX_ALARM_RETRY_DELAY_MS = 60_000;

interface PersistedGame {
  readonly position: Position;
  readonly lastMove?: Uci;
  readonly finished?: TerminalState;
}

interface StoredGame {
  readonly pairing: Pairing;
  readonly config: SeasonConfig;
  readonly game: PersistedGame;
}

export interface GameSnapshot {
  readonly fen: Fen;
  readonly ply: number;
  readonly decisions: readonly DecisionRecord[];
  readonly finished?: TerminalState;
}

function violation(method: string, detail: string): never {
  throw new ContractViolation(`do/game.GameDurableObject.${method}`, detail);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProviderResponse(value: unknown): ChatResponse | ProviderFailure {
  if (!isObject(value)) {
    violation("alarm", "provider response must be an object");
  }

  let tokens: TokenUsage | undefined;
  if (value.tokens !== undefined) {
    if (
      !isObject(value.tokens) ||
      typeof value.tokens.in !== "number" ||
      !Number.isFinite(value.tokens.in) ||
      typeof value.tokens.out !== "number" ||
      !Number.isFinite(value.tokens.out)
    ) {
      violation(
        "alarm",
        "provider tokens must contain finite in and out counts",
      );
    }
    tokens = {
      in: value.tokens.in,
      out: value.tokens.out,
    };
  }

  if (value.kind === "chat" && typeof value.text === "string") {
    return tokens === undefined
      ? { kind: "chat", text: value.text }
      : { kind: "chat", text: value.text, tokens };
  }
  if (
    value.kind === "error" &&
    typeof value.message === "string" &&
    (value.status === undefined ||
      (typeof value.status === "number" && Number.isFinite(value.status)))
  ) {
    return {
      kind: "error",
      message: value.message,
      ...(value.status === undefined ? {} : { status: value.status }),
    };
  }
  violation("alarm", "provider response must be chat or error");
}

function parseCursor(url: URL): number {
  const value = url.searchParams.get("cursor");
  if (value === null || !/^(0|[1-9]\d*)$/.test(value)) return 0;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : 0;
}

function moveEvent(record: DecisionRecord, fen: Fen): MoveEvent {
  return {
    type: "move",
    gameId: record.gameId,
    ply: record.ply + 1,
    move: record.move,
    fen,
    competitor: { name: record.competitor, version: record.version },
    strategy: record.strategy,
    ...(record.confidence === undefined
      ? {}
      : { confidence: record.confidence }),
    latencyMs: record.latencyMs,
  };
}

function manifestFor(
  config: SeasonConfig,
  competitor: CompetitorRef,
  method: string,
): CompetitorManifest {
  const manifest = config.competitors.find(
    (candidate) =>
      candidate.name === competitor.name &&
      candidate.version === competitor.version,
  );
  if (manifest === undefined) {
    violation(
      method,
      `missing competitor manifest: ${competitor.name}@${competitor.version}`,
    );
  }
  return manifest;
}

export class GameDurableObject extends DurableObject<Env> {
  private alarmInFlight: Promise<void> | undefined;

  async start(pairing: Pairing, config: SeasonConfig): Promise<void> {
    const opening = config.openings.find(
      (candidate) => candidate.id === pairing.openingId,
    );
    if (opening === undefined) {
      violation("start", `missing opening: ${pairing.openingId}`);
    }
    manifestFor(config, pairing.white, "start");
    manifestFor(config, pairing.black, "start");

    const position = positionFromFen(
      opening.fen,
      opening.moves.length,
      opening.moves,
    );
    const finished = terminalState(position, config.maxPlies);
    const game: PersistedGame =
      finished === undefined ? { position } : { position, finished };

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.kv.put("pairing", pairing);
      this.ctx.storage.kv.put("config", config);
      this.ctx.storage.kv.put("game", game);
      this.ctx.storage.kv.delete(ALARM_FAILURE_COUNT);
    });

    if (finished === undefined) {
      await this.scheduleAlarm(ALARM_DELAY_MS);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async alarm(): Promise<void> {
    if (this.alarmInFlight !== undefined) {
      return this.alarmInFlight;
    }

    const operation = this.runAlarm();
    this.alarmInFlight = operation;
    try {
      await operation;
    } finally {
      if (this.alarmInFlight === operation) {
        this.alarmInFlight = undefined;
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/spectate") {
      return new Response("Not found", { status: 404 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    const stored = this.loadStoredGame();
    if (stored === undefined) {
      return new Response("Game not found", { status: 404 });
    }
    const cursor = parseCursor(url);

    const events: LiveEvent[] = this.decisions()
      .filter((record) => record.ply + 1 > cursor)
      .map((record) =>
        moveEvent(
          record,
          applyMove(positionFromFen(record.fen, record.ply), record.move).fen,
        ),
      );
    if (stored.game.finished !== undefined) {
      events.push({
        type: "result",
        gameId: stored.pairing.gameId,
        ply: stored.game.position.ply,
        result: stored.game.finished.result,
        reason: stored.game.finished.reason,
      });
    }

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    for (const event of events) {
      pair[1].send(JSON.stringify(event));
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async snapshot(): Promise<GameSnapshot> {
    const { game } = this.storedGame("snapshot");
    const decisions = this.decisions();

    return game.finished === undefined
      ? {
          fen: game.position.fen,
          ply: game.position.ply,
          decisions,
        }
      : {
          fen: game.position.fen,
          ply: game.position.ply,
          decisions,
          finished: game.finished,
        };
  }

  /**
   * Records a whole game inside one invocation, for precomputed seasons.
   *
   * Contract:
   * - Plies loop in this call rather than one per alarm, so a 60-ply
   *   hierarchical game is 120 subrequests, inside the paid 1,000 ceiling.
   * - Idempotent: calling it again on a finished game returns the same
   *   snapshot and makes no provider call, because the coordinator retries.
   * - A game already part-played resumes from its stored position rather than
   *   starting over.
   * - The broadcast schedule is stored with the game so the gate can slice it
   *   later, and recording never waits on the clock.
   */
  async record(
    pairing: Pairing,
    config: SeasonConfig,
    schedule: BroadcastSchedule,
  ): Promise<GameSnapshot> {
    if (this.loadStoredGame() === undefined) {
      await this.start(pairing, config);
    }
    this.ctx.storage.kv.put("schedule", schedule);

    while (this.storedGame("record").game.finished === undefined) {
      await this.advanceOnePly();
    }
    return this.snapshot();
  }

  private loadStoredGame(): StoredGame | undefined {
    const pairing = this.ctx.storage.kv.get<Pairing>("pairing");
    const config = this.ctx.storage.kv.get<SeasonConfig>("config");
    const game = this.ctx.storage.kv.get<PersistedGame>("game");
    return pairing === undefined || config === undefined || game === undefined
      ? undefined
      : { pairing, config, game };
  }

  private storedGame(method: string): StoredGame {
    const stored = this.loadStoredGame();
    if (stored === undefined) {
      violation(method, "game has not been started");
    }
    return stored;
  }

  private decisions(): readonly DecisionRecord[] {
    return [
      ...this.ctx.storage.kv.list<DecisionRecord>({
        prefix: DECISION_PREFIX,
      }),
    ]
      .map((entry) => entry[1])
      .sort((left, right) => left.ply - right.ply);
  }

  private async scheduleAlarm(delayMs: number): Promise<void> {
    await this.ctx.storage.setAlarm(
      performance.timeOrigin + createSystemClock().now() + delayMs,
    );
  }

  private async runAlarm(): Promise<void> {
    try {
      await this.advanceOnePly();
      this.ctx.storage.kv.delete(ALARM_FAILURE_COUNT);
    } catch (error) {
      const failureCount =
        (this.ctx.storage.kv.get<number>(ALARM_FAILURE_COUNT) ?? 0) + 1;
      this.ctx.storage.kv.put(ALARM_FAILURE_COUNT, failureCount);
      const retryDelayMs = Math.min(
        ALARM_DELAY_MS * 2 ** Math.min(failureCount - 1, 10),
        MAX_ALARM_RETRY_DELAY_MS,
      );
      await this.scheduleAlarm(retryDelayMs);
      const pairing = this.ctx.storage.kv.get<Pairing>("pairing");
      console.error({
        event: "game-alarm-failed",
        ...(pairing === undefined ? {} : { gameId: pairing.gameId }),
        failureCount,
        retryDelayMs,
        error,
      });
    }
  }

  private async advanceOnePly(): Promise<void> {
    const stored = this.storedGame("alarm");
    if (stored.game.finished !== undefined) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const competitor =
      stored.game.position.turn === "white"
        ? stored.pairing.white
        : stored.pairing.black;
    const manifest = manifestFor(stored.config, competitor, "alarm");
    const input = buildPositionInput({
      seasonId: stored.config.seasonId,
      gameId: stored.pairing.gameId,
      position: stored.game.position,
      persona: manifest,
      ...(stored.game.lastMove === undefined
        ? {}
        : { lastMove: stored.game.lastMove }),
    });

    const clock = createSystemClock();
    const startedAt = clock.now();
    const signal = AbortSignal.timeout(manifest.budget.maxMs);
    const decisionModel = manifest.model.startsWith("jev");
    const requests: readonly unknown[] = decisionModel
      ? buildJevRequests(input).map(toSystemOneBody)
      : [buildLlmRequest(input)];
    const url = decisionModel
      ? `${this.env.TYPESAFE_BASE_URL.replace(/\/+$/, "")}/v1/systemone`
      : this.env.TYPESAFE_BASE_URL;
    const providerValues: unknown[] = [];
    const statuses: number[] = [];
    try {
      for (const body of requests) {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.env.TYPESAFE_API_KEY
              ? { authorization: `Bearer ${this.env.TYPESAFE_API_KEY}` }
              : {}),
          },
          body: JSON.stringify(body),
          signal,
        });
        statuses.push(response.status);
        providerValues.push(await response.json());
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }

    const latencyMs = clock.now() - startedAt;
    let decision: MoveDecision;
    if (signal.aborted || latencyMs > manifest.budget.maxMs) {
      decision = applyFallback(
        input,
        "timeout",
        createRng(
          `${stored.config.seed}:${idempotencyKey(
            stored.pairing.gameId,
            stored.game.position.ply,
            manifest.version,
          )}`,
        ),
        latencyMs,
      );
    } else {
      const parsed = decisionModel
        ? parseJevResponses(
            input,
            providerValues.map((value, index) =>
              parseSystemOneResponse(value, statuses[index] ?? 200),
            ),
            latencyMs,
          )
        : parseLlmResponse(
            input,
            parseProviderResponse(providerValues[0] ?? null),
            latencyMs,
          );
      decision = parsed.ok
        ? parsed.decision
        : applyFallback(
            input,
            parsed.reason,
            createRng(
              `${stored.config.seed}:${idempotencyKey(
                stored.pairing.gameId,
                stored.game.position.ply,
                manifest.version,
              )}`,
            ),
            latencyMs,
          );
    }

    const nextPosition = applyMove(stored.game.position, decision.move);
    const finished = terminalState(nextPosition, stored.config.maxPlies);
    const record: DecisionRecord = {
      seasonId: stored.config.seasonId,
      gameId: stored.pairing.gameId,
      ply: stored.game.position.ply,
      competitor: manifest.name,
      version: manifest.version,
      colour: stored.game.position.turn,
      fen: stored.game.position.fen,
      legalMoveCount: input.legalMoves.length,
      move: decision.move,
      strategy: decision.strategy,
      ...(decision.confidence === undefined
        ? {}
        : { confidence: decision.confidence }),
      ...(decision.distribution === undefined
        ? {}
        : { distribution: decision.distribution }),
      latencyMs: decision.latencyMs,
      ...(decision.tokens === undefined ? {} : { tokens: decision.tokens }),
      ...(decision.fallback === undefined
        ? {}
        : { fallback: decision.fallback }),
      featuresSeen: [...manifest.features],
      idempotencyKey: idempotencyKey(
        stored.pairing.gameId,
        stored.game.position.ply,
        manifest.version,
      ),
    };
    const decisionKey = `${DECISION_PREFIX}${record.idempotencyKey}`;
    const nextGame: PersistedGame =
      finished === undefined
        ? { position: nextPosition, lastMove: decision.move }
        : { position: nextPosition, lastMove: decision.move, finished };

    const committed = this.ctx.storage.transactionSync(() => {
      const current = this.storedGame("alarm").game;
      if (
        current.position.ply !== stored.game.position.ply ||
        current.position.fen !== stored.game.position.fen ||
        this.ctx.storage.kv.get<DecisionRecord>(decisionKey) !== undefined
      ) {
        return false;
      }
      this.ctx.storage.kv.put("game", nextGame);
      this.ctx.storage.kv.put(decisionKey, record);
      return true;
    });
    if (!committed) return;

    if (finished === undefined) {
      await this.scheduleAlarm(ALARM_DELAY_MS);
    } else {
      await this.ctx.storage.deleteAlarm();
    }

    const committedMoveEvent = moveEvent(record, nextPosition.fen);
    this.broadcast(committedMoveEvent);

    if (finished !== undefined) {
      const resultEvent: ResultEvent = {
        type: "result",
        gameId: stored.pairing.gameId,
        ply: nextPosition.ply,
        result: finished.result,
        reason: finished.reason,
      };
      this.broadcast(resultEvent);
    }
  }

  private broadcast(event: LiveEvent): void {
    const message = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // A disconnected spectator cannot roll back an already committed move.
      }
    }
  }
}
