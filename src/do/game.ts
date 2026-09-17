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
  ChatResponse,
  CompetitorManifest,
  CompetitorRef,
  DecisionRecord,
  Fen,
  LiveEvent,
  MoveEvent,
  Pairing,
  ProviderFailure,
  ResultEvent,
  SeasonConfig,
  TerminalState,
  TokenUsage,
  Uci,
} from "../core/types.ts";
import { applyFallback } from "../core/validation.ts";
import { buildLlmRequest, parseLlmResponse } from "../players/llm.ts";
import { idempotencyKey } from "../season/log.ts";

const DECISION_PREFIX = "decision:";
const ALARM_DELAY_MS = 1_000;

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
    });

    if (finished === undefined) {
      await this.ctx.storage.setAlarm(
        performance.timeOrigin + createSystemClock().now() + ALARM_DELAY_MS,
      );
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async alarm(): Promise<void> {
    if (this.alarmInFlight !== undefined) {
      return this.alarmInFlight;
    }

    const operation = this.advanceOnePly();
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
    const { pathname } = new URL(request.url);
    if (pathname !== "/spectate") {
      return new Response("Not found", { status: 404 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async snapshot(): Promise<GameSnapshot> {
    const { game } = this.storedGame("snapshot");
    const decisions = [...this.ctx.storage.kv.list<DecisionRecord>({
      prefix: DECISION_PREFIX,
    })]
      .map((entry) => entry[1])
      .sort((left, right) => left.ply - right.ply);

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

  private storedGame(method: string): StoredGame {
    const pairing = this.ctx.storage.kv.get<Pairing>("pairing");
    const config = this.ctx.storage.kv.get<SeasonConfig>("config");
    const game = this.ctx.storage.kv.get<PersistedGame>("game");
    if (pairing === undefined || config === undefined || game === undefined) {
      violation(method, "game has not been started");
    }
    return { pairing, config, game };
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
    const response = await fetch(this.env.TYPESAFE_BASE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.env.TYPESAFE_API_KEY
          ? { authorization: `Bearer ${this.env.TYPESAFE_API_KEY}` }
          : {}),
      },
      body: JSON.stringify(buildLlmRequest(input)),
    });
    const providerValue: unknown = await response.json();
    if (!isObject(providerValue)) {
      violation("alarm", "provider response must be an object");
    }
    let tokens: TokenUsage | undefined;
    if (providerValue.tokens !== undefined) {
      if (
        !isObject(providerValue.tokens) ||
        typeof providerValue.tokens.in !== "number" ||
        !Number.isFinite(providerValue.tokens.in) ||
        typeof providerValue.tokens.out !== "number" ||
        !Number.isFinite(providerValue.tokens.out)
      ) {
        violation(
          "alarm",
          "provider tokens must contain finite in and out counts",
        );
      }
      tokens = {
        in: providerValue.tokens.in,
        out: providerValue.tokens.out,
      };
    }

    let providerResponse: ChatResponse | ProviderFailure;
    if (providerValue.kind === "chat" && typeof providerValue.text === "string") {
      providerResponse =
        tokens === undefined
          ? { kind: "chat", text: providerValue.text }
          : { kind: "chat", text: providerValue.text, tokens };
    } else if (
      providerValue.kind === "error" &&
      typeof providerValue.message === "string" &&
      (providerValue.status === undefined ||
        (typeof providerValue.status === "number" &&
          Number.isFinite(providerValue.status)))
    ) {
      providerResponse = {
        kind: "error",
        message: providerValue.message,
        ...(providerValue.status === undefined
          ? {}
          : { status: providerValue.status }),
      };
    } else {
      violation("alarm", "provider response must be chat or error");
    }

    const latencyMs = clock.now() - startedAt;
    const parsed = parseLlmResponse(input, providerResponse, latencyMs);
    const decision = parsed.ok
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
      await this.ctx.storage.setAlarm(
        performance.timeOrigin + createSystemClock().now() + ALARM_DELAY_MS,
      );
    } else {
      await this.ctx.storage.deleteAlarm();
    }

    const moveEvent: MoveEvent = {
      type: "move",
      gameId: stored.pairing.gameId,
      ply: nextPosition.ply,
      move: decision.move,
      fen: nextPosition.fen,
      competitor,
      strategy: decision.strategy,
      ...(decision.confidence === undefined
        ? {}
        : { confidence: decision.confidence }),
      latencyMs: decision.latencyMs,
    };
    this.broadcast(moveEvent);
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
