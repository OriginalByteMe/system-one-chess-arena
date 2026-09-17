import { useEffect, useReducer, useRef, useState } from "react";

import {
  STRATEGY_LABELS,
  type GameResult,
  type LiveEvent,
  type SpectatorState,
  type StrategyLabel,
  type TerminalReason,
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
  };
}

export function useSpectator(gameId: string): SpectatorConnection {
  const [state, dispatch] = useReducer(
    applyEvent,
    initialSpectatorState(gameId, INITIAL_FEN),
  );
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const cursor = useRef(resubscribeCursor(state));
  cursor.current = resubscribeCursor(state);

  useEffect(() => {
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
      socket.addEventListener("open", () => setConnection("live"));
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

  return { state, connection };
}
