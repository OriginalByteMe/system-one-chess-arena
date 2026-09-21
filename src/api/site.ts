// The front page's one request.
//
// Everything on the championship page comes from here: which season is on,
// what is playing right now, the standings, and who the competitors are. It is
// one round trip because the page is one screen, and it is gated the same way
// every other read is — a game still on air contributes its revealed prefix and
// nothing else, so the bundle can never leak a result the clock has not reached.
import { revealGame } from "../broadcast/gate.ts";
import { leaderboardView } from "./read.ts";
import type { ReadContext } from "./read.ts";
import type {
  CompetitorManifest,
  CompetitorRef,
  EpochMs,
  Fen,
  GameResult,
  Leaderboard,
  LiveGameSnapshot,
  RevealWindow,
  StrategyLabel,
  TerminalReason,
  Uci,
} from "../core/types.ts";

export interface SeasonRef {
  readonly seasonId: string;
  /** Earliest broadcast time in the season; the ordering key. */
  readonly startAt: EpochMs;
  readonly games: number;
}

/** What the site needs about a competitor: its brief, which is the competitor. */
export interface SiteCompetitor {
  readonly name: string;
  readonly version: string;
  readonly playstyle: string;
  readonly strategies: readonly StrategyLabel[];
  readonly budgetMs: number;
  readonly historyPlies: number;
}

export interface SiteGame {
  readonly gameId: string;
  readonly seasonId: string;
  readonly white: CompetitorRef;
  readonly black: CompetitorRef;
  readonly status: RevealWindow["status"];
  readonly revealedPlies: number;
  readonly nextBoundaryAt?: EpochMs;
  readonly startAt: EpochMs;
  readonly msPerPly: number;
  /** Position after the last revealed ply. */
  readonly fen: Fen;
  readonly lastMove?: Uci;
  readonly mover?: string;
  readonly strategy?: StrategyLabel;
  readonly confidence?: number;
  /** Present only once the broadcast has finished. */
  readonly result?: GameResult;
  readonly reason?: TerminalReason;
  readonly plies?: number;
  readonly adjudicatedCp?: number;
}

export interface SiteRecentGame {
  readonly gameId: string;
  readonly seasonId: string;
  readonly white: string;
  readonly black: string;
  readonly result: GameResult;
  readonly reason: TerminalReason;
  readonly plies: number;
  /** When the broadcast finished. Recorded games with no schedule use 0. */
  readonly finishedAt: EpochMs;
}

export type SiteHighlightKind = "shortest" | "longest" | "checkmate" | "decisive";

export interface SiteHighlight {
  readonly kind: SiteHighlightKind;
  /** Short label, e.g. "Shortest decisive game". */
  readonly headline: string;
  /** One sentence of fact, e.g. "Vex beat Cinder in 34 plies." */
  readonly detail: string;
  readonly gameId: string;
  readonly seasonId: string;
}

export interface SiteView {
  readonly now: EpochMs;
  readonly seasonId: string;
  readonly seasons: readonly SeasonRef[];
  readonly window: RevealWindow;
  /** The game the page opens on: on air, else next up, else most recent. */
  readonly featuredGameId?: string;
  readonly games: readonly SiteGame[];
  /**
   * Games playing right now, straight from the season that is on. These are
   * not in the filed ledger yet — they are being decided as the page loads —
   * so they are a separate field rather than pretend history.
   */
  readonly live: readonly LiveGameSnapshot[];
  readonly leaderboard: Leaderboard;
  readonly competitors: readonly SiteCompetitor[];
  /** Decisions the clock has actually released, across the season. */
  readonly decisionsRevealed: number;
  /** The season's bracket, when it has one. */
  readonly bracketId?: string;
  /** Finished games across every season, newest first, at most 12. */
  readonly recent: readonly SiteRecentGame[];
  /** At most 4, computed from `recent`. Empty when nothing qualifies. */
  readonly highlights: readonly SiteHighlight[];
}

/**
 * The season-scoped queries the front page needs and the read API never did.
 * Kept separate from ArenaStore so the gated read surface keeps exactly the
 * seven methods it was designed around.
 */
export interface SiteStore {
  readonly seasons: () => Promise<readonly SeasonRef[]>;
  readonly manifests: (seasonId: string) => Promise<readonly CompetitorManifest[]>;
  readonly bracket: (seasonId: string) => Promise<string | undefined>;
  /** Operator settings. Undefined for an unset key or a missing table. */
  readonly setting: (key: string) => Promise<string | undefined>;
  /** Finished games across all seasons, newest first. Caller bounds the count. */
  readonly recentGames: (now: EpochMs, limit: number) => Promise<readonly SiteRecentGame[]>;
}

/** The next reveal boundary across a season, for the response's cache lifetime. */
export function seasonWindow(games: readonly SiteGame[]): RevealWindow {
  let earliest: EpochMs | undefined;
  for (const game of games) {
    if (game.status === "finished" || game.nextBoundaryAt === undefined) continue;
    if (earliest === undefined || game.nextBoundaryAt < earliest) earliest = game.nextBoundaryAt;
  }
  return earliest === undefined
    ? { status: "finished", revealedPlies: 0 }
    : { status: "on-air", revealedPlies: 0, nextBoundaryAt: earliest };
}

/**
 * Which season the front door opens on. The operator's pin wins, then the
 * setting written from the admin console, then simply the latest season —
 * which is the right answer until somebody pins one.
 */
export async function featuredSeason(
  site: SiteStore,
  seasons: readonly SeasonRef[],
  pinned: string | undefined,
): Promise<string | undefined> {
  const known = new Set(seasons.map((season) => season.seasonId));
  if (pinned !== undefined && pinned !== "" && known.has(pinned)) return pinned;
  const stored = await site.setting("featured_season");
  if (stored !== undefined && known.has(stored)) return stored;
  return seasons[0]?.seasonId;
}

/** On air wins, then the next one scheduled, then the one that finished last. */
export function featuredGame(games: readonly SiteGame[], now: EpochMs): SiteGame | undefined {
  const onAir = games
    .filter((game) => game.status === "on-air")
    .sort((a, b) => a.startAt - b.startAt);
  if (onAir[0] !== undefined) return onAir[0];

  const upcoming = games
    .filter((game) => game.status === "scheduled" && game.startAt >= now)
    .sort((a, b) => a.startAt - b.startAt);
  if (upcoming[0] !== undefined) return upcoming[0];

  const finished = games
    .filter((game) => game.status === "finished")
    .sort((a, b) => b.startAt - a.startAt);
  return finished[0] ?? games[0];
}

/**
 * Competitor names are lowercase roster ids. This is a sentence rather than
 * an id, and the rest of the site prints the name capitalised, so it is
 * capitalised here too.
 */
function displayName(name: string): string {
  return name.length === 0 ? name : name[0]?.toUpperCase() + name.slice(1);
}

function highlightDetail(game: SiteRecentGame): string {
  const white = displayName(game.white);
  const black = displayName(game.black);
  if (game.result === "draw") return `${white} and ${black} drew in ${game.plies} plies.`;
  const winner = game.result === "white" ? white : black;
  const loser = game.result === "white" ? black : white;
  return `${winner} beat ${loser} in ${game.plies} plies.`;
}

/**
 * At most one highlight per kind, at most four total, computed only from
 * facts the row already carries. There is no seed data behind this list, so
 * nothing here may imply an upset or any other judgment the columns cannot
 * back up.
 */
export function highlightsOf(games: readonly SiteRecentGame[]): readonly SiteHighlight[] {
  const highlights: SiteHighlight[] = [];

  const checkmate = games
    .filter((game) => game.reason === "checkmate")
    .sort((a, b) => b.finishedAt - a.finishedAt)[0];
  if (checkmate !== undefined) {
    highlights.push({
      kind: "checkmate",
      headline: "Latest checkmate",
      detail: highlightDetail(checkmate),
      gameId: checkmate.gameId,
      seasonId: checkmate.seasonId,
    });
  }

  // Shortest and longest are only worth naming once there is a pool to stand
  // out from; below three games either one is just "the game we have".
  if (games.length >= 3) {
    const shortest = games
      .filter((game) => game.result !== "draw")
      .sort((a, b) => a.plies - b.plies)[0];
    if (shortest !== undefined) {
      highlights.push({
        kind: "shortest",
        headline: "Shortest decisive game",
        detail: highlightDetail(shortest),
        gameId: shortest.gameId,
        seasonId: shortest.seasonId,
      });
    }

    const longest = [...games].sort((a, b) => b.plies - a.plies)[0];
    if (longest !== undefined) {
      highlights.push({
        kind: "longest",
        headline: "Longest game",
        detail: highlightDetail(longest),
        gameId: longest.gameId,
        seasonId: longest.seasonId,
      });
    }
  }

  return highlights.slice(0, 4);
}

export async function siteView(
  context: ReadContext,
  site: SiteStore,
  pinned: string | undefined,
  live: readonly LiveGameSnapshot[] = [],
): Promise<SiteView | undefined> {
  const seasons = await site.seasons();
  const liveSeasonId = live[0]?.seasonId;
  // A season that is playing right now has nothing in the filed ledger yet, so
  // it cannot come out of `seasons()`. It is still the season that is on.
  const seasonId = liveSeasonId ?? (await featuredSeason(site, seasons, pinned));
  if (seasonId === undefined) return undefined;

  const recorded = await context.store.games(seasonId);
  const games: SiteGame[] = [];
  let decisionsRevealed = 0;

  for (const game of recorded) {
    const decisions = await context.store.decisions(seasonId, game.summary.gameId);
    const revealed = revealGame(game, decisions, context.now);
    const last = revealed.decisions[revealed.decisions.length - 1];
    const finished = revealed.window.status === "finished";
    decisionsRevealed += revealed.decisions.length;

    games.push({
      gameId: revealed.gameId,
      seasonId,
      white: revealed.white,
      black: revealed.black,
      status: revealed.window.status,
      revealedPlies: revealed.window.revealedPlies,
      ...(revealed.window.nextBoundaryAt === undefined
        ? {}
        : { nextBoundaryAt: revealed.window.nextBoundaryAt }),
      startAt: game.schedule.startAt,
      msPerPly: game.schedule.msPerPly,
      fen: revealed.fen,
      ...(last === undefined
        ? {}
        : {
            lastMove: last.move,
            mover: last.competitor,
            strategy: last.strategy,
            ...(last.confidence === undefined ? {} : { confidence: last.confidence }),
          }),
      ...(finished
        ? {
            result: game.summary.result,
            reason: game.summary.reason,
            plies: game.summary.plies,
            ...(game.summary.adjudicatedCp === undefined
              ? {}
              : { adjudicatedCp: game.summary.adjudicatedCp }),
          }
        : {}),
    });
  }

  games.sort((a, b) => a.startAt - b.startAt);
  const manifests = await site.manifests(seasonId);
  const bracketId = await site.bracket(seasonId);
  const featured = featuredGame(games, context.now);
  const recent = await site.recentGames(context.now, 12);

  return {
    now: context.now,
    seasonId,
    seasons,
    window: seasonWindow(games),
    ...(featured === undefined ? {} : { featuredGameId: featured.gameId }),
    games,
    live,
    leaderboard: await leaderboardView(context, seasonId),
    competitors: manifests.map((manifest) => ({
      name: manifest.name,
      version: manifest.version,
      playstyle: manifest.playstyle,
      strategies: manifest.strategies,
      budgetMs: manifest.budget.maxMs,
      historyPlies: manifest.historyPlies,
    })),
    decisionsRevealed,
    ...(bracketId === undefined ? {} : { bracketId }),
    recent,
    highlights: highlightsOf(recent),
  };
}
