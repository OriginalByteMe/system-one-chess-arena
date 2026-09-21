import { ContractViolation } from "../core/errors.ts";
import { cacheControl, revealGame, revealedMoves } from "../broadcast/gate.ts";
import { revealWindow } from "../broadcast/clock.ts";
import { revealBracket } from "../match/bracket.ts";
import { headToHeadFor, pairKey } from "../rivalry/head-to-head.ts";
import { activeTraits } from "../rivalry/traits.ts";
import { calibrationCurve } from "../season/calibration.ts";
import { dashboardFrom } from "../season/dashboard.ts";
import { lineageOf } from "../season/identity.ts";
import { leaderboardFrom } from "../season/leaderboard.ts";
import type {
  ArenaStore,
  Bracket,
  CompetitorProfile,
  CompetitorVersionRow,
  DashboardEntry,
  DecisionRecord,
  EpochMs,
  GameScore,
  GameSummary,
  Leaderboard,
  Match,
  RecordedGame,
  RevealWindow,
  RevealedGame,
  RevealedMoves,
  RivalrySummary,
  StrategyLabel,
  StrategyStats,
  Trait,
} from "../core/types.ts";

export interface ReadContext {
  readonly store: ArenaStore;
  /** Evaluated once per request, so every view in it agrees on the clock. */
  readonly now: EpochMs;
}

interface LoadedGame {
  readonly recorded: RecordedGame;
  readonly decisions: readonly DecisionRecord[];
  readonly revealed: RevealedGame;
}

async function loadRevealedGame(
  context: ReadContext,
  seasonId: string,
  gameId: string,
): Promise<LoadedGame | undefined> {
  const recorded = await context.store.game(seasonId, gameId);
  if (recorded === undefined) return undefined;
  const decisions = await context.store.decisions(seasonId, gameId);
  return { recorded, decisions, revealed: revealGame(recorded, decisions, context.now) };
}

interface LoadedSeasonGame {
  readonly recorded: RecordedGame;
  readonly revealed: RevealedGame;
}

async function seasonGames(
  context: ReadContext,
  seasonId: string,
): Promise<readonly LoadedSeasonGame[]> {
  const recorded = await context.store.games(seasonId);
  const loaded: LoadedSeasonGame[] = [];
  for (const game of recorded) {
    const decisions = await context.store.decisions(seasonId, game.summary.gameId);
    loaded.push({ recorded: game, revealed: revealGame(game, decisions, context.now) });
  }
  return loaded;
}

/** Every distinct (seasonId, gameId) this competitor has a logged decision in. */
async function competitorGames(
  context: ReadContext,
  competitor: string,
): Promise<readonly LoadedSeasonGame[]> {
  const decisions = await context.store.competitorDecisions(competitor);
  const seen = new Set<string>();
  const loaded: LoadedSeasonGame[] = [];
  for (const decision of decisions) {
    const key = `${decision.seasonId}\u0000${decision.gameId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const game = await loadRevealedGame(context, decision.seasonId, decision.gameId);
    if (game === undefined) continue;
    loaded.push({ recorded: game.recorded, revealed: game.revealed });
  }
  return loaded;
}

/** A game sliced to its revealed prefix. Undefined when it does not exist. */
export async function gameView(
  context: ReadContext,
  seasonId: string,
  gameId: string,
): Promise<RevealedGame | undefined> {
  const loaded = await loadRevealedGame(context, seasonId, gameId);
  return loaded?.revealed;
}

/** Legal moves at the revealed position, for guess-the-move. */
export async function movesView(
  context: ReadContext,
  seasonId: string,
  gameId: string,
): Promise<RevealedMoves | undefined> {
  const loaded = await loadRevealedGame(context, seasonId, gameId);
  if (loaded === undefined) return undefined;
  return revealedMoves(loaded.recorded, loaded.decisions, context.now);
}

/**
 * Standings from revealed games only. A game still on air contributes nothing,
 * which is the whole point.
 */
export async function leaderboardView(
  context: ReadContext,
  seasonId: string,
): Promise<Leaderboard> {
  const games = await seasonGames(context, seasonId);

  const names = new Set<string>();
  for (const { recorded } of games) {
    names.add(recorded.summary.white.name);
    names.add(recorded.summary.black.name);
  }
  const versions: CompetitorVersionRow[] = [];
  for (const name of names) {
    versions.push(...(await context.store.versions(name)));
  }

  const finishedGames: GameSummary[] = [];
  const revealedDecisions: DecisionRecord[] = [];
  for (const { recorded, revealed } of games) {
    if (revealed.window.status !== "finished") continue;
    finishedGames.push(recorded.summary);
    revealedDecisions.push(...revealed.decisions);
  }

  return leaderboardFrom({
    games: finishedGames,
    decisions: revealedDecisions,
    versions,
    asOf: context.now,
  });
}

/** The revealed head of every game in a season, most interesting first. */
export async function dashboardView(
  context: ReadContext,
  seasonId: string,
): Promise<readonly DashboardEntry[]> {
  const games = await seasonGames(context, seasonId);

  const finishedSorted = games
    .filter((game) => game.revealed.window.status === "finished")
    .slice()
    .sort((a, b) => a.recorded.schedule.startAt - b.recorded.schedule.startAt)
    .map((game) => game.recorded.summary);

  const byPair = new Map<string, GameSummary[]>();
  for (const summary of finishedSorted) {
    const key = pairKey(summary.white.name, summary.black.name);
    const list = byPair.get(key);
    if (list === undefined) byPair.set(key, [summary]);
    else list.push(summary);
  }

  const traits = new Map<string, readonly Trait[]>();
  for (const [key, summaries] of byPair) {
    const first = summaries[0];
    if (first === undefined) continue;
    traits.set(key, [
      ...activeTraits(headToHeadFor(first.white.name, first.black.name, summaries)),
      ...activeTraits(headToHeadFor(first.black.name, first.white.name, summaries)),
    ]);
  }

  return dashboardFrom(games.map((game) => game.revealed), traits);
}

/** A bracket with unrevealed rounds still reading "winner of match N". */
export async function bracketView(
  context: ReadContext,
  bracketId: string,
): Promise<Bracket | undefined> {
  const seasonId = await context.store.bracketSeason(bracketId);
  if (seasonId === undefined) return undefined;
  const matches = await context.store.matches(bracketId);

  const uniqueGameIds = new Set<string>();
  for (const match of matches) {
    for (const gameId of match.gameIds) uniqueGameIds.add(gameId);
  }
  const finishedGameIds = new Set<string>();
  for (const recorded of await context.store.games(seasonId)) {
    const gameId = recorded.summary.gameId;
    if (!uniqueGameIds.has(gameId)) continue;
    const decisions = await context.store.decisions(seasonId, gameId);
    if (revealWindow(recorded.schedule, decisions.length, context.now).status === "finished") {
      finishedGameIds.add(gameId);
    }
  }

  const revealedMatchIds = matches
    .filter((match) => match.gameIds.every((gameId) => finishedGameIds.has(gameId)))
    .map((match) => match.matchId);

  const maxRound = matches.reduce((max, match) => Math.max(max, match.round), -1);
  const rounds: Match[][] = [];
  for (let round = 0; round <= maxRound; round += 1) {
    rounds.push(matches.filter((match) => match.round === round).sort((a, b) => a.slot - b.slot));
  }

  return revealBracket({ bracketId, seasonId, rounds }, revealedMatchIds);
}

function strategyMixFor(
  competitor: string,
  games: readonly GameSummary[],
  decisions: readonly DecisionRecord[],
): { readonly [key in StrategyLabel]?: StrategyStats } {
  const scoreByGame = new Map<string, GameScore>();
  for (const game of games) {
    const colour =
      game.white.name === competitor ? "white" : game.black.name === competitor ? "black" : undefined;
    if (colour === undefined) continue;
    const score: GameScore = game.result === "draw" ? 0.5 : game.result === colour ? 1 : 0;
    scoreByGame.set(game.gameId, score);
  }

  const aggregates = new Map<
    StrategyLabel,
    { picks: number; confidenceTotal: number; confidenceCount: number; gameScores: Map<string, GameScore> }
  >();
  for (const decision of decisions) {
    if (decision.competitor !== competitor) continue;
    let aggregate = aggregates.get(decision.strategy);
    if (aggregate === undefined) {
      aggregate = { picks: 0, confidenceTotal: 0, confidenceCount: 0, gameScores: new Map() };
      aggregates.set(decision.strategy, aggregate);
    }
    aggregate.picks += 1;
    if (decision.confidence !== undefined) {
      aggregate.confidenceTotal += decision.confidence;
      aggregate.confidenceCount += 1;
    }
    const score = scoreByGame.get(decision.gameId);
    if (score !== undefined) aggregate.gameScores.set(decision.gameId, score);
  }

  const byStrategy: { [key in StrategyLabel]?: StrategyStats } = {};
  for (const [strategy, aggregate] of aggregates) {
    let score = 0;
    for (const gameScore of aggregate.gameScores.values()) score += gameScore;
    byStrategy[strategy] = {
      picks: aggregate.picks,
      score,
      avgConfidence:
        aggregate.confidenceCount === 0 ? 0 : aggregate.confidenceTotal / aggregate.confidenceCount,
    };
  }
  return byStrategy;
}

/** Record, lineage, strategy mix, calibration and rivals, revealed only. */
export async function competitorView(
  context: ReadContext,
  competitor: string,
): Promise<CompetitorProfile | undefined> {
  const versions = await context.store.versions(competitor);
  if (versions.length === 0) return undefined;

  const games = await competitorGames(context, competitor);
  const finished = games
    .filter((game) => game.revealed.window.status === "finished")
    .slice()
    .sort((a, b) => a.recorded.schedule.startAt - b.recorded.schedule.startAt);

  const revealedGames = finished.map((game) => game.recorded.summary);
  const revealedDecisions = finished.flatMap((game) => game.revealed.decisions);

  const leaderboard = leaderboardFrom({
    games: revealedGames,
    decisions: revealedDecisions,
    versions,
    asOf: context.now,
  });
  const row = leaderboard.rows.find((entry) => entry.competitor === competitor);
  if (row === undefined) {
    throw new ContractViolation("api.read.competitorView", `missing leaderboard row for ${competitor}`);
  }

  const opponents = new Set<string>();
  for (const summary of revealedGames) {
    opponents.add(summary.white.name === competitor ? summary.black.name : summary.white.name);
  }
  const rivals: RivalrySummary[] = [];
  for (const opponent of opponents) {
    const relevant = revealedGames.filter((summary) => {
      const names = [summary.white.name, summary.black.name];
      return names.includes(competitor) && names.includes(opponent);
    });
    const headToHead = headToHeadFor(competitor, opponent, relevant);
    rivals.push({
      headToHead,
      traits: activeTraits(headToHead),
      gameIds: relevant.map((summary) => summary.gameId),
    });
  }

  return {
    competitor,
    row,
    lineage: lineageOf(competitor, versions),
    strategyMix: strategyMixFor(competitor, revealedGames, revealedDecisions),
    calibration: calibrationCurve(competitor, revealedDecisions, revealedGames),
    rivals,
  };
}

/** One pair's history, active traits and the games behind them. */
export async function rivalryView(
  context: ReadContext,
  competitor: string,
  opponent: string,
): Promise<RivalrySummary | undefined> {
  const games = await competitorGames(context, competitor);
  const relevant = games
    .filter((game) => game.revealed.window.status === "finished")
    .slice()
    .sort((a, b) => a.recorded.schedule.startAt - b.recorded.schedule.startAt)
    .map((game) => game.recorded.summary)
    .filter((summary) => {
      const names = [summary.white.name, summary.black.name];
      return names.includes(competitor) && names.includes(opponent);
    });

  const headToHead = headToHeadFor(competitor, opponent, relevant);
  return {
    headToHead,
    traits: activeTraits(headToHead),
    gameIds: relevant.map((summary) => summary.gameId),
  };
}

async function bracketGameWindows(
  context: ReadContext,
  bracketId: string,
): Promise<readonly RevealWindow[]> {
  const seasonId = await context.store.bracketSeason(bracketId);
  if (seasonId === undefined) return [];
  const matches = await context.store.matches(bracketId);
  const gameIds = new Set<string>();
  for (const match of matches) {
    for (const gameId of match.gameIds) gameIds.add(gameId);
  }
  const windows: RevealWindow[] = [];
  for (const recorded of await context.store.games(seasonId)) {
    const gameId = recorded.summary.gameId;
    if (!gameIds.has(gameId)) continue;
    const decisions = await context.store.decisions(seasonId, gameId);
    windows.push(revealWindow(recorded.schedule, decisions.length, context.now));
  }
  return windows;
}

/** The next reveal boundary across a set of windows, or "finished" if none is open. */
function combinedWindow(windows: readonly RevealWindow[]): RevealWindow {
  let earliest: EpochMs | undefined;
  for (const window of windows) {
    if (window.status === "finished" || window.nextBoundaryAt === undefined) continue;
    if (earliest === undefined || window.nextBoundaryAt < earliest) {
      earliest = window.nextBoundaryAt;
    }
  }
  return earliest === undefined
    ? { status: "finished", revealedPlies: 0 }
    : { status: "on-air", revealedPlies: 0, nextBoundaryAt: earliest };
}

const ID_PATTERN = /^[A-Za-z0-9._:@-]+$/;

function decodeId(segment: string | undefined): string | undefined {
  if (segment === undefined) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  return ID_PATTERN.test(decoded) ? decoded : undefined;
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

function jsonResponse(body: unknown, window: RevealWindow, now: EpochMs): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheControl(window, now),
    },
  });
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
export async function handleRead(
  request: Request,
  context: ReadContext,
): Promise<Response | undefined> {
  if (request.method !== "GET") return undefined;

  const { pathname } = new URL(request.url);
  const segments = pathname.split("/").filter((segment) => segment.length > 0);

  if (segments[0] !== "api") return undefined;
  const kind = segments[1];

  if (kind === "seasons" && segments.length >= 3) {
    const seasonId = decodeId(segments[2]);

    if (segments.length === 4 && segments[3] === "leaderboard") {
      if (seasonId === undefined) return notFound();
      const body = await leaderboardView(context, seasonId);
      const window = combinedWindow((await seasonGames(context, seasonId)).map((g) => g.revealed.window));
      return jsonResponse(body, window, context.now);
    }

    if (segments.length === 4 && segments[3] === "dashboard") {
      if (seasonId === undefined) return notFound();
      const body = await dashboardView(context, seasonId);
      const window = combinedWindow((await seasonGames(context, seasonId)).map((g) => g.revealed.window));
      return jsonResponse(body, window, context.now);
    }

    if (segments.length === 5 && segments[3] === "games") {
      const gameId = decodeId(segments[4]);
      if (seasonId === undefined || gameId === undefined) return notFound();
      const body = await gameView(context, seasonId, gameId);
      if (body === undefined) return notFound();
      return jsonResponse(body, body.window, context.now);
    }

    if (segments.length === 6 && segments[3] === "games" && segments[5] === "moves") {
      const gameId = decodeId(segments[4]);
      if (seasonId === undefined || gameId === undefined) return notFound();
      const loaded = await loadRevealedGame(context, seasonId, gameId);
      if (loaded === undefined) return notFound();
      const body = revealedMoves(loaded.recorded, loaded.decisions, context.now);
      return jsonResponse(body, loaded.revealed.window, context.now);
    }

    return undefined;
  }

  if (kind === "brackets" && segments.length === 3) {
    const bracketId = decodeId(segments[2]);
    if (bracketId === undefined) return notFound();
    const body = await bracketView(context, bracketId);
    if (body === undefined) return notFound();
    const window = combinedWindow(await bracketGameWindows(context, bracketId));
    return jsonResponse(body, window, context.now);
  }

  if (kind === "competitors" && segments.length === 5 && segments[3] === "rivals") {
    const competitor = decodeId(segments[2]);
    const opponent = decodeId(segments[4]);
    if (competitor === undefined || opponent === undefined) return notFound();
    const body = await rivalryView(context, competitor, opponent);
    if (body === undefined) return notFound();
    const games = (await competitorGames(context, competitor)).filter((game) => {
      const names = [game.recorded.summary.white.name, game.recorded.summary.black.name];
      return names.includes(opponent);
    });
    const window = combinedWindow(games.map((game) => game.revealed.window));
    return jsonResponse(body, window, context.now);
  }

  if (kind === "competitors" && segments.length === 3) {
    const competitor = decodeId(segments[2]);
    if (competitor === undefined) return notFound();
    const body = await competitorView(context, competitor);
    if (body === undefined) return notFound();
    const window = combinedWindow((await competitorGames(context, competitor)).map((g) => g.revealed.window));
    return jsonResponse(body, window, context.now);
  }

  return undefined;
}
