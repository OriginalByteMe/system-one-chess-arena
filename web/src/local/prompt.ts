// How a chat model is made to behave like a decision model.
//
// Jev answers a closed choice with a probability for every option. A chat model
// can do the same if the choice is posed as single-character labels and the
// answer is read off the first generated token: its logprobs over the labels
// ARE the distribution, measured rather than self-reported. WebLLM returns at
// most the top 5 logprobs per token, so the distribution is the model's top
// five options, renormalised, with the mass it could not see reported as
// `tailMass` instead of being invented.
import { positionFromFen, toSan } from "../../../src/core/rules.ts";
import type { PositionInput, Uci } from "../../../src/core/types.ts";

/** One character each, so every label is a single token in common tokenizers. */
export const LABELS: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** The most WebLLM will return for one position (top_logprobs range is 0-5). */
export const TOP_LOGPROBS = 5;

export interface Chat {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface TopLogprob {
  readonly token: string;
  readonly logprob: number;
}

export interface Question {
  readonly messages: readonly Chat[];
  /** label -> the option it stands for */
  readonly labelled: ReadonlyMap<string, string>;
}

/** Splits legal moves into groups that each fit the label alphabet. */
export function chunkOptions<T>(options: readonly T[]): readonly (readonly T[])[] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < options.length; offset += LABELS.length) {
    chunks.push(options.slice(offset, offset + LABELS.length));
  }
  return chunks;
}

function system(input: PositionInput): string {
  return [
    `You are ${input.persona.name}, a chess player.`,
    `Your playstyle: ${input.persona.playstyle}`,
    "Reply with exactly one character: the label of the option you choose. No other text.",
  ].join("\n");
}

function context(input: PositionInput): string[] {
  const lines = [`Position (FEN): ${input.fen}`, `You play ${input.colour}.`];
  if (input.history.length > 0) {
    lines.push(`Recent moves: ${input.history.join(" ")}`);
  }
  for (const feature of input.persona.features) {
    const value = input.features[feature];
    if (value !== undefined) lines.push(`${feature}: ${String(value)}`);
  }
  return lines;
}

function labelled(options: readonly string[]): ReadonlyMap<string, string> {
  return new Map(options.map((option, index) => [LABELS.charAt(index), option]));
}

function optionLines(map: ReadonlyMap<string, string>, name: (option: string) => string): string[] {
  return [...map].map(([label, option]) => `${label}) ${name(option)}`);
}

/** Only used when the persona is hierarchical: pick a strategy, then a move. */
export function strategyQuestion(input: PositionInput): Question {
  const map = labelled(input.persona.strategies);
  return {
    labelled: map,
    messages: [
      { role: "system", content: system(input) },
      {
        role: "user",
        content: [
          ...context(input),
          "",
          "Choose the strategy that best fits this position:",
          ...optionLines(map, (option) => option),
          "",
          "Answer with the label only.",
        ].join("\n"),
      },
    ],
  };
}

/**
 * Moves are named in algebraic notation. Jev measured 1 of 3 mates found with
 * bare UCI against 3 of 3 with SAN; the same applies to a chat model.
 */
export function moveQuestion(
  input: PositionInput,
  moves: readonly Uci[],
  strategy: string | undefined,
): Question {
  const position = positionFromFen(input.fen);
  const map = labelled(moves);
  return {
    labelled: map,
    messages: [
      { role: "system", content: system(input) },
      {
        role: "user",
        content: [
          ...context(input),
          ...(strategy === undefined ? [] : [`Your strategy: ${strategy}`]),
          "",
          "Choose the best legal move:",
          ...optionLines(map, (move) => toSan(position, move)),
          "",
          "Answer with the label only.",
        ].join("\n"),
      },
    ],
  };
}

export interface ChoiceRead {
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  /** Probability of `choice` among the option labels the model put mass on. */
  readonly confidence: number;
  /**
   * Probability the answer token put anywhere outside the labelled options it
   * returned: other tokens, and options beyond the top five.
   */
  readonly tailMass: number;
}

/**
 * Turns the first generated token's top logprobs into a distribution over
 * options. Tokens are matched after trimming, so "A" and " A" both count for
 * A. Returns undefined when none of the top tokens is an option label, which
 * is a malformed answer the caller treats as a failure.
 */
export function readChoice(
  top: readonly TopLogprob[],
  options: ReadonlyMap<string, string>,
): ChoiceRead | undefined {
  const mass = new Map<string, number>();
  let labelMass = 0;
  for (const entry of top) {
    if (!Number.isFinite(entry.logprob)) continue;
    const probability = Math.exp(entry.logprob);
    const option = options.get(entry.token.trim());
    if (option === undefined) continue;
    mass.set(option, (mass.get(option) ?? 0) + probability);
    labelMass += probability;
  }
  if (mass.size === 0 || labelMass <= 0) return undefined;

  const probabilities: Record<string, number> = {};
  let choice: string | undefined;
  let best = -1;
  for (const [option, value] of mass) {
    const share = value / labelMass;
    probabilities[option] = share;
    if (share > best) {
      best = share;
      choice = option;
    }
  }
  if (choice === undefined) return undefined;
  return {
    choice,
    probabilities,
    confidence: best,
    tailMass: Math.max(0, 1 - labelMass),
  };
}
