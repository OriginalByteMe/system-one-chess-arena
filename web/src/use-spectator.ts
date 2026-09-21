import { useEffect, useReducer, useRef, useState } from "react";

import {
  FEATURE_KEYS,
  STRATEGY_LABELS,
  type DecisionRecord,
  type FallbackReason,
  type FeatureKey,
  type GameResult,
  type LiveEvent,
  type MoveDistribution,
  type SpectatorState,
  type StrategyLabel,
  type TerminalReason,
  type TokenUsage,
} from "../../src/core/types.ts";
import {
  applyEvent,
  initialSpectatorState,
  resubscribeCursor,
} from "../../src/live/stream.ts";

const INITIAL_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type ConnectionState = "connecting" | "live" | "offline";

interface SpectatorConnection {
  readonly state: SpectatorState;
  readonly connection: ConnectionState;
  /**
   * True once the socket has completed at least one successful handshake.
   * A connection that has never opened even once usually means the game's
   * Durable Object has not started yet, distinct from one that opened and
   * later dropped.
   */
  readonly everConnected: boolean;
}


function isStrategy(value: unknown): value is StrategyLabel {
  return typeof value === "string" && STRATEGY_LABELS.some((label) => label === value);
}

function isGameResult(value: unknown): value is GameResult {
  return value === "white" || value === "black" || value === "draw";
}

function isTerminalReason(value: unknown): value is TerminalReason {
  return (
    value === "checkmate" ||
    value === "stalemate" ||
    value === "insufficient-material" ||
    value === "fifty-move" ||
    value === "threefold" ||
    value === "move-limit"
  );
}

/**
 * The decision behind a live move. A spectator gets the whole audit row - the
 * distribution, the token counts, the features the competitor was allowed to
 * see - so the live board can show the same reasoning a replay does. Anything
 * malformed drops the event rather than half-rendering it.
 */
function parseDecision(value: unknown): DecisionRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw: Record<string, unknown> = { ...value };

  const strings = ["seasonId", "gameId", "competitor", "version", "fen", "move", "idempotencyKey"];
  for (const key of strings) {
    if (typeof raw[key] !== "string") return undefined;
  }
  if (typeof raw.ply !== "number" || typeof raw.legalMoveCount !== "number") return undefined;
  if (typeof raw.latencyMs !== "number") return undefined;
  if (raw.colour !== "white" && raw.colour !== "black") return undefined;
  if (!isStrategy(raw.strategy)) return undefined;
  if (!Array.isArray(raw.featuresSeen) || !raw.featuresSeen.every(isFeatureKey)) return undefined;

  const confidence = typeof raw.confidence === "number" ? raw.confidence : undefined;
  const distribution = parseDistribution(raw.distribution);
  const tokens = parseTokens(raw.tokens);
  const fallback = isFallbackReason(raw.fallback) ? raw.fallback : undefined;

  return {
    seasonId: String(raw.seasonId),
    gameId: String(raw.gameId),
    ply: raw.ply,
    competitor: String(raw.competitor),
    version: String(raw.version),
    colour: raw.colour,
    fen: String(raw.fen),
    legalMoveCount: raw.legalMoveCount,
    move: String(raw.move),
    strategy: raw.strategy,
    ...(confidence === undefined ? {} : { confidence }),
    ...(distribution === undefined ? {} : { distribution }),
    latencyMs: raw.latencyMs,
    ...(tokens === undefined ? {} : { tokens }),
    ...(fallback === undefined ? {} : { fallback }),
    featuresSeen: raw.featuresSeen,
    idempotencyKey: String(raw.idempotencyKey),
  };
}

function parseDistribution(value: unknown): MoveDistribution | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function parseTokens(value: unknown): TokenUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw: Record<string, unknown> = { ...value };
  return typeof raw.in === "number" && typeof raw.out === "number"
    ? { in: raw.in, out: raw.out }
    : undefined;
}

function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && FEATURE_KEYS.some((key) => key === value);
}

function isFallbackReason(value: unknown): value is FallbackReason {
  return (
    value === "timeout" ||
    value === "illegal-output" ||
    value === "provider-error" ||
    value === "malformed-response" ||
    value === "malformed-distribution" ||
    value === "unknown-strategy"
  );
}

function parseLiveEvent(value: unknown): LiveEvent | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("gameId" in value) ||
    typeof value.gameId !== "string" ||
    !("ply" in value) ||
    typeof value.ply !== "number" ||
    !("type" in value)
  ) {
    return undefined;
  }

  if (
    value.type === "result" &&
    "result" in value &&
    isGameResult(value.result) &&
    "reason" in value &&
    isTerminalReason(value.reason)
  ) {
    return {
      type: "result",
      gameId: value.gameId,
      ply: value.ply,
      result: value.result,
      reason: value.reason,
    };
  }

  if (
    value.type !== "move" ||
    !("move" in value) ||
    typeof value.move !== "string" ||
    !("fen" in value) ||
    typeof value.fen !== "string" ||
    !("competitor" in value) ||
    typeof value.competitor !== "object" ||
    value.competitor === null ||
    !("name" in value.competitor) ||
    typeof value.competitor.name !== "string" ||
    !("version" in value.competitor) ||
    typeof value.competitor.version !== "string" ||
    !("strategy" in value) ||
    !isStrategy(value.strategy) ||
    !("latencyMs" in value) ||
    typeof value.latencyMs !== "number" ||
    ("confidence" in value &&
      value.confidence !== undefined &&
      typeof value.confidence !== "number")
  ) {
    return undefined;
  }
  const confidence =
    "confidence" in value && typeof value.confidence === "number"
      ? value.confidence
      : undefined;
  const decision = parseDecision("decision" in value ? value.decision : undefined);
  if (decision === undefined) return undefined;

  return {
    type: "move",
    gameId: value.gameId,
    ply: value.ply,
    move: value.move,
    fen: value.fen,
    competitor: {
      name: value.competitor.name,
      version: value.competitor.version,
    },
    strategy: value.strategy,
    ...(confidence === undefined ? {} : { confidence }),
    latencyMs: value.latencyMs,
    decision,
  };
}

/**
 * Streams one game's live decisions over a WebSocket.
 *
 * Contract: `gameId` may be undefined so a page can render before it knows
 * which game it is watching (or, once a recorded copy has been filed, to
 * stop watching one it no longer needs) - no socket is opened until it is a
 * string, and any socket already open is torn down the moment it goes back
 * to undefined.
 */
export function useSpectator(gameId: string | undefined): SpectatorConnection {
  const [state, dispatch] = useReducer(
    applyEvent,
    initialSpectatorState(gameId ?? "", INITIAL_FEN),
  );
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [everConnected, setEverConnected] = useState(false);
  const cursor = useRef(resubscribeCursor(state));
  cursor.current = resubscribeCursor(state);

  useEffect(() => {
    if (gameId === undefined) return undefined;
    let stopped = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;

    const connect = () => {
      setConnection("connecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const path = `/api/games/${encodeURIComponent(gameId)}/spectate`;
      socket = new WebSocket(
        `${protocol}//${window.location.host}${path}?cursor=${cursor.current}`,
      );
      socket.addEventListener("open", () => {
        setConnection("live");
        setEverConnected(true);
      });
      socket.addEventListener("message", (message) => {
        if (typeof message.data !== "string") return;
        const parsed: unknown = JSON.parse(message.data);
        const event = parseLiveEvent(parsed);
        if (event?.gameId === gameId) dispatch(event);
      });
      socket.addEventListener("close", () => {
        if (stopped) return;
        setConnection("offline");
        reconnectTimer = window.setTimeout(connect, 1_500);
      });
      socket.addEventListener("error", () => socket?.close());
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [gameId]);

  return { state, connection, everConnected };
}
