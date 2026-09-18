import { describe, expect, test } from "bun:test";
import { manifestVersion } from "../../src/core/manifest.ts";
import { buildPlaystyleRequest, revisePlaystyle } from "../../src/season/revision.ts";
import type {
  CompetitorManifest,
  PlayerRecord,
  Provider,
  ProviderRequest,
  ProviderResponse,
  StrategyStats,
} from "../../src/core/types.ts";

function manifest(): CompetitorManifest {
  return {
    name: "adaptive-player",
    model: "revision-model",
    playstyle: "Build pressure, but preserve king safety.",
    strategies: ["attack", "defend", "develop"],
    features: ["materialBalance", "kingSafety", "development"],
    historyPlies: 12,
    fallback: "greedy",
    budget: { maxMs: 2_000, maxCostUsd: 0.02 },
    hierarchical: true,
    version: "adaptive-v1",
  };
}

function stats(picks: number, score: number, avgConfidence: number): StrategyStats {
  return { picks, score, avgConfidence };
}

function record(
  attack: StrategyStats = stats(12, 6, 0.75),
  defend: StrategyStats = stats(12, 9, 0.81),
  develop: StrategyStats = stats(12, 3, 0.66),
): PlayerRecord {
  return {
    competitor: "adaptive-player",
    version: "adaptive-v1",
    games: 36,
    wins: 16,
    draws: 8,
    losses: 12,
    byColour: { white: 18, black: 18 },
    byStrategy: { attack, defend, develop },
  };
}

function singleQuestion(
  request: ProviderRequest,
): { readonly id: string; readonly options: readonly string[] } {
  if (request.kind !== "systemone") {
    throw new Error("expected a systemone request");
  }
  const entries = Object.entries(request.questions);
  if (entries.length !== 1) {
    throw new Error("expected exactly one question");
  }
  const [id, question] = entries[0]!;
  return { id, options: question.options };
}

function playstyleProvider(currentSentence: string, pick: "current" | "alternative"): Provider {
  return {
    async ask(request: ProviderRequest): Promise<ProviderResponse> {
      const { id, options } = singleQuestion(request);
      const target =
        pick === "current" ? currentSentence : options.find((option) => option !== currentSentence);
      if (target === undefined) {
        throw new Error("no usable playstyle option in the request");
      }
      return {
        kind: "systemone",
        answers: {
          [id]: {
            choice: target,
            probabilities: Object.fromEntries(
              options.map((option) => [option, option === target ? 1 : 0]),
            ),
            confidence: 1,
          },
        },
      };
    },
  };
}

function countingProvider(response: ProviderResponse): {
  readonly provider: Provider;
  readonly calls: () => number;
} {
  let calls = 0;
  return {
    provider: {
      async ask(): Promise<ProviderResponse> {
        calls += 1;
        return response;
      },
    },
    calls: () => calls,
  };
}

describe("buildPlaystyleRequest", () => {
  test("offers the current sentence as one closed choice among alternatives", () => {
    const base = manifest();
    const request = buildPlaystyleRequest({
      manifest: base,
      record: record(),
      provider: playstyleProvider(base.playstyle, "current"),
      minSamplesPerStrategy: 10,
    });
    const entries = Object.entries(request.questions);

    expect(entries).toHaveLength(1);
    const [, question] = entries[0]!;
    expect(question.type).toBe("choice");
    expect(question.options).toContain(base.playstyle);
    expect(question.options.length).toBeGreaterThan(1);
    expect(new Set(question.options).size).toBe(question.options.length);
  });

  test("keeps a stable question id across calls with the same inputs", () => {
    const base = manifest();
    const args = {
      manifest: base,
      record: record(),
      provider: playstyleProvider(base.playstyle, "current"),
      minSamplesPerStrategy: 10,
    };

    const firstIds = Object.keys(buildPlaystyleRequest(args).questions);
    const secondIds = Object.keys(buildPlaystyleRequest(args).questions);

    expect(firstIds).toHaveLength(1);
    expect(firstIds).toEqual(secondIds);
  });

  test("the state carries the record the proposal is based on", () => {
    const base = manifest();
    const rec = record();
    const request = buildPlaystyleRequest({
      manifest: base,
      record: rec,
      provider: playstyleProvider(base.playstyle, "current"),
      minSamplesPerStrategy: 10,
    });

    expect(Object.values(request.state)).toContain(rec.version);
  });

  test("the alternatives are deterministic for a given record rather than free text", () => {
    const base = manifest();
    const args = {
      manifest: base,
      record: record(),
      provider: playstyleProvider(base.playstyle, "current"),
      minSamplesPerStrategy: 10,
    };

    expect(buildPlaystyleRequest(args)).toEqual(buildPlaystyleRequest(args));
  });
});

describe("revisePlaystyle", () => {
  test("blocks on too few samples for any declared strategy without calling the provider", async () => {
    const base = record(
      stats(10, 5, 0.7),
      stats(10, 6, 0.8),
      stats(10, 4, 0.65),
    );
    const below: PlayerRecord = {
      ...base,
      byStrategy: { ...base.byStrategy, develop: stats(9, 4, 0.65) },
    };
    const { provider, calls } = countingProvider({ kind: "systemone", answers: {} });

    await expect(
      revisePlaystyle({
        manifest: manifest(),
        record: below,
        provider,
        minSamplesPerStrategy: 10,
      }),
    ).resolves.toEqual({ kind: "blocked", reason: "insufficient-samples", needed: 1 });
    expect(calls()).toBe(0);
  });

  test("choosing the current sentence keeps the manifest unchanged", async () => {
    const base = manifest();
    const outcome = await revisePlaystyle({
      manifest: base,
      record: record(),
      provider: playstyleProvider(base.playstyle, "current"),
      minSamplesPerStrategy: 10,
    });

    expect(outcome).toEqual({ kind: "kept", version: base.version });
  });

  test("choosing an alternative sentence rehashes the version and leaves everything else untouched", async () => {
    const base = manifest();
    const outcome = await revisePlaystyle({
      manifest: base,
      record: record(),
      provider: playstyleProvider(base.playstyle, "alternative"),
      minSamplesPerStrategy: 10,
    });

    expect(outcome.kind).toBe("revised");
    if (outcome.kind !== "revised") {
      throw new Error(`expected revised outcome, received ${outcome.kind}`);
    }
    expect(outcome.manifest.playstyle).not.toBe(base.playstyle);

    const { version: _version, ...fields } = base;
    const revisedFields = { ...fields, playstyle: outcome.manifest.playstyle };
    expect(outcome.manifest).toEqual({
      ...revisedFields,
      version: manifestVersion(revisedFields),
    });
  });

  test("a provider that throws keeps the current version", async () => {
    const base = manifest();
    const provider: Provider = {
      async ask(): Promise<ProviderResponse> {
        throw new Error("connection reset");
      },
    };

    await expect(
      revisePlaystyle({ manifest: base, record: record(), provider, minSamplesPerStrategy: 10 }),
    ).resolves.toEqual({ kind: "kept", version: base.version });
  });

  test("a non-systemone provider response keeps the current version", async () => {
    const base = manifest();
    const provider: Provider = {
      async ask(): Promise<ProviderResponse> {
        return { kind: "chat", text: "sure, whatever you think is best" };
      },
    };

    await expect(
      revisePlaystyle({ manifest: base, record: record(), provider, minSamplesPerStrategy: 10 }),
    ).resolves.toEqual({ kind: "kept", version: base.version });
  });

  test("a systemone response missing the answer keeps the current version", async () => {
    const base = manifest();
    const provider: Provider = {
      async ask(): Promise<ProviderResponse> {
        return { kind: "systemone", answers: {} };
      },
    };

    await expect(
      revisePlaystyle({ manifest: base, record: record(), provider, minSamplesPerStrategy: 10 }),
    ).resolves.toEqual({ kind: "kept", version: base.version });
  });
});
