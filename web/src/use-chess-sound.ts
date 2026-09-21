import { useCallback, useEffect, useRef, useState } from "react";

export type ChessSound = "move" | "capture" | "check";

export interface ChessSoundControls {
  readonly enabled: boolean;
  readonly available: boolean;
  readonly toggle: () => void;
  readonly error: string | undefined;
}

interface SoundEngine {
  readonly context: AudioContext;
  readonly output: GainNode;
  readonly buffers: Readonly<Record<ChessSound, AudioBuffer>>;
  readonly activeSources: Set<AudioBufferSourceNode>;
}

function createMoveBuffer(context: AudioContext): AudioBuffer {
  const duration = 0.055;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  let noise = 0x41c64e6d;

  for (let index = 0; index < samples.length; index += 1) {
    const time = index / context.sampleRate;
    noise = (Math.imul(noise, 1_103_515_245) + 12_345) | 0;
    const grain = ((noise >>> 16) / 32_768 - 1) * 0.18;
    const wood = Math.sin(2 * Math.PI * 780 * time) * 0.46
      + Math.sin(2 * Math.PI * 1_230 * time) * 0.18;
    samples[index] = (wood + grain) * Math.exp(-time * 78);
  }

  return buffer;
}

function createCaptureBuffer(context: AudioContext): AudioBuffer {
  const duration = 0.085;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  let noise = 0x19660d;

  for (let index = 0; index < samples.length; index += 1) {
    const time = index / context.sampleRate;
    noise = (Math.imul(noise, 1_664_525) + 1_013_904_223) | 0;
    const grain = ((noise >>> 16) / 32_768 - 1) * 0.12;
    const wood = Math.sin(2 * Math.PI * 190 * time) * 0.58
      + Math.sin(2 * Math.PI * 370 * time) * 0.28;
    samples[index] = (wood + grain) * Math.exp(-time * 48);
  }

  return buffer;
}

function createCheckBuffer(context: AudioContext): AudioBuffer {
  const duration = 0.16;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);

  for (let index = 0; index < samples.length; index += 1) {
    const time = index / context.sampleRate;
    const attack = Math.min(1, time / 0.006);
    const tone = Math.sin(2 * Math.PI * 740 * time) * 0.34
      + Math.sin(2 * Math.PI * 1_110 * time) * 0.1;
    samples[index] = tone * attack * Math.exp(-time * 19);
  }

  return buffer;
}

function createSoundEngine(): SoundEngine {
  const context = new AudioContext();
  const output = context.createGain();
  try {
    output.gain.value = 0;
    output.connect(context.destination);
    return {
      context,
      output,
      buffers: {
        move: createMoveBuffer(context),
        capture: createCaptureBuffer(context),
        check: createCheckBuffer(context),
      },
      activeSources: new Set(),
    };
  } catch (reason) {
    output.disconnect();
    if (context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
    throw reason;
  }
}

function stopSources(engine: SoundEngine): void {
  for (const source of engine.activeSources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // A source that ended between iteration and cleanup is already silent.
    }
    source.disconnect();
  }
  engine.activeSources.clear();
}

function releaseEngine(engine: SoundEngine): void {
  stopSources(engine);
  engine.output.disconnect();
  if (engine.context.state !== "closed") {
    void engine.context.close().catch(() => undefined);
  }
}

function errorMessage(prefix: string, reason: unknown): string {
  return reason instanceof Error && reason.message.length > 0
    ? `${prefix}: ${reason.message}`
    : prefix;
}

/**
 * Plays a short synthesized chess sound when the displayed position changes.
 * Audio is created and resumed only from the explicit toggle gesture.
 */
export function useChessSound(
  fen: string | undefined,
  kind: ChessSound,
): ChessSoundControls {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(() => typeof AudioContext !== "undefined");
  const [error, setError] = useState<string | undefined>(undefined);
  const engineRef = useRef<SoundEngine | undefined>(undefined);
  const enabledRef = useRef(false);
  const mountedRef = useRef(false);
  const operationRef = useRef(0);
  const previousFenRef = useRef(fen);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      enabledRef.current = false;
      const engine = engineRef.current;
      engineRef.current = undefined;
      if (engine !== undefined) releaseEngine(engine);
    };
  }, []);

  const toggle = useCallback((): void => {
    const currentEngine = engineRef.current;
    if (enabledRef.current) {
      const operation = operationRef.current + 1;
      operationRef.current = operation;
      enabledRef.current = false;
      setEnabled(false);
      setError(undefined);
      if (currentEngine !== undefined) {
        currentEngine.output.gain.setValueAtTime(0, currentEngine.context.currentTime);
        stopSources(currentEngine);
        if (currentEngine.context.state === "running") {
          void currentEngine.context.suspend().catch((reason: unknown) => {
            if (mountedRef.current && operationRef.current === operation) {
              setError(errorMessage("Chess sounds could not be suspended", reason));
            }
          });
        }
      }
      return;
    }

    if (typeof AudioContext === "undefined") {
      setAvailable(false);
      return;
    }

    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setError(undefined);

    try {
      const engine = currentEngine === undefined || currentEngine.context.state === "closed"
        ? createSoundEngine()
        : currentEngine;
      engineRef.current = engine;
      const ready = engine.context.state === "running"
        ? Promise.resolve()
        : engine.context.resume();
      void ready.then(() => {
        if (!mountedRef.current || operationRef.current !== operation) return;
        engine.output.gain.setValueAtTime(0.5, engine.context.currentTime);
        enabledRef.current = true;
        setEnabled(true);
        setAvailable(true);
      }).catch((reason: unknown) => {
        if (engineRef.current === engine) engineRef.current = undefined;
        releaseEngine(engine);
        if (!mountedRef.current || operationRef.current !== operation) return;
        setEnabled(false);
        setAvailable(false);
        setError(errorMessage("Chess sounds could not start", reason));
      });
    } catch (reason) {
      const engine = engineRef.current;
      engineRef.current = undefined;
      if (engine !== undefined) releaseEngine(engine);
      setEnabled(false);
      setAvailable(false);
      setError(errorMessage("Chess sounds could not start", reason));
    }
  }, []);

  useEffect(() => {
    const previousFen = previousFenRef.current;
    previousFenRef.current = fen;
    if (
      !enabled
      || fen === undefined
      || previousFen === undefined
      || fen === previousFen
    ) {
      return;
    }

    const engine = engineRef.current;
    if (engine === undefined || engine.context.state !== "running") return;

    try {
      const source = engine.context.createBufferSource();
      source.buffer = engine.buffers[kind];
      source.connect(engine.output);
      engine.activeSources.add(source);
      source.onended = () => {
        engine.activeSources.delete(source);
        source.disconnect();
      };
      source.start();
    } catch (reason) {
      setError(errorMessage("Chess sound could not play", reason));
    }
  }, [enabled, fen, kind]);

  return { enabled, available, toggle, error };
}
