import { ContractViolation } from "../core/errors.ts";
import { buildPositionInput } from "../core/position-input.ts";
import {
  applyMove,
  positionFromOpening,
  terminalState,
  toPgn,
} from "../core/rules.ts";
import { applyFallback, validateDecision } from "../core/validation.ts";
import type {
  Clock,
  Competitor,
  DecisionRecord,
  GameSummary,
  MoveDecision,
  Rng,
  SeasonConfig,
  SeasonStandings,
} from "../core/types.ts";
import { DEFAULT_ELO, ratingsFromGames } from "./elo.ts";
import { idempotencyKey } from "./log.ts";
import { buildPairings } from "./pairings.ts";

export interface SeasonOutcome {
  readonly standings: SeasonStandings;
  readonly decisions: readonly DecisionRecord[];
  readonly games: readonly GameSummary[];
}

function identity(name: string, version: string): string {
  return `${name}\0${version}`;
}

function violation(detail: string): never {
  throw new ContractViolation("runner.runSeason", detail);
}

export async function runSeason(
  config: SeasonConfig,
  players: readonly Competitor[],
  rng: Rng,
  clock: Clock,
): Promise<SeasonOutcome> {
  const playersByIdentity = new Map(
    players.map((player) => [
      identity(player.manifest.name, player.manifest.version),
      player,
    ]),
  );
  const openingsById = new Map(
    config.openings.map((opening) => [opening.id, opening]),
  );
  const decisions: DecisionRecord[] = [];
  const games: GameSummary[] = [];

  for (const pairing of buildPairings(config, rng)) {
    const opening = openingsById.get(pairing.openingId);
    if (opening === undefined) {
      violation(`missing opening for pairing: ${pairing.openingId}`);
    }

    let position = positionFromOpening(opening);
    let finished = terminalState(position, config.maxPlies);
    while (finished === undefined) {
      const ref = position.turn === "white" ? pairing.white : pairing.black;
      const player = playersByIdentity.get(identity(ref.name, ref.version));
      if (player === undefined) {
        violation(`missing player: ${ref.name}@${ref.version}`);
      }

      const input = buildPositionInput({
        seasonId: config.seasonId,
        gameId: pairing.gameId,
        position,
        persona: player.manifest,
      });
      const startedAt = clock.now();
      let decision: MoveDecision;
      try {
        const raw = await player.decide(input);
        const validation = validateDecision(input, raw);
        decision = validation.ok
          ? validation.decision
          : applyFallback(input, validation.reason, rng, raw.latencyMs);
      } catch {
        decision = applyFallback(
          input,
          "provider-error",
          rng,
          clock.now() - startedAt,
        );
      }

      decisions.push({
        seasonId: config.seasonId,
        gameId: pairing.gameId,
        ply: input.ply,
        competitor: ref.name,
        version: ref.version,
        colour: input.colour,
        fen: input.fen,
        legalMoveCount: input.legalMoves.length,
        ...decision,
        featuresSeen: player.manifest.features,
        idempotencyKey: idempotencyKey(
          pairing.gameId,
          input.ply,
          ref.version,
        ),
      });
      position = applyMove(position, decision.move);
      finished = terminalState(position, config.maxPlies);
    }

    games.push({
      seasonId: config.seasonId,
      gameId: pairing.gameId,
      white: pairing.white,
      black: pairing.black,
      openingId: pairing.openingId,
      result: finished.result,
      reason: finished.reason,
      plies: position.ply,
      pgn: toPgn(position),
    });
  }

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
    const whiteScore =
      game.result === "draw" ? 0.5 : game.result === "white" ? 1 : 0;
    scores.set(whiteKey, (scores.get(whiteKey) ?? 0) + whiteScore);
    scores.set(blackKey, (scores.get(blackKey) ?? 0) + 1 - whiteScore);
  }

  const rows: SeasonStandings["rows"][number][] = [];
  const seen = new Set<string>();
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

  return {
    standings: { seasonId: config.seasonId, rows },
    decisions,
    games,
  };
}
