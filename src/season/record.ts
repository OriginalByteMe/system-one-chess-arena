import type {
  CompetitorRef,
  DecisionRecord,
  GameScore,
  GameSummary,
  PlayerRecord,
  StrategyLabel,
  StrategyStats,
} from "../core/types";

function sameCompetitor(
  competitor: CompetitorRef,
  candidate: CompetitorRef,
): boolean {
  return competitor.name === candidate.name && competitor.version === candidate.version;
}

function scoreFor(result: GameSummary["result"], colour: "white" | "black"): GameScore {
  if (result === "draw") return 0.5;
  return result === colour ? 1 : 0;
}

export function rebuildRecord(
  competitor: CompetitorRef,
  decisions: readonly DecisionRecord[],
  games: readonly GameSummary[],
): PlayerRecord {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let white = 0;
  let black = 0;
  const scores = new Map<string, GameScore>();

  for (const game of games) {
    const colour = sameCompetitor(competitor, game.white)
      ? "white"
      : sameCompetitor(competitor, game.black)
        ? "black"
        : undefined;
    if (colour === undefined) continue;

    const score = scoreFor(game.result, colour);
    scores.set(game.gameId, score);
    if (score === 1) wins += 1;
    else if (score === 0.5) draws += 1;
    else losses += 1;
    if (colour === "white") white += score;
    else black += score;
  }

  const aggregates = new Map<
    StrategyLabel,
    {
      picks: number;
      confidenceTotal: number;
      confidenceCount: number;
      gameScores: Map<string, GameScore>;
    }
  >();
  for (const decision of decisions) {
    if (
      decision.competitor !== competitor.name ||
      decision.version !== competitor.version
    ) {
      continue;
    }
    let aggregate = aggregates.get(decision.strategy);
    if (aggregate === undefined) {
      aggregate = {
        picks: 0,
        confidenceTotal: 0,
        confidenceCount: 0,
        gameScores: new Map(),
      };
      aggregates.set(decision.strategy, aggregate);
    }
    aggregate.picks += 1;
    if (decision.confidence !== undefined) {
      aggregate.confidenceTotal += decision.confidence;
      aggregate.confidenceCount += 1;
    }
    const score = scores.get(decision.gameId);
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
        aggregate.confidenceCount === 0
          ? 0
          : aggregate.confidenceTotal / aggregate.confidenceCount,
    };
  }

  return {
    competitor: competitor.name,
    version: competitor.version,
    games: wins + draws + losses,
    wins,
    draws,
    losses,
    byColour: { white, black },
    byStrategy,
  };
}

export function rebuildRecords(
  decisions: readonly DecisionRecord[],
  games: readonly GameSummary[],
): readonly PlayerRecord[] {
  const competitors = new Map<string, CompetitorRef>();
  for (const game of games) {
    competitors.set(`${game.white.name}\0${game.white.version}`, game.white);
    competitors.set(`${game.black.name}\0${game.black.version}`, game.black);
  }
  for (const decision of decisions) {
    const competitor = {
      name: decision.competitor,
      version: decision.version,
    };
    competitors.set(`${competitor.name}\0${competitor.version}`, competitor);
  }

  return [...competitors.values()]
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.version.localeCompare(right.version),
    )
    .map((competitor) => rebuildRecord(competitor, decisions, games));
}
