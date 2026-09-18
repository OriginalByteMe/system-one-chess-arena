import { describe, expect, test } from "bun:test";

import type { HeadToHead, RivalrySummary, Trait } from "../../src/core/types.ts";
import { TRAIT_RULES } from "../../src/rivalry/traits.ts";
import { rivalryBanner, rivalryTimeline } from "../src/rivalry-model.ts";

const h2h = (overrides: Partial<HeadToHead>): HeadToHead => ({
  competitor: "hal",
  opponent: "jev",
  wins: 0,
  losses: 0,
  draws: 0,
  recent: [],
  gameIds: [],
  streak: 0,
  ...overrides,
});

const trait = (overrides: Partial<Trait>): Trait => ({
  rule: "nemesis",
  opponent: "jev",
  reason: "Lost three in a row to this opponent.",
  gameIds: [],
  ...overrides,
});

const summary = (overrides: Partial<RivalrySummary>): RivalrySummary => ({
  headToHead: h2h({}),
  traits: [],
  gameIds: [],
  ...overrides,
});

describe("rivalry timeline", () => {
  test("lists revealed games oldest first with the result from the subject's point of view", () => {
    const events = rivalryTimeline(
      summary({
        headToHead: h2h({
          wins: 1,
          losses: 2,
          recent: ["loss", "loss", "win"],
          gameIds: ["g1", "g2", "g3"],
          streak: 1,
        }),
        gameIds: ["g1", "g2", "g3"],
      }),
    );

    expect(events).toEqual([
      { gameId: "g1", result: "loss", triggered: [] },
      { gameId: "g2", result: "loss", triggered: [] },
      { gameId: "g3", result: "win", triggered: [] },
    ]);
  });

  test("attributes a trait to the game that completed its condition, not an earlier one", () => {
    const nemesis = trait({ rule: "nemesis", gameIds: ["g1", "g2", "g3"] });
    const events = rivalryTimeline(
      summary({
        headToHead: h2h({
          losses: 3,
          recent: ["loss", "loss", "loss"],
          gameIds: ["g1", "g2", "g3"],
          streak: 3,
        }),
        traits: [nemesis],
        gameIds: ["g1", "g2", "g3"],
      }),
    );

    expect(events.find((event) => event.gameId === "g1")?.triggered).toEqual([]);
    expect(events.find((event) => event.gameId === "g2")?.triggered).toEqual([]);
    expect(events.find((event) => event.gameId === "g3")?.triggered).toEqual(["nemesis"]);
  });

  test("a game not named by any trait has an empty triggered list", () => {
    const nemesis = trait({ rule: "nemesis", gameIds: ["g2"] });
    const avenger = trait({ rule: "avenger", gameIds: ["g4"] });
    const events = rivalryTimeline(
      summary({
        headToHead: h2h({
          wins: 1,
          losses: 3,
          recent: ["loss", "loss", "loss", "win"],
          gameIds: ["g1", "g2", "g3", "g4"],
          streak: 1,
        }),
        traits: [nemesis, avenger],
        gameIds: ["g1", "g2", "g3", "g4"],
      }),
    );

    expect(events.find((event) => event.gameId === "g1")?.triggered).toEqual([]);
    expect(events.find((event) => event.gameId === "g3")?.triggered).toEqual([]);
  });

  test("only includes games the summary revealed, even when head-to-head knows of more", () => {
    const events = rivalryTimeline(
      summary({
        headToHead: h2h({
          wins: 1,
          losses: 3,
          recent: ["loss", "loss", "loss", "win"],
          gameIds: ["g1", "g2", "g3", "g4"],
          streak: 1,
        }),
        gameIds: ["g1", "g2", "g3"],
      }),
    );

    expect(events.map((event) => event.gameId)).toEqual(["g1", "g2", "g3"]);
  });
});

describe("rivalry banner", () => {
  test("returns undefined when the pair has never met", () => {
    expect(rivalryBanner(summary({ headToHead: h2h({}), gameIds: [] }))).toBeUndefined();
  });

  test("requires at least three meetings, or an active trait, to be worth a banner", () => {
    const twoGames = h2h({
      wins: 2,
      recent: ["win", "win"],
      gameIds: ["g1", "g2"],
      streak: 2,
    });
    const threeGames = h2h({
      wins: 3,
      recent: ["win", "win", "win"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
    });
    const oneGame = h2h({ wins: 1, recent: ["win"], gameIds: ["g1"], streak: 1 });

    expect(
      rivalryBanner(summary({ headToHead: twoGames, gameIds: ["g1", "g2"] })),
    ).toBeUndefined();
    expect(
      rivalryBanner(summary({ headToHead: threeGames, gameIds: ["g1", "g2", "g3"] })),
    ).not.toBeUndefined();
    expect(
      rivalryBanner(
        summary({ headToHead: oneGame, traits: [trait({})], gameIds: ["g1"] }),
      ),
    ).not.toBeUndefined();
  });

  test("otherwise names a single-line record that changes with the head-to-head", () => {
    const bannerA = rivalryBanner(
      summary({
        headToHead: h2h({
          wins: 6,
          losses: 2,
          draws: 1,
          recent: ["win", "win", "win", "loss", "win", "draw", "win", "loss", "win"],
          gameIds: ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"],
          streak: 1,
        }),
        gameIds: ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"],
      }),
    );
    const bannerB = rivalryBanner(
      summary({
        headToHead: h2h({
          wins: 1,
          losses: 6,
          draws: 2,
          recent: ["loss", "loss", "loss", "win", "loss", "draw", "loss", "loss", "draw"],
          gameIds: ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"],
          streak: 1,
        }),
        gameIds: ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9"],
      }),
    );

    expect(typeof bannerA).toBe("string");
    expect(bannerA?.includes("\n")).toBe(false);
    expect(bannerA).not.toBe(bannerB);
  });

  test("names the active trait by its resolved label, not its raw id", () => {
    const base = h2h({
      losses: 3,
      recent: ["loss", "loss", "loss"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
    });
    const nemesisLabel = TRAIT_RULES.find((rule) => rule.id === "nemesis")?.label;
    if (nemesisLabel === undefined) throw new Error("expected a nemesis rule in TRAIT_RULES");

    const banner = rivalryBanner(
      summary({
        headToHead: base,
        traits: [trait({ rule: "nemesis" })],
        gameIds: ["g1", "g2", "g3"],
      }),
    );

    expect(banner).toContain(nemesisLabel);
  });

  test("drops an unresolvable trait id rather than printing it raw", () => {
    const base = h2h({
      wins: 3,
      recent: ["win", "win", "win"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
    });

    const banner = rivalryBanner(
      summary({
        headToHead: base,
        traits: [trait({ rule: "made-up-trait-id" })],
        gameIds: ["g1", "g2", "g3"],
      }),
    );

    expect(banner).not.toContain("made-up-trait-id");
  });
});
