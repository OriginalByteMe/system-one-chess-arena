import { Chess } from "chess.js";
import type {
  BroadcastSchedule,
  CompetitorRef,
  DecisionRecord,
  Fen,
  GameSummary,
  RecordedGame,
  StrategyLabel,
  TerminalState,
} from "../../src/core/types";

// Scholar's mate, replayed through chess.js so every fen and uci below is
// genuinely reachable rather than hand-typed. White mates on the 7th ply.
const SAN_MOVES = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"] as const;
const STRATEGIES: readonly StrategyLabel[] = [
  "direct",
  "direct",
  "attack",
  "develop",
  "attack",
  "develop",
  "attack",
];

export const WHITE: CompetitorRef = { name: "Alpha", version: "v1" };
export const BLACK: CompetitorRef = { name: "Beta", version: "v1" };

export const BROADCAST_SEASON_ID = "season-broadcast";
export const BROADCAST_GAME_ID = "game-scholars-mate";

interface Replay {
  readonly decisions: readonly DecisionRecord[];
  readonly summary: GameSummary;
  readonly finalFen: Fen;
}

function replayScholarsMate(): Replay {
  const chess = new Chess();
  const decisions: DecisionRecord[] = [];

  SAN_MOVES.forEach((san, index) => {
    const fenBefore: Fen = chess.fen();
    const legalMoveCount = chess.moves().length;
    const colour = chess.turn() === "w" ? "white" : "black";
    const competitor = colour === "white" ? WHITE : BLACK;
    const played = chess.move(san);
    if (played === null) {
      throw new Error(`broadcast fixture: illegal replay move ${san}`);
    }
    const move = `${played.from}${played.to}${played.promotion ?? ""}`;
    const strategy = STRATEGIES[index] ?? "direct";

    decisions.push({
      seasonId: BROADCAST_SEASON_ID,
      gameId: BROADCAST_GAME_ID,
      ply: index,
      competitor: competitor.name,
      version: competitor.version,
      colour,
      fen: fenBefore,
      legalMoveCount,
      move,
      strategy,
      latencyMs: 10,
      featuresSeen: ["materialBalance"],
      idempotencyKey: `${BROADCAST_GAME_ID}:${index}:${competitor.version}`,
    });
  });

  if (!chess.isCheckmate()) {
    throw new Error("broadcast fixture: replay did not end in checkmate");
  }

  const summary: GameSummary = {
    seasonId: BROADCAST_SEASON_ID,
    gameId: BROADCAST_GAME_ID,
    white: WHITE,
    black: BLACK,
    openingId: "start",
    result: "white",
    reason: "checkmate",
    plies: decisions.length,
    pgn: chess.pgn(),
  };

  return { decisions, summary, finalFen: chess.fen() };
}

const REPLAY = replayScholarsMate();

/** Ply 0 sees the fen the opening produced; ply N sees the fen after move N-1. */
export const BROADCAST_DECISIONS: readonly DecisionRecord[] = REPLAY.decisions;
export const BROADCAST_SUMMARY: GameSummary = REPLAY.summary;
/** Position after every recorded decision has been played out. */
export const BROADCAST_FINAL_FEN: Fen = REPLAY.finalFen;
export const BROADCAST_OUTCOME: TerminalState = {
  result: REPLAY.summary.result,
  reason: REPLAY.summary.reason,
};

export function broadcastSchedule(
  startAt: number,
  msPerPly: number,
): BroadcastSchedule {
  return { startAt, msPerPly };
}

export function recordedGame(
  schedule: BroadcastSchedule,
  matchId?: string,
): RecordedGame {
  return {
    summary: BROADCAST_SUMMARY,
    schedule,
    ...(matchId === undefined ? {} : { matchId }),
  };
}

/** The same decisions, deliberately out of ply order. */
export function shuffledBroadcastDecisions(): DecisionRecord[] {
  const [first, ...rest] = BROADCAST_DECISIONS;
  if (first === undefined) return [];
  return [...rest].reverse().concat(first);
}
