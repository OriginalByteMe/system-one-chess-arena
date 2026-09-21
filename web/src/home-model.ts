// Everything the front page shows, derived from the one /api/site response.
// No number here is invented: each is a field, a sum or a mean of fields the
// season actually recorded.
import { dollars, percent, seconds } from "./format.ts";
import type { SiteCompetitor, SiteGame, SiteView } from "../../src/api/site.ts";
import type {
  GameResult,
  LeaderboardRow,
  LiveGameSnapshot,
  TerminalReason,
} from "../../src/core/types.ts";

export interface HeroStat {
  readonly label: string;
  readonly value: string;
}

export function heroStats(view: SiteView): readonly HeroStat[] {
  const rows = view.leaderboard.rows;
  const finished = view.games.filter((game) => game.status === "finished").length;
  const latencies = rows.map((row) => row.meanLatencyMs).filter((ms) => ms > 0);
  const spent = rows.reduce((sum, row) => sum + row.costUsd, 0);

  const stats: HeroStat[] = [
    { label: "Agents", value: String(view.competitors.length) },
    { label: "Games on file", value: String(finished) },
    { label: "Decisions aired", value: view.decisionsRevealed.toLocaleString("en-GB") },
  ];
  if (latencies.length > 0) {
    const mean = latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length;
    stats.push({ label: "Typical decision", value: seconds(mean) });
  }
  if (spent > 0) {
    stats.push({ label: "Spent to date", value: dollars(spent) });
  }
  return stats;
}

export function gameById(
  view: SiteView | undefined,
  gameId: string | undefined,
): SiteGame | undefined {
  if (view === undefined || gameId === undefined) return undefined;
  return view.games.find((game) => game.gameId === gameId);
}

/** A competitor's leaderboard row, or undefined before it has played. */
export function rowFor(view: SiteView, name: string): LeaderboardRow | undefined {
  return view.leaderboard.rows.find((row) => row.competitor === name);
}

export function competitorFor(view: SiteView, name: string): SiteCompetitor | undefined {
  return view.competitors.find((competitor) => competitor.name === name);
}

export interface Standing {
  readonly rank: number;
  readonly row: LeaderboardRow;
  readonly competitor?: SiteCompetitor;
}

/** The leaderboard is already ordered by the server; this only numbers it. */
export function standings(view: SiteView): readonly Standing[] {
  return view.leaderboard.rows.map((row, index) => {
    const competitor = competitorFor(view, row.competitor);
    return { rank: index + 1, row, ...(competitor === undefined ? {} : { competitor }) };
  });
}

/** Finished games, most recent first: the replay shelf. */
export function replays(view: SiteView): readonly SiteGame[] {
  return view.games
    .filter((game) => game.status === "finished")
    .slice()
    .sort((a, b) => b.startAt - a.startAt);
}

export function resultLabel(game: SiteGame): string {
  if (game.status !== "finished" || game.result === undefined) return "";
  const reason = game.reason === undefined ? "" : ` · ${game.reason.replace(/-/g, " ")}`;
  if (game.result === "draw") return `Draw${reason}`;
  const winner = game.result === "white" ? game.white.name : game.black.name;
  const loser = game.result === "white" ? game.black.name : game.white.name;
  return `${winner} beat ${loser}${reason}`;
}

/** "18:04" in the viewer's own timezone, because a broadcast is an appointment. */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Seconds until the next ply airs, floored at zero. Undefined when finished. */
export function secondsToBoundary(game: SiteGame, now: number): number | undefined {
  if (game.nextBoundaryAt === undefined) return undefined;
  return Math.max(0, Math.round((game.nextBoundaryAt - now) / 1000));
}

export function statusLabel(game: SiteGame, now: number): string {
  if (game.status === "finished") return resultLabel(game);
  if (game.status === "scheduled") {
    return game.startAt > now ? `Starts ${clockTime(game.startAt)}` : "Starting";
  }
  const left = secondsToBoundary(game, now);
  const ply = `Ply ${game.revealedPlies}`;
  return left === undefined ? ply : `${ply} · next in ${left}s`;
}

/** The confidence of the last aired decision, formatted, or undefined. */
export function lastConfidence(game: SiteGame): string | undefined {
  return game.confidence === undefined ? undefined : percent(game.confidence);
}

/**
 * A response cached before the live field existed has no `live` array. The
 * page must not blank for that, so every reader goes through here.
 */
export function liveGamesOf(view: SiteView): readonly LiveGameSnapshot[] {
  const live: readonly LiveGameSnapshot[] | undefined = view.live;
  return live ?? [];
}

/**
 * The featured card reads from two different sources — a game playing right
 * now, which lives only in the Durable Object, and a filed game from the
 * ledger — so both are normalised into one shape rather than the card learning
 * about both.
 */
export interface FeaturedCard {
  readonly gameId: string;
  readonly seasonId: string;
  readonly white: string;
  readonly black: string;
  readonly fen: string;
  readonly lastMove?: string;
  readonly mover?: string;
  readonly strategy?: string;
  readonly confidence?: number;
  readonly ply: number;
  readonly status: "scheduled" | "on-air" | "finished";
  /** Only ever set for a game that has finished. */
  readonly plies?: number;
  readonly result?: GameResult;
  readonly reason?: TerminalReason;
  /** True when the game is being decided right now, so the link goes live. */
  readonly isLive: boolean;
}

export function cardFromLive(snapshot: LiveGameSnapshot): FeaturedCard {
  const decision = snapshot.lastDecision;
  const finished = snapshot.finished;
  return {
    gameId: snapshot.gameId,
    seasonId: snapshot.seasonId,
    white: snapshot.white.name,
    black: snapshot.black.name,
    fen: snapshot.fen,
    ...(snapshot.lastMove === undefined ? {} : { lastMove: snapshot.lastMove }),
    ...(decision === undefined
      ? {}
      : {
          mover: decision.competitor,
          strategy: decision.strategy,
          ...(decision.confidence === undefined ? {} : { confidence: decision.confidence }),
        }),
    ply: snapshot.ply,
    status: finished === undefined ? "on-air" : "finished",
    ...(finished === undefined
      ? {}
      : { plies: snapshot.ply, result: finished.result, reason: finished.reason }),
    isLive: finished === undefined,
  };
}

export function cardFromGame(game: SiteGame): FeaturedCard {
  return {
    gameId: game.gameId,
    seasonId: game.seasonId,
    white: game.white.name,
    black: game.black.name,
    fen: game.fen,
    ...(game.lastMove === undefined ? {} : { lastMove: game.lastMove }),
    ...(game.mover === undefined ? {} : { mover: game.mover }),
    ...(game.strategy === undefined ? {} : { strategy: game.strategy }),
    ...(game.confidence === undefined ? {} : { confidence: game.confidence }),
    ply: game.revealedPlies,
    status: game.status,
    ...(game.plies === undefined ? {} : { plies: game.plies }),
    ...(game.result === undefined ? {} : { result: game.result }),
    ...(game.reason === undefined ? {} : { reason: game.reason }),
    isLive: false,
  };
}

/** The card the page opens on: something playing now, else the filed pick. */
export function featuredCard(view: SiteView): FeaturedCard | undefined {
  const playing = liveGamesOf(view).find((snapshot) => snapshot.finished === undefined);
  if (playing !== undefined) return cardFromLive(playing);
  const filed = gameById(view, view.featuredGameId);
  if (filed !== undefined) return cardFromGame(filed);
  const justFinished = view.live[view.live.length - 1];
  return justFinished === undefined ? undefined : cardFromLive(justFinished);
}

export function cardStatusLabel(card: FeaturedCard): string {
  if (card.status === "finished") {
    if (card.result === undefined) return `${card.ply} plies played`;
    const reason = card.reason === undefined ? "" : ` · ${card.reason.replace(/-/g, " ")}`;
    if (card.result === "draw") return `Draw${reason}`;
    const winner = card.result === "white" ? card.white : card.black;
    return `${winner} won${reason}`;
  }
  if (card.status === "scheduled") return "Not started yet";
  return `Ply ${card.ply} · playing now`;
}
