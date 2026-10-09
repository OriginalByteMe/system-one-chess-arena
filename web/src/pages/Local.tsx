// `/local`: run a persona's brief on a model that lives in this browser tab.
//
// The league's games are recorded on the server so everyone watches the same
// ones. This page is the opposite on purpose: the model runs on the visitor's
// own GPU, nothing it decides is recorded or rated, and nothing leaves the page.
// What the page measures is the device, so it can pick a model that device can
// actually run.
import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import { benchmarkGpu } from "../local/bench.ts";
import {
  explainLoadError,
  forgetModel,
  isCached,
  loadEngine,
  type LoadedEngine,
  type LoadProgress,
} from "../local/engine.ts";
import { probeDevice } from "../local/probe.ts";
import {
  TIERS,
  approxDownloadGb,
  chooseTier,
  choiceFor,
  formatGflops,
  type DeviceProbe,
  type GpuBench,
  type TierChoice,
  type TierId,
} from "../local/tiers.ts";
import { Card, CardHead } from "../ui/chrome.tsx";
import { Footer } from "./home/Footer.tsx";
import { TopNav } from "./home/TopNav.tsx";
import { LabBoard } from "./local/LabBoard.tsx";

type Phase =
  | { readonly kind: "measuring" }
  | { readonly kind: "unsupported"; readonly reason: string }
  | {
      readonly kind: "ready";
      readonly probe: DeviceProbe;
      readonly bench: GpuBench | undefined;
      readonly auto: TierChoice;
    }
  | { readonly kind: "loading"; readonly probe: DeviceProbe; readonly bench: GpuBench | undefined }
  | { readonly kind: "loaded"; readonly engine: LoadedEngine; readonly probe: DeviceProbe };

function gb(mb: number): string {
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function Local(): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: "measuring" });
  const [chosen, setChosen] = useState<TierId | undefined>(undefined);
  const [progress, setProgress] = useState<LoadProgress>({ fraction: 0, text: "" });
  const [notes, setNotes] = useState<readonly string[]>([]);
  const [cached, setCached] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  // What the probe found, kept so a failed load can return to the choice.
  const device = useRef<Extract<Phase, { kind: "ready" }> | undefined>(undefined);
  const engineRef = useRef<LoadedEngine | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { probe, adapter } = await probeDevice();
      const bench = adapter !== undefined && !probe.softwareAdapter ? await benchmarkGpu(adapter) : undefined;
      if (!live) return;
      const selection = chooseTier(probe, bench);
      if (selection.kind === "unsupported") {
        setPhase({ kind: "unsupported", reason: selection.reason });
        return;
      }
      const ready: Extract<Phase, { kind: "ready" }> = { kind: "ready", probe, bench, auto: selection.choice };
      device.current = ready;
      setPhase(ready);
    })();
    return () => {
      live = false;
    };
  }, []);

  // Free the GPU when the visitor leaves the page.
  useEffect(() => {
    return () => {
      void engineRef.current?.dispose();
    };
  }, []);

  const current: TierChoice | undefined =
    phase.kind === "ready"
      ? (() => {
          const override = TIERS.find((tier) => tier.id === chosen);
          return override === undefined ? phase.auto : choiceFor(override, phase.probe, ["chosen by you"]);
        })()
      : undefined;

  useEffect(() => {
    let live = true;
    if (current === undefined) return;
    void isCached(current.modelId).then((has) => {
      if (live) setCached(has);
    });
    return () => {
      live = false;
    };
  }, [current?.modelId]);

  const load = useCallback(
    async (choice: TierChoice, probe: DeviceProbe, bench: GpuBench | undefined): Promise<void> => {
      setPhase({ kind: "loading", probe, bench });
      setProblem(undefined);
      setNotes([]);
      setProgress({ fraction: 0, text: "Starting" });
      try {
        const engine = await loadEngine(choice, probe, {
          onProgress: setProgress,
          onStepDown: (failed, reason, next) =>
            setNotes((previous) => [
              ...previous,
              `${failed.tier.label} would not load (${reason}). Trying ${next.tier.label}.`,
            ]),
        });
        engineRef.current = engine;
        setPhase({ kind: "loaded", engine, probe });
      } catch (error) {
        setProblem(`No model could be loaded on this device: ${explainLoadError(error)}`);
        if (device.current !== undefined) setPhase(device.current);
      }
    },
    [],
  );

  return (
    <div className="flex min-h-full w-full flex-col bg-void font-sans text-chalk">
      <TopNav />
      <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <header className="flex max-w-[72ch] flex-col gap-3">
          <h1 className="font-display text-[clamp(1.9rem,4vw,2.6rem)] leading-tight font-extrabold tracking-[-0.02em]">
            Run a persona on your own GPU
          </h1>
          <p className="text-[15px] leading-relaxed text-mist">
            Every league game is decided by Jev on a server. Here a small open model runs inside this tab instead,
            reading a persona's brief and answering with the probabilities it assigns to each legal move. It is
            far weaker than Jev at chess, and the lab says so rather than hiding it. Nothing you play here is
            recorded, rated or sent to the arena.
          </p>
        </header>

        {phase.kind === "loaded" ? (
          <LabBoard asker={phase.engine} tierLabel={phase.engine.choice.tier.label} />
        ) : (
          <Card>
            <CardHead title="This device" />
            {phase.kind === "measuring" ? (
              <p role="status" className="text-[15px] text-mist">
                Checking for WebGPU and timing your graphics chip. This takes a moment and stays on this page.
              </p>
            ) : phase.kind === "unsupported" ? (
              <p role="alert" className="text-[15px] leading-relaxed text-mist">
                {phase.reason} The league itself still works: it never needed your hardware.
              </p>
            ) : phase.kind === "loading" ? (
              <div className="flex flex-col gap-3">
                <p className="text-[15px] text-mist">Loading the model onto your GPU.</p>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress.fraction * 100)}
                  aria-label="Model load progress"
                  className="h-2 overflow-hidden rounded-full bg-deck"
                >
                  <div className="h-full rounded-full bg-brand" style={{ width: `${progress.fraction * 100}%` }} />
                </div>
                <p role="status" className="text-xs text-mist">
                  {progress.text}
                </p>
                {notes.map((note) => (
                  <p key={note} className="text-sm text-chalk">
                    {note}
                  </p>
                ))}
              </div>
            ) : current === undefined ? null : (
              <Ready
                phase={phase}
                current={current}
                cached={cached}
                problem={problem}
                onChoose={setChosen}
                onLoad={() => void load(current, phase.probe, phase.bench)}
                onForget={() => void forgetModel(current.modelId).then(() => setCached(false))}
              />
            )}
          </Card>
        )}
      </main>
      <Footer />
    </div>
  );
}

function Ready({
  phase,
  current,
  cached,
  problem,
  onChoose,
  onLoad,
  onForget,
}: {
  readonly phase: Extract<Phase, { kind: "ready" }>;
  readonly current: TierChoice;
  readonly cached: boolean;
  readonly problem: string | undefined;
  readonly onChoose: (id: TierId) => void;
  readonly onLoad: () => void;
  readonly onForget: () => void;
}): JSX.Element {
  const { probe, bench } = phase;
  return (
    <div className="flex flex-col gap-5">
      {problem === undefined ? null : (
        <p role="alert" className="rounded-lg border border-live px-3 py-2 text-sm leading-relaxed text-chalk">
          {problem}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <Spec label="GPU" value={[probe.vendor, probe.architecture].filter((part) => part !== "").join(" ") || "unnamed"} />
        <Spec label="Measured speed" value={bench === undefined ? "not measured" : `${formatGflops(bench.gflops)} GFLOPS`} />
        <Spec label="Largest GPU buffer" value={gb(probe.maxBufferBytes / (1024 * 1024))} />
        <Spec label="Half-precision shaders" value={probe.shaderF16 ? "yes" : "no"} />
      </dl>

      <div className="flex flex-col gap-2">
        <label htmlFor="tier" className="text-sm font-semibold text-chalk">
          Model
        </label>
        <select
          id="tier"
          value={current.tier.id}
          onChange={(event) => {
            const picked = TIERS.find((tier) => tier.id === event.target.value);
            if (picked !== undefined) onChoose(picked.id);
          }}
          className="min-h-11 max-w-[28rem] rounded-lg border border-rail bg-deck px-3 text-chalk"
        >
          {TIERS.map((tier) => (
            <option key={tier.id} value={tier.id}>
              {tier.label}
              {tier.id === phase.auto.tier.id ? " (recommended)" : ""}
            </option>
          ))}
        </select>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-mist">
          {current.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onLoad}
            className="min-h-11 rounded-lg bg-brand px-5 text-sm font-bold text-void transition-colors hover:bg-brand-hi"
          >
            {cached ? `Load ${current.tier.label}` : `Download and load ${current.tier.label}`}
          </button>
          {cached ? (
            <button
              type="button"
              onClick={onForget}
              className="min-h-11 rounded-lg border border-rail px-4 text-sm font-semibold text-chalk transition-colors hover:border-mist hover:bg-deck"
            >
              Remove from this browser
            </button>
          ) : null}
        </div>
        <p className="max-w-[72ch] text-xs leading-relaxed text-mist">
          {cached
            ? "Already downloaded to this browser, so loading is quick."
            : `About ${approxDownloadGb(current.tier)} GB to download, once. It is fetched from Hugging Face and
              GitHub by your browser and kept in its cache, and needs about ${gb(current.vramMb)} of GPU memory.`}
        </p>
      </div>
    </div>
  );
}

function Spec({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-mist">{label}</dt>
      <dd className="truncate font-semibold text-chalk">{value}</dd>
    </div>
  );
}
