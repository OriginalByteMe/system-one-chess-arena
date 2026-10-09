import { describe, expect, test } from "bun:test";

import { createRng } from "../../src/core/rng.ts";
import { initialPosition, legalMoves, positionFromFen } from "../../src/core/rules.ts";
import { buildPositionInput } from "../../src/core/position-input.ts";
import { ROSTER } from "../../src/players/roster.ts";
import type { Clock, CompetitorManifest, PositionInput } from "../../src/core/types.ts";
import { decideLocally, type Asker } from "../src/local/decide.ts";
import { parseMoveInput } from "../src/local/game.ts";
import {
  LABELS,
  chunkOptions,
  moveQuestion,
  readChoice,
  strategyQuestion,
  type Chat,
  type TopLogprob,
} from "../src/local/prompt.ts";

const clock: Clock = { now: () => 0 };

function manifestFor(name: string): CompetitorManifest {
  const fields = ROSTER.find((entry) => entry.name === name);
  if (fields === undefined) throw new Error(`no ${name} in roster`);
  return { ...fields, version: "local" };
}

function inputFor(name: string, fen?: string): PositionInput {
  return buildPositionInput({
    seasonId: "lab",
    gameId: "lab",
    position: fen === undefined ? initialPosition() : positionFromFen(fen),
    persona: manifestFor(name),
  });
}

/** An asker that plays the part of a model: picks labels by a rule. */
function asker(choose: (messages: readonly Chat[]) => readonly TopLogprob[]): Asker & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    async topTokens(messages) {
      state.calls += 1;
      return choose(messages);
    },
  };
}

const lp = (token: string, probability: number): TopLogprob => ({ token, logprob: Math.log(probability) });

describe("readChoice", () => {
  const options = new Map([
    ["A", "e2e4"],
    ["B", "d2d4"],
    ["C", "g1f3"],
  ]);

  test("renormalises the labelled mass into a distribution", () => {
    const read = readChoice([lp("A", 0.6), lp("B", 0.2), lp("C", 0.1)], options);
    expect(read?.choice).toBe("e2e4");
    const total = Object.values(read?.probabilities ?? {}).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 12);
    expect(read?.probabilities["e2e4"]).toBeCloseTo(0.6 / 0.9, 12);
    expect(read?.confidence).toBeCloseTo(0.6 / 0.9, 12);
    expect(read?.tailMass).toBeCloseTo(0.1, 12);
  });

  test("a leading space on the token still counts", () => {
    expect(readChoice([lp(" B", 0.9)], options)?.choice).toBe("d2d4");
  });

  test("non-label tokens are tail mass, not options", () => {
    const read = readChoice([lp("The", 0.5), lp("A", 0.4)], options);
    expect(read?.choice).toBe("e2e4");
    expect(Object.keys(read?.probabilities ?? {})).toEqual(["e2e4"]);
    expect(read?.tailMass).toBeCloseTo(0.6, 12);
  });

  test("no label among the top tokens is a malformed answer", () => {
    expect(readChoice([lp("The", 0.9), lp("I", 0.05)], options)).toBeUndefined();
  });

  test("a label outside this question's options is ignored", () => {
    expect(readChoice([lp("Z", 0.9)], options)).toBeUndefined();
  });
});

describe("questions", () => {
  test("moves are shown in SAN against single-character labels", () => {
    const input = inputFor("architect");
    const question = moveQuestion(input, input.legalMoves, "develop");
    const text = question.messages.map((message) => message.content).join("\n");
    expect(text).toContain("A) a3");
    expect(text).toContain("Nf3");
    expect(text).not.toContain("g1f3");
    expect(text).toContain(input.persona.playstyle);
    expect(text).toContain("Your strategy: develop");
    expect(question.labelled.size).toBe(input.legalMoves.length);
  });

  test("strategy options are the persona's declared strategies", () => {
    const input = inputFor("aggressor");
    const question = strategyQuestion(input);
    expect([...question.labelled.values()]).toEqual([...input.persona.strategies]);
  });

  test("more moves than labels are split into chunks", () => {
    const moves = Array.from({ length: LABELS.length + 3 }, (_, index) => `m${index}`);
    const chunks = chunkOptions(moves);
    expect(chunks.map((chunk) => chunk.length)).toEqual([LABELS.length, 3]);
    expect(new Set(LABELS).size).toBe(LABELS.length);
  });
});

describe("decideLocally", () => {
  test("a hierarchical persona asks for a strategy, then a move", async () => {
    const input = inputFor("aggressor");
    const model = asker((messages) => {
      const user = messages[1]?.content ?? "";
      return user.includes("best fits this position") ? [lp("B", 0.7), lp("A", 0.2)] : [lp("A", 0.5), lp("B", 0.3)];
    });
    const result = await decideLocally(input, model, clock, createRng("t"));
    expect(model.calls).toBe(2);
    expect(result.decision.fallback).toBeUndefined();
    expect(result.decision.strategy).toBe(input.persona.strategies[1]!);
    expect(result.decision.move).toBe(input.legalMoves[0]!);
    expect(result.decision.confidence).toBeCloseTo(0.5 / 0.8, 12);
    expect(Object.keys(result.decision.distribution ?? {})).toHaveLength(2);
    expect(result.tailMass).toBeCloseTo(0.2, 12);
  });

  test("the distribution is accepted by the league's own validator", async () => {
    const input = inputFor("architect");
    const model = asker(() => [lp("C", 0.4), lp("A", 0.3), lp("B", 0.2), lp("D", 0.05), lp("E", 0.02)]);
    const result = await decideLocally(input, model, clock, createRng("t"));
    expect(result.decision.fallback).toBeUndefined();
    expect(legalMoves(positionFromFen(input.fen))).toContain(result.decision.move);
  });

  test("an unparseable answer falls back to the persona's fallback, and says why", async () => {
    const input = inputFor("aggressor");
    const result = await decideLocally(input, asker(() => [lp("Sorry", 0.9)]), clock, createRng("t"));
    expect(result.decision.fallback).toBe("malformed-response");
    expect(input.legalMoves).toContain(result.decision.move);
    expect(result.detail).toContain("strategy");
  });

  test("a model that throws is a provider error, not a crash", async () => {
    const input = inputFor("aggressor");
    const broken: Asker = {
      async topTokens() {
        throw new Error("device lost");
      },
    };
    const result = await decideLocally(input, broken, clock, createRng("t"));
    expect(result.decision.fallback).toBe("provider-error");
    expect(result.detail).toBe("device lost");
  });

  test("more moves than labels: chunk winners meet in a final round instead of racing on per-chunk confidence", async () => {
    // 218 legal moves is the known maximum; this FEN has well over 62.
    const fen = "R6R/3Q4/1Q4Q1/4Q3/2Q4Q/Q4Q2/pp1Q4/kBNN1KB1 w - - 0 1";
    const input = inputFor("architect", fen);
    expect(input.legalMoves.length).toBeGreaterThan(LABELS.length);
    const chunks = Math.ceil(input.legalMoves.length / LABELS.length);
    let call = 0;
    const model = asker(() => {
      call += 1;
      if (call === 1) return [lp("A", 0.9)]; // strategy
      if (call < 2 + chunks - 1) return [lp("A", 0.4), lp("B", 0.4)]; // full chunks, unsure
      if (call === 2 + chunks - 1) return [lp("A", 1)]; // short last chunk: trivially 100%
      return [lp("A", 0.7), lp("D", 0.2)]; // final round over the chunk winners
    });
    const result = await decideLocally(input, model, clock, createRng("t"));
    // strategy + one call per chunk + the final round
    expect(model.calls).toBe(1 + chunks + 1);
    expect(result.decision.fallback).toBeUndefined();
    // The first chunk's winner wins the final round; the last chunk's trivial
    // 100% must not have decided it.
    expect(result.decision.move).toBe(input.legalMoves[0]!);
    expect(result.decision.confidence).toBeCloseTo(0.7 / 0.9, 12);
    expect(Object.keys(result.decision.distribution ?? {})).toHaveLength(2);
  });
});

describe("parseMoveInput", () => {
  const start = initialPosition();

  test("accepts UCI and SAN for the same move", () => {
    expect(parseMoveInput(start, "g1f3")).toBe("g1f3");
    expect(parseMoveInput(start, "Nf3")).toBe("g1f3");
    expect(parseMoveInput(start, " nf3 ")).toBe("g1f3");
    expect(parseMoveInput(start, "e4")).toBe("e2e4");
  });

  test("rejects moves that are illegal or empty", () => {
    expect(parseMoveInput(start, "e5")).toBeUndefined();
    expect(parseMoveInput(start, "")).toBeUndefined();
    expect(parseMoveInput(start, "Qh5")).toBeUndefined();
  });

  test("does not collapse a bishop capture and a pawn capture that differ only in case", () => {
    const position = positionFromFen("4k3/8/8/8/1p6/2P5/B7/4K3 w - - 0 1");
    // Bxb... is not legal here; pawn takes b4 is. Case must not turn "bxb4" into a bishop move.
    expect(parseMoveInput(position, "cxb4")).toBe("c3b4");
    expect(parseMoveInput(position, "Bxb4")).toBeUndefined();
  });

  test("forgives castling written with zeros and check marks", () => {
    const position = positionFromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    expect(parseMoveInput(position, "0-0")).toBe("e1g1");
    expect(parseMoveInput(position, "O-O-O")).toBe("e1c1");
  });
});
