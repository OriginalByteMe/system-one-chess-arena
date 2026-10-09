// One local decision: strategy (if the persona declares one first), then the
// move, each read from the model's token logprobs. The model sits behind the
// `Asker` seam so this logic runs, and is tested, without a GPU.
import { applyFallback, validateDecision } from "../../../src/core/validation.ts";
import type {
  Clock,
  FallbackReason,
  MoveDecision,
  PositionInput,
  Rng,
  Uci,
} from "../../../src/core/types.ts";
import {
  chunkOptions,
  moveQuestion,
  readChoice,
  strategyQuestion,
  type Chat,
  type ChoiceRead,
  type TopLogprob,
} from "./prompt.ts";

export interface Asker {
  /** Generates one token and returns its top logprobs, best first. */
  topTokens(messages: readonly Chat[]): Promise<readonly TopLogprob[]>;
}

export interface LocalDecision {
  readonly decision: MoveDecision;
  /** Probability the move answer left outside the options it listed. */
  readonly tailMass?: number;
  /** Model calls made for this decision. */
  readonly calls: number;
  /** Why a fallback was used, when one was, in words. */
  readonly detail?: string;
}

export async function decideLocally(
  input: PositionInput,
  asker: Asker,
  clock: Clock,
  rng: Rng,
): Promise<LocalDecision> {
  const startedAt = clock.now();
  let calls = 0;
  const fail = (reason: FallbackReason, detail: string): LocalDecision => ({
    decision: applyFallback(input, reason, rng, clock.now() - startedAt),
    calls,
    detail,
  });

  let strategy: string | undefined;
  try {
    if (input.persona.hierarchical) {
      const question = strategyQuestion(input);
      calls += 1;
      const read = readChoice(await asker.topTokens(question.messages), question.labelled);
      if (read === undefined) {
        return fail("malformed-response", "the strategy answer was not one of the labels");
      }
      strategy = read.choice;
    }

    let best: ChoiceRead | undefined;
    for (const moves of chunkOptions<Uci>(input.legalMoves)) {
      const question = moveQuestion(input, moves, strategy);
      calls += 1;
      const read = readChoice(await asker.topTokens(question.messages), question.labelled);
      if (read === undefined) {
        return fail("malformed-response", "the move answer was not one of the labels");
      }
      if (best === undefined || read.confidence > best.confidence) best = read;
    }
    if (best === undefined) return fail("malformed-response", "no move was offered");

    const result = validateDecision(input, {
      move: best.choice,
      strategy: strategy ?? input.persona.strategies[0] ?? "",
      confidence: best.confidence,
      distribution: best.probabilities,
      latencyMs: clock.now() - startedAt,
    });
    if (!result.ok) return fail(result.reason, result.detail);
    return { decision: result.decision, tailMass: best.tailMass, calls };
  } catch (error) {
    return fail("provider-error", error instanceof Error ? error.message : "the model failed");
  }
}
