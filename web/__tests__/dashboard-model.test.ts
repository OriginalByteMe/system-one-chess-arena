import { describe, expect, test } from "bun:test";

import type { CompetitorRef, DashboardEntry } from "../../src/core/types.ts";
import { dashboardCards } from "../src/dashboard-model.ts";

const WHITE: CompetitorRef = { name: "calculated-risk", version: "v3" };
const BLACK: CompetitorRef = { name: "steady-eddie", version: "v1" };

const BASE_ENTRY: DashboardEntry = {
  gameId: "game-1",
  seasonId: "season-1",
  white: WHITE,
  black: BLACK,
  fen: "8/8/8/8/8/8/8/8 w - - 0 1",
  ply: 12,
  status: "on-air",
  rivalry: [],
  interest: 0,
};

describe("dashboard model", () => {
  test("keeps the server's order without re-ranking by interest", () => {
    const entries: readonly DashboardEntry[] = [
      { ...BASE_ENTRY, gameId: "low-interest", interest: 1 },
      { ...BASE_ENTRY, gameId: "high-interest", interest: 99 },
      { ...BASE_ENTRY, gameId: "mid-interest", interest: 50 },
    ];

    const cards = dashboardCards(entries);

    expect(cards.map((card) => card.entry.gameId)).toEqual([
      "low-interest",
      "high-interest",
      "mid-interest",
    ]);
  });

  test("resolves rivalry trait ids to their catalogue labels", () => {
    const entry: DashboardEntry = {
      ...BASE_ENTRY,
      rivalry: ["avenger", "nemesis"],
    };

    const [card] = dashboardCards([entry]);

    expect(card?.rivalryLabels).toEqual(["Avenger", "Nemesis"]);
  });

  test("drops an unknown trait id instead of printing it raw", () => {
    const entry: DashboardEntry = {
      ...BASE_ENTRY,
      rivalry: ["nemesis", "made-up-trait"],
    };

    const [card] = dashboardCards([entry]);

    expect(card?.rivalryLabels).toEqual(["Nemesis"]);
    expect(card?.rivalryLabels).not.toContain("made-up-trait");
  });

  test("names the strategy and confidence in the subtitle once revealed", () => {
    const entry: DashboardEntry = {
      ...BASE_ENTRY,
      strategy: "king-hunt",
      confidence: 0.5,
    };

    const [card] = dashboardCards([entry]);

    expect(card?.subtitle).toContain("King hunt");
    expect(card?.subtitle).toContain("50%");
  });

  test("formats confidence as a consistent percentage across values", () => {
    const low: DashboardEntry = { ...BASE_ENTRY, strategy: "direct", confidence: 0.2 };
    const high: DashboardEntry = { ...BASE_ENTRY, strategy: "direct", confidence: 0.85 };

    const [lowCard, highCard] = dashboardCards([low, high]);

    expect(lowCard?.subtitle).toContain("20%");
    expect(highCard?.subtitle).toContain("85%");
  });

  test("reads as waiting and mentions neither strategy nor confidence before the game starts", () => {
    const entry: DashboardEntry = {
      ...BASE_ENTRY,
      status: "scheduled",
      strategy: undefined,
      confidence: undefined,
    };

    const [card] = dashboardCards([entry]);

    expect(card?.subtitle.toLowerCase()).toContain("waiting");
    expect(card?.subtitle).not.toContain("%");
    expect(card?.subtitle).not.toContain("undefined");
  });

  test("shows a revealed confidence of exactly zero rather than treating it as missing", () => {
    const entry: DashboardEntry = {
      ...BASE_ENTRY,
      strategy: "direct",
      confidence: 0,
    };

    const [card] = dashboardCards([entry]);

    expect(card?.subtitle).toContain("0%");
  });
});
