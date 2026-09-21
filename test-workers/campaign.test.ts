// The campaign scheduler, end to end against real D1 and real Durable Objects.
//
// What is under test is the part that decides: does a tick notice a match is
// over, fold it into the bracket, hold until the next daily window, crown a
// champion, and chain into the next season. Whether chess works is
// season-do.test.ts's job, so games are filed directly rather than played:
// `tickCampaign` reads the filed ledger to make every one of those decisions,
// so filing a result is exactly as real an input as playing one.
import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Env } from "../src/core/env.ts";
import {
  campaignReport,
  campaignSeasonConfig,
  campaignState,
  setCampaignPaused,
  startCampaign,
  stopCampaign,
  tickCampaign,
} from "../src/api/campaign.ts";
import { entrantsFor, seasonIdFor } from "../src/season/campaign.ts";
import type { CampaignPlan, CampaignState } from "../src/season/campaign.ts";

const arenaEnv = env as Env;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS competitor_versions (season_id TEXT NOT NULL, competitor TEXT NOT NULL, version TEXT NOT NULL, manifest_json TEXT NOT NULL, parent_version TEXT, traits_json TEXT, rationale TEXT, PRIMARY KEY (season_id, competitor, version))",
  "CREATE TABLE IF NOT EXISTS competitors (name TEXT NOT NULL PRIMARY KEY, first_season_id TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS games (season_id TEXT NOT NULL, game_id TEXT NOT NULL, white_competitor TEXT NOT NULL, white_version TEXT NOT NULL, black_competitor TEXT NOT NULL, black_version TEXT NOT NULL, opening_id TEXT NOT NULL, result TEXT NOT NULL, reason TEXT NOT NULL, adjudicated_cp INTEGER, plies INTEGER NOT NULL, pgn TEXT NOT NULL, match_id TEXT, broadcast_start_at INTEGER, ms_per_ply INTEGER, PRIMARY KEY (season_id, game_id))",
  "CREATE TABLE IF NOT EXISTS decisions (season_id TEXT NOT NULL, game_id TEXT NOT NULL, ply INTEGER NOT NULL, competitor TEXT NOT NULL, version TEXT NOT NULL, colour TEXT NOT NULL, fen TEXT NOT NULL, legal_move_count INTEGER NOT NULL, move TEXT NOT NULL, strategy TEXT NOT NULL, confidence REAL, distribution_json TEXT, latency_ms INTEGER NOT NULL, tokens_in INTEGER, tokens_out INTEGER, fallback TEXT, features_seen_json TEXT NOT NULL, idempotency_key TEXT NOT NULL, PRIMARY KEY (season_id, game_id, ply))",
  "CREATE TABLE IF NOT EXISTS strategy_outcomes (season_id TEXT NOT NULL, competitor TEXT NOT NULL, version TEXT NOT NULL, strategy TEXT NOT NULL, picks INTEGER NOT NULL, score REAL NOT NULL, avg_confidence REAL NOT NULL, PRIMARY KEY (season_id, competitor, version, strategy))",
  "CREATE TABLE IF NOT EXISTS site_settings (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS brackets (bracket_id TEXT NOT NULL PRIMARY KEY, season_id TEXT NOT NULL, best_of INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS matches (match_id TEXT NOT NULL PRIMARY KEY, bracket_id TEXT NOT NULL, round INTEGER NOT NULL, slot INTEGER NOT NULL, competitor_a TEXT, competitor_b TEXT, feeder_a TEXT, feeder_b TEXT, best_of INTEGER NOT NULL, game_ids_json TEXT NOT NULL, winner TEXT)",
] as const;

/** 2027-01-15T08:00:00Z. The 08:00 matters: the plans below open at hour 8. */
const NOW = 1_800_000_000_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A whole round a day, so a two-round season is two days. */
function plan(overrides: Partial<CampaignPlan> = {}): CampaignPlan {
  return { rounds: 2, seasons: 1, msPerPly: 250, bestOf: 2, matchesPerDay: 8, hourUtc: 8, ...overrides };
}

beforeEach(async () => {
  await reset();
  await arenaEnv.DB.batch(SCHEMA.map((statement) => arenaEnv.DB.prepare(statement)));
  // Games start playing the moment a match is dealt. Nothing here waits for
  // them, but an unmocked provider would make real network calls from the
  // alarms still in flight.
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(
      Response.json({ kind: "chat", text: JSON.stringify({ move: "e2e4", strategy: "direct", confidence: 0.5 }) }),
    ),
  );
});

/**
 * Files every game the matches on the board are waiting on.
 *
 * The alphabetically first name wins, so outcomes are fixed rather than
 * random and a whole season replays identically.
 */
async function fileDealtMatches(state: CampaignState, at: number = NOW): Promise<void> {
  const config = campaignSeasonConfig(state.plan, state.seasonId);
  const versions = new Map(config.competitors.map((entry) => [entry.name, entry.version]));
  const handed = new Set(state.started);
  const statements = [];

  for (const match of state.bracket.rounds.flat()) {
    if (match.winner !== undefined || !handed.has(match.matchId)) continue;
    const a = match.a.kind === "competitor" ? match.a.competitor : undefined;
    const b = match.b.kind === "competitor" ? match.b.competitor : undefined;
    if (a === undefined || b === undefined) throw new Error(`${match.matchId} is unresolved`);
    const winner = a < b ? a : b;

    for (const [index, gameId] of match.gameIds.entries()) {
      // matchPairings alternates colours, a as white in game 1.
      const aIsWhite = index % 2 === 0;
      const white = aIsWhite ? a : b;
      const black = aIsWhite ? b : a;
      statements.push(
        // No match_id. The season Durable Object files a game from a
        // GameSummary, which carries no match, so the column is always null
        // in real life and the calendar must not depend on it.
        arenaEnv.DB.prepare(
          "INSERT OR REPLACE INTO games (season_id, game_id, white_competitor, white_version," +
            " black_competitor, black_version, opening_id, result, reason, plies, pgn," +
            " broadcast_start_at, ms_per_ply) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          state.seasonId,
          gameId,
          white,
          versions.get(white) ?? "",
          black,
          versions.get(black) ?? "",
          "italian-game",
          winner === white ? "white" : "black",
          "checkmate",
          24,
          "",
          at,
          state.plan.msPerPly,
        ),
      );
    }
  }
  if (statements.length > 0) await arenaEnv.DB.batch(statements);
}

function requireState(state: CampaignState | undefined): CampaignState {
  if (state === undefined) throw new Error("expected a campaign");
  return state;
}

/** Files what is on the board, then opens the next day's window. */
async function playADay(state: CampaignState, day: number): Promise<CampaignState> {
  await fileDealtMatches(state, NOW + (day - 1) * DAY_MS);
  return requireState(await tickCampaign(arenaEnv, NOW + day * DAY_MS));
}

describe("campaign scheduler", () => {
  test("starting deals the first matches immediately at the chosen pace", async () => {
    const state = await startCampaign(arenaEnv, plan({ rounds: 1, msPerPly: 2_000 }), NOW);

    expect(state.phase).toBe("running");
    expect(state.entrants).toBe(entrantsFor(1, 20));
    expect(state.started).toHaveLength(1);
    expect(state.seasonId).toBe(seasonIdFor(state.campaignId, 0));

    // The bracket is persisted up front, so the site can show it before any
    // game is decided, and at the plan's bestOf rather than a fixed one.
    const bracketRow = await arenaEnv.DB.prepare("SELECT best_of FROM brackets WHERE season_id = ?")
      .bind(state.seasonId)
      .first<{ best_of: number }>();
    expect(bracketRow?.best_of).toBe(2);

    await fileDealtMatches(state);
    await tickCampaign(arenaEnv, NOW + DAY_MS);
    const paceRow = await arenaEnv.DB.prepare(
      "SELECT DISTINCT ms_per_ply AS pace FROM games WHERE season_id = ?",
    )
      .bind(state.seasonId)
      .first<{ pace: number }>();
    expect(paceRow?.pace).toBe(2_000);
  });

  test("matchesPerDay is what caps a day, not the round", async () => {
    // Two rounds is four entrants and two first-round matches. One a day means
    // the second one waits, which is the whole point of the daily window.
    const state = await startCampaign(arenaEnv, plan({ matchesPerDay: 1 }), NOW);
    expect(state.started).toHaveLength(1);

    const sameDay = requireState(await tickCampaign(arenaEnv, NOW + HOUR_MS));
    expect(sameDay.started).toHaveLength(1);

    const nextDay = requireState(await tickCampaign(arenaEnv, NOW + DAY_MS));
    expect(nextDay.started).toHaveLength(2);
  });

  test("the window only opens at the operator's hour", async () => {
    const state = await startCampaign(arenaEnv, plan({ matchesPerDay: 1, hourUtc: 17 }), NOW);
    expect(state.started).toHaveLength(1);

    // 08:00 the next day is before 17:00, so nothing is dealt.
    const early = requireState(await tickCampaign(arenaEnv, NOW + DAY_MS));
    expect(early.started).toHaveLength(1);

    const onTime = requireState(await tickCampaign(arenaEnv, NOW + DAY_MS + 9 * HOUR_MS));
    expect(onTime.started).toHaveLength(2);
  });

  test("a forced tick deals whatever the hour is", async () => {
    const state = await startCampaign(arenaEnv, plan({ matchesPerDay: 1, hourUtc: 17 }), NOW);
    const forced = requireState(await tickCampaign(arenaEnv, NOW + HOUR_MS, true));
    expect(forced.started).toHaveLength(state.started.length + 1);
  });

  test("a decided match folds into the bracket and the next day deals the round after it", async () => {
    const started = await startCampaign(arenaEnv, plan(), NOW);
    await fileDealtMatches(started);

    const next = requireState(await tickCampaign(arenaEnv, NOW + DAY_MS));
    // Round 0's winners are real names in round 1 now, not "winner-of" slots,
    // and the final was dealt in the same tick that folded them in.
    const final = next.bracket.rounds[1] ?? [];
    expect(final[0]?.a.kind).toBe("competitor");
    expect(final[0]?.b.kind).toBe("competitor");
    expect(next.started).toContain(final[0]?.matchId);
  });

  test("a day at a time plays a whole season and crowns a champion", async () => {
    let state = await startCampaign(arenaEnv, plan(), NOW);

    for (let day = 1; day < 10 && state.phase !== "finished"; day++) {
      state = await playADay(state, day);
    }

    expect(state.phase).toBe("finished");
    expect(state.champion).toBeDefined();
    // The champion is the winner recorded on the final, not a separate answer.
    const finalRound = state.bracket.rounds[state.bracket.rounds.length - 1] ?? [];
    expect(finalRound[0]?.winner).toBe(state.champion);
  });

  test("a finished season chains into the next one until the season count is reached", async () => {
    let state = await startCampaign(arenaEnv, plan({ rounds: 1, seasons: 3 }), NOW);
    const seenSeasons = new Set([state.seasonId]);

    for (let day = 1; day < 20 && state.phase !== "finished"; day++) {
      state = await playADay(state, day);
      seenSeasons.add(state.seasonId);
    }

    expect(state.phase).toBe("finished");
    expect(state.seasonIndex).toBe(2);
    // Each season is a separate, browsable id, which is what makes replays work.
    expect(seenSeasons.size).toBe(3);
  });

  test("a plan of zero seasons keeps going past where one season would have stopped", async () => {
    let state = await startCampaign(arenaEnv, plan({ rounds: 1, seasons: 0 }), NOW);

    for (let day = 1; day <= 6; day++) {
      state = await playADay(state, day);
    }

    expect(state.phase).toBe("running");
    expect(state.seasonIndex).toBeGreaterThan(0);
    expect(state.champion).toBeUndefined();
  });

  test("a paused campaign files results but deals nothing until it is resumed", async () => {
    const started = await startCampaign(arenaEnv, plan(), NOW);
    await fileDealtMatches(started);
    await setCampaignPaused(arenaEnv, true, NOW + HOUR_MS);

    const paused = requireState(await tickCampaign(arenaEnv, NOW + DAY_MS));
    expect(paused.phase).toBe("paused");
    // Reconciled: round 0 is folded in and the final has real names.
    expect(paused.bracket.rounds[1]?.[0]?.a.kind).toBe("competitor");
    // But nothing new went on the board.
    expect(paused.started).toEqual(started.started);

    await setCampaignPaused(arenaEnv, false, NOW + DAY_MS);
    const resumed = requireState(await tickCampaign(arenaEnv, NOW + 2 * DAY_MS));
    expect(resumed.phase).toBe("running");
    expect(resumed.started.length).toBeGreaterThan(started.started.length);
  });

  test("a finished campaign ignores further ticks", async () => {
    let state = await startCampaign(arenaEnv, plan({ rounds: 1 }), NOW);
    state = await playADay(state, 1);
    expect(state.phase).toBe("finished");

    const again = requireState(await tickCampaign(arenaEnv, NOW + 2 * DAY_MS));
    expect(again.lastTickAt).toBe(state.lastTickAt);
  });

  test("stopping a campaign leaves no campaign to tick", async () => {
    await startCampaign(arenaEnv, plan({ rounds: 1, seasons: 2 }), NOW);
    await stopCampaign(arenaEnv);

    expect(await campaignState(arenaEnv)).toBeUndefined();
    expect(await tickCampaign(arenaEnv, NOW + DAY_MS)).toBeUndefined();
  });

  test("the calendar separates the day that happened from the days projected", async () => {
    const started = await startCampaign(arenaEnv, plan({ matchesPerDay: 1 }), NOW);
    await fileDealtMatches(started);
    await tickCampaign(arenaEnv, NOW + DAY_MS);

    const report = await campaignReport(arenaEnv, NOW + DAY_MS);
    if (report === undefined) throw new Error("expected a report");

    // Four entrants is three matches that reach a board.
    expect(report.matchesTotal).toBe(3);
    expect(report.matchesPlayed).toBe(1);

    // Three kinds of day, and only the last is a guess: yesterday's match is
    // played, today's is on the board, and what is left is projected forward.
    const actual = report.calendar.filter((day) => !day.projected);
    const projected = report.calendar.filter((day) => day.projected);
    expect(actual.map((day) => day.day)).toEqual(["2027-01-15", "2027-01-16"]);
    expect(actual[0]?.matches[0]?.status).toBe("played");
    expect(actual[1]?.matches[0]?.status).toBe("playing");
    expect(projected).toHaveLength(1);
    // A match nobody has qualified for yet shows the feeder, not a guess.
    const names = projected.flatMap((day) => day.matches.flatMap((match) => [match.a, match.b]));
    expect(names.some((name) => name.startsWith("Winner of"))).toBe(true);
  });

  test("an out-of-range plan is refused rather than clamped", async () => {
    await expect(startCampaign(arenaEnv, plan({ rounds: 9 }), NOW)).rejects.toThrow(/rounds/);
    await expect(startCampaign(arenaEnv, plan({ msPerPly: 5 }), NOW)).rejects.toThrow(/msPerPly/);
    await expect(startCampaign(arenaEnv, plan({ bestOf: 4 }), NOW)).rejects.toThrow(/bestOf/);
    await expect(startCampaign(arenaEnv, plan({ hourUtc: 24 }), NOW)).rejects.toThrow(/hourUtc/);
    expect(await campaignState(arenaEnv)).toBeUndefined();
  });
});
