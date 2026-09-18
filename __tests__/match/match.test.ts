import { describe, expect, test } from "bun:test";

import { ContractViolation } from "../../src/core/errors.ts";
import type {
  CompetitorRef,
  GameSummary,
  Match,
} from "../../src/core/types.ts";
import { matchOutcome, matchPairings } from "../../src/match/match.ts";
import { OPENINGS } from "../../src/season/openings.ts";

function buildMatch(overrides: Partial<Match> = {}): Match {
  return {
    matchId: "bracket-x:r0m0",
    bracketId: "bracket-x",
    round: 0,
    slot: 0,
    a: { kind: "competitor", competitor: "alpha" },
    b: { kind: "competitor", competitor: "beta" },
    bestOf: 2,
    gameIds: ["bracket-x:r0m0:g1", "bracket-x:r0m0:g2"],
    ...overrides,
  };
}

function ref(name: string, version: string): CompetitorRef {
  return { name, version };
}

function buildGame(
  overrides: Partial<GameSummary> &
    Pick<GameSummary, "gameId" | "white" | "black" | "result">,
): GameSummary {
  return {
    seasonId: "season-1",
    openingId: "italian-game",
    reason: "checkmate",
    plies: 24,
    pgn: "1. e4 e5 2. Nf3 Nc6",
    ...overrides,
  };
}

describe("matchPairings", () => {
  const versions = new Map([
    ["alpha", "v1"],
    ["beta", "v2"],
  ]);

  test("produces bestOf pairings with alternating colours, cycling openings and matchId-derived ids", () => {
    const match = buildMatch({
      matchId: "bracket-x:r0m0",
      bestOf: 4,
      gameIds: [
        "bracket-x:r0m0:g1",
        "bracket-x:r0m0:g2",
        "bracket-x:r0m0:g3",
        "bracket-x:r0m0:g4",
      ],
    });
    const openings = OPENINGS.slice(0, 2);

    const pairings = matchPairings({
      match,
      a: "alpha",
      b: "beta",
      versions,
      openings,
    });

    expect(pairings).toEqual([
      {
        gameId: "bracket-x:r0m0:g1",
        white: ref("alpha", "v1"),
        black: ref("beta", "v2"),
        openingId: openings[0]!.id,
      },
      {
        gameId: "bracket-x:r0m0:g2",
        white: ref("beta", "v2"),
        black: ref("alpha", "v1"),
        openingId: openings[1]!.id,
      },
      {
        gameId: "bracket-x:r0m0:g3",
        white: ref("alpha", "v1"),
        black: ref("beta", "v2"),
        openingId: openings[0]!.id,
      },
      {
        gameId: "bracket-x:r0m0:g4",
        white: ref("beta", "v2"),
        black: ref("alpha", "v1"),
        openingId: openings[1]!.id,
      },
    ]);
  });

  test("produces stable, deep-equal ids and pairings across repeated calls", () => {
    const args = {
      match: buildMatch(),
      a: "alpha",
      b: "beta",
      versions,
      openings: OPENINGS,
    };

    expect(matchPairings(args)).toEqual(matchPairings(args));
  });

  test("rejects a side missing from the versions map", () => {
    const incomplete = new Map([["alpha", "v1"]]);

    expect(() =>
      matchPairings({
        match: buildMatch(),
        a: "alpha",
        b: "beta",
        versions: incomplete,
        openings: OPENINGS,
      }),
    ).toThrow(ContractViolation);
  });
});

describe("matchOutcome", () => {
  test("hides the winner while any of the match's games is unrevealed", () => {
    const match = buildMatch({
      matchId: "bracket-x:r1m0",
      gameIds: ["bracket-x:r1m0:g1", "bracket-x:r1m0:g2"],
    });
    const onlyFirstGame = [
      buildGame({
        gameId: "bracket-x:r1m0:g1",
        white: ref("alpha", "v1"),
        black: ref("beta", "v2"),
        result: "white",
      }),
    ];

    expect(matchOutcome(match, onlyFirstGame)).toBeUndefined();
  });

  test("scores 1 for a win and 0.5 for a draw, reading the colour actually played each game", () => {
    const match = buildMatch({
      matchId: "bracket-x:r1m1",
      gameIds: ["bracket-x:r1m1:g1", "bracket-x:r1m1:g2"],
    });
    const games = [
      buildGame({
        gameId: "bracket-x:r1m1:g1",
        white: ref("alpha", "v1"),
        black: ref("beta", "v2"),
        result: "white",
      }),
      buildGame({
        gameId: "bracket-x:r1m1:g2",
        white: ref("beta", "v2"),
        black: ref("alpha", "v1"),
        result: "draw",
      }),
    ];

    expect(matchOutcome(match, games)).toEqual({
      matchId: "bracket-x:r1m1",
      winner: "alpha",
      loser: "beta",
      scoreA: 1.5,
      scoreB: 0.5,
      decidedBy: "score",
    });
  });

  test("ignores a game in the list that does not belong to the match", () => {
    const match = buildMatch({
      matchId: "bracket-x:r1m1",
      gameIds: ["bracket-x:r1m1:g1", "bracket-x:r1m1:g2"],
    });
    const games = [
      buildGame({
        gameId: "bracket-x:r1m1:g1",
        white: ref("alpha", "v1"),
        black: ref("beta", "v2"),
        result: "white",
      }),
      buildGame({
        gameId: "bracket-x:r1m1:g2",
        white: ref("beta", "v2"),
        black: ref("alpha", "v1"),
        result: "draw",
      }),
      buildGame({
        gameId: "unrelated-match:g1",
        white: ref("charlie", "v9"),
        black: ref("delta", "v9"),
        result: "black",
      }),
    ];

    expect(matchOutcome(match, games)).toEqual({
      matchId: "bracket-x:r1m1",
      winner: "alpha",
      loser: "beta",
      scoreA: 1.5,
      scoreB: 0.5,
      decidedBy: "score",
    });
  });

  test("an all-draw match is decided by seed, favouring slot a", () => {
    const match = buildMatch({
      matchId: "bracket-x:r1m2",
      gameIds: ["bracket-x:r1m2:g1", "bracket-x:r1m2:g2"],
    });
    const games = [
      buildGame({
        gameId: "bracket-x:r1m2:g1",
        white: ref("alpha", "v1"),
        black: ref("beta", "v2"),
        result: "draw",
      }),
      buildGame({
        gameId: "bracket-x:r1m2:g2",
        white: ref("beta", "v2"),
        black: ref("alpha", "v1"),
        result: "draw",
      }),
    ];

    expect(matchOutcome(match, games)).toEqual({
      matchId: "bracket-x:r1m2",
      winner: "alpha",
      loser: "beta",
      scoreA: 1,
      scoreB: 1,
      decidedBy: "seed",
    });
  });

  test("a split 1-1 match is decided by seed, favouring slot a", () => {
    const match = buildMatch({
      matchId: "bracket-x:r1m3",
      gameIds: ["bracket-x:r1m3:g1", "bracket-x:r1m3:g2"],
    });
    const games = [
      buildGame({
        gameId: "bracket-x:r1m3:g1",
        white: ref("alpha", "v1"),
        black: ref("beta", "v2"),
        result: "white",
      }),
      buildGame({
        gameId: "bracket-x:r1m3:g2",
        white: ref("beta", "v2"),
        black: ref("alpha", "v1"),
        result: "white",
      }),
    ];

    expect(matchOutcome(match, games)).toEqual({
      matchId: "bracket-x:r1m3",
      winner: "alpha",
      loser: "beta",
      scoreA: 1,
      scoreB: 1,
      decidedBy: "seed",
    });
  });
});
