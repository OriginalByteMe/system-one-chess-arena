// Reads what the browser will say about the machine. Browser-only; the policy
// that interprets it is tiers.ts. Nothing here leaves the page: the probe is
// never sent to the server.
import type { DeviceProbe } from "./tiers.ts";

interface NavigatorExtras {
  readonly deviceMemory?: number;
  readonly hardwareConcurrency?: number;
  readonly userAgentData?: { readonly mobile?: boolean };
  readonly connection?: { readonly saveData?: boolean };
  readonly userAgent: string;
}

const ABSENT: DeviceProbe = {
  webgpu: false,
  softwareAdapter: false,
  shaderF16: false,
  maxBufferBytes: 0,
  vendor: "",
  architecture: "",
  mobile: false,
  saveData: false,
};

export interface ProbeResult {
  readonly probe: DeviceProbe;
  /** Held so the benchmark can reuse the same adapter. */
  readonly adapter?: GPUAdapter;
}

export async function probeDevice(): Promise<ProbeResult> {
  const nav = navigator as Navigator & NavigatorExtras;
  const mobile =
    nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  const base: DeviceProbe = {
    ...ABSENT,
    mobile,
    saveData: nav.connection?.saveData === true,
    ...(nav.deviceMemory === undefined ? {} : { deviceMemoryGb: nav.deviceMemory }),
    ...(nav.hardwareConcurrency === undefined ? {} : { cores: nav.hardwareConcurrency }),
  };

  if (!("gpu" in navigator)) return { probe: base };

  let adapter: GPUAdapter | null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch {
    return { probe: base };
  }
  if (adapter === null) return { probe: base };

  // adapter.info is current; requestAdapterInfo() was the older spelling.
  const info: Partial<GPUAdapterInfo> = adapter.info ?? {};
  // Before `info.isFallbackAdapter` the flag sat on the adapter itself.
  const legacyFallback: unknown = Reflect.get(adapter, "isFallbackAdapter");
  return {
    adapter,
    probe: {
      ...base,
      webgpu: true,
      softwareAdapter: info.isFallbackAdapter === true || legacyFallback === true,
      shaderF16: adapter.features.has("shader-f16"),
      maxBufferBytes: adapter.limits.maxBufferSize,
      vendor: info.vendor ?? "",
      architecture: info.architecture ?? "",
    },
  };
}
