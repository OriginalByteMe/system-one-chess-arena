// A half-second GPU benchmark. A language model's prefill is matrix multiply
// bound, so sustained matmul throughput says what the adapter name and the
// buffer limits cannot: whether this is an integrated chip or a discrete card.
import type { GpuBench } from "./tiers.ts";

const N = 1024;
const TILE = 16;
const FLOPS_PER_RUN = 2 * N * N * N;
const WARMUP_RUNS = 2;
const TIMED_RUNS = 6;

const SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> c: array<f32>;

var<workgroup> tileA: array<f32, ${TILE * TILE}>;
var<workgroup> tileB: array<f32, ${TILE * TILE}>;

@compute @workgroup_size(${TILE}, ${TILE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>,
        @builtin(local_invocation_id) lid: vec3<u32>) {
  let n = ${N}u;
  var acc = 0.0;
  for (var t = 0u; t < n / ${TILE}u; t = t + 1u) {
    tileA[lid.y * ${TILE}u + lid.x] = a[gid.y * n + t * ${TILE}u + lid.x];
    tileB[lid.y * ${TILE}u + lid.x] = b[(t * ${TILE}u + lid.y) * n + gid.x];
    workgroupBarrier();
    for (var k = 0u; k < ${TILE}u; k = k + 1u) {
      acc = fma(tileA[lid.y * ${TILE}u + k], tileB[k * ${TILE}u + lid.x], acc);
    }
    workgroupBarrier();
  }
  c[gid.y * n + gid.x] = acc;
}
`;

function filled(device: GPUDevice, value: number): GPUBuffer {
  const buffer = device.createBuffer({
    size: N * N * 4,
    usage: GPUBufferUsage.STORAGE,
    mappedAtCreation: true,
  });
  new Float32Array(buffer.getMappedRange()).fill(value);
  buffer.unmap();
  return buffer;
}

/** Undefined when the benchmark cannot run; the caller then stays modest. */
export async function benchmarkGpu(adapter: GPUAdapter): Promise<GpuBench | undefined> {
  let device: GPUDevice | undefined;
  try {
    device = await adapter.requestDevice();
    const a = filled(device, 0.001);
    const b = filled(device, 0.002);
    const c = device.createBuffer({ size: N * N * 4, usage: GPUBufferUsage.STORAGE });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: device.createShaderModule({ code: SHADER }), entryPoint: "main" },
    });
    const bindings = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [a, b, c].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });

    const run = async (count: number): Promise<number> => {
      const encoder = device!.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindings);
      for (let index = 0; index < count; index += 1) {
        pass.dispatchWorkgroups(N / TILE, N / TILE);
      }
      pass.end();
      const started = performance.now();
      device!.queue.submit([encoder.finish()]);
      await device!.queue.onSubmittedWorkDone();
      return performance.now() - started;
    };

    await run(WARMUP_RUNS);
    const ms = await run(TIMED_RUNS);
    if (!(ms > 0)) return undefined;
    return { gflops: (FLOPS_PER_RUN * TIMED_RUNS) / (ms / 1000) / 1e9 };
  } catch {
    return undefined;
  } finally {
    device?.destroy();
  }
}
