#!/usr/bin/env bun
/**
 * Runs a live single-elimination knockout for the twenty-competitor roster
 * against a running Worker's admin API.
 *
 * Unlike the bulk `record()` path, a game started here plays out for real:
 * `SeasonDurableObject.start` schedules each `GameDurableObject`'s own
 * one-ply-per-second alarm, and spectators watch it over the websocket the
 * game already broadcasts on. There is no spoiler gate to wait out and no
 * broadcast schedule to compute -- the live endpoint just reports what has
 * happened so far.
 *
 * Flow: build the twenty-seed bracket, then for each round build that
 * round's games with `matchPairings`, POST them to
 * `/api/seasons/:id/start` (merged into the season if it already exists),
 * poll `/api/seasons/:id/live` until every one of that round's games has
 * finished, resolve the round with `matchOutcome`/`advanceBracket`, persist
 * the bracket and match rows to D1, and move to the next round.
 *
 * Usage:
 *   ARENA_ADMIN_TOKEN=... bun scripts/run-season.ts [--dry-run]
 *   ARENA_ADMIN_TOKEN=... bun scripts/run-season.ts --base https://arena.example.com --season open-2026-09-19
 *
 * Flags:
 *   --base <url>          Worker base URL. Default http://localhost:8787.
 *   --season <id>         Season id. Default open-<yyyy-mm-dd>.
 *   --remote              Write the bracket/match rows to the remote D1
 *                          database instead of the local one.
 *   --concurrency <n>     Kept for parity with the bulk recorder's flag.
 *                         Unused here: a round's games all start in one
 *                         `/start` call and play out in parallel regardless.
 *   --dry-run             Print the full bracket plan and exit. No network
 *                         calls, no database writes, no ARENA_ADMIN_TOKEN
 *                         required.
 */
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildManifest } from "../src/core/manifest.ts";
import type {
  Bracket,
  CompetitorRef,
  GameSummary,
  LiveGameSnapshot,
  Match,
  MatchOutcome,
  MatchSlot,
  Pairing,
  SeasonConfig,
  TerminalState,
} from "../src/core/types.ts";
import { advanceBracket, buildBracket } from "../src/match/bracket.ts";
import { matchOutcome, matchPairings } from "../src/match/match.ts";
import { ROSTER } from "../src/players/roster.ts";
import { OPENINGS } from "../src/season/openings.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE = "http://localhost:8787";
const BEST_OF = 2;
const MAX_PLIES = 200;
const POLL_INTERVAL_MS = 5_000;
/** Generous ceiling: a bestOf-2, 200-ply round at the slowest declared budget. */
const POLL_TIMEOUT_MS = 90 * 60 * 1000;

interface Args {
  readonly base: string;
  readonly season: string;
  readonly remote: boolean;
  readonly concurrency: number;
  readonly dryRun: boolean;
}

/** Everything a network call or D1 write needs once a token is confirmed present. */
interface LiveContext {
  readonly base: string;
  readonly season: string;
  readonly remote: boolean;
  readonly token: string;
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv: readonly string[]): Args {
  let base = DEFAULT_BASE;
  let season = `open-${new Date().toISOString().slice(0, 10)}`;
  let remote = false;
  let concurrency = 6;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--base":
        base = requireValue(argv, ++i, "--base");
        break;
      case "--season":
        season = requireValue(argv, ++i, "--season");
        break;
      case "--remote":
        remote = true;
        break;
      case "--concurrency": {
        const raw = requireValue(argv, ++i, "--concurrency");
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error(`--concurrency must be a positive integer, got: ${raw}`);
        }
        concurrency = parsed;
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  return { base, season, remote, concurrency, dryRun };
}

function describeSlot(slot: MatchSlot): string {
  if (slot.kind === "competitor") return slot.competitor;
  if (slot.kind === "bye") return "(bye)";
  return `winner of ${slot.matchId}`;
}

function competitorNameOf(slot: MatchSlot): string {
  if (slot.kind !== "competitor") {
    throw new Error(`expected a resolved competitor slot, got ${slot.kind}`);
  }
  return slot.competitor;
}

function printDryRunPlan(bracket: Bracket, config: SeasonConfig): void {
  const versions = new Map(config.competitors.map((competitor) => [competitor.name, competitor.version]));
  console.log(
    `Dry run: knockout plan for season "${bracket.seasonId}" ` +
      `(${config.competitors.length} competitors, best-of-${BEST_OF}, ${bracket.rounds.length} rounds).`,
  );

  for (const [round, matches] of bracket.rounds.entries()) {
    console.log(`\nRound ${round}:`);
    for (const match of matches) {
      console.log(
        `  ${match.matchId}: ${describeSlot(match.a)} vs ${describeSlot(match.b)} ` +
          `[${match.gameIds.join(", ")}]`,
      );
      if (match.winner !== undefined) {
        console.log(`    resolved without games: ${match.winner} advances on a bye`);
        continue;
      }
      if (match.a.kind !== "competitor" || match.b.kind !== "competitor") {
        console.log("    pairings depend on earlier rounds, not knowable yet");
        continue;
      }
      const pairings = matchPairings({
        match,
        a: match.a.competitor,
        b: match.b.competitor,
        versions,
        openings: config.openings,
      });
      for (const pairing of pairings) {
        console.log(
          `    ${pairing.gameId}: white=${pairing.white.name} black=${pairing.black.name} ` +
            `opening=${pairing.openingId}`,
        );
      }
    }
  }
}

/**
 * A tournament runs for many minutes, and the Worker it talks to can be
 * redeployed or restarted underneath it. A refused connection is therefore a
 * pause rather than a failure: retry a few times before giving up, and let a
 * real HTTP error through immediately, because that one is our own fault.
 */
async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const attempts = 10;
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(`  ${url} unreachable, retrying in 3s (${attempt}/${attempts})`);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 3_000);
      await promise;
      continue;
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${init.method ?? "GET"} ${url} failed with ${response.status}: ${text}`);
    }
    return text.length === 0 ? undefined : JSON.parse(text);
  }
}

function isCompetitorRef(value: unknown): value is CompetitorRef {
  if (typeof value !== "object" || value === null) return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.name === "string" && typeof raw.version === "string";
}

function isTerminalState(value: unknown): value is TerminalState {
  if (typeof value !== "object" || value === null) return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.result === "string" && typeof raw.reason === "string";
}

/** Narrows one entry of the live endpoint's response. It is network input: never trusted blind. */
function parseLiveGameSnapshot(value: unknown): LiveGameSnapshot {
  if (typeof value !== "object" || value === null) {
    throw new Error(`live game snapshot must be an object: ${JSON.stringify(value)}`);
  }
  const raw = value as Record<string, unknown>;
  const { gameId, seasonId, white, black, fen, ply, lastMove, finished } = raw;
  if (
    typeof gameId !== "string" ||
    typeof seasonId !== "string" ||
    !isCompetitorRef(white) ||
    !isCompetitorRef(black) ||
    typeof fen !== "string" ||
    typeof ply !== "number"
  ) {
    throw new Error(`malformed live game snapshot: ${JSON.stringify(value)}`);
  }
  return {
    gameId,
    seasonId,
    white,
    black,
    fen,
    ply,
    ...(typeof lastMove === "string" ? { lastMove } : {}),
    ...(isTerminalState(finished) ? { finished } : {}),
  };
}

async function startGames(
  ctx: LiveContext,
  config: SeasonConfig,
  pairings: readonly Pairing[],
): Promise<void> {
  const url = `${ctx.base}/api/seasons/${encodeURIComponent(ctx.season)}/start`;
  await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.token}`,
    },
    body: JSON.stringify({ ...config, pairings }),
  });
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function pollUntilFinished(
  ctx: LiveContext,
  gameIds: readonly string[],
): Promise<ReadonlyMap<string, LiveGameSnapshot>> {
  const remaining = new Set(gameIds);
  const finished = new Map<string, LiveGameSnapshot>();
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (remaining.size > 0) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for games to finish: ${[...remaining].join(", ")}`);
    }

    const url = `${ctx.base}/api/seasons/${encodeURIComponent(ctx.season)}/live`;
    const body = await fetchJson(url, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    if (!Array.isArray(body)) {
      throw new Error(`GET ${url} did not return an array: ${JSON.stringify(body)}`);
    }
    const byId = new Map(body.map(parseLiveGameSnapshot).map((snapshot) => [snapshot.gameId, snapshot]));

    for (const gameId of remaining) {
      const snapshot = byId.get(gameId);
      if (snapshot?.finished !== undefined) {
        finished.set(gameId, snapshot);
        remaining.delete(gameId);
      }
    }

    console.log(`  polling: ${finished.size}/${gameIds.length} games finished`);
    if (remaining.size > 0) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  return finished;
}

function toGameSummary(pairing: Pairing, live: LiveGameSnapshot): GameSummary {
  const finished = live.finished;
  if (finished === undefined) {
    throw new Error(`game not finished yet: ${live.gameId}`);
  }
  return {
    seasonId: live.seasonId,
    gameId: live.gameId,
    white: pairing.white,
    black: pairing.black,
    openingId: pairing.openingId,
    result: finished.result,
    reason: finished.reason,
    ...(finished.adjudicatedCp === undefined ? {} : { adjudicatedCp: finished.adjudicatedCp }),
    plies: live.ply,
    // The live endpoint reports state, not a transcript. matchOutcome only
    // reads gameId/white.name/result, so an absent pgn costs it nothing.
    pgn: "",
  };
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlString(value: string): string {
  return `'${escapeSqlString(value)}'`;
}

function sqlNullableString(value: string | undefined): string {
  return value === undefined ? "NULL" : sqlString(value);
}

function bracketUpsertSql(bracket: Bracket): string {
  return (
    `INSERT INTO brackets (bracket_id, season_id, best_of) ` +
    `VALUES (${sqlString(bracket.bracketId)}, ${sqlString(bracket.seasonId)}, ${BEST_OF}) ` +
    `ON CONFLICT (bracket_id) DO UPDATE SET season_id = excluded.season_id, best_of = excluded.best_of;`
  );
}

function matchUpsertSql(match: Match): string {
  const competitorA = match.a.kind === "competitor" ? match.a.competitor : undefined;
  const competitorB = match.b.kind === "competitor" ? match.b.competitor : undefined;
  const feederA = match.a.kind === "winner-of" ? match.a.matchId : undefined;
  const feederB = match.b.kind === "winner-of" ? match.b.matchId : undefined;
  return (
    "INSERT INTO matches " +
    "(match_id, bracket_id, round, slot, competitor_a, competitor_b, feeder_a, feeder_b, best_of, game_ids_json, winner) " +
    `VALUES (${sqlString(match.matchId)}, ${sqlString(match.bracketId)}, ${match.round}, ${match.slot}, ` +
    `${sqlNullableString(competitorA)}, ${sqlNullableString(competitorB)}, ` +
    `${sqlNullableString(feederA)}, ${sqlNullableString(feederB)}, ${match.bestOf}, ` +
    `${sqlString(JSON.stringify(match.gameIds))}, ${sqlNullableString(match.winner)}) ` +
    "ON CONFLICT (match_id) DO UPDATE SET " +
    "competitor_a = excluded.competitor_a, competitor_b = excluded.competitor_b, " +
    "feeder_a = excluded.feeder_a, feeder_b = excluded.feeder_b, winner = excluded.winner;"
  );
}

async function runD1(ctx: LiveContext, sql: string): Promise<void> {
  const path = join(tmpdir(), `run-season-${randomUUID()}.sql`);
  await Bun.write(path, sql);
  try {
    const proc = Bun.spawn(
      ["bunx", "wrangler", "d1", "execute", "arena", ctx.remote ? "--remote" : "--local", "--file", path],
      { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`wrangler d1 execute failed (exit ${exitCode}): ${stderr || stdout}`);
    }
  } finally {
    await rm(path, { force: true });
  }
}

async function persistBracket(ctx: LiveContext, bracket: Bracket): Promise<void> {
  const statements = [bracketUpsertSql(bracket)];
  for (const matches of bracket.rounds) {
    for (const match of matches) {
      statements.push(matchUpsertSql(match));
    }
  }
  await runD1(ctx, statements.join("\n"));
}

async function playRound(
  bracket: Bracket,
  round: number,
  config: SeasonConfig,
  versions: ReadonlyMap<string, string>,
  ctx: LiveContext,
): Promise<Bracket> {
  const matches = bracket.rounds[round];
  if (matches === undefined) {
    throw new Error(`bracket has no round ${round}`);
  }
  const pending = matches.filter((match) => match.winner === undefined);

  if (pending.length === 0) {
    console.log(`\nRound ${round}: every match already decided by a bye.`);
    return bracket;
  }

  const pairingsByMatch = new Map<string, readonly Pairing[]>();
  const allPairings: Pairing[] = [];
  for (const match of pending) {
    const pairings = matchPairings({
      match,
      a: competitorNameOf(match.a),
      b: competitorNameOf(match.b),
      versions,
      openings: config.openings,
    });
    pairingsByMatch.set(match.matchId, pairings);
    allPairings.push(...pairings);
  }

  console.log(`\nRound ${round}: starting ${allPairings.length} games across ${pending.length} matches.`);
  for (const match of pending) {
    console.log(`  ${match.matchId}: ${competitorNameOf(match.a)} vs ${competitorNameOf(match.b)}`);
  }

  await startGames(ctx, config, allPairings);

  const finished = await pollUntilFinished(
    ctx,
    allPairings.map((pairing) => pairing.gameId),
  );

  const outcomes: MatchOutcome[] = pending.map((match) => {
    const pairings = pairingsByMatch.get(match.matchId);
    if (pairings === undefined) {
      throw new Error(`no pairings recorded for ${match.matchId}`);
    }
    const games = pairings.map((pairing) => {
      const live = finished.get(pairing.gameId);
      if (live === undefined) {
        throw new Error(`game ${pairing.gameId} never reported as finished`);
      }
      return toGameSummary(pairing, live);
    });
    const outcome = matchOutcome(match, games);
    if (outcome === undefined) {
      throw new Error(`match ${match.matchId} has no outcome after all its games finished`);
    }
    console.log(
      `  ${match.matchId}: ${outcome.winner} beat ${outcome.loser} ` +
        `${outcome.scoreA}-${outcome.scoreB} (decided by ${outcome.decidedBy})`,
    );
    return outcome;
  });

  const advanced = advanceBracket(bracket, outcomes);
  await persistBracket(ctx, advanced);
  return advanced;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const competitors = ROSTER.map((fields) => buildManifest(fields));
  const config: SeasonConfig = {
    seasonId: args.season,
    seed: `${args.season}:knockout`,
    competitors,
    openings: OPENINGS,
    roundsPerPair: 1,
    maxPlies: MAX_PLIES,
  };
  const versions = new Map(competitors.map((competitor) => [competitor.name, competitor.version]));

  let bracket = buildBracket({
    bracketId: `${args.season}:bracket`,
    seasonId: args.season,
    seeds: competitors.map((competitor) => competitor.name),
    bestOf: BEST_OF,
  });
  // Folds in any round-0 byes up front, so `pending` filters below skip them.
  bracket = advanceBracket(bracket, []);

  if (args.dryRun) {
    printDryRunPlan(bracket, config);
    return;
  }

  const token = process.env.ARENA_ADMIN_TOKEN;
  if (token === undefined || token.length === 0) {
    console.error(
      "ARENA_ADMIN_TOKEN is not set. Export it (matching the Worker's configured admin token) before running a live tournament.",
    );
    process.exitCode = 1;
    return;
  }
  const ctx: LiveContext = { base: args.base, season: args.season, remote: args.remote, token };

  console.log(
    `Starting live knockout "${args.season}" against ${ctx.base} with ${competitors.length} competitors ` +
      `(best-of-${BEST_OF}, ${bracket.rounds.length} rounds).`,
  );

  for (let round = 0; round < bracket.rounds.length; round++) {
    bracket = await playRound(bracket, round, config, versions, ctx);
  }

  const finalRound = bracket.rounds[bracket.rounds.length - 1];
  const champion = finalRound?.[0]?.winner;
  if (champion === undefined) {
    throw new Error("bracket finished without a champion");
  }

  // Live games live in Durable Object storage while they play. Completing the
  // season projects them into D1, which is what the standings, the replay
  // shelf and every competitor profile read from.
  console.log("\nFiling the season into D1…");
  await fetchJson(`${ctx.base}/api/seasons/${encodeURIComponent(ctx.season)}/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${ctx.token}` },
  });

  console.log(`Champion: ${champion}`);
}

await main();
