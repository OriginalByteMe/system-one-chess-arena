import { readFileSync } from "node:fs";
import type {
  ChoiceAnswer,
  Provider,
  ProviderResponse,
  TokenUsage,
} from "../../src/core/types.ts";

export type TranscriptId =
  | "jev-flat-ok"
  | "jev-hierarchical-ok"
  | "jev-illegal-move"
  | "jev-unknown-strategy"
  | "jev-bad-probabilities"
  | "jev-missing-answer"
  | "chat-ok"
  | "chat-prose-wrapped"
  | "chat-illegal-move"
  | "chat-empty"
  | "chat-wrong-type"
  | "error-429"
  | "error-500"
  | "error-socket";

function fail(path: string, detail: string): never {
  throw new Error(`invalid recorded provider transcript at ${path}: ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(path, "expected an object");
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail(path, `missing ${key}`);
    }
  }

  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(path, `unexpected ${key}`);
    }
  }
}

function stringField(value: Record<string, unknown>, key: string, path: string): string {
  const field = value[key];
  if (typeof field !== "string") {
    fail(`${path}.${key}`, "expected a string");
  }
  return field;
}

function finiteNumberField(
  value: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) {
    fail(`${path}.${key}`, "expected a finite number");
  }
  return field;
}

function parseTokens(value: unknown, path: string): TokenUsage {
  const fields = record(value, path);
  exactKeys(fields, path, ["in", "out"]);
  const input = finiteNumberField(fields, "in", path);
  const output = finiteNumberField(fields, "out", path);
  if (!Number.isInteger(input) || input < 0 || !Number.isInteger(output) || output < 0) {
    fail(path, "token counts must be non-negative integers");
  }
  return { in: input, out: output };
}

function parseProbabilities(value: unknown, path: string): Readonly<Record<string, number>> {
  const fields = record(value, path);
  const probabilities: Record<string, number> = {};
  for (const [option, probability] of Object.entries(fields)) {
    if (
      typeof probability !== "number"
      || !Number.isFinite(probability)
      || probability < 0
      || probability > 1
    ) {
      fail(`${path}.${option}`, "expected a probability from 0 to 1");
    }
    probabilities[option] = probability;
  }
  return probabilities;
}

function parseChoiceAnswer(value: unknown, path: string): ChoiceAnswer {
  const fields = record(value, path);
  exactKeys(fields, path, ["choice", "probabilities", "confidence"]);
  const confidence = finiteNumberField(fields, "confidence", path);
  if (confidence < 0 || confidence > 1) {
    fail(`${path}.confidence`, "expected a confidence from 0 to 1");
  }
  return {
    choice: stringField(fields, "choice", path),
    probabilities: parseProbabilities(fields.probabilities, `${path}.probabilities`),
    confidence,
  };
}

function parseResponse(value: unknown, path: string): ProviderResponse {
  const fields = record(value, path);
  const kind = stringField(fields, "kind", path);

  if (kind === "systemone") {
    exactKeys(fields, path, ["kind", "answers"], ["tokens"]);
    const rawAnswers = record(fields.answers, `${path}.answers`);
    const answers: Record<string, ChoiceAnswer> = {};
    for (const [id, answer] of Object.entries(rawAnswers)) {
      answers[id] = parseChoiceAnswer(answer, `${path}.answers.${id}`);
    }
    const tokens = fields.tokens === undefined
      ? undefined
      : parseTokens(fields.tokens, `${path}.tokens`);
    return tokens === undefined
      ? { kind: "systemone", answers }
      : { kind: "systemone", answers, tokens };
  }

  if (kind === "chat") {
    exactKeys(fields, path, ["kind", "text"], ["tokens"]);
    const text = stringField(fields, "text", path);
    const tokens = fields.tokens === undefined
      ? undefined
      : parseTokens(fields.tokens, `${path}.tokens`);
    return tokens === undefined
      ? { kind: "chat", text }
      : { kind: "chat", text, tokens };
  }

  if (kind === "error") {
    exactKeys(fields, path, ["kind", "message"], ["status"]);
    const message = stringField(fields, "message", path);
    if (fields.status === undefined) {
      return { kind: "error", message };
    }
    const status = finiteNumberField(fields, "status", path);
    if (!Number.isInteger(status)) {
      fail(`${path}.status`, "expected an integer");
    }
    return { kind: "error", status, message };
  }

  return fail(`${path}.kind`, `unexpected provider response kind ${JSON.stringify(kind)}`);
}

export function loadTranscript(id: TranscriptId): ProviderResponse {
  const url = new URL(`../fixtures/transcripts/${id}.json`, import.meta.url);
  const source = readFileSync(url, "utf8");
  const parsed: unknown = JSON.parse(source);
  return parseResponse(parsed, id);
}

export function createRecordedProvider(ids: readonly TranscriptId[]): Provider {
  const responses = ids.map(loadTranscript);
  let cursor = 0;
  return {
    async ask() {
      const response = responses[cursor];
      if (response === undefined) {
        throw new Error(`recorded provider exhausted after ${cursor} response(s)`);
      }
      cursor += 1;
      return response;
    },
  };
}

export function createCountingProvider(
  response: ProviderResponse,
): Provider & { readonly calls: () => number } {
  let count = 0;
  return {
    async ask() {
      count += 1;
      return response;
    },
    calls: () => count,
  };
}
