import { describe, expect, test } from "bun:test";

import {
  GFLOPS_PER_BILLION_PARAMS,
  TIERS,
  chooseTier,
  formatGflops,
  lighterThan,
  requiredGflops,
  type DeviceProbe,
  type Selection,
} from "../src/local/tiers.ts";

const GIB = 1024 ** 3;

const desktop: DeviceProbe = {
  webgpu: true,
  softwareAdapter: false,
  shaderF16: true,
  maxBufferBytes: 4 * GIB,
  vendor: "nvidia",
  architecture: "ampere",
  deviceMemoryGb: 8,
  cores: 16,
  mobile: false,
  saveData: false,
};

function picked(selection: Selection): string {
  if (selection.kind !== "ready") throw new Error(`expected a model, got: ${selection.reason}`);
  return selection.choice.tier.id;
}

describe("chooseTier", () => {
  test("no WebGPU means no local model", () => {
    const result = chooseTier({ ...desktop, webgpu: false });
    expect(result.kind).toBe("unsupported");
  });

  test("a software renderer is refused rather than given a slow model", () => {
    const result = chooseTier({ ...desktop, softwareAdapter: true }, { gflops: 5000 });
    expect(result.kind).toBe("unsupported");
  });

  test("a strong discrete GPU gets the largest tier", () => {
    expect(picked(chooseTier(desktop, { gflops: 6000 }))).toBe("large");
  });

  test("tier falls as measured compute falls", () => {
    const order = [6000, 2500, 1000, 400].map((gflops) => picked(chooseTier(desktop, { gflops })));
    expect(order).toEqual(["large", "medium", "small", "micro"]);
  });

  test("an integrated-class GPU lands on a very small model", () => {
    expect(picked(chooseTier({ ...desktop, vendor: "intel" }, { gflops: 250 }))).toBe("micro");
  });

  test("unmeasured compute never goes above small", () => {
    expect(["micro", "small"]).toContain(picked(chooseTier(desktop)));
  });

  test("a small buffer limit holds back a fast GPU", () => {
    const result = chooseTier({ ...desktop, maxBufferBytes: 1 * GIB }, { gflops: 9000 });
    expect(picked(result)).toBe("micro");
  });

  test("mobile devices are held to the lightest models", () => {
    expect(picked(chooseTier({ ...desktop, mobile: true }, { gflops: 9000 }))).toBe("micro");
  });

  test("low reported system memory caps an otherwise strong machine", () => {
    expect(picked(chooseTier({ ...desktop, deviceMemoryGb: 2 }, { gflops: 9000 }))).toBe("micro");
  });

  test("8 GB is Chromium's ceiling, not a measurement, so it does not hold a strong machine back", () => {
    expect(picked(chooseTier({ ...desktop, deviceMemoryGb: 8 }, { gflops: 6000 }))).toBe("large");
  });

  test("without shader-f16 the heavier 32-bit build is chosen and sized", () => {
    const result = chooseTier({ ...desktop, shaderF16: false }, { gflops: 3000 });
    if (result.kind !== "ready") throw new Error("expected a model");
    expect(result.choice.variant).toBe("f32");
    expect(result.choice.modelId).toBe(result.choice.tier.modelF32);
    expect(result.choice.vramMb).toBe(result.choice.tier.vramMbF32);
  });

  test("an unfittable device still gets the lightest model, with a warning", () => {
    const result = chooseTier({ ...desktop, maxBufferBytes: 256 * 1024 * 1024 }, { gflops: 9000 });
    if (result.kind !== "ready") throw new Error("expected a model");
    expect(result.choice.tier.id).toBe("micro");
    expect(result.choice.reasons.join(" ")).toContain("may not fit");
  });

  test("a slow GPU with plenty of memory is told to expect slow moves, not a memory problem", () => {
    const result = chooseTier(desktop, { gflops: 40 });
    if (result.kind !== "ready") throw new Error("expected a model");
    const text = result.choice.reasons.join(" ");
    expect(text).toContain("slow moves");
    expect(text).not.toContain("may not fit");
  });
});

describe("tier table", () => {
  test("required compute grows with model size", () => {
    expect(GFLOPS_PER_BILLION_PARAMS).toBeGreaterThan(0);
    const sized = [...TIERS].sort((a, b) => a.paramsB - b.paramsB).map(requiredGflops);
    expect(sized).toEqual([...sized].sort((a, b) => a - b));
  });

  test("every tier names distinct f16 and f32 builds, and f32 needs more memory", () => {
    for (const tier of TIERS) {
      expect(tier.modelF16).not.toBe(tier.modelF32);
      expect(tier.vramMbF32).toBeGreaterThan(tier.vramMbF16);
    }
  });

  test("stepping down walks to ever lighter models and ends", () => {
    let tier = TIERS.find((candidate) => candidate.id === "large");
    const seen: number[] = [];
    while (tier !== undefined) {
      seen.push(tier.vramMbF16);
      tier = lighterThan(tier, desktop);
    }
    expect(seen.length).toBe(TIERS.length);
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
  });
});

describe("formatGflops", () => {
  test("tiny readings keep a decimal instead of rounding to zero", () => {
    expect(formatGflops(0.49)).toBe("0.5");
    expect(formatGflops(1234.6)).toBe("1235");
  });
});
