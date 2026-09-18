import { NotImplemented } from "../core/errors.ts";
import type {
  ArenaStore,
  Bracket,
  CompetitorProfile,
  DashboardEntry,
  EpochMs,
  Leaderboard,
  RevealedGame,
  RevealedMoves,
  RivalrySummary,
} from "../core/types.ts";

export interface ReadContext {
  readonly store: ArenaStore;
  /** Evaluated once per request, so every view in it agrees on the clock. */
  readonly now: EpochMs;
}

/** A game sliced to its revealed prefix. Undefined when it does not exist. */
export function gameView(
  context: ReadContext,
  seasonId: string,
  gameId: string,
): Promise<RevealedGame | undefined> {
  void context;
  void seasonId;
  void gameId;
  throw new NotImplemented("api.read.gameView");
}

/** Legal moves at the revealed position, for guess-the-move. */
export function movesView(
  context: ReadContext,
  seasonId: string,
  gameId: string,
): Promise<RevealedMoves | undefined> {
  void context;
  void seasonId;
  void gameId;
  throw new NotImplemented("api.read.movesView");
}

/**
 * Standings from revealed games only. A game still on air contributes nothing,
 * which is the whole point.
 */
export function leaderboardView(
  context: ReadContext,
  seasonId: string,
): Promise<Leaderboard> {
  void context;
  void seasonId;
  throw new NotImplemented("api.read.leaderboardView");
}

/** The revealed head of every game in a season, most interesting first. */
export function dashboardView(
  context: ReadContext,
  seasonId: string,
): Promise<readonly DashboardEntry[]> {
  void context;
  void seasonId;
  throw new NotImplemented("api.read.dashboardView");
}

/** A bracket with unrevealed rounds still reading "winner of match N". */
export function bracketView(
  context: ReadContext,
  bracketId: string,
): Promise<Bracket | undefined> {
  void context;
  void bracketId;
  throw new NotImplemented("api.read.bracketView");
}

/** Record, lineage, strategy mix, calibration and rivals, revealed only. */
export function competitorView(
  context: ReadContext,
  competitor: string,
): Promise<CompetitorProfile | undefined> {
  void context;
  void competitor;
  throw new NotImplemented("api.read.competitorView");
}

/** One pair's history, active traits and the games behind them. */
export function rivalryView(
  context: ReadContext,
  competitor: string,
  opponent: string,
): Promise<RivalrySummary | undefined> {
  void context;
  void competitor;
  void opponent;
  throw new NotImplemented("api.read.rivalryView");
}

/**
 * Routes the read surface.
 *
 * Contract:
 * - Returns undefined when nothing matches, so the worker can fall through to
 *   the existing routes and the static assets.
 * - Every response carries a Cache-Control from the reveal boundary, so a
 *   revealed prefix caches until it changes.
 * - Ids are validated before they reach the store, and a bad id is 404 rather
 *   than an error.
 */
export function handleRead(
  request: Request,
  context: ReadContext,
): Promise<Response | undefined> {
  void request;
  void context;
  throw new NotImplemented("api.read.handleRead");
}
