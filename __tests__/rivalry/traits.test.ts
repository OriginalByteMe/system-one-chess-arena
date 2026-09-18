import { describe, expect, test } from "bun:test";
import { buildManifest, manifestVersion } from "../../src/core/manifest.ts";
import type {
  CompetitorManifest,
  HeadToHead,
  HeadToHeadResult,
  TraitRule,
} from "../../src/core/types.ts";
import {
  activeTraits,
  MAX_ACTIVE_TRAITS,
  resolveManifest,
  TRAIT_RULES,
} from "../../src/rivalry/traits.ts";
import { SCRIPTED_MANIFEST } from "../fixtures/manifests.ts";

function h2h(fields: {
  competitor?: string;
  opponent?: string;
  wins?: number;
  losses?: number;
  draws?: number;
  recent: readonly HeadToHeadResult[];
  gameIds: readonly string[];
  streak: number;
}): HeadToHead {
  return {
    competitor: fields.competitor ?? "alice",
    opponent: fields.opponent ?? "bob",
    wins: fields.wins ?? 0,
    losses: fields.losses ?? 0,
    draws: fields.draws ?? 0,
    recent: fields.recent,
    gameIds: fields.gameIds,
    streak: fields.streak,
  };
}

const NEMESIS_RULE = TRAIT_RULES.find((rule) => rule.id === "nemesis");
const AVENGER_RULE = TRAIT_RULES.find((rule) => rule.id === "avenger");
if (!NEMESIS_RULE || !AVENGER_RULE) {
  throw new Error("expected the shipped catalogue to contain nemesis and avenger");
}

describe("activeTraits", () => {
  test("fires nemesis on exactly three consecutive losses", () => {
    const h = h2h({
      recent: ["loss", "loss", "loss"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
      losses: 3,
    });

    expect(activeTraits(h).some((t) => t.rule === "nemesis")).toBe(true);
  });

  test("does not fire nemesis on two consecutive losses", () => {
    const h = h2h({
      recent: ["loss", "loss"],
      gameIds: ["g1", "g2"],
      streak: 2,
      losses: 2,
    });

    expect(activeTraits(h).some((t) => t.rule === "nemesis")).toBe(false);
  });

  test("does not fire nemesis when three losses are interrupted by a draw", () => {
    const h = h2h({
      recent: ["loss", "loss", "loss", "draw", "loss", "loss"],
      gameIds: ["g1", "g2", "g3", "g4", "g5", "g6"],
      streak: 2,
      losses: 5,
      draws: 1,
    });

    expect(activeTraits(h).some((t) => t.rule === "nemesis")).toBe(false);
  });

  test("does not fire nemesis when three losses are interrupted by a win", () => {
    const h = h2h({
      recent: ["loss", "loss", "win", "loss", "loss"],
      gameIds: ["g1", "g2", "g3", "g4", "g5"],
      streak: 2,
      losses: 4,
      wins: 1,
    });

    expect(activeTraits(h).some((t) => t.rule === "nemesis")).toBe(false);
  });

  test("fires avenger on a win preceded by at least three losses", () => {
    const h = h2h({
      recent: ["loss", "loss", "loss", "win"],
      gameIds: ["g1", "g2", "g3", "g4"],
      streak: 1,
      wins: 1,
      losses: 3,
    });

    expect(activeTraits(h).some((t) => t.rule === "avenger")).toBe(true);
  });

  test("does not fire avenger on a win preceded by only two losses", () => {
    const h = h2h({
      recent: ["loss", "loss", "win"],
      gameIds: ["g1", "g2", "g3"],
      streak: 1,
      wins: 1,
      losses: 2,
    });

    expect(activeTraits(h).some((t) => t.rule === "avenger")).toBe(false);
  });

  test("does not fire both rules on the same history", () => {
    const h = h2h({
      recent: ["loss", "loss", "loss", "win"],
      gameIds: ["g1", "g2", "g3", "g4"],
      streak: 1,
      wins: 1,
      losses: 3,
    });

    const traits = activeTraits(h);
    expect(traits.some((t) => t.rule === "nemesis")).toBe(false);
    expect(traits.some((t) => t.rule === "avenger")).toBe(true);
  });

  test("carries the game ids that formed the loss-streak condition", () => {
    const h = h2h({
      recent: ["loss", "loss", "loss"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
      losses: 3,
    });

    const nemesis = activeTraits(h).find((t) => t.rule === "nemesis");
    if (!nemesis) throw new Error("expected nemesis to fire");
    expect(nemesis.gameIds).toEqual(["g1", "g2", "g3"]);
    expect(nemesis.opponent).toBe("bob");
  });

  test("carries the game ids that formed the broken-streak condition, including the winning game", () => {
    const h = h2h({
      recent: ["loss", "loss", "loss", "win"],
      gameIds: ["g1", "g2", "g3", "g4"],
      streak: 1,
      wins: 1,
      losses: 3,
    });

    const avenger = activeTraits(h).find((t) => t.rule === "avenger");
    if (!avenger) throw new Error("expected avenger to fire");
    expect(avenger.gameIds).toEqual(["g1", "g2", "g3", "g4"]);
  });

  test("gives no traits for an empty history", () => {
    const h = h2h({ recent: [], gameIds: [], streak: 0 });
    expect(activeTraits(h)).toEqual([]);
  });

  test("keeps at most MAX_ACTIVE_TRAITS, highest priority first, then rule order", () => {
    const low: TraitRule = {
      id: "low",
      label: "Low",
      description: "low priority match",
      when: { kind: "loss-streak", atLeast: 1 },
      playstyleSuffix: " low",
      promote: [],
      priority: 1,
    };
    const mid: TraitRule = { ...low, id: "mid", priority: 5 };
    const high: TraitRule = { ...low, id: "high", priority: 10 };

    const h = h2h({
      recent: ["loss", "loss", "loss"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
      losses: 3,
    });

    const traits = activeTraits(h, [low, high, mid]);

    expect(traits).toHaveLength(MAX_ACTIVE_TRAITS);
    expect(traits.map((t) => t.rule)).toEqual(["high", "mid"]);
  });

  test("honours an explicit cap parameter", () => {
    const low: TraitRule = {
      id: "low",
      label: "Low",
      description: "low priority match",
      when: { kind: "loss-streak", atLeast: 1 },
      playstyleSuffix: " low",
      promote: [],
      priority: 1,
    };
    const mid: TraitRule = { ...low, id: "mid", priority: 5 };
    const high: TraitRule = { ...low, id: "high", priority: 10 };

    const h = h2h({
      recent: ["loss", "loss", "loss"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
      losses: 3,
    });

    expect(activeTraits(h, [low, high, mid], 1).map((t) => t.rule)).toEqual(["high"]);
  });

  test("honours a custom rules array instead of the shipped catalogue", () => {
    const custom: TraitRule = {
      id: "custom-quick-loss",
      label: "Quick Loss",
      description: "fires on any single loss",
      when: { kind: "loss-streak", atLeast: 1 },
      playstyleSuffix: " custom",
      promote: [],
      priority: 1,
    };

    const h = h2h({ recent: ["loss"], gameIds: ["g1"], streak: 1, losses: 1 });

    expect(activeTraits(h, [custom]).map((t) => t.rule)).toEqual(["custom-quick-loss"]);
    expect(activeTraits(h, TRAIT_RULES).map((t) => t.rule)).toEqual([]);
  });
});

describe("resolveManifest", () => {
  test("returns the base manifest unchanged when no traits are active", () => {
    const h = h2h({ recent: [], gameIds: [], streak: 0 });
    const resolved = resolveManifest(SCRIPTED_MANIFEST, "bob", h);

    expect(resolved.manifest).toEqual(SCRIPTED_MANIFEST);
    expect(resolved.manifest.version).toBe(SCRIPTED_MANIFEST.version);
    expect(resolved.traits).toEqual([]);
  });

  test("changes only playstyle and strategy order when a trait is active", () => {
    const h = h2h({
      recent: ["loss", "loss", "loss"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
      losses: 3,
    });
    const resolved = resolveManifest(SCRIPTED_MANIFEST, "bob", h);
    const { manifest } = resolved;

    expect(manifest.model).toBe(SCRIPTED_MANIFEST.model);
    expect(manifest.name).toBe(SCRIPTED_MANIFEST.name);
    expect(manifest.features).toEqual(SCRIPTED_MANIFEST.features);
    expect(manifest.historyPlies).toBe(SCRIPTED_MANIFEST.historyPlies);
    expect(manifest.fallback).toBe(SCRIPTED_MANIFEST.fallback);
    expect(manifest.budget).toEqual(SCRIPTED_MANIFEST.budget);
    expect(manifest.hierarchical).toBe(SCRIPTED_MANIFEST.hierarchical);

    expect([...manifest.strategies].sort()).toEqual(
      [...SCRIPTED_MANIFEST.strategies].sort(),
    );
    expect(manifest.playstyle).toBe(SCRIPTED_MANIFEST.playstyle + NEMESIS_RULE.playstyleSuffix);
  });

  test("moves a promoted strategy to the front without adding one the base does not declare", () => {
    const base = buildManifest({
      name: "reorder-test",
      model: "builtin-scripted",
      playstyle: "Defend first, then look for chances.",
      strategies: ["defend", "attack", "simplify"],
      features: [],
      historyPlies: 2,
      fallback: "first-legal",
      budget: { maxMs: 50 },
      hierarchical: true,
    });
    const h = h2h({
      recent: ["loss", "loss", "loss"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
      losses: 3,
    });

    const resolved = resolveManifest(base, "bob", h);

    expect(resolved.manifest.strategies).toEqual(["attack", "defend", "simplify"]);
    expect(resolved.manifest.strategies).not.toContain("king-hunt");
  });

  test("orders multiple promoted strategies by the rule's promote list, not the base's declared order", () => {
    const base = buildManifest({
      name: "avenger-reorder-test",
      model: "builtin-scripted",
      playstyle: "Play solidly.",
      strategies: ["simplify", "develop", "attack"],
      features: [],
      historyPlies: 2,
      fallback: "first-legal",
      budget: { maxMs: 50 },
      hierarchical: true,
    });
    const h = h2h({
      recent: ["loss", "loss", "loss", "win"],
      gameIds: ["g1", "g2", "g3", "g4"],
      streak: 1,
      wins: 1,
      losses: 3,
    });

    const resolved = resolveManifest(base, "bob", h);

    expect(resolved.manifest.strategies).toEqual(["attack", "develop", "simplify"]);
  });

  test("the version is a real content hash of the resolved fields", () => {
    const h = h2h({
      recent: ["loss", "loss", "loss"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
      losses: 3,
    });
    const resolved = resolveManifest(SCRIPTED_MANIFEST, "bob", h);
    const { version, ...fields } = resolved.manifest;

    expect(version).toBe(manifestVersion(fields));
    expect(version).not.toBe(SCRIPTED_MANIFEST.version);

    const again = resolveManifest(SCRIPTED_MANIFEST, "bob", h);
    expect(again.manifest.version).toBe(version);
  });

  test("different opponents with different histories give different versions", () => {
    const hAlice = h2h({
      recent: ["loss", "loss", "loss"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
      losses: 3,
      opponent: "bob",
    });
    const hCarol = h2h({ recent: [], gameIds: [], streak: 0, opponent: "carol" });

    const resolvedBob = resolveManifest(SCRIPTED_MANIFEST, "bob", hAlice);
    const resolvedCarol = resolveManifest(SCRIPTED_MANIFEST, "carol", hCarol);

    expect(resolvedBob.manifest.version).not.toBe(resolvedCarol.manifest.version);
  });

  test("the same history against the same opponent gives the same version", () => {
    const h = h2h({
      recent: ["loss", "loss", "loss"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
      losses: 3,
    });

    const first = resolveManifest(SCRIPTED_MANIFEST, "bob", h);
    const second = resolveManifest(SCRIPTED_MANIFEST, "bob", h);

    expect(first.manifest.version).toBe(second.manifest.version);
  });

  test("reports baseVersion and the active traits for the audit trail", () => {
    const h = h2h({
      recent: ["loss", "loss", "loss"],
      gameIds: ["g1", "g2", "g3"],
      streak: 3,
      losses: 3,
    });
    const resolved = resolveManifest(SCRIPTED_MANIFEST, "bob", h);

    expect(resolved.baseVersion).toBe(SCRIPTED_MANIFEST.version);
    expect(resolved.traits).toHaveLength(1);
    expect(resolved.traits[0]?.rule).toBe("nemesis");
    expect(resolved.traits[0]?.opponent).toBe("bob");
  });
});
