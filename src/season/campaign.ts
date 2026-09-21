// A campaign is the thing the operator actually starts: a bracket depth, how
// many seasons to play back to back with the same roster, and the rhythm they
// play at. Everything here is pure, so the state machine can be exercised
// without a Durable Object, a database or a clock.
//
// The rhythm is one daily window. At the chosen UTC hour the scheduler puts
// up to `matchesPerDay` ready matches on the board, and does nothing else
// until the next day. A three round bracket is eight entrants and seven
// matches, so at one a day a season is exactly one week.
//
// The shape of a campaign's progress is deliberately small. Which games have
// been played is not stored here: the bracket already knows every game id it
// expects, and D1 already knows which of those are filed. Duplicating that
// into campaign state would give two answers that can disagree. The one
// exception is `started`, because a match handed to the Durable Object and
// still being played leaves no trace in D1 until it finishes, and the
// scheduler must not hand it over twice.
import { resolveSlot } from "../match/bracket.ts";
import { ContractViolation } from "../core/errors.ts";
import type { Bracket, EpochMs, Match, MatchSlot } from "../core/types.ts";

const SUBJECT = "season.campaign";

/** Four rounds is sixteen entrants and no byes, which is why it is the default. */
export const MAX_ROUNDS = 5;
export const MAX_SEASONS = 20;
/** Slower than this and a season never finishes; faster and the provider rate limits. */
export const MIN_MS_PER_PLY = 100;
export const MAX_MS_PER_PLY = 60_000;
/** Two games with colours swapped is the fairer match; one game is the faster season. */
export const MAX_BEST_OF = 2;
export const MAX_MATCHES_PER_DAY = 8;
const MS_PER_DAY = 86_400_000;

export interface CampaignPlan {
  /** Bracket depth. Entrants is 2**rounds, capped at the roster size. */
  readonly rounds: number;
  /** 0 means run until the operator stops it. Otherwise 1 to MAX_SEASONS. */
  readonly seasons: number;
  readonly msPerPly: number;
  /** Games per match. 2 swaps colours, 1 halves the season. */
  readonly bestOf: number;
  readonly matchesPerDay: number;
  /** The UTC hour the daily window opens. */
  readonly hourUtc: number;
}

/**
 * Where a campaign is.
 *
 * - `running`: the scheduler opens a window every day.
 * - `paused`: it reconciles finished games but starts nothing new. Matches
 *   already on the board keep playing, because their clock lives in the game
 *   Durable Object and pausing a broadcast midway would strand its viewers.
 * - `finished`: every season the plan asked for has a champion.
 */
export type CampaignPhase = "running" | "paused" | "finished";

export interface CampaignState {
  readonly campaignId: string;
  readonly plan: CampaignPlan;
  readonly entrants: number;
  /** 0-based index of the season being played. */
  readonly seasonIndex: number;
  readonly seasonId: string;
  readonly bracket: Bracket;
  /** Match ids already handed to the season Durable Object. */
  readonly started: readonly string[];
  /** UTC date key of the last day a window opened, so a second cron is a no-op. */
  readonly lastStartDay?: string;
  readonly phase: CampaignPhase;
  readonly startedAt: EpochMs;
  readonly lastTickAt: EpochMs;
  /** Set once the current season's final has a winner. */
  readonly champion?: string;
}

/** One match as the calendar shows it, with names resolved where they are known. */
export interface ScheduledMatch {
  readonly matchId: string;
  readonly round: number;
  /** Resolved competitor name, or "Winner of round 1 match 2" when not yet known. */
  readonly a: string;
  readonly b: string;
  readonly status: "played" | "playing" | "scheduled";
  readonly winner?: string;
}

export interface CalendarDay {
  /** UTC date key, "2026-09-21". */
  readonly day: string;
  readonly seasonId: string;
  readonly seasonIndex: number;
  /** True when this day is a projection rather than something that happened. */
  readonly projected: boolean;
  readonly matches: readonly ScheduledMatch[];
}

function fail(detail: string): never {
  throw new ContractViolation(SUBJECT, detail);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/**
 * Validates an operator's campaign request.
 *
 * Contract: every field is required and bounded. A plan is the one place a
 * human number reaches the scheduler, so nothing here is defaulted silently.
 */
export function parseCampaignPlan(raw: unknown): CampaignPlan {
  if (!isObject(raw)) fail("campaign plan must be an object");
  return {
    rounds: boundedInteger(raw.rounds, "rounds", 1, MAX_ROUNDS),
    // 0 is the "until I stop it" case, which is why the floor is 0 and not 1.
    seasons: boundedInteger(raw.seasons, "seasons", 0, MAX_SEASONS),
    msPerPly: boundedInteger(raw.msPerPly, "msPerPly", MIN_MS_PER_PLY, MAX_MS_PER_PLY),
    bestOf: boundedInteger(raw.bestOf, "bestOf", 1, MAX_BEST_OF),
    matchesPerDay: boundedInteger(raw.matchesPerDay, "matchesPerDay", 1, MAX_MATCHES_PER_DAY),
    hourUtc: boundedInteger(raw.hourUtc, "hourUtc", 0, 23),
  };
}

/** The UTC date a moment falls on, as "2026-09-21". */
export function dayKey(at: EpochMs): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * How many competitors enter a bracket of this depth.
 *
 * A depth deeper than the roster can fill is not an error: buildBracket pads
 * the difference with byes, which is how 20 personas play a 5-round bracket.
 */
export function entrantsFor(rounds: number, rosterSize: number): number {
  return Math.min(2 ** rounds, rosterSize);
}

/** Season ids are derived, never stored, so a campaign cannot drift from them. */
export function seasonIdFor(campaignId: string, seasonIndex: number): string {
  return `${campaignId}-s${seasonIndex + 1}`;
}

/**
 * The champion, or undefined while the final is undecided.
 *
 * The final is the last round, which single elimination guarantees holds
 * exactly one match.
 */
export function championOf(bracket: Bracket): string | undefined {
  const final = bracket.rounds[bracket.rounds.length - 1];
  return final?.[0]?.winner;
}

/**
 * True when the campaign has played every season its plan asked for.
 *
 * A plan of 0 seasons never satisfies this, which is what "until I stop it"
 * means: the only thing that ends such a campaign is the operator.
 */
export function isLastSeason(state: CampaignState): boolean {
  return state.plan.seasons !== 0 && state.seasonIndex + 1 >= state.plan.seasons;
}

/** Every match in the bracket, round 0 first, then by slot. */
export function allMatches(bracket: Bracket): readonly Match[] {
  return bracket.rounds.flat();
}

/**
 * How the calendar names a slot, including one nobody has qualified for yet.
 *
 * Roster names are lowercase ids. These sit beside prose like "Winner of
 * round 1 match 2" in the console, so they are capitalised to match rather
 * than left as raw ids.
 */
function placeholderFor(slot: MatchSlot, matches: readonly Match[]): string {
  if (slot.kind === "bye") return "Bye";
  if (slot.kind === "competitor") return capitalise(slot.competitor);
  const feeder = matches.find((match) => match.matchId === slot.matchId);
  return feeder === undefined
    ? `Winner of ${slot.matchId}`
    : `Winner of round ${feeder.round + 1} match ${feeder.slot + 1}`;
}

function capitalise(name: string): string {
  return name.length === 0 ? name : (name[0]?.toUpperCase() ?? "") + name.slice(1);
}

/**
 * The matches that could go on the board right now, in bracket order.
 *
 * A match qualifies when it has no winner, both its slots resolve to a real
 * name, and it has not already been handed over. Byes are excluded by the
 * winner test, because `advanceBracket` decides them before anything is
 * played.
 */
export function readyMatches(bracket: Bracket, started: readonly string[]): readonly Match[] {
  const flat = allMatches(bracket);
  const handed = new Set(started);
  return flat.filter((match) => {
    if (match.winner !== undefined || handed.has(match.matchId)) return false;
    return resolveSlot(match.a, flat) !== undefined && resolveSlot(match.b, flat) !== undefined;
  });
}

/** Matches that were handed over and have not come back with a winner. */
export function inFlightMatches(bracket: Bracket, started: readonly string[]): readonly Match[] {
  const handed = new Set(started);
  return allMatches(bracket).filter(
    (match) => handed.has(match.matchId) && match.winner === undefined,
  );
}

/** Matches that reach a board, so byes are excluded. Drives the progress line. */
export function playableCount(bracket: Bracket): number {
  return allMatches(bracket).filter(
    (match) => match.a.kind !== "bye" && match.b.kind !== "bye",
  ).length;
}

function scheduledMatch(
  match: Match,
  flat: readonly Match[],
  status: ScheduledMatch["status"],
): ScheduledMatch {
  return {
    matchId: match.matchId,
    round: match.round,
    a: placeholderFor(match.a, flat),
    b: placeholderFor(match.b, flat),
    status,
    ...(match.winner === undefined ? {} : { winner: match.winner }),
  };
}

/**
 * The campaign's days, the ones that happened and the ones that will.
 *
 * Past days are grouped from `playedOn`, which the caller fills from the filed
 * ledger's broadcast times, so a day that actually happened shows its real
 * date. Everything still to play is projected forward from the next window at
 * `matchesPerDay` a day, in bracket order.
 *
 * The projection is honest about one thing it cannot know: a match whose
 * feeders have not been decided has no names yet, so it shows "Winner of
 * round 1 match 2" rather than guessing.
 */
export function projectCalendar(
  state: CampaignState,
  playedOn: ReadonlyMap<string, EpochMs>,
  now: EpochMs,
): readonly CalendarDay[] {
  const flat = allMatches(state.bracket);
  const handed = new Set(state.started);
  const days = new Map<string, ScheduledMatch[]>();
  const push = (day: string, entry: ScheduledMatch): void => {
    const existing = days.get(day);
    if (existing === undefined) days.set(day, [entry]);
    else existing.push(entry);
  };

  const future: Match[] = [];
  for (const match of flat) {
    if (match.a.kind === "bye" || match.b.kind === "bye") continue;
    const playedAt = playedOn.get(match.matchId);
    if (playedAt !== undefined) {
      push(dayKey(playedAt), scheduledMatch(match, flat, "played"));
    } else if (handed.has(match.matchId)) {
      push(dayKey(now), scheduledMatch(match, flat, "playing"));
    } else {
      future.push(match);
    }
  }

  const past = [...days.keys()].sort();
  const projectedFrom = nextWindow(state.plan.hourUtc, state.lastStartDay, now);
  const projected: CalendarDay[] = [];
  for (let i = 0; i < future.length; i += state.plan.matchesPerDay) {
    const day = dayKey(projectedFrom + (i / state.plan.matchesPerDay) * MS_PER_DAY);
    projected.push({
      day,
      seasonId: state.seasonId,
      seasonIndex: state.seasonIndex,
      projected: true,
      matches: future
        .slice(i, i + state.plan.matchesPerDay)
        .map((match) => scheduledMatch(match, flat, "scheduled")),
    });
  }

  return [
    ...past.map((day) => ({
      day,
      seasonId: state.seasonId,
      seasonIndex: state.seasonIndex,
      projected: false,
      matches: days.get(day) ?? [],
    })),
    ...projected,
  ];
}

/**
 * When the next daily window opens.
 *
 * Today's window if the hour has not passed and today has not already been
 * used, otherwise tomorrow's.
 */
export function nextWindow(hourUtc: number, lastStartDay: string | undefined, now: EpochMs): EpochMs {
  const today = new Date(now);
  today.setUTCHours(hourUtc, 0, 0, 0);
  const usedToday = lastStartDay === dayKey(now);
  if (today.getTime() > now && !usedToday) return today.getTime();
  return today.getTime() + MS_PER_DAY;
}

/**
 * Whether a window is open right now.
 *
 * The cron runs hourly so that a missed hour retries, which means most ticks
 * must start nothing. A window is open when the chosen hour has arrived and no
 * window has opened today. Comparing on the UTC day rather than on elapsed
 * time is what makes a doubled cron a no-op.
 */
export function windowOpen(plan: CampaignPlan, lastStartDay: string | undefined, now: EpochMs): boolean {
  if (lastStartDay === dayKey(now)) return false;
  return new Date(now).getUTCHours() >= plan.hourUtc;
}

function parseSlot(raw: unknown, where: string): MatchSlot {
  if (!isObject(raw)) fail(`${where} slot must be an object`);
  if (raw.kind === "bye") return { kind: "bye" };
  if (raw.kind === "competitor" && typeof raw.competitor === "string") {
    return { kind: "competitor", competitor: raw.competitor };
  }
  if (raw.kind === "winner-of" && typeof raw.matchId === "string") {
    return { kind: "winner-of", matchId: raw.matchId };
  }
  fail(`${where} slot has an unknown kind: ${String(raw.kind)}`);
}

function parseMatch(raw: unknown): Match {
  if (!isObject(raw)) fail("match must be an object");
  const { matchId, bracketId, round, slot, a, b, bestOf, gameIds, winner } = raw;
  if (typeof matchId !== "string") fail("matchId must be a string");
  if (typeof bracketId !== "string") fail("bracketId must be a string");
  if (!Array.isArray(gameIds) || gameIds.some((id: unknown) => typeof id !== "string")) {
    fail(`${matchId} gameIds must be strings`);
  }
  if (winner !== undefined && typeof winner !== "string") {
    fail(`${matchId} winner must be a string when present`);
  }
  return {
    matchId,
    bracketId,
    round: boundedInteger(round, `${matchId} round`, 0, MAX_ROUNDS - 1),
    slot: boundedInteger(slot, `${matchId} slot`, 0, 2 ** MAX_ROUNDS),
    a: parseSlot(a, `${matchId} a`),
    b: parseSlot(b, `${matchId} b`),
    bestOf: boundedInteger(bestOf, `${matchId} bestOf`, 1, 8),
    gameIds: gameIds as readonly string[],
    ...(winner === undefined ? {} : { winner }),
  };
}

/**
 * Narrows a stored bracket.
 *
 * Only `buildBracket` and `advanceBracket` ever write one, so this is not
 * guarding against a hostile caller. It is guarding against a campaign row
 * written by an older deploy whose shape has since moved.
 */
function parseBracket(raw: unknown): Bracket {
  if (!isObject(raw)) fail("bracket must be an object");
  const { bracketId, seasonId, rounds } = raw;
  if (typeof bracketId !== "string") fail("bracket bracketId must be a string");
  if (typeof seasonId !== "string") fail("bracket seasonId must be a string");
  if (!Array.isArray(rounds) || rounds.length === 0) fail("bracket rounds must be a non-empty array");
  return {
    bracketId,
    seasonId,
    rounds: rounds.map((round: unknown) => {
      if (!Array.isArray(round)) fail("each bracket round must be an array");
      return round.map(parseMatch);
    }),
  };
}

/**
 * Narrows stored campaign JSON.
 *
 * Read back from D1, so it is untrusted input like any other row: a campaign
 * written by an older deploy must fail loudly rather than drive the scheduler
 * with half a shape.
 */
export function parseCampaignState(raw: unknown): CampaignState {
  if (!isObject(raw)) fail("campaign state must be an object");
  const {
    campaignId,
    plan,
    entrants,
    seasonIndex,
    seasonId,
    bracket,
    started,
    lastStartDay,
    phase,
    startedAt,
    lastTickAt,
    champion,
  } = raw;

  if (typeof campaignId !== "string" || campaignId.length === 0) {
    fail("campaignId must be a non-empty string");
  }
  if (typeof seasonId !== "string" || seasonId.length === 0) {
    fail("seasonId must be a non-empty string");
  }
  if (phase !== "running" && phase !== "paused" && phase !== "finished") {
    fail(`unknown phase: ${String(phase)}`);
  }
  if (!Array.isArray(started) || started.some((id: unknown) => typeof id !== "string")) {
    fail("started must be an array of match ids");
  }
  if (lastStartDay !== undefined && typeof lastStartDay !== "string") {
    fail("lastStartDay must be a string when present");
  }
  if (champion !== undefined && typeof champion !== "string") {
    fail("champion must be a string when present");
  }

  return {
    campaignId,
    plan: parseCampaignPlan(plan),
    entrants: boundedInteger(entrants, "entrants", 2, 1_000),
    // Not bounded by MAX_SEASONS: a plan of 0 seasons runs until stopped, so
    // the index is only bounded by how long the operator leaves it running.
    seasonIndex: boundedInteger(seasonIndex, "seasonIndex", 0, 10_000),
    seasonId,
    bracket: parseBracket(bracket),
    started: started as readonly string[],
    ...(lastStartDay === undefined ? {} : { lastStartDay }),
    phase,
    startedAt: boundedInteger(startedAt, "startedAt", 0, Number.MAX_SAFE_INTEGER),
    lastTickAt: boundedInteger(lastTickAt, "lastTickAt", 0, Number.MAX_SAFE_INTEGER),
    ...(champion === undefined ? {} : { champion }),
  };
}
