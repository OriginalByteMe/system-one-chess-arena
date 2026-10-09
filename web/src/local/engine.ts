// The WebLLM side of the seam: loads a tier's model into a worker and answers
// `Asker` calls with real token logprobs. Everything WebLLM is imported lazily,
// so visitors who never open the lab never download its code.
import type { MLCEngineInterface } from "@mlc-ai/web-llm";

import type { Asker } from "./decide.ts";
import { TOP_LOGPROBS, type Chat, type TopLogprob } from "./prompt.ts";
import { choiceFor, lighterThan, type DeviceProbe, type LocalTier, type TierChoice } from "./tiers.ts";

export interface LoadProgress {
  /** 0..1 */
  readonly fraction: number;
  readonly text: string;
}

export interface LoadedEngine extends Asker {
  readonly choice: TierChoice;
  dispose(): Promise<void>;
}

export interface LoadHooks {
  readonly onProgress: (progress: LoadProgress) => void;
  /** A tier failed to load and a lighter one is being tried instead. */
  readonly onStepDown: (failed: TierChoice, reason: string, next: TierChoice) => void;
}

/**
 * What a failed load means in the visitor's terms. WebLLM and the browser
 * surface these as bare strings ("Failed to fetch", "Out of memory"); the page
 * should say what to do about them.
 */
export function explainLoadError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed|net::/i.test(text)) {
    return "the browser could not download the model files from Hugging Face or GitHub. Check that you are online and that neither is blocked on your network.";
  }
  if (/out of memory|oom|device (was )?lost|allocation|exceeds the (max|limit)|maxbuffersize|maxstoragebuffer/i.test(text)) {
    return "the GPU ran out of memory for this model.";
  }
  if (/quota|storage/i.test(text)) {
    return "the browser has no room left to cache the model. Free some storage and try again.";
  }
  return text;
}

async function loadOne(choice: TierChoice, onProgress: LoadHooks["onProgress"]): Promise<LoadedEngine> {
  const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let engine: MLCEngineInterface;
  try {
    engine = await CreateWebWorkerMLCEngine(worker, choice.modelId, {
      initProgressCallback: (report) => onProgress({ fraction: report.progress, text: report.text }),
    });
  } catch (error) {
    worker.terminate();
    throw error;
  }

  let queue: Promise<unknown> = Promise.resolve();
  return {
    choice,
    topTokens(messages: readonly Chat[]): Promise<readonly TopLogprob[]> {
      // One generation at a time: the engine holds a single KV cache.
      const run = queue.then(async () => {
        const reply = await engine.chat.completions.create({
          messages: messages.map((message) => ({ role: message.role, content: message.content })),
          max_tokens: 1,
          temperature: 0,
          logprobs: true,
          top_logprobs: TOP_LOGPROBS,
          // Qwen3.x opens with a reasoning block unless it is closed up front;
          // a one-token answer would be spent on "<think>".
          ...(choice.tier.thinks ? { extra_body: { enable_thinking: false } } : {}),
        });
        const first = reply.choices[0]?.logprobs?.content?.[0];
        if (first === undefined) throw new Error("the model returned no token probabilities");
        return first.top_logprobs.map((entry) => ({ token: entry.token, logprob: entry.logprob }));
      });
      queue = run.catch(() => undefined);
      return run;
    },
    async dispose(): Promise<void> {
      await engine.unload();
      worker.terminate();
    },
  };
}

/**
 * Loads the chosen tier. If it will not load (out of memory, device lost,
 * download blocked), steps down to the next lighter tier and says so, until one
 * loads or the lightest has failed. The probe cannot see VRAM, so a failed
 * load is the only certain signal that a model is too big.
 */
export async function loadEngine(
  start: TierChoice,
  probe: DeviceProbe,
  hooks: LoadHooks,
): Promise<LoadedEngine> {
  let choice = start;
  for (;;) {
    try {
      return await loadOne(choice, hooks.onProgress);
    } catch (error) {
      const lighter: LocalTier | undefined = lighterThan(choice.tier, probe);
      if (lighter === undefined) throw error;
      const next = choiceFor(lighter, probe, [`stepped down from ${choice.tier.label}`]);
      hooks.onStepDown(choice, explainLoadError(error), next);
      choice = next;
    }
  }
}

/** Whether this model's weights are already cached, so loading is quick. */
export async function isCached(modelId: string): Promise<boolean> {
  const { hasModelInCache } = await import("@mlc-ai/web-llm");
  return hasModelInCache(modelId);
}

/** Deletes a model's cached weights from this browser. */
export async function forgetModel(modelId: string): Promise<void> {
  const { deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
  await deleteModelAllInfoInCache(modelId);
}
