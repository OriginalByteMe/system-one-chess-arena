import { DurableObject } from "cloudflare:workers";
import { Chess } from "chess.js";

import { ContractViolation } from "../core/errors.ts";
import type { Env } from "../core/env.ts";
import type {
  BroadcastSchedule,
  Colour,
  CompetitorManifest,
  CompetitorVersionRow,
  DecisionRecord,
  GameResult,
  GameSummary,
  LiveGameSnapshot,
  Pairing,
  RecordRequest,
  SeasonConfig,
  SeasonStandings,
  StrategyLabel,
  Trait,
} from "../core/types.ts";
import { ALARM_DELAY_MS } from "./game.ts";
import type { GameSnapshot } from "./game.ts";
import { createRng } from "../core/rng.ts";
import { DEFAULT_ELO, ratingsFromGames } from "../season/elo.ts";
import { decisionStatements } from "../season/decisions.ts";
import { registerVersions } from "../season/identity.ts";
import { buildPairings } from "../season/pairings.ts";

const CONFIG_KEY = "config";
const PAIRINGS_KEY = "pairings";
/** gameId -> the broadcast a live game actually played on. */
const SCHEDULES_KEY = "schedules";
/** Milliseconds per ply, fixed when the season starts so later rounds match. */
const PACE_KEY = "pace";
const FINISHED_PREFIX = "finished:";

interface GameStub extends DurableObjectStub {
  start(pairing: Pairing, config: SeasonConfig, msPerPly?: number): Promise<void>;
  snapshot(): Promise<GameSnapshot>;
  record(
    pairing: Pairing,
    config: SeasonConfig,
    schedule: BroadcastSchedule,
  ): Promise<GameSnapshot>;
}

interface FinishedGame {
  readonly summary: GameSummary;
  readonly decisions: readonly DecisionRecord[];
}

interface StrategyOutcome {
  readonly competitor: string;
  readonly version: string;
  readonly strategy: StrategyLabel;
  picks: number;
  score: number;
  confidenceTotal: number;
}

function violation(method: string, detail: string): never {
  throw new ContractViolation(
    `do/season.SeasonDurableObject.${method}`,
    detail,
  );
}

function identity(name: string, version: string): string {
  return `${name}\0${version}`;
}

function scoreFor(result: GameResult, colour: Colour): number {
  if (result === "draw") return 0.5;
  return result === colour ? 1 : 0;
}

function standingsFor(
  config: SeasonConfig,
  games: readonly GameSummary[],
): SeasonStandings {
  const ratings = new Map(
    ratingsFromGames(games).map((rating) => [
      identity(rating.competitor, rating.version),
      rating,
    ]),
  );
  const scores = new Map<string, number>();
  for (const game of games) {
    const whiteKey = identity(game.white.name, game.white.version);
    const blackKey = identity(game.black.name, game.black.version);
    const whiteScore = scoreFor(game.result, "white");
    scores.set(whiteKey, (scores.get(whiteKey) ?? 0) + whiteScore);
    scores.set(blackKey, (scores.get(blackKey) ?? 0) + 1 - whiteScore);
  }

  const seen = new Set<string>();
  const rows: SeasonStandings["rows"][number][] = [];
  for (const competitor of config.competitors) {
    const key = identity(competitor.name, competitor.version);
    if (seen.has(key)) continue;
    seen.add(key);
    const rating = ratings.get(key);
    rows.push({
      competitor: competitor.name,
      version: competitor.version,
      games: rating?.games ?? 0,
      score: scores.get(key) ?? 0,
      elo: rating?.rating ?? DEFAULT_ELO,
    });
  }
  return { seasonId: config.seasonId, rows };
}

function recountStrategies(
  games: readonly FinishedGame[],
): readonly StrategyOutcome[] {
  const outcomes = new Map<string, StrategyOutcome>();
  for (const game of games) {
    for (const decision of game.decisions) {
      const key = `${identity(decision.competitor, decision.version)}\0${decision.strategy}`;
      const outcome = outcomes.get(key) ?? {
        competitor: decision.competitor,
        version: decision.version,
        strategy: decision.strategy,
        picks: 0,
        score: 0,
        confidenceTotal: 0,
      };
      outcome.picks += 1;
      outcome.score += scoreFor(game.summary.result, decision.colour);
      outcome.confidenceTotal += decision.confidence ?? 0;
      outcomes.set(key, outcome);
    }
  }
  return [...outcomes.values()];
}

interface CompetitorVersionRowShape {
  readonly season_id: string;
  readonly competitor: string;
  readonly version: string;
  readonly manifest_json: string;
  readonly parent_version: string | null;
  readonly traits_json: string | null;
  readonly rationale: string | null;
}

function parseCompetitorVersionRow(
  row: CompetitorVersionRowShape,
): CompetitorVersionRow {
  const manifest = JSON.parse(row.manifest_json) as CompetitorManifest;
  const traits =
    row.traits_json === null
      ? []
      : (JSON.parse(row.traits_json) as readonly Trait[]);
  return {
    competitor: row.competitor,
    version: row.version,
    seasonId: row.season_id,
    manifest,
    ...(row.parent_version === null ? {} : { parentVersion: row.parent_version }),
    traits,
    ...(row.rationale === null ? {} : { rationale: row.rationale }),
  };
}

export class SeasonDurableObject extends DurableObject<Env> {
  /**
   * Starts a season's games. Idempotent per gameId.
   *
   * Contract:
   * - No `pairings`: behaves exactly as before. A season not yet started
   *   gets the round-robin `buildPairings` derives from `config`; a season
   *   already started with the same config is a no-op, with a different
   *   config a ContractViolation.
   * - `pairings` given and the season is new: those pairings start the
   *   season in place of the round-robin ones. This is how a knockout's
   *   round 0 goes live.
   * - `pairings` given and the season already exists (same config only):
   *   any pairing whose gameId is not already stored is merged in and its
   *   game stub started; already-known gameIds are left untouched. This is
   *   how a knockout's later rounds join an in-progress season.
   */
  async start(
    config: SeasonConfig,
    pairings?: readonly Pairing[],
    msPerPly?: number,
  ): Promise<void> {
    const existing = this.ctx.storage.kv.get<SeasonConfig>(CONFIG_KEY);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(config)) {
        violation("start", "season has already been started with another config");
      }
      if (pairings === undefined) return;

      const stored =
        this.ctx.storage.kv.get<readonly Pairing[]>(PAIRINGS_KEY) ?? [];
      const knownGameIds = new Set(stored.map((pairing) => pairing.gameId));
      const additions = pairings.filter((pairing) => !knownGameIds.has(pairing.gameId));
      if (additions.length === 0) return;

      // A later round keeps the pace the season was started at, so one
      // campaign broadcasts at one speed however many rounds it runs.
      const pace = this.ctx.storage.kv.get<number>(PACE_KEY) ?? msPerPly ?? ALARM_DELAY_MS;
      const merged = [...stored, ...additions];
      // Round 0's schedules were written at start; these are the only record
      // that a later round ever aired, so without them those games file with
      // a null broadcast and the site reads them as unscheduled.
      const startedAt = Date.now();
      const schedules = {
        ...(this.ctx.storage.kv.get<Record<string, BroadcastSchedule>>(SCHEDULES_KEY) ?? {}),
      };
      for (const pairing of additions) {
        schedules[pairing.gameId] = { startAt: startedAt, msPerPly: pace };
      }
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.kv.put(PAIRINGS_KEY, merged);
        this.ctx.storage.kv.put(SCHEDULES_KEY, schedules);
      });
      await Promise.all(
        additions.map((pairing) => this.gameStub(pairing.gameId).start(pairing, config, pace)),
      );
      return;
    }

    // The config claim stays synchronous with the check above it: two starts
    // racing must not both believe they were first.
    const resolvedPairings = pairings ?? buildPairings(config, createRng(config.seed));
    const pace = msPerPly ?? ALARM_DELAY_MS;
    // A live game's broadcast is simply when it started and how fast the alarm
    // advances it. Storing that here is what lets a finished live season be
    // filed with a real schedule rather than a null one.
    const startedAt = Date.now();
    const schedules: Record<string, BroadcastSchedule> = {};
    for (const pairing of resolvedPairings) {
      schedules[pairing.gameId] = { startAt: startedAt, msPerPly: pace };
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.kv.put(CONFIG_KEY, config);
      this.ctx.storage.kv.put(PAIRINGS_KEY, resolvedPairings);
      this.ctx.storage.kv.put(SCHEDULES_KEY, schedules);
      this.ctx.storage.kv.put(PACE_KEY, pace);
    });
    // Identity before play, like `record`: a live season files its competitors
    // up front, so the site has a roster from the first move rather than after
    // the last one, and a rejected roster never reaches a board.
    await this.registerCompetitors({
      config,
      broadcast: { startAt: Date.now(), msPerPly: 1 },
      concurrency: 1,
    });

    await Promise.all(
      resolvedPairings.map((pairing) =>
        this.gameStub(pairing.gameId).start(pairing, config, pace),
      ),
    );
  }

  async alarm(): Promise<void> {
    await this.complete();
  }

  async complete(): Promise<SeasonStandings> {
    const { config, games } = await this.refreshFinishedGames("complete");
    const standings = standingsFor(
      config,
      games.map((game) => game.summary),
    );
    await this.project(config, games);
    return standings;
  }

  async standings(): Promise<SeasonStandings> {
    const { config, games } = await this.refreshFinishedGames("standings");
    return standingsFor(
      config,
      games.map((game) => game.summary),
    );
  }

  /**
   * Every game this season has started, finished or not.
   *
   * Contract:
   * - Not gated: a live game has no future to spoil, because its next move
   *   has not been decided yet. Unlike `RecordedGame`, callers see it whole.
   * - `lastMove`/`lastDecision` come from the last entry of each game's
   *   decision list (oldest first), absent for a game with no plies yet.
   */
  async liveGames(): Promise<readonly LiveGameSnapshot[]> {
    const { config, pairings } = this.storedSeason("liveGames");
    return Promise.all(
      pairings.map(async (pairing): Promise<LiveGameSnapshot> => {
        const snapshot = await this.gameStub(pairing.gameId).snapshot();
        const lastDecision = snapshot.decisions[snapshot.decisions.length - 1];
        return {
          gameId: pairing.gameId,
          seasonId: config.seasonId,
          white: pairing.white,
          black: pairing.black,
          fen: snapshot.fen,
          ply: snapshot.ply,
          ...(lastDecision === undefined
            ? {}
            : { lastMove: lastDecision.move, lastDecision }),
          ...(snapshot.finished === undefined ? {} : { finished: snapshot.finished }),
        };
      }),
    );
  }

  /**
   * Records a whole season up front, then hands it to the broadcast clock.
   *
   * Contract:
   * - Runs at most `request.concurrency` games at a time, starting the next
   *   when one finishes. The six-simultaneous-connection ceiling is per
   *   invocation, so the fan-out has to be one Game Durable Object per game
   *   rather than one Worker looping.
   * - Each game's broadcast start is staggered from the request's schedule, so
   *   a season plays out rather than all at once.
   * - Idempotent: a re-run skips games already recorded and returns the same
   *   summaries, because the coordinator alarm retries.
   * - Projects games, decisions and competitor versions into D1 as each game
   *   lands, so a later failure cannot lose a finished game.
   */
  async record(request: RecordRequest): Promise<readonly GameSummary[]> {
    const { config, broadcast, concurrency } = request;
    // Identity first. `start` schedules a one-ply alarm per game, so a roster
    // rejected after it would leave the season quietly playing itself out.
    await this.registerCompetitors(request);
    await this.start(config);
    const { pairings } = this.storedSeason("record");

    const staggerMs = config.maxPlies * broadcast.msPerPly;
    const results = new Map<string, GameSummary>();
    let failure: unknown;
    let cursor = 0;

    const runNext = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const pairing = pairings[index];
        if (pairing === undefined) return;
        const schedule: BroadcastSchedule = {
          startAt: broadcast.startAt + index * staggerMs,
          msPerPly: broadcast.msPerPly,
        };
        try {
          const snapshot = await this.gameStub(pairing.gameId).record(
            pairing,
            config,
            schedule,
          );
          const game = this.finishedGame(config, pairing, snapshot, "record");
          if (game !== undefined) {
            results.set(pairing.gameId, game.summary);
            await this.projectGame(game, schedule);
          }
        } catch (error) {
          failure = error;
        }
      }
    };

    const workerCount = Math.min(concurrency, pairings.length);
    await Promise.all(Array.from({ length: workerCount }, () => runNext()));

    if (failure !== undefined) throw failure;

    return pairings.map((pairing) => {
      const summary = results.get(pairing.gameId);
      if (summary === undefined) {
        violation("record", `missing recorded game: ${pairing.gameId}`);
      }
      return summary;
    });
  }

  private gameStub(gameId: string): GameStub {
    return this.env.GAME.getByName(gameId) as GameStub;
  }

  private storedSeason(method: string): {
    readonly config: SeasonConfig;
    readonly pairings: readonly Pairing[];
  } {
    const config = this.ctx.storage.kv.get<SeasonConfig>(CONFIG_KEY);
    const pairings =
      this.ctx.storage.kv.get<readonly Pairing[]>(PAIRINGS_KEY);
    if (config === undefined || pairings === undefined) {
      violation(method, "season has not been started");
    }
    return { config, pairings };
  }

  private async refreshFinishedGames(method: string): Promise<{
    readonly config: SeasonConfig;
    readonly games: readonly FinishedGame[];
  }> {
    const { config, pairings } = this.storedSeason(method);
    const snapshots = await Promise.all(
      pairings.map(async (pairing) => {
        const stored = this.ctx.storage.kv.get<FinishedGame>(
          `${FINISHED_PREFIX}${pairing.gameId}`,
        );
        if (stored !== undefined) return stored;
        const snapshot = await this.gameStub(pairing.gameId).snapshot();
        return this.finishedGame(config, pairing, snapshot, method);
      }),
    );

    this.ctx.storage.transactionSync(() => {
      for (const game of snapshots) {
        if (game !== undefined) {
          this.ctx.storage.kv.put(
            `${FINISHED_PREFIX}${game.summary.gameId}`,
            game,
          );
        }
      }
    });

    return {
      config,
      games: snapshots.filter(
        (game): game is FinishedGame => game !== undefined,
      ),
    };
  }

  private finishedGame(
    config: SeasonConfig,
    pairing: Pairing,
    snapshot: GameSnapshot,
    method: string,
  ): FinishedGame | undefined {
    if (snapshot.finished === undefined) return undefined;
    const opening = config.openings.find(
      (candidate) => candidate.id === pairing.openingId,
    );
    if (opening === undefined) {
      violation(method, `missing opening: ${pairing.openingId}`);
    }
    const chess = new Chess(opening.fen);
    for (const decision of snapshot.decisions) {
      const promotion = decision.move[4];
      chess.move({
        from: decision.move.slice(0, 2),
        to: decision.move.slice(2, 4),
        ...(promotion === undefined ? {} : { promotion }),
      });
    }
    return {
      summary: {
        seasonId: config.seasonId,
        gameId: pairing.gameId,
        white: pairing.white,
        black: pairing.black,
        openingId: pairing.openingId,
        result: snapshot.finished.result,
        reason: snapshot.finished.reason,
        ...(snapshot.finished.adjudicatedCp === undefined
          ? {}
          : { adjudicatedCp: snapshot.finished.adjudicatedCp }),
        plies: snapshot.ply,
        pgn: chess.pgn(),
      },
      decisions: snapshot.decisions,
    };
  }

  private async project(
    config: SeasonConfig,
    games: readonly FinishedGame[],
  ): Promise<void> {
    const outcomes = recountStrategies(games);
    const statements: D1PreparedStatement[] = [];
    const insertCompetitor = this.env.DB.prepare(
      "INSERT INTO competitor_versions (season_id, competitor, version, manifest_json) VALUES (?, ?, ?, ?) ON CONFLICT (season_id, competitor, version) DO NOTHING",
    );
    for (const competitor of config.competitors) {
      statements.push(
        insertCompetitor.bind(
          config.seasonId,
          competitor.name,
          competitor.version,
          JSON.stringify(competitor),
        ),
      );
    }

    // The schedule goes in with the game: a filed game with no broadcast is
    // unreadable by the gated read surface, which is what serves the site.
    const schedules =
      this.ctx.storage.kv.get<Record<string, BroadcastSchedule>>(SCHEDULES_KEY) ?? {};
    const insertGame = this.env.DB.prepare(
      "INSERT INTO games (season_id, game_id, white_competitor, white_version, black_competitor, black_version, opening_id, result, reason, adjudicated_cp, plies, pgn, broadcast_start_at, ms_per_ply) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (season_id, game_id) DO NOTHING",
    );
    for (const { summary } of games) {
      const schedule = schedules[summary.gameId];
      statements.push(
        insertGame.bind(
          summary.seasonId,
          summary.gameId,
          summary.white.name,
          summary.white.version,
          summary.black.name,
          summary.black.version,
          summary.openingId,
          summary.result,
          summary.reason,
          summary.adjudicatedCp ?? null,
          summary.plies,
          summary.pgn,
          schedule?.startAt ?? null,
          schedule?.msPerPly ?? null,
        ),
      );
    }

    // The decision log is the product: a filed game without its decisions has
    // a result and no reasoning. The record path writes these per game as it
    // lands; a season that played live writes them here, when it completes.
    for (const { decisions } of games) {
      statements.push(...decisionStatements(this.env.DB, decisions));
    }

    statements.push(
      this.env.DB.prepare(
        "DELETE FROM strategy_outcomes WHERE season_id = ?",
      ).bind(config.seasonId),
    );
    const insertOutcome = this.env.DB.prepare(
      "INSERT INTO strategy_outcomes (season_id, competitor, version, strategy, picks, score, avg_confidence) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const outcome of outcomes) {
      statements.push(
        insertOutcome.bind(
          config.seasonId,
          outcome.competitor,
          outcome.version,
          outcome.strategy,
          outcome.picks,
          outcome.score,
          outcome.confidenceTotal / outcome.picks,
        ),
      );
    }
    await this.env.DB.batch(statements);
  }

  private async knownVersions(): Promise<readonly CompetitorVersionRow[]> {
    const result = await this.env.DB.prepare(
      "SELECT season_id, competitor, version, manifest_json, parent_version, traits_json, rationale FROM competitor_versions",
    ).all<CompetitorVersionRowShape>();
    return result.results.map(parseCompetitorVersionRow);
  }

  private async registerCompetitors(request: RecordRequest): Promise<void> {
    const { config } = request;
    const known = await this.knownVersions();
    const { rows, violations } = registerVersions({
      config,
      known,
      ...(request.parents === undefined ? {} : { parents: request.parents }),
      ...(request.rationales === undefined
        ? {}
        : { rationales: request.rationales }),
    });
    if (violations.length > 0) {
      violation("record", violations.map((v) => v.detail).join("; "));
    }

    const statements: D1PreparedStatement[] = [];
    const insertVersion = this.env.DB.prepare(
      "INSERT INTO competitor_versions (season_id, competitor, version, manifest_json, parent_version, traits_json, rationale) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (season_id, competitor, version) DO NOTHING",
    );
    for (const row of rows) {
      statements.push(
        insertVersion.bind(
          row.seasonId,
          row.competitor,
          row.version,
          JSON.stringify(row.manifest),
          row.parentVersion ?? null,
          JSON.stringify(row.traits),
          row.rationale ?? null,
        ),
      );
    }

    const insertCompetitor = this.env.DB.prepare(
      "INSERT INTO competitors (name, first_season_id) VALUES (?, ?) ON CONFLICT (name) DO NOTHING",
    );
    for (const competitor of config.competitors) {
      statements.push(insertCompetitor.bind(competitor.name, config.seasonId));
    }

    if (statements.length > 0) await this.env.DB.batch(statements);
  }

  private async projectGame(
    game: FinishedGame,
    schedule: BroadcastSchedule,
  ): Promise<void> {
    const { summary, decisions } = game;
    const insertGame = this.env.DB.prepare(
      "INSERT INTO games (season_id, game_id, white_competitor, white_version, black_competitor, black_version, opening_id, result, reason, adjudicated_cp, plies, pgn, broadcast_start_at, ms_per_ply) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (season_id, game_id) DO NOTHING",
    );
    const statements: D1PreparedStatement[] = [
      insertGame.bind(
        summary.seasonId,
        summary.gameId,
        summary.white.name,
        summary.white.version,
        summary.black.name,
        summary.black.version,
        summary.openingId,
        summary.result,
        summary.reason,
        summary.adjudicatedCp ?? null,
        summary.plies,
        summary.pgn,
        schedule.startAt,
        schedule.msPerPly,
      ),
      ...decisionStatements(this.env.DB, decisions),
    ];
    await this.env.DB.batch(statements);
  }
}
