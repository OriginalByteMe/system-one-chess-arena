import { describe, expect, test } from "bun:test";
import {
  buildCandidate,
  buildRevisionRequest,
  reviseStrategies,
} from "../../src/season/revision.ts";
import type {
  CompetitorManifest,
  PlayerRecord,
  Provider,
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

function choiceProvider(choice: "keep" | "revise"): Provider {
  return {
    async ask(): Promise<ProviderResponse> {
      return {
        kind: "systemone",
        answers: {
          revision: {
            choice,
            probabilities:
              choice === "keep"
                ? { keep: 1, revise: 0 }
                : { keep: 0, revise: 1 },
            confidence: 1,
          },
        },
      };
    },
  };
}

function frozenManifest(value: CompetitorManifest): CompetitorManifest {
  Object.freeze(value.strategies);
  Object.freeze(value.features);
  Object.freeze(value.budget);
  return Object.freeze(value);
}

describe("strategy revision", () => {
  test("candidate derivation drops the strategy with the lowest score per pick", () => {
    expect(buildCandidate(manifest(), record())).toEqual({
      competitor: "adaptive-player",
      fromVersion: "adaptive-v1",
      strategies: ["attack", "defend"],
      rationale: "develop scored 0.25/pick over 12 picks",
    });
  });

  test("candidate ties are broken by STRATEGY_LABELS order", () => {
    const tied = record(
      stats(10, 4, 0.7),
      stats(20, 8, 0.8),
      stats(10, 7, 0.75),
    );

    expect(buildCandidate(manifest(), tied)).toEqual({
      competitor: "adaptive-player",
      fromVersion: "adaptive-v1",
      strategies: ["defend", "develop"],
      rationale: "attack scored 0.4/pick over 10 picks",
    });
  });

  test("candidate derivation returns undefined rather than removing the only strategy", () => {
    const singleStrategyManifest: CompetitorManifest = {
      ...manifest(),
      strategies: ["attack"],
    };
    const singleStrategyRecord: PlayerRecord = {
      ...record(),
      byStrategy: { attack: stats(20, 7, 0.73) },
    };

    expect(buildCandidate(singleStrategyManifest, singleStrategyRecord)).toBeUndefined();
  });

  test("revision request is one closed Choice between keeping and adopting the candidate set", () => {
    const args = {
      manifest: manifest(),
      record: record(),
      provider: choiceProvider("keep"),
      minSamplesPerStrategy: 10,
    };
    const request = buildRevisionRequest(args);
    const question = request.questions.revision;

    expect(Object.keys(request.questions)).toEqual(["revision"]);
    expect(question).toEqual({
      type: "choice",
      instructions: "Choose whether to keep the current strategy set or adopt the proposed set.",
      options: ["keep", "revise"],
    });
    expect(request).toEqual({
      kind: "systemone",
      model: "revision-model",
      state: {
        competitor: "adaptive-player",
        recordVersion: "adaptive-v1",
        playstyle: "Build pressure, but preserve king safety.",
        games: 36,
        wins: 16,
        draws: 8,
        losses: 12,
        whiteGames: 18,
        blackGames: 18,
        currentStrategies: ["attack", "defend", "develop"],
        proposedStrategies: ["attack", "defend"],
        proposalRationale: "develop scored 0.25/pick over 12 picks",
        "strategy.attack.picks": 12,
        "strategy.attack.score": 6,
        "strategy.attack.avgConfidence": 0.75,
        "strategy.defend.picks": 12,
        "strategy.defend.score": 9,
        "strategy.defend.avgConfidence": 0.81,
        "strategy.develop.picks": 12,
        "strategy.develop.score": 3,
        "strategy.develop.avgConfidence": 0.66,
      },
      questions: {
        revision: {
          type: "choice",
          instructions: "Choose whether to keep the current strategy set or adopt the proposed set.",
          options: ["keep", "revise"],
        },
      },
    });
  });

  test("one sample below the threshold blocks, while exactly the threshold is allowed", async () => {
    let calls = 0;
    const provider: Provider = {
      async ask(): Promise<ProviderResponse> {
        calls += 1;
        return {
          kind: "systemone",
          answers: {
            revision: {
              choice: "keep",
              probabilities: { keep: 1, revise: 0 },
              confidence: 1,
            },
          },
        };
      },
    };
    const base = record(
      stats(10, 5, 0.7),
      stats(10, 6, 0.8),
      stats(10, 4, 0.65),
    );
    const below = {
      ...base,
      byStrategy: {
        ...base.byStrategy,
        develop: stats(9, 4, 0.65),
      },
    };

    await expect(
      reviseStrategies({
        manifest: manifest(),
        record: below,
        provider,
        minSamplesPerStrategy: 10,
      }),
    ).resolves.toEqual({
      kind: "blocked",
      reason: "insufficient-samples",
      needed: 1,
    });
    expect(calls).toBe(0);

    await expect(
      reviseStrategies({
        manifest: manifest(),
        record: base,
        provider,
        minSamplesPerStrategy: 10,
      }),
    ).resolves.toEqual({ kind: "kept", version: "adaptive-v1" });
    expect(calls).toBe(1);
  });

  test("choosing keep preserves the existing immutable version", async () => {
    await expect(
      reviseStrategies({
        manifest: manifest(),
        record: record(),
        provider: choiceProvider("keep"),
        minSamplesPerStrategy: 10,
      }),
    ).resolves.toEqual({ kind: "kept", version: "adaptive-v1" });
  });

  test("choosing revise creates a new manifest without laundering the input manifest", async () => {
    const input = frozenManifest(manifest());
    const before = manifest();
    const outcome = await reviseStrategies({
      manifest: input,
      record: record(),
      provider: choiceProvider("revise"),
      minSamplesPerStrategy: 10,
    });

    expect(input).toEqual(before);
    expect(outcome.kind).toBe("revised");
    if (outcome.kind !== "revised") {
      throw new Error(`expected revised outcome, received ${outcome.kind}`);
    }
    expect(outcome.manifest).not.toBe(input);
    expect(outcome.manifest.version).not.toBe(input.version);
    expect(outcome.manifest.strategies).toEqual(["attack", "defend"]);
    expect(outcome.manifest).toEqual({
      ...before,
      version: outcome.manifest.version,
      strategies: ["attack", "defend"],
    });
    expect(input).toEqual(before);
  });

  test("provider error responses keep the current version instead of rewriting it", async () => {
    const provider: Provider = {
      async ask(): Promise<ProviderResponse> {
        return { kind: "error", status: 503, message: "provider unavailable" };
      },
    };

    await expect(
      reviseStrategies({
        manifest: manifest(),
        record: record(),
        provider,
        minSamplesPerStrategy: 10,
      }),
    ).resolves.toEqual({ kind: "kept", version: "adaptive-v1" });
  });

  test("a rejected provider call also keeps the current version", async () => {
    const provider: Provider = {
      async ask(): Promise<ProviderResponse> {
        throw new Error("connection reset");
      },
    };

    await expect(
      reviseStrategies({
        manifest: manifest(),
        record: record(),
        provider,
        minSamplesPerStrategy: 10,
      }),
    ).resolves.toEqual({ kind: "kept", version: "adaptive-v1" });
  });
});
