// The auto-decider: which on-device model a visitor's machine should start
// with. Pure, so the whole policy is testable without a GPU.
//
// WebGPU does not report VRAM. What it does report is the largest buffer the
// adapter will hand out, whether it is a software renderer, and whether it has
// half-precision shaders. Chrome also reports a capped RAM figure. None of
// that says how fast the GPU is, so a short matmul benchmark (bench.ts) measures
// that. The choice is: the biggest tier that fits the memory signals AND whose
// measured compute can answer in a tolerable time.
//
// The thresholds below are first-pass numbers, derived rather than calibrated
// against a spread of real devices. They live in this one file so tuning them
// is a one-file change, and the page lets the visitor override the choice, and
// steps down on its own if a model fails to load.
import { ContractViolation } from "../../../src/core/errors.ts";

export interface DeviceProbe {
  /** An adapter was granted. False when WebGPU is absent or refused. */
  readonly webgpu: boolean;
  /** A software renderer (e.g. SwiftShader). Works, but far too slow. */
  readonly softwareAdapter: boolean;
  readonly shaderF16: boolean;
  readonly maxBufferBytes: number;
  readonly vendor: string;
  readonly architecture: string;
  /** navigator.deviceMemory, GB. Chromium only, rounded and capped at 8. */
  readonly deviceMemoryGb?: number;
  readonly cores?: number;
  readonly mobile: boolean;
  readonly saveData: boolean;
}

export interface GpuBench {
  /** Sustained f32 tiled-matmul throughput in GFLOPS. */
  readonly gflops: number;
}

export type TierId = "micro" | "small" | "medium" | "large";

export interface LocalTier {
  readonly id: TierId;
  readonly label: string;
  /** WebLLM prebuilt model id when the adapter has shader-f16. */
  readonly modelF16: string;
  /** Same model without f16 shaders: heavier on memory. */
  readonly modelF32: string;
  readonly paramsB: number;
  /** vram_required_MB from WebLLM's prebuiltAppConfig, for each variant. */
  readonly vramMbF16: number;
  readonly vramMbF32: number;
  /** Qwen-family models think before answering unless told not to. */
  readonly thinks: boolean;
}

/**
 * Smallest to largest. Every id is in @mlc-ai/web-llm 0.2.85's
 * prebuiltAppConfig; the vram figures are read from there too. The ceiling is
 * 9B: a 27B model at 4 bits is ~15 GB of weights, beyond what a browser tab can
 * allocate on any current consumer GPU.
 */
export const TIERS: readonly LocalTier[] = [
  {
    id: "micro",
    label: "Llama 3.2 1B",
    modelF16: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    modelF32: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    paramsB: 1.2,
    vramMbF16: 879,
    vramMbF32: 1129,
    thinks: false,
  },
  {
    id: "small",
    label: "Qwen3.5 2B",
    modelF16: "Qwen3.5-2B-q4f16_1-MLC",
    modelF32: "Qwen3.5-2B-q4f32_1-MLC",
    paramsB: 2,
    vramMbF16: 2245,
    vramMbF32: 2592,
    thinks: true,
  },
  {
    id: "medium",
    label: "Qwen3.5 4B",
    modelF16: "Qwen3.5-4B-q4f16_1-MLC",
    modelF32: "Qwen3.5-4B-q4f32_1-MLC",
    paramsB: 4,
    vramMbF16: 3868,
    vramMbF32: 4680,
    thinks: true,
  },
  {
    id: "large",
    label: "Qwen3.5 9B",
    modelF16: "Qwen3.5-9B-q4f16_1-MLC",
    modelF32: "Qwen3.5-9B-q4f32_1-MLC",
    paramsB: 9,
    vramMbF16: 6433,
    vramMbF32: 7545,
    thinks: true,
  },
];

/** Seconds a visitor should wait for one move, at most. */
export const TARGET_SECONDS_PER_MOVE = 10;

/**
 * Tokens one decision reads, and how many model calls it takes. A hierarchical
 * persona asks for a strategy and then a move. Prefill is the cost that
 * matters: each call only generates a single token.
 */
const PROMPT_TOKENS = 500;
const CALLS_PER_MOVE = 2;

/**
 * Benchmark GFLOPS the matmul must show per billion parameters. Prefill is
 * 2 * params * tokens FLOPs per call; dividing by the target time gives the
 * throughput needed, and MLC's kernels are assumed to land at roughly half of
 * what the plain tiled benchmark reaches.
 */
const KERNEL_EFFICIENCY = 0.5;
export const GFLOPS_PER_BILLION_PARAMS: number =
  (2 * PROMPT_TOKENS * CALLS_PER_MOVE) /
  TARGET_SECONDS_PER_MOVE /
  KERNEL_EFFICIENCY;

const MIB = 1024 * 1024;
/** navigator.deviceMemory never reports more than this. */
const DEVICE_MEMORY_CAP_GB = 8;
/** Fraction of the reported largest buffer treated as usable for weights. */
const BUFFER_HEADROOM = 0.75;
/**
 * Chromium reports a 4 GiB buffer limit on most desktop GPUs regardless of how
 * much VRAM they have, so above this the limit says nothing. Beyond it a tier
 * needs the compute benchmark to vouch for the machine.
 */
const REPORTED_BUFFER_CEILING_MB = 4096;

export interface TierChoice {
  readonly tier: LocalTier;
  readonly variant: "f16" | "f32";
  readonly modelId: string;
  readonly vramMb: number;
  /** Why this tier, in the visitor's terms. Shown on the page. */
  readonly reasons: readonly string[];
}

export type Selection =
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "ready"; readonly choice: TierChoice };

export function variantFor(probe: DeviceProbe): "f16" | "f32" {
  return probe.shaderF16 ? "f16" : "f32";
}

export function vramMbFor(tier: LocalTier, variant: "f16" | "f32"): number {
  return variant === "f16" ? tier.vramMbF16 : tier.vramMbF32;
}

export function choiceFor(tier: LocalTier, probe: DeviceProbe, reasons: readonly string[]): TierChoice {
  const variant = variantFor(probe);
  return {
    tier,
    variant,
    modelId: variant === "f16" ? tier.modelF16 : tier.modelF32,
    vramMb: vramMbFor(tier, variant),
    reasons,
  };
}

export function requiredGflops(tier: LocalTier): number {
  return GFLOPS_PER_BILLION_PARAMS * tier.paramsB;
}

/**
 * The model budget in MB that the memory signals allow, plus what produced it.
 * Mobile devices share memory with the OS and the browser tab gets a fraction,
 * so they are held to the lightest models whatever the adapter claims.
 */
export function memoryBudgetMb(probe: DeviceProbe): { readonly mb: number; readonly note: string } {
  const bufferMb = probe.maxBufferBytes / MIB;
  // At the usual 4 GiB the limit says nothing about VRAM, so it does not bind;
  // the benchmark and the step-down on a failed load carry the decision.
  const informative = bufferMb < REPORTED_BUFFER_CEILING_MB;
  let mb = informative ? bufferMb * BUFFER_HEADROOM : Number.POSITIVE_INFINITY;
  let note = informative
    ? `GPU buffer limit ${formatMb(bufferMb)}`
    : "GPU reports the usual 4 GB buffer limit, which does not bound its memory";

  if (probe.mobile) {
    mb = Math.min(mb, 1800);
    note = "mobile device, capped to the lightest models";
  }
  if (probe.deviceMemoryGb !== undefined && probe.deviceMemoryGb < DEVICE_MEMORY_CAP_GB) {
    // Integrated and unified-memory GPUs draw on system RAM. Chromium rounds
    // the figure and reports 8 for anything at or above 8 GB, so 8 says
    // nothing and only the lower values bind.
    const ramCap = probe.deviceMemoryGb * 1024 * 0.4;
    if (ramCap < mb) {
      mb = ramCap;
      note = `${probe.deviceMemoryGb} GB of system memory reported`;
    }
  }
  return { mb, note };
}

/** Whole GFLOPS, except tiny readings, which would otherwise round to 0. */
export function formatGflops(gflops: number): string {
  return gflops < 10 ? gflops.toFixed(1) : String(Math.round(gflops));
}

function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * Picks the largest tier that fits. Without a benchmark (it failed, or has not
 * run) compute is unknown, so the choice stops at "small": unproven machines
 * are not sent a multi-gigabyte download on a guess.
 */
export function chooseTier(probe: DeviceProbe, bench?: GpuBench): Selection {
  if (!probe.webgpu) {
    return {
      kind: "unsupported",
      reason: "This browser has no WebGPU, which on-device models need.",
    };
  }
  if (probe.softwareAdapter) {
    return {
      kind: "unsupported",
      reason: "WebGPU is running on a software renderer, which is too slow for a language model.",
    };
  }

  const memory = memoryBudgetMb(probe);
  const variant = variantFor(probe);
  const unprovenCeiling: TierId = "small";

  // Largest first, so the first tier that clears every gate wins.
  const candidates = [...TIERS].sort((a, b) => b.paramsB - a.paramsB);
  for (const tier of candidates) {
    const vram = vramMbFor(tier, variant);
    if (vram > memory.mb) continue;
    if (bench === undefined && tierIndex(tier.id) > tierIndex(unprovenCeiling)) continue;
    if (bench !== undefined && bench.gflops < requiredGflops(tier)) continue;
    const reasons = [
      `${memory.note}, which fits a ${formatMb(vram)} model`,
      bench === undefined
        ? "GPU speed was not measured, so the choice stays modest"
        : `GPU measured at ${formatGflops(bench.gflops)} GFLOPS, ${Math.round(requiredGflops(tier))} needed`,
    ];
    if (!probe.shaderF16) reasons.push("no half-precision shaders, so the larger 32-bit build is used");
    return { kind: "ready", choice: choiceFor(tier, probe, reasons) };
  }

  // Nothing cleared the gates. The lightest tier is the floor: the visitor
  // asked for a local model, so offer it and be straight about the risk. The
  // load step steps down or fails honestly if even this does not fit.
  const floor = TIERS[0];
  if (floor === undefined) throw new ContractViolation("local.chooseTier", "no tiers defined");
  const reasons = [`${memory.note}; this is the lightest model on offer`];
  if (vramMbFor(floor, variant) > memory.mb) reasons.push("it may not fit in this device's memory");
  if (bench !== undefined && bench.gflops < requiredGflops(floor)) {
    reasons.push(`GPU measured at ${formatGflops(bench.gflops)} GFLOPS, so expect slow moves`);
  }
  return { kind: "ready", choice: choiceFor(floor, probe, reasons) };
}

export function tierIndex(id: TierId): number {
  return TIERS.findIndex((tier) => tier.id === id);
}

/** The next lighter tier by memory, for stepping down after a failed load. */
export function lighterThan(tier: LocalTier, probe: DeviceProbe): LocalTier | undefined {
  const variant = variantFor(probe);
  const own = vramMbFor(tier, variant);
  return [...TIERS]
    .filter((candidate) => vramMbFor(candidate, variant) < own)
    .sort((a, b) => vramMbFor(b, variant) - vramMbFor(a, variant))[0];
}

/**
 * Rough weight download in GB: 4-bit weights are ~0.6 bytes per parameter once
 * the embeddings and scales are counted. An estimate for the button label, not
 * a measurement.
 */
export function approxDownloadGb(tier: LocalTier): number {
  return Math.round(tier.paramsB * 0.6 * 10) / 10;
}
