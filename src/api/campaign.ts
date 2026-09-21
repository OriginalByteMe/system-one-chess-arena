// The scheduler that plays a campaign without anybody's laptop being on.
//
// One tick reconciles, then at most once a day it starts matches. An hourly
// cron calls it, so a missed hour retries by itself and a finished game is
// filed within the hour rather than a day later. The operator console calls
// the same function to force a start immediately, because waiting a day to
// find out the wiring works is not a debugging strategy.
//
// The tick is idempotent by construction: it reads the world (which games are
// filed, which matches are decided) rather than trusting a cursor, so a cron
// that fires twice, a retry after a failure, and a manual advance all converge
// on the same bracket. The one cursor it keeps, `lastStartDay`, exists only so
// that a second cron in the same day does not deal a second day of matches.
import { buildManifest } from "../core/manifest.ts";
import { ContractViolation } from "../core/errors.ts";
import type { Env } from "../core/env.ts";
import type {
  Bracket,
  EpochMs,
  GameSummary,
  Match,
  MatchOutcome,
  Pairing,
  SeasonConfig,
} from "../core/types.ts";
import { advanceBracket, buildBracket, resolveSlot } from "../match/bracket.ts";
import { matchOutcome, matchPairings } from "../match/match.ts";
import { ROSTER } from "../players/roster.ts";
import { OPENINGS } from "../season/openings.ts";
import {
  championOf,
  dayKey,
  entrantsFor,
  isLastSeason,
  parseCampaignPlan,
  parseCampaignState,
  playableCount,
  projectCalendar,
  readyMatches,
  seasonIdFor,
  windowOpen,
} from "../season/campaign.ts";
import type { CalendarDay, CampaignPlan, CampaignState } from "../season/campaign.ts";

const SUBJECT = "api.campaign";
export const CAMPAIGN_KEY = "campaign";
/** Matches MAX_PLIES in scripts/run-season.ts, so a live season ends like a recorded one. */
const MAX_PLIES = 200;


export type CampaignEnv = Pick<Env, "DB" | "SEASON">;

function fail(detail: string): never {
  throw new ContractViolation(SUBJECT, detail);
}

/**
 * The config a campaign season plays under.
 *
 * Derived from the plan, never stored, so every tick rebuilds the identical
 * object. The season Durable Object compares configs by value on restart, so a
 * config that is not byte-stable would make the second tick look like a
 * different season.
 */
export function campaignSeasonConfig(plan: CampaignPlan, seasonId: string): SeasonConfig {
  const entrants = entrantsFor(plan.rounds, ROSTER.length);
  return {
    seasonId,
    seed: `${seasonId}:knockout`,
    competitors: ROSTER.slice(0, entrants).map(buildManifest),
    openings: OPENINGS,
    roundsPerPair: 1,
    maxPlies: MAX_PLIES,
  };
}

async function readCampaign(db: D1Database): Promise<CampaignState | undefined> {
  const row = await db
    .prepare("SELECT value FROM site_settings WHERE key = ?")
    .bind(CAMPAIGN_KEY)
    .first();
  if (row === null || typeof row.value !== "string") return undefined;
  return parseCampaignState(JSON.parse(row.value));
}

async function writeCampaign(db: D1Database, state: CampaignState): Promise<CampaignState> {
  await db
    .prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)" +
        " ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(CAMPAIGN_KEY, JSON.stringify(state), state.lastTickAt)
    .run();
  return state;
}

/**
 * The games a match played, read from the filed ledger.
 *
 * D1 is the source of truth rather than the season Durable Object because a
 * round is only really over once it is filed: a match decided from live state
 * that then failed to project would advance the bracket past games the site
 * cannot show.
 */
async function filedGames(db: D1Database, seasonId: string): Promise<readonly GameSummary[]> {
  const { results } = await db
    .prepare(
      "SELECT game_id, white_competitor, white_version, black_competitor, black_version," +
        " opening_id, result, reason, plies, pgn FROM games WHERE season_id = ?",
    )
    .bind(seasonId)
    .all();

  return results.map((row): GameSummary => {
    const raw = row as Record<string, unknown>;
    const gameId = raw.game_id;
    const result = raw.result;
    const reason = raw.reason;
    if (typeof gameId !== "string" || typeof result !== "string" || typeof reason !== "string") {
      fail("games row is missing gameId, result or reason");
    }
    return {
      seasonId,
      gameId,
      white: { name: String(raw.white_competitor), version: String(raw.white_version) },
      black: { name: String(raw.black_competitor), version: String(raw.black_version) },
      openingId: String(raw.opening_id),
      result: result as GameSummary["result"],
      reason: reason as GameSummary["reason"],
      plies: Number(raw.plies),
      pgn: String(raw.pgn),
    };
  });
}

/** Rows for the bracket and its matches, so /api/seasons/:id/bracket can read them. */
async function persistBracket(db: D1Database, bracket: Bracket, bestOf: number): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO brackets (bracket_id, season_id, best_of) VALUES (?, ?, ?)" +
          " ON CONFLICT (bracket_id) DO UPDATE SET season_id = excluded.season_id," +
          " best_of = excluded.best_of",
      )
      .bind(bracket.bracketId, bracket.seasonId, bestOf),
  ];
  const insertMatch = db.prepare(
    "INSERT INTO matches (match_id, bracket_id, round, slot, competitor_a, competitor_b," +
      " feeder_a, feeder_b, best_of, game_ids_json, winner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)" +
      " ON CONFLICT (match_id) DO UPDATE SET competitor_a = excluded.competitor_a," +
      " competitor_b = excluded.competitor_b, winner = excluded.winner",
  );
  for (const matches of bracket.rounds) {
    for (const match of matches) {
      statements.push(
        insertMatch.bind(
          match.matchId,
          match.bracketId,
          match.round,
          match.slot,
          match.a.kind === "competitor" ? match.a.competitor : null,
          match.b.kind === "competitor" ? match.b.competitor : null,
          match.a.kind === "winner-of" ? match.a.matchId : null,
          match.b.kind === "winner-of" ? match.b.matchId : null,
          match.bestOf,
          JSON.stringify(match.gameIds),
          match.winner ?? null,
        ),
      );
    }
  }
  await db.batch(statements);
}

/**
 * Pairings for a set of matches that are ready to play.
 *
 * A match whose slots are still `winner-of` cannot be paired. `readyMatches`
 * has already excluded those, so reaching one here means the bracket and the
 * started list have drifted apart, which is worth failing loudly over.
 */
function pairingsFor(
  bracket: Bracket,
  matches: readonly Match[],
  config: SeasonConfig,
): readonly Pairing[] {
  const versions = new Map(config.competitors.map((entry) => [entry.name, entry.version]));
  const flat = bracket.rounds.flat();
  const pairings: Pairing[] = [];
  for (const match of matches) {
    const a = resolveSlot(match.a, flat);
    const b = resolveSlot(match.b, flat);
    if (a === undefined || b === undefined) {
      fail(`${match.matchId} has an unresolved slot`);
    }
    pairings.push(...matchPairings({ match, a, b, versions, openings: config.openings }));
  }
  return pairings;
}

/**
 * Outcomes for every started match whose games are all filed.
 *
 * Unlike the round-at-a-time version this replaced, a match that is still
 * being played does not hold the others back. That is what lets a bracket
 * advance the morning after one match while another is mid broadcast.
 */
function settledOutcomes(
  bracket: Bracket,
  started: readonly string[],
  games: readonly GameSummary[],
): readonly MatchOutcome[] {
  const handed = new Set(started);
  const outcomes: MatchOutcome[] = [];
  for (const match of bracket.rounds.flat()) {
    if (match.winner !== undefined || !handed.has(match.matchId)) continue;
    const outcome = matchOutcome(match, games);
    if (outcome !== undefined) outcomes.push(outcome);
  }
  return outcomes;
}

/**
 * When each decided match was broadcast, so the calendar can show real dates.
 *
 * Keyed off the bracket's own game ids rather than the `match_id` column,
 * because the season Durable Object files a game from a GameSummary and a
 * summary carries no match. The bracket is the thing that knows which games
 * belong to which match, so it is the thing that is asked.
 */
async function matchDays(
  db: D1Database,
  bracket: Bracket,
): Promise<ReadonlyMap<string, EpochMs>> {
  const { results } = await db
    .prepare(
      "SELECT game_id, broadcast_start_at FROM games" +
        " WHERE season_id = ? AND broadcast_start_at IS NOT NULL",
    )
    .bind(bracket.seasonId)
    .all();

  const byGame = new Map<string, EpochMs>();
  for (const row of results) {
    const raw = row as Record<string, unknown>;
    const gameId = raw.game_id;
    const startAt = raw.broadcast_start_at;
    if (typeof gameId !== "string" || typeof startAt !== "number") continue;
    byGame.set(gameId, startAt);
  }

  const days = new Map<string, EpochMs>();
  for (const match of bracket.rounds.flat()) {
    const times = match.gameIds
      .map((gameId) => byGame.get(gameId))
      .filter((at): at is EpochMs => at !== undefined);
    // A match half filed is still being played, so it is not a past day yet.
    if (times.length === match.gameIds.length && times.length > 0) {
      days.set(match.matchId, Math.min(...times));
    }
  }
  return days;
}

/** The season Durable Object's RPC stub; typed by the SEASON binding itself. */
function seasonStub(env: CampaignEnv, seasonId: string) {
  return env.SEASON.get(env.SEASON.idFromName(seasonId));
}

/**
 * A fresh season's bracket, built and filed but with nothing on the board.
 *
 * Nothing starts here. The daily window is the only thing that puts matches
 * on a board, so a season that opens at 02:00 because the previous final was
 * decided then still plays its first match at the operator's chosen hour.
 */
async function openSeason(
  env: CampaignEnv,
  plan: CampaignPlan,
  campaignId: string,
  seasonIndex: number,
  now: EpochMs,
  lastStartDay: string | undefined,
): Promise<Omit<CampaignState, "startedAt">> {
  const seasonId = seasonIdFor(campaignId, seasonIndex);
  const config = campaignSeasonConfig(plan, seasonId);
  // Byes are folded before anything is played, so the ready list holds only
  // matches that actually reach a board.
  const bracket = advanceBracket(
    buildBracket({
      bracketId: `${seasonId}:bracket`,
      seasonId,
      seeds: config.competitors.map((entry) => entry.name),
      bestOf: plan.bestOf,
    }),
    [],
  );
  await persistBracket(env.DB, bracket, plan.bestOf);

  return {
    campaignId,
    plan,
    entrants: config.competitors.length,
    seasonIndex,
    seasonId,
    bracket,
    started: [],
    ...(lastStartDay === undefined ? {} : { lastStartDay }),
    phase: "running",
    lastTickAt: now,
  };
}

/**
 * Hands the next matches to the season Durable Object.
 *
 * Returns the state unchanged when nothing is ready, which happens when every
 * remaining match is waiting on a result that has not been filed yet.
 */
async function dealMatches(
  env: CampaignEnv,
  state: CampaignState,
  now: EpochMs,
): Promise<CampaignState> {
  const ready = readyMatches(state.bracket, state.started).slice(0, state.plan.matchesPerDay);
  if (ready.length === 0) return state;

  const config = campaignSeasonConfig(state.plan, state.seasonId);
  const pairings = pairingsFor(state.bracket, ready, config);
  await seasonStub(env, state.seasonId).start(config, pairings, state.plan.msPerPly);

  return {
    ...state,
    started: [...state.started, ...ready.map((match) => match.matchId)],
    lastStartDay: dayKey(now),
    lastTickAt: now,
  };
}

/**
 * Starts a campaign, replacing any previous one.
 *
 * The first matches go live immediately rather than waiting for tonight's
 * window: the operator pressed a button and expects something to happen. From
 * the second day on, the window is the only thing that deals.
 */
export async function startCampaign(
  env: CampaignEnv,
  raw: unknown,
  now: EpochMs,
): Promise<CampaignState> {
  const plan = parseCampaignPlan(raw);
  const campaignId = `arena-${dayKey(now)}-${now.toString(36)}`;
  const opened = await openSeason(env, plan, campaignId, 0, now, undefined);
  const dealt = await dealMatches(env, { ...opened, startedAt: now }, now);
  return writeCampaign(env.DB, dealt);
}

export async function campaignState(env: CampaignEnv): Promise<CampaignState | undefined> {
  return readCampaign(env.DB);
}

export async function stopCampaign(env: CampaignEnv): Promise<void> {
  await env.DB.prepare("DELETE FROM site_settings WHERE key = ?").bind(CAMPAIGN_KEY).run();
}

/**
 * Pauses or resumes a campaign.
 *
 * Pausing does not touch games already on the board. Their clock lives in the
 * game Durable Object and rewinding it would strand anyone watching, so pause
 * means "deal nothing new" and the last matches dealt play themselves out.
 */
export async function setCampaignPaused(
  env: CampaignEnv,
  paused: boolean,
  now: EpochMs,
): Promise<CampaignState | undefined> {
  const state = await readCampaign(env.DB);
  if (state === undefined || state.phase === "finished") return state;
  return writeCampaign(env.DB, {
    ...state,
    phase: paused ? "paused" : "running",
    lastTickAt: now,
  });
}

/**
 * Advances a campaign.
 *
 * Every tick reconciles: it asks the season to file whatever has finished,
 * folds decided matches into the bracket, and crowns or rolls over when the
 * final is done. That part runs hourly and is safe to repeat.
 *
 * Dealing is the once-a-day part. It happens when the chosen hour has arrived
 * and no window has opened today, or when `force` is set, which is the console
 * button. A paused campaign reconciles and deals nothing.
 */
export async function tickCampaign(
  env: CampaignEnv,
  now: EpochMs,
  force = false,
): Promise<CampaignState | undefined> {
  const initial = await readCampaign(env.DB);
  if (initial === undefined || initial.phase === "finished") return initial;

  const state = await reconcile(env, initial, now);
  if (state.phase === "finished") return writeCampaign(env.DB, state);

  const open = force || (state.phase === "running" && windowOpen(state.plan, state.lastStartDay, now));
  if (!open) return writeCampaign(env.DB, { ...state, lastTickAt: now });

  return writeCampaign(env.DB, await dealMatches(env, state, now));
}

/**
 * Folds every settled match into the bracket, rolling over to the next season
 * when the final is decided.
 *
 * A season can finish and the next one open inside a single tick, which is
 * what keeps a rollover from costing a day.
 */
async function reconcile(
  env: CampaignEnv,
  state: CampaignState,
  now: EpochMs,
): Promise<CampaignState> {
  // A match is over only once every one of its games is filed, and `complete()`
  // is what makes that true, so ask the season to file before looking.
  await seasonStub(env, state.seasonId).complete();
  const games = await filedGames(env.DB, state.seasonId);
  const outcomes = settledOutcomes(state.bracket, state.started, games);

  const advanced = outcomes.length === 0 ? state.bracket : advanceBracket(state.bracket, outcomes);
  if (outcomes.length > 0) await persistBracket(env.DB, advanced, state.plan.bestOf);

  const champion = championOf(advanced);
  if (champion === undefined) {
    return { ...state, bracket: advanced, lastTickAt: now };
  }

  if (isLastSeason(state)) {
    return { ...state, bracket: advanced, phase: "finished", champion, lastTickAt: now };
  }

  const opened = await openSeason(
    env,
    state.plan,
    state.campaignId,
    state.seasonIndex + 1,
    now,
    state.lastStartDay,
  );
  return { ...opened, phase: state.phase, startedAt: state.startedAt };
}

/** Everything the console needs to draw a campaign, including its calendar. */
export interface CampaignReport {
  readonly state: CampaignState;
  readonly matchesTotal: number;
  readonly matchesPlayed: number;
  readonly calendar: readonly CalendarDay[];
}

export async function campaignReport(
  env: CampaignEnv,
  now: EpochMs,
): Promise<CampaignReport | undefined> {
  const state = await readCampaign(env.DB);
  if (state === undefined) return undefined;
  const played = await matchDays(env.DB, state.bracket);
  return {
    state,
    matchesTotal: playableCount(state.bracket),
    matchesPlayed: state.bracket.rounds
      .flat()
      .filter((match) => match.winner !== undefined && match.a.kind !== "bye" && match.b.kind !== "bye")
      .length,
    calendar: projectCalendar(state, played, now),
  };
}
