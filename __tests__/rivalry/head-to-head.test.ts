import { describe, expect, test } from "bun:test";
import {
  headToHeadFor,
  headToHeadFrom,
  pairKey,
  RECENT_LIMIT,
} from "../../src/rivalry/head-to-head.ts";
import type {
  CompetitorRef,
  GameResult,
  GameSummary,
  HeadToHead,
  HeadToHeadResult,
} from "../../src/core/types.ts";

function ref(name: string): CompetitorRef {
  return { name, version: "v1" };
}

function game(
  gameId: string,
  white: string,
  black: string,
  result: GameResult,
): GameSummary {
  return {
    seasonId: "s1",
    gameId,
    white: ref(white),
    black: ref(black),
    openingId: "start",
    result,
    reason: "checkmate",
    plies: 40,
    pgn: "1. e4 e5",
  };
}

function direction(
  pairs: readonly HeadToHead[],
  competitor: string,
  opponent: string,
): HeadToHead {
  const found = pairs.find(
    (h) => h.competitor === competitor && h.opponent === opponent,
  );
  if (!found) throw new Error(`missing ${competitor} vs ${opponent} in result`);
  return found;
}

function aliceResult(result: GameResult): HeadToHeadResult {
  if (result === "draw") return "draw";
  return result === "white" ? "win" : "loss";
}

describe("pairKey", () => {
  test("is order independent", () => {
    expect(pairKey("alice", "bob")).toBe(pairKey("bob", "alice"));
  });

  test("distinguishes pairs that share a prefix", () => {
    expect(pairKey("ab", "c")).not.toBe(pairKey("a", "bc"));
  });
});

describe("headToHeadFrom", () => {
  test("returns both directions, with one side's losses equal to the other's wins", () => {
    const games = [
      game("g1", "alice", "bob", "white"),
      game("g2", "alice", "bob", "white"),
      game("g3", "bob", "alice", "black"),
      game("g4", "alice", "bob", "black"),
    ];

    const pairs = headToHeadFrom(games);
    const aliceVsBob = direction(pairs, "alice", "bob");
    const bobVsAlice = direction(pairs, "bob", "alice");

    expect(aliceVsBob.wins).toBe(3);
    expect(aliceVsBob.losses).toBe(1);
    expect(bobVsAlice.wins).toBe(1);
    expect(bobVsAlice.losses).toBe(3);
    expect(aliceVsBob.losses).toBe(bobVsAlice.wins);
    expect(aliceVsBob.wins).toBe(bobVsAlice.losses);
  });

  test("reads results from the colour each competitor played, so a black win counts for the black side", () => {
    const games = [game("g1", "bob", "alice", "black")];

    const pairs = headToHeadFrom(games);
    const aliceVsBob = direction(pairs, "alice", "bob");
    const bobVsAlice = direction(pairs, "bob", "alice");

    expect(aliceVsBob.wins).toBe(1);
    expect(aliceVsBob.losses).toBe(0);
    expect(bobVsAlice.wins).toBe(0);
    expect(bobVsAlice.losses).toBe(1);
  });

  test("ignores games between other competitors", () => {
    const games = [
      game("g1", "alice", "bob", "white"),
      game("g2", "alice", "carol", "black"),
      game("g3", "bob", "carol", "draw"),
    ];

    const aliceVsBob = direction(headToHeadFrom(games), "alice", "bob");

    expect(aliceVsBob.wins).toBe(1);
    expect(aliceVsBob.losses).toBe(0);
    expect(aliceVsBob.draws).toBe(0);
    expect(aliceVsBob.recent).toEqual(["win"]);
    expect(aliceVsBob.gameIds).toEqual(["g1"]);
  });

  test("recent holds the last RECENT_LIMIT results, oldest first, with gameIds aligned position for position", () => {
    const resultSequence: readonly GameResult[] = [
      "white",
      "black",
      "draw",
      "white",
      "black",
      "draw",
      "white",
      "black",
      "draw",
      "white",
    ];
    const games = resultSequence.map((result, index) =>
      game(`g${index}`, "alice", "bob", result),
    );

    const aliceVsBob = direction(headToHeadFrom(games), "alice", "bob");
    const expectedRecent = games.slice(-RECENT_LIMIT).map((g) => aliceResult(g.result));
    const expectedGameIds = games.slice(-RECENT_LIMIT).map((g) => g.gameId);

    expect(aliceVsBob.wins).toBe(4);
    expect(aliceVsBob.losses).toBe(3);
    expect(aliceVsBob.draws).toBe(3);
    expect(aliceVsBob.recent).toHaveLength(RECENT_LIMIT);
    expect(aliceVsBob.gameIds).toHaveLength(RECENT_LIMIT);
    expect(aliceVsBob.recent).toEqual(expectedRecent);
    expect(aliceVsBob.gameIds).toEqual(expectedGameIds);
  });

  describe("streak", () => {
    test("is 1 after a single game", () => {
      const games = [game("g1", "alice", "bob", "white")];
      expect(direction(headToHeadFrom(games), "alice", "bob").streak).toBe(1);
    });

    test("counts the run of identical results at the end of history", () => {
      const games = [
        game("g1", "alice", "bob", "black"),
        game("g2", "alice", "bob", "white"),
        game("g3", "alice", "bob", "white"),
        game("g4", "alice", "bob", "white"),
      ];
      expect(direction(headToHeadFrom(games), "alice", "bob").streak).toBe(3);
    });

    test("resets to 1 the instant the result changes", () => {
      const games = [
        game("g1", "alice", "bob", "white"),
        game("g2", "alice", "bob", "white"),
        game("g3", "alice", "bob", "black"),
      ];
      expect(direction(headToHeadFrom(games), "alice", "bob").streak).toBe(1);
    });
  });

  test("reads history in the given, revealed order: the same games in a different order give a different recent and streak", () => {
    const g1 = game("g1", "alice", "bob", "white");
    const g2 = game("g2", "alice", "bob", "white");
    const g3 = game("g3", "alice", "bob", "black");

    const forward = direction(headToHeadFrom([g1, g2, g3]), "alice", "bob");
    const reversed = direction(headToHeadFrom([g3, g2, g1]), "alice", "bob");

    expect(forward.recent).toEqual(["win", "win", "loss"]);
    expect(forward.streak).toBe(1);
    expect(reversed.recent).toEqual(["loss", "win", "win"]);
    expect(reversed.streak).toBe(2);
    expect(forward.recent).not.toEqual(reversed.recent);
    expect(forward.streak).not.toBe(reversed.streak);
  });
});

describe("headToHeadFor", () => {
  test("gives an all-zero, empty-history value for a pair that never met", () => {
    const games = [game("g1", "alice", "carol", "white")];

    expect(headToHeadFor("alice", "bob", games)).toEqual({
      competitor: "alice",
      opponent: "bob",
      wins: 0,
      losses: 0,
      draws: 0,
      recent: [],
      gameIds: [],
      streak: 0,
    });
  });

  test("matches the corresponding direction from headToHeadFrom", () => {
    const games = [
      game("g1", "alice", "bob", "white"),
      game("g2", "alice", "bob", "black"),
    ];

    const fromAll = direction(headToHeadFrom(games), "alice", "bob");
    const forPair = headToHeadFor("alice", "bob", games);

    expect(forPair).toEqual(fromAll);
  });
});
