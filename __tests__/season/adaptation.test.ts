import { describe, expect, test } from "bun:test";
import { adaptSeason, lineageFrom, nextSeasonConfig } from "../../src/season/adaptation.ts";
import { positionFixture } from "../fixtures/positions.ts";
import type {
  AdaptationResult,
  CompetitorManifest,
  PlayerRecord,
  Provider,
  ProviderRequest,
  ProviderResponse,
  SeasonConfig,
  StrategyStats,
} from "../../src/core/types.ts";

function stats(picks: number, score: number, avgConfidence: number): StrategyStats {
  return { picks, score, avgConfidence };
}

function manifestFor(name: string, playstyle: string): CompetitorManifest {
  return {
    name,
    model: `${name}-model`,
    playstyle,
    strategies: ["attack", "defend", "develop"],
    features: ["materialBalance", "kingSafety", "development"],
    historyPlies: 8,
    fallback: "greedy",
    budget: { maxMs: 1_500 },
    hierarchical: true,
    version: `${name}-v1`,
  };
}

function recordFor(
  competitor: string,
  version: string,
  attack: StrategyStats = stats(12, 6, 0.75),
  defend: StrategyStats = stats(12, 9, 0.81),
  develop: StrategyStats = stats(12, 3, 0.66),
): PlayerRecord {
  return {
    competitor,
    version,
    games: 36,
    wins: 16,
    draws: 8,
    losses: 12,
    byColour: { white: 18, black: 18 },
    byStrategy: { attack, defend, develop },
  };
}

function seasonConfigFor(competitors: readonly CompetitorManifest[]): SeasonConfig {
  return {
    seasonId: "season-1",
    seed: "seed-1",
    competitors,
    openings: [
      {
        id: "italian",
        name: "Italian Game",
        moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"],
        fen: positionFixture("start").fen,
      },
    ],
    roundsPerPair: 4,
    maxPlies: 120,
  };
}

interface CompetitorPlan {
  readonly strategy: "keep" | "revise" | "throw";
  readonly playstyle?: "current" | "alternative" | "throw";
}

function planProvider(
  manifestsByName: { readonly [competitor: string]: CompetitorManifest },
  plans: { readonly [competitor: string]: CompetitorPlan },
): { readonly provider: Provider; readonly callCounts: () => { readonly [competitor: string]: number } } {
  const calls: Record<string, number> = {};
  const provider: Provider = {
    async ask(request: ProviderRequest): Promise<ProviderResponse> {
      if (request.kind !== "systemone") {
        throw new Error("expected a systemone request");
      }
      const competitor = String(request.state.competitor);
      calls[competitor] = (calls[competitor] ?? 0) + 1;
      const plan = plans[competitor];
      if (plan === undefined) {
        throw new Error(`no plan configured for ${competitor}`);
      }

      const entries = Object.entries(request.questions);
      const [id, question] = entries[0]!;

      if (id === "revision") {
        if (plan.strategy === "throw") {
          throw new Error("provider unavailable");
        }
        const choice = plan.strategy;
        return {
          kind: "systemone",
          answers: {
            [id]: {
              choice,
              probabilities: choice === "keep" ? { keep: 1, revise: 0 } : { keep: 0, revise: 1 },
              confidence: 1,
            },
          },
        };
      }

      const mode = plan.playstyle ?? "current";
      if (mode === "throw") {
        throw new Error("provider unavailable");
      }
      const currentSentence = manifestsByName[competitor]?.playstyle;
      const target =
        mode === "current" ? currentSentence : question.options.find((option) => option !== currentSentence);
      if (target === undefined) {
        throw new Error("no usable playstyle option in the request");
      }
      return {
        kind: "systemone",
        answers: {
          [id]: {
            choice: target,
            probabilities: Object.fromEntries(
              question.options.map((option) => [option, option === target ? 1 : 0]),
            ),
            confidence: 1,
          },
        },
      };
    },
  };
  return { provider, callCounts: () => ({ ...calls }) };
}

describe("adaptSeason", () => {
  test("returns one result per manifest, in input order", async () => {
    const a = manifestFor("alpha", "Play sharp, tactical chess.");
    const b = manifestFor("beta", "Play safe, positional chess.");
    const c = manifestFor("gamma", "Grind out small material edges.");
    const manifestsByName = { [a.name]: a, [b.name]: b, [c.name]: c };
    const { provider } = planProvider(manifestsByName, {
      [a.name]: { strategy: "keep" },
      [b.name]: { strategy: "keep" },
      [c.name]: { strategy: "keep" },
    });

    const results = await adaptSeason({
      manifests: [a, b, c],
      records: [recordFor(a.name, a.version), recordFor(b.name, b.version), recordFor(c.name, c.version)],
      provider,
      minSamplesPerStrategy: 10,
      revisePlaystyle: false,
    });

    expect(results.map((result) => result.competitor)).toEqual([a.name, b.name, c.name]);
  });

  test("a competitor with no record in records is blocked, not crashed", async () => {
    const a = manifestFor("alpha", "Play sharp, tactical chess.");
    const b = manifestFor("beta", "Play safe, positional chess.");
    const manifestsByName = { [a.name]: a, [b.name]: b };
    const { provider, callCounts } = planProvider(manifestsByName, {
      [a.name]: { strategy: "keep" },
    });

    const results = await adaptSeason({
      manifests: [a, b],
      records: [recordFor(a.name, a.version)],
      provider,
      minSamplesPerStrategy: 10,
      revisePlaystyle: false,
    });

    const aResult = results.find((result) => result.competitor === a.name);
    const bResult = results.find((result) => result.competitor === b.name);
    if (aResult === undefined || bResult === undefined) {
      throw new Error("expected a result for both competitors");
    }

    expect(bResult.outcome.kind).toBe("blocked");
    expect(callCounts()[b.name]).toBeUndefined();
    expect(aResult.outcome.kind).toBe("kept");
  });

  test("with revisePlaystyle false, no playstyle change appears and the sentence is untouched", async () => {
    const a = manifestFor("alpha", "Play sharp, tactical chess.");
    const manifestsByName = { [a.name]: a };
    const { provider } = planProvider(manifestsByName, { [a.name]: { strategy: "revise" } });

    const results = await adaptSeason({
      manifests: [a],
      records: [recordFor(a.name, a.version)],
      provider,
      minSamplesPerStrategy: 10,
      revisePlaystyle: false,
    });
    const [result] = results;
    if (result === undefined || result.outcome.kind !== "revised") {
      throw new Error("expected a revised outcome");
    }

    expect(result.playstyle).toBeUndefined();
    expect(result.outcome.manifest.playstyle).toBe(a.playstyle);
  });

  test("with revisePlaystyle true, a competitor can adopt both a new strategy list and a new sentence", async () => {
    const a = manifestFor("alpha", "Play sharp, tactical chess.");
    const manifestsByName = { [a.name]: a };
    const { provider } = planProvider(manifestsByName, {
      [a.name]: { strategy: "revise", playstyle: "alternative" },
    });

    const results = await adaptSeason({
      manifests: [a],
      records: [recordFor(a.name, a.version)],
      provider,
      minSamplesPerStrategy: 10,
      revisePlaystyle: true,
    });
    const [result] = results;
    if (result === undefined || result.outcome.kind !== "revised") {
      throw new Error("expected a revised outcome");
    }

    expect(result.outcome.manifest.strategies).not.toEqual(a.strategies);
    expect(result.outcome.manifest.playstyle).not.toBe(a.playstyle);
    expect(result.playstyle).toEqual({ from: a.playstyle, to: result.outcome.manifest.playstyle });
  });

  test("one competitor's provider failure leaves that one kept without failing the round", async () => {
    const a = manifestFor("alpha", "Play sharp, tactical chess.");
    const b = manifestFor("beta", "Play safe, positional chess.");
    const manifestsByName = { [a.name]: a, [b.name]: b };
    const { provider } = planProvider(manifestsByName, {
      [a.name]: { strategy: "throw" },
      [b.name]: { strategy: "revise" },
    });

    const results = await adaptSeason({
      manifests: [a, b],
      records: [recordFor(a.name, a.version), recordFor(b.name, b.version)],
      provider,
      minSamplesPerStrategy: 10,
      revisePlaystyle: false,
    });

    const aResult = results.find((result) => result.competitor === a.name);
    const bResult = results.find((result) => result.competitor === b.name);
    if (aResult === undefined || bResult === undefined) {
      throw new Error("expected a result for both competitors");
    }

    expect(aResult.outcome).toEqual({ kind: "kept", version: a.version });
    expect(bResult.outcome.kind).toBe("revised");
  });

  test("every result carries a non-empty rationale", async () => {
    const a = manifestFor("alpha", "Play sharp, tactical chess.");
    const b = manifestFor("beta", "Play safe, positional chess.");
    const c = manifestFor("gamma", "Grind out small material edges.");
    const manifestsByName = { [a.name]: a, [b.name]: b, [c.name]: c };
    const { provider } = planProvider(manifestsByName, {
      [a.name]: { strategy: "keep" },
      [b.name]: { strategy: "revise" },
    });

    const cRecord = recordFor(c.name, c.version);
    const belowThreshold = { ...cRecord, byStrategy: { ...cRecord.byStrategy, develop: stats(2, 1, 0.5) } };

    const results = await adaptSeason({
      manifests: [a, b, c],
      records: [recordFor(a.name, a.version), recordFor(b.name, b.version), belowThreshold],
      provider,
      minSamplesPerStrategy: 10,
      revisePlaystyle: false,
    });

    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.rationale.length).toBeGreaterThan(0);
    }
    expect(results.map((result) => result.outcome.kind).sort()).toEqual(["blocked", "kept", "revised"]);
  });
});

describe("nextSeasonConfig", () => {
  test("carries the revised manifest where revision happened and the previous manifest otherwise", () => {
    const a = manifestFor("alpha", "Play sharp, tactical chess.");
    const b = manifestFor("beta", "Play safe, positional chess.");
    const c = manifestFor("gamma", "Grind out small material edges.");
    const config = seasonConfigFor([a, b, c]);

    const revisedA: CompetitorManifest = { ...a, strategies: ["attack", "defend"], version: "alpha-v2" };

    const results: readonly AdaptationResult[] = [
      {
        competitor: a.name,
        fromVersion: a.version,
        outcome: { kind: "revised", manifest: revisedA },
        rationale: "dropped its worst-performing strategy",
      },
      {
        competitor: b.name,
        fromVersion: b.version,
        outcome: { kind: "kept", version: b.version },
        rationale: "kept a strategy set that is already working",
      },
      {
        competitor: c.name,
        fromVersion: c.version,
        outcome: { kind: "blocked", reason: "insufficient-samples", needed: 4 },
        rationale: "too few games to judge fairly",
      },
    ];

    const next = nextSeasonConfig(config, results, "season-2", "seed-2");

    expect(next.competitors).toEqual([revisedA, b, c]);
    expect(next.openings).toEqual(config.openings);
    expect(next.roundsPerPair).toBe(config.roundsPerPair);
    expect(next.maxPlies).toBe(config.maxPlies);
    expect(next.seasonId).toBe("season-2");
    expect(next.seed).toBe("seed-2");
  });

  test("never changes a competitor's name even when results arrive out of order", () => {
    const a = manifestFor("alpha", "Play sharp, tactical chess.");
    const b = manifestFor("beta", "Play safe, positional chess.");
    const config = seasonConfigFor([a, b]);

    const revisedA: CompetitorManifest = {
      ...a,
      playstyle: "Grind for small edges and trade down.",
      version: "alpha-v2",
    };

    const results: readonly AdaptationResult[] = [
      {
        competitor: b.name,
        fromVersion: b.version,
        outcome: { kind: "kept", version: b.version },
        rationale: "no change warranted",
      },
      {
        competitor: a.name,
        fromVersion: a.version,
        outcome: { kind: "revised", manifest: revisedA },
        rationale: "adopted a calmer style",
      },
    ];

    const next = nextSeasonConfig(config, results, "season-2", "seed-2");
    const byName = new Map(next.competitors.map((competitor) => [competitor.name, competitor]));

    expect(next.competitors).toHaveLength(2);
    expect(byName.get(a.name)).toEqual(revisedA);
    expect(byName.get(b.name)).toEqual(b);
  });
});

describe("lineageFrom", () => {
  test("maps each revised competitor to the version it came from and its rationale, omitting kept and blocked ones", () => {
    const alpha = manifestFor("alpha", "Play sharp, tactical chess.");
    const revisedAlpha: CompetitorManifest = { ...alpha, strategies: ["attack", "defend"], version: "alpha-v2" };

    const results: readonly AdaptationResult[] = [
      {
        competitor: "alpha",
        fromVersion: alpha.version,
        outcome: { kind: "revised", manifest: revisedAlpha },
        rationale: "dropped its worst-performing strategy",
      },
      {
        competitor: "beta",
        fromVersion: "beta-v1",
        outcome: { kind: "kept", version: "beta-v1" },
        rationale: "kept a strategy set that is already working",
      },
      {
        competitor: "gamma",
        fromVersion: "gamma-v1",
        outcome: { kind: "blocked", reason: "insufficient-samples", needed: 6 },
        rationale: "too few games to judge fairly",
      },
    ];

    const { parents, rationales } = lineageFrom(results);

    expect(Object.keys(parents).sort()).toEqual(["alpha"]);
    expect(Object.keys(rationales).sort()).toEqual(["alpha"]);
    expect(parents.alpha).toBe(alpha.version);
    expect(parents.alpha).not.toBe(revisedAlpha.version);
    expect(rationales.alpha).toBe("dropped its worst-performing strategy");
  });
});
