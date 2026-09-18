import { describe, expect, test } from "bun:test";
import { cacheControl, revealGame } from "../../src/broadcast/gate.ts";
import {
  bracketView,
  competitorView,
  dashboardView,
  gameView,
  handleRead,
  leaderboardView,
  movesView,
  rivalryView,
} from "../../src/api/read.ts";
import type { ReadContext } from "../../src/api/read.ts";
import {
  applyMove,
  legalMoves,
  positionFromFen,
  positionFromOpening,
  terminalState,
} from "../../src/core/rules.ts";
import { dashboardFrom } from "../../src/season/dashboard.ts";
import { countingStore, memoryStore } from "../helpers/memory-store.ts";
import { GREEDY_MANIFEST, RANDOM_MANIFEST, SCRIPTED_MANIFEST } from "../fixtures/manifests.ts";
import type {
  Bracket,
  BroadcastSchedule,
  CompetitorManifest,
  CompetitorRef,
  CompetitorVersionRow,
  DecisionRecord,
  EpochMs,
  GameSummary,
  Match,
  Opening,
  RecordedGame,
  StrategyLabel,
  Uci,
} from "../../src/core/types.ts";

// handleRead is tested against a fixed routing contract:
//   GET /api/seasons/:seasonId/games/:gameId
//   GET /api/seasons/:seasonId/games/:gameId/moves
//   GET /api/seasons/:seasonId/leaderboard
//   GET /api/seasons/:seasonId/dashboard
//   GET /api/brackets/:bracketId
//   GET /api/competitors/:competitor
//   GET /api/competitors/:competitor/rivals/:opponent

const OPENING: Opening = {
  id: "read-test-opening",
  name: "Initial position",
  moves: [],
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
};

/** Fool's mate: the fastest possible checkmate, always won by black. */
const FOOLS_MATE: readonly Uci[] = ["f2f3", "e7e5", "g2g4", "d8h4"];

interface SequenceStep {
  readonly ply: number;
  readonly fen: string;
  readonly colour: "white" | "black";
  readonly move: Uci;
  readonly legalMoveCount: number;
}

function buildSequence(moves: readonly Uci[]) {
  let position = positionFromOpening(OPENING);
  const steps: SequenceStep[] = [];
  for (const move of moves) {
    steps.push({
      ply: position.ply,
      fen: position.fen,
      colour: position.turn,
      move,
      legalMoveCount: legalMoves(position).length,
    });
    position = applyMove(position, move);
  }
  const outcome = terminalState(position, 200);
  if (outcome === undefined) throw new Error("fixture sequence must terminate");
  return { steps, outcome };
}

function decisionFrom(
  seasonId: string,
  gameId: string,
  step: SequenceStep,
  ref: CompetitorRef,
  strategy: StrategyLabel = "direct",
): DecisionRecord {
  return {
    seasonId,
    gameId,
    ply: step.ply,
    competitor: ref.name,
    version: ref.version,
    colour: step.colour,
    fen: step.fen,
    legalMoveCount: step.legalMoveCount,
    move: step.move,
    strategy,
    latencyMs: 10,
    featuresSeen: [],
    idempotencyKey: `${gameId}:${step.ply}:${ref.version}`,
  };
}

interface BuiltGame {
  readonly recorded: RecordedGame;
  readonly decisions: readonly DecisionRecord[];
  readonly winner: CompetitorRef;
}

/** A recorded Fool's Mate game: black always delivers the mate. */
function buildGame(
  seasonId: string,
  gameId: string,
  white: CompetitorManifest,
  black: CompetitorManifest,
  schedule: BroadcastSchedule,
): BuiltGame {
  const { steps, outcome } = buildSequence(FOOLS_MATE);
  const whiteRef: CompetitorRef = { name: white.name, version: white.version };
  const blackRef: CompetitorRef = { name: black.name, version: black.version };
  const decisions = steps.map((step) =>
    decisionFrom(seasonId, gameId, step, step.colour === "white" ? whiteRef : blackRef),
  );
  const summary: GameSummary = {
    seasonId,
    gameId,
    white: whiteRef,
    black: blackRef,
    openingId: OPENING.id,
    result: outcome.result,
    reason: outcome.reason,
    plies: steps.length,
    pgn: "1. f3 e5 2. g4 Qh4#",
  };
  return {
    recorded: { summary, schedule },
    decisions,
    winner: outcome.result === "white" ? whiteRef : blackRef,
  };
}

function versionRow(manifest: CompetitorManifest, seasonId: string): CompetitorVersionRow {
  return {
    competitor: manifest.name,
    version: manifest.version,
    seasonId,
    manifest,
    traits: [],
  };
}

const MS_PER_PLY = 1_000;
const NOW: EpochMs = 10_000;

describe("gameView", () => {
  const SEASON_ID = "gv-season";
  const GAME = buildGame(SEASON_ID, "gv-game", RANDOM_MANIFEST, GREEDY_MANIFEST, {
    startAt: 0,
    msPerPly: MS_PER_PLY,
  });
  const store = memoryStore({ games: [GAME.recorded], decisions: GAME.decisions });
  const context: ReadContext = { store, now: NOW };

  test("returns the revealed prefix of a known game", async () => {
    const actual = await gameView(context, SEASON_ID, "gv-game");
    const expected = revealGame(GAME.recorded, GAME.decisions, NOW);

    expect(actual).toEqual(expected);
  });

  test("returns undefined for an unknown game", async () => {
    const actual = await gameView(context, SEASON_ID, "no-such-game");

    expect(actual).toBeUndefined();
  });
});

describe("movesView", () => {
  const SEASON_ID = "mv-season";
  // A schedule that reveals exactly the first two of four plies at NOW.
  const GAME = buildGame(SEASON_ID, "mv-game", RANDOM_MANIFEST, GREEDY_MANIFEST, {
    startAt: NOW - 2 * MS_PER_PLY,
    msPerPly: MS_PER_PLY,
  });
  const store = memoryStore({ games: [GAME.recorded], decisions: GAME.decisions });
  const context: ReadContext = { store, now: NOW };

  test("returns the legal moves at the revealed position without leaking which move was played", async () => {
    const actual = await movesView(context, SEASON_ID, "mv-game");
    const expected = revealGame(GAME.recorded, GAME.decisions, NOW);

    expect(actual).toBeDefined();
    if (actual === undefined) return;
    expect(actual.fen).toBe(expected.fen);
    expect(actual.ply).toBe(expected.window.revealedPlies);
    expect([...actual.legalMoves].sort()).toEqual([...legalMoves(positionFromFen(actual.fen))].sort());
    expect(Object.keys(actual).sort()).toEqual(["fen", "gameId", "legalMoves", "ply"]);
  });

  test("returns undefined for an unknown game", async () => {
    const actual = await movesView(context, SEASON_ID, "no-such-game");

    expect(actual).toBeUndefined();
  });
});


describe("leaderboardView", () => {
  const SEASON_ID = "lb-season";
  // GAME_A: finished, fully revealed. Random (white) loses to Greedy (black).
  const GAME_A = buildGame(SEASON_ID, "lb-game-finished", RANDOM_MANIFEST, GREEDY_MANIFEST, {
    startAt: 0,
    msPerPly: MS_PER_PLY,
  });
  // GAME_B: same pair, colours reversed, still on air (1 of 4 plies revealed at NOW).
  const GAME_B = buildGame(SEASON_ID, "lb-game-on-air", GREEDY_MANIFEST, RANDOM_MANIFEST, {
    startAt: NOW - MS_PER_PLY,
    msPerPly: MS_PER_PLY,
  });
  const versions = [
    versionRow(RANDOM_MANIFEST, SEASON_ID),
    versionRow(GREEDY_MANIFEST, SEASON_ID),
  ];

  const finishedOnly = memoryStore({
    games: [GAME_A.recorded],
    decisions: GAME_A.decisions,
    versions,
  });
  const withOnAirRematch = memoryStore({
    games: [GAME_A.recorded, GAME_B.recorded],
    decisions: [...GAME_A.decisions, ...GAME_B.decisions],
    versions,
  });

  test("counts only games whose broadcast has finished", async () => {
    const leaderboard = await leaderboardView({ store: finishedOnly, now: NOW }, SEASON_ID);
    const random = leaderboard.rows.find((row) => row.competitor === RANDOM_MANIFEST.name);
    const greedy = leaderboard.rows.find((row) => row.competitor === GREEDY_MANIFEST.name);

    expect(random).toBeDefined();
    expect(greedy).toBeDefined();
    if (random === undefined || greedy === undefined) return;
    expect(random.games).toBe(1);
    expect(random.wins).toBe(0);
    expect(random.losses).toBe(1);
    expect(greedy.games).toBe(1);
    expect(greedy.wins).toBe(1);
    expect(greedy.losses).toBe(0);
  });

  test("an on-air game's result moves nothing on the leaderboard", async () => {
    const withoutRematch = await leaderboardView({ store: finishedOnly, now: NOW }, SEASON_ID);
    const withRematch = await leaderboardView({ store: withOnAirRematch, now: NOW }, SEASON_ID);

    expect(withRematch.rows).toEqual(withoutRematch.rows);
  });
});

describe("dashboardView", () => {
  const SEASON_ID = "db-season";
  // Three distinct pairs, so no pair has repeat history and traits stay empty.
  const GAME_A = buildGame(SEASON_ID, "db-game-a", RANDOM_MANIFEST, GREEDY_MANIFEST, {
    startAt: 0,
    msPerPly: MS_PER_PLY,
  });
  const GAME_B = buildGame(SEASON_ID, "db-game-b", SCRIPTED_MANIFEST, RANDOM_MANIFEST, {
    startAt: NOW - MS_PER_PLY,
    msPerPly: MS_PER_PLY,
  });
  const store = memoryStore({
    games: [GAME_A.recorded, GAME_B.recorded],
    decisions: [...GAME_A.decisions, ...GAME_B.decisions],
  });
  const context: ReadContext = { store, now: NOW };

  test("returns the revealed head of every game, ordered as the dashboard module orders them", async () => {
    const actual = await dashboardView(context, SEASON_ID);
    const revealedGames = [
      revealGame(GAME_A.recorded, GAME_A.decisions, NOW),
      revealGame(GAME_B.recorded, GAME_B.decisions, NOW),
    ];
    const expected = dashboardFrom(revealedGames, new Map());

    expect(actual).toEqual(expected);
  });
});

describe("bracketView", () => {
  const SEASON_ID = "br-season";
  const BRACKET_ID = "br-bracket";
  // M0's game is finished: its winner is revealed.
  const GAME_0 = buildGame(SEASON_ID, "br-game-0", RANDOM_MANIFEST, GREEDY_MANIFEST, {
    startAt: 0,
    msPerPly: MS_PER_PLY,
  });
  // M1's game is on air: its winner must stay hidden.
  const GAME_1 = buildGame(SEASON_ID, "br-game-1", SCRIPTED_MANIFEST, RANDOM_MANIFEST, {
    startAt: NOW - MS_PER_PLY,
    msPerPly: MS_PER_PLY,
  });

  const M0: Match = {
    matchId: "br-bracket:r0m0",
    bracketId: BRACKET_ID,
    round: 0,
    slot: 0,
    a: { kind: "competitor", competitor: RANDOM_MANIFEST.name },
    b: { kind: "competitor", competitor: GREEDY_MANIFEST.name },
    bestOf: 1,
    gameIds: ["br-game-0"],
    winner: GAME_0.winner.name,
  };
  const M1: Match = {
    matchId: "br-bracket:r0m1",
    bracketId: BRACKET_ID,
    round: 0,
    slot: 1,
    a: { kind: "competitor", competitor: SCRIPTED_MANIFEST.name },
    b: { kind: "competitor", competitor: RANDOM_MANIFEST.name },
    bestOf: 1,
    gameIds: ["br-game-1"],
    winner: GAME_1.winner.name,
  };
  // The final has already resolved its slots from the raw (precomputed) match
  // winners, but has not itself been played yet.
  const FINAL: Match = {
    matchId: "br-bracket:r1m0",
    bracketId: BRACKET_ID,
    round: 1,
    slot: 0,
    a: { kind: "competitor", competitor: M0.winner ?? "" },
    b: { kind: "competitor", competitor: M1.winner ?? "" },
    bestOf: 1,
    gameIds: [],
    winner: undefined,
  };
  const BRACKET: Bracket = { bracketId: BRACKET_ID, seasonId: SEASON_ID, rounds: [[M0, M1], [FINAL]] };

  const store = memoryStore({
    games: [GAME_0.recorded, GAME_1.recorded],
    decisions: [...GAME_0.decisions, ...GAME_1.decisions],
    matches: [M0, M1, FINAL],
    bracketSeasons: { [BRACKET_ID]: SEASON_ID },
  });
  const context: ReadContext = { store, now: NOW };

  test("hides the winner of a match whose game is not fully revealed, and the slot it feeds", async () => {
    const actual = await bracketView(context, BRACKET_ID);

    expect(actual).toBeDefined();
    if (actual === undefined) return;
    expect(actual.bracketId).toBe(BRACKET.bracketId);
    expect(actual.seasonId).toBe(BRACKET.seasonId);
    expect(actual.rounds[0]).toEqual([M0, { ...M1, winner: undefined }]);
    expect(actual.rounds[1]).toEqual([
      { ...FINAL, b: { kind: "winner-of", matchId: M1.matchId } },
    ]);
  });

  test("returns undefined for an unknown bracket", async () => {
    const actual = await bracketView(context, "no-such-bracket");

    expect(actual).toBeUndefined();
  });
});

describe("competitorView", () => {
  const SEASON_ID = "cv-season";
  const GAME_A = buildGame(SEASON_ID, "cv-game-finished", RANDOM_MANIFEST, GREEDY_MANIFEST, {
    startAt: 0,
    msPerPly: MS_PER_PLY,
  });
  const GAME_B = buildGame(SEASON_ID, "cv-game-on-air", RANDOM_MANIFEST, SCRIPTED_MANIFEST, {
    startAt: NOW - MS_PER_PLY,
    msPerPly: MS_PER_PLY,
  });
  const versions = [
    versionRow(RANDOM_MANIFEST, SEASON_ID),
    versionRow(GREEDY_MANIFEST, SEASON_ID),
    versionRow(SCRIPTED_MANIFEST, SEASON_ID),
  ];

  const finishedOnly = memoryStore({
    games: [GAME_A.recorded],
    decisions: GAME_A.decisions,
    versions,
  });
  const withOnAirGame = memoryStore({
    games: [GAME_A.recorded, GAME_B.recorded],
    decisions: [...GAME_A.decisions, ...GAME_B.decisions],
    versions,
  });

  test("builds a profile from revealed games only; an unrevealed game moves nothing", async () => {
    const without = await competitorView({ store: finishedOnly, now: NOW }, RANDOM_MANIFEST.name);
    const withExtra = await competitorView({ store: withOnAirGame, now: NOW }, RANDOM_MANIFEST.name);

    expect(without).toBeDefined();
    expect(withExtra).toEqual(without);
  });

  test("returns undefined for an unknown competitor", async () => {
    const actual = await competitorView({ store: finishedOnly, now: NOW }, "nobody");

    expect(actual).toBeUndefined();
  });
});

describe("rivalryView", () => {
  const SEASON_ID = "rv-season";
  const GAME_A = buildGame(SEASON_ID, "rv-game-finished", RANDOM_MANIFEST, GREEDY_MANIFEST, {
    startAt: 0,
    msPerPly: MS_PER_PLY,
  });
  // A second meeting of the same pair, still on air.
  const GAME_B = buildGame(SEASON_ID, "rv-game-on-air", GREEDY_MANIFEST, RANDOM_MANIFEST, {
    startAt: NOW - MS_PER_PLY,
    msPerPly: MS_PER_PLY,
  });

  const finishedOnly = memoryStore({ games: [GAME_A.recorded], decisions: GAME_A.decisions });
  const withOnAirRematch = memoryStore({
    games: [GAME_A.recorded, GAME_B.recorded],
    decisions: [...GAME_A.decisions, ...GAME_B.decisions],
  });

  test("returns the pair's revealed history; an on-air rematch moves nothing", async () => {
    const without = await rivalryView(
      { store: finishedOnly, now: NOW },
      RANDOM_MANIFEST.name,
      GREEDY_MANIFEST.name,
    );
    const withExtra = await rivalryView(
      { store: withOnAirRematch, now: NOW },
      RANDOM_MANIFEST.name,
      GREEDY_MANIFEST.name,
    );

    expect(without).toBeDefined();
    expect(without?.gameIds.length).toBeGreaterThan(0);
    expect(withExtra).toEqual(without);
  });

  test("works with the pair's names in either order", async () => {
    const context: ReadContext = { store: finishedOnly, now: NOW };
    const forward = await rivalryView(context, RANDOM_MANIFEST.name, GREEDY_MANIFEST.name);
    const backward = await rivalryView(context, GREEDY_MANIFEST.name, RANDOM_MANIFEST.name);

    expect(forward).toBeDefined();
    expect(backward).toBeDefined();
    if (forward === undefined || backward === undefined) return;
    expect(forward.gameIds).toEqual(backward.gameIds);
    expect(forward.headToHead.wins).toBe(backward.headToHead.losses);
    expect(forward.headToHead.losses).toBe(backward.headToHead.wins);
    expect(forward.headToHead.draws).toBe(backward.headToHead.draws);
  });

  test("gives an empty history for a pair that never met", async () => {
    const context: ReadContext = { store: finishedOnly, now: NOW };
    const actual = await rivalryView(context, RANDOM_MANIFEST.name, SCRIPTED_MANIFEST.name);

    expect(actual).toBeDefined();
    if (actual === undefined) return;
    expect(actual.gameIds).toEqual([]);
    expect(actual.traits).toEqual([]);
    expect(actual.headToHead.wins).toBe(0);
    expect(actual.headToHead.losses).toBe(0);
    expect(actual.headToHead.draws).toBe(0);
    expect(actual.headToHead.recent).toEqual([]);
  });
});

describe("handleRead", () => {
  const SEASON_ID = "hr-season";
  const GAME = buildGame(SEASON_ID, "hr-game", RANDOM_MANIFEST, GREEDY_MANIFEST, {
    startAt: 0,
    msPerPly: MS_PER_PLY,
  });
  const versions = [versionRow(RANDOM_MANIFEST, SEASON_ID), versionRow(GREEDY_MANIFEST, SEASON_ID)];
  const store = memoryStore({ games: [GAME.recorded], decisions: GAME.decisions, versions });
  const context: ReadContext = { store, now: NOW };

  function url(path: string): string {
    return `https://arena.test${path}`;
  }

  test("returns undefined for an unmatched path, so the worker can fall through", async () => {
    const response = await handleRead(new Request(url("/api/not-a-read-route")), context);

    expect(response).toBeUndefined();
  });

  test("sets a Cache-Control expiring at the next reveal boundary", async () => {
    const request = new Request(url(`/api/seasons/${SEASON_ID}/games/hr-game`));
    const response = await handleRead(request, context);

    expect(response).toBeDefined();
    if (response === undefined) return;
    const revealed = revealGame(GAME.recorded, GAME.decisions, NOW);
    expect(response.headers.get("Cache-Control")).toBe(cacheControl(revealed.window, NOW));
  });

  test.each([
    ["a season id", `/api/seasons/${encodeURIComponent("bad season")}/games/hr-game`],
    ["a game id", `/api/seasons/${SEASON_ID}/games/${encodeURIComponent("bad/game")}`],
    ["a competitor name", `/api/competitors/${encodeURIComponent("bad competitor")}`],
    ["a bracket id", `/api/brackets/${encodeURIComponent("bad bracket")}`],
  ])("gives 404 for %s that is malformed, without reaching the store", async (_label, path) => {
    const { store: spiedStore, calls } = countingStore(memoryStore({}));
    const response = await handleRead(new Request(url(path)), { store: spiedStore, now: NOW });

    expect(response).toBeDefined();
    if (response === undefined) return;
    expect(response.status).toBe(404);
    expect(calls()).toBe(0);
  });

  test("game view response body deep-equals gameView's return value", async () => {
    const request = new Request(url(`/api/seasons/${SEASON_ID}/games/hr-game`));
    const response = await handleRead(request, context);
    const direct = await gameView(context, SEASON_ID, "hr-game");

    expect(response).toBeDefined();
    if (response === undefined) return;
    expect(await response.json()).toEqual(direct);
  });

  test("moves view response body deep-equals movesView's return value", async () => {
    const request = new Request(url(`/api/seasons/${SEASON_ID}/games/hr-game/moves`));
    const response = await handleRead(request, context);
    const direct = await movesView(context, SEASON_ID, "hr-game");

    expect(response).toBeDefined();
    if (response === undefined) return;
    expect(await response.json()).toEqual(direct);
  });

  test("leaderboard view response body deep-equals leaderboardView's return value", async () => {
    const request = new Request(url(`/api/seasons/${SEASON_ID}/leaderboard`));
    const response = await handleRead(request, context);
    const direct = await leaderboardView(context, SEASON_ID);

    expect(response).toBeDefined();
    if (response === undefined) return;
    expect(await response.json()).toEqual(direct);
  });

  test("dashboard view response body deep-equals dashboardView's return value", async () => {
    const request = new Request(url(`/api/seasons/${SEASON_ID}/dashboard`));
    const response = await handleRead(request, context);
    const direct = await dashboardView(context, SEASON_ID);

    expect(response).toBeDefined();
    if (response === undefined) return;
    expect(await response.json()).toEqual(direct);
  });

  test("competitor view response body deep-equals competitorView's return value", async () => {
    const request = new Request(url(`/api/competitors/${RANDOM_MANIFEST.name}`));
    const response = await handleRead(request, context);
    const direct = await competitorView(context, RANDOM_MANIFEST.name);

    expect(response).toBeDefined();
    if (response === undefined) return;
    expect(await response.json()).toEqual(direct);
  });

  test("rivalry view response body deep-equals rivalryView's return value", async () => {
    const request = new Request(
      url(`/api/competitors/${RANDOM_MANIFEST.name}/rivals/${GREEDY_MANIFEST.name}`),
    );
    const response = await handleRead(request, context);
    const direct = await rivalryView(context, RANDOM_MANIFEST.name, GREEDY_MANIFEST.name);

    expect(response).toBeDefined();
    if (response === undefined) return;
    expect(await response.json()).toEqual(direct);
  });
});
