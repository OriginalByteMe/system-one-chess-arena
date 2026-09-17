import { DurableObject } from "cloudflare:workers";
import { Chess } from "chess.js";

import { ContractViolation } from "../core/errors.ts";
import type { Env } from "../core/env.ts";
import type {
  Colour,
  DecisionRecord,
  GameResult,
  GameSummary,
  Pairing,
  SeasonConfig,
  SeasonStandings,
  StrategyLabel,
} from "../core/types.ts";
import type { GameSnapshot } from "./game.ts";
import { createRng } from "../core/rng.ts";
import { DEFAULT_ELO, ratingsFromGames } from "../season/elo.ts";
import { buildPairings } from "../season/pairings.ts";

const CONFIG_KEY = "config";
const PAIRINGS_KEY = "pairings";
const FINISHED_PREFIX = "finished:";

interface GameStub extends DurableObjectStub {
  start(pairing: Pairing, config: SeasonConfig): Promise<void>;
  snapshot(): Promise<GameSnapshot>;
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

export class SeasonDurableObject extends DurableObject<Env> {
  async start(config: SeasonConfig): Promise<void> {
    const existing = this.ctx.storage.kv.get<SeasonConfig>(CONFIG_KEY);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(config)) {
        violation("start", "season has already been started with another config");
      }
      return;
    }

    const pairings = buildPairings(config, createRng(config.seed));
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.kv.put(CONFIG_KEY, config);
      this.ctx.storage.kv.put(PAIRINGS_KEY, pairings);
    });

    await Promise.all(
      pairings.map((pairing) =>
        this.gameStub(pairing.gameId).start(pairing, config),
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

    const insertGame = this.env.DB.prepare(
      "INSERT INTO games (season_id, game_id, white_competitor, white_version, black_competitor, black_version, opening_id, result, reason, plies, pgn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (season_id, game_id) DO NOTHING",
    );
    for (const { summary } of games) {
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
          summary.plies,
          summary.pgn,
        ),
      );
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
}
