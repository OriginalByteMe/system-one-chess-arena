import { expect, test, type Page } from "@playwright/test";

import { GAME_ID, SEASON_ID } from "./fixture.ts";

const watchPath = `/watch/${encodeURIComponent(SEASON_ID)}/${encodeURIComponent(GAME_ID)}`;
type SoundProbe = { peak: number; frames: number };
type SoundProbeWindow = typeof window & { soundProbe: SoundProbe };

async function openPausedReplay(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(watchPath, { waitUntil: "commit" });
  await expect(page.getByRole("region", { name: "Broadcast board" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Skip to the board" })).toHaveCount(0);

  const pause = page.getByRole("button", { name: "Pause replay", exact: true });
  if (await pause.isVisible()) await pause.click();
}

test("chess sounds are opt-in, stay enabled for a move, and can be muted", async ({ page }) => {
  await page.addInitScript(() => {
    const probe: SoundProbe = { peak: 0, frames: 0 };
    Object.assign(window, { soundProbe: probe });
    const NativeAudioContext = window.AudioContext;
    let context: AudioContext | undefined;
    let analyser: AnalyserNode | undefined;
    const samples = new Float32Array(256);
    window.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        context = this;
        analyser = this.createAnalyser();
        analyser.fftSize = samples.length;
        analyser.connect(this.destination);
        // Measure the native output graph, not calls to mocked audio methods.
        Object.defineProperty(this, "destination", { value: analyser });
      }
    };
    const sample = (): void => {
      probe.frames += 1;
      if (context?.state === "running" && analyser !== undefined) {
        analyser.getFloatTimeDomainData(samples);
        for (const value of samples) probe.peak = Math.max(probe.peak, Math.abs(value));
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "media") mediaRequests.push(request.url());
  });

  await openPausedReplay(page);

  const enable = page.getByRole("button", { name: "Enable chess sounds", exact: true });
  await expect(enable).toBeVisible();
  await expect(enable).toBeEnabled();
  await expect(enable).toHaveAttribute("aria-pressed", "false");
  await expect(enable).toContainText("Sound off");

  await enable.click();
  const mute = page.getByRole("button", { name: "Mute chess sounds", exact: true });
  await expect(mute).toBeVisible();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await expect(mute).toContainText("Sound on");
  expect(await page.evaluate(() => (window as SoundProbeWindow).soundProbe.peak)).toBe(0);

  const board = page.getByRole("region", { name: "Broadcast board" });
  const beforeMove = await board.locator("[data-square]").evaluateAll((squares) =>
    squares.map((square) => square.textContent),
  );
  const nextTurn = page.getByRole("button", { name: "Next turn", exact: true });
  await expect(nextTurn).toBeEnabled();
  await nextTurn.click();
  await expect.poll(() =>
    board.locator("[data-square]").evaluateAll((squares) =>
      squares.map((square) => square.textContent),
    ),
  ).not.toEqual(beforeMove);
  await expect.poll(() => page.evaluate(
    () => (window as SoundProbeWindow).soundProbe.peak,
  )).toBeGreaterThan(0.001);
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  expect(mediaRequests, "synthesized chess sounds must not fetch audio assets").toEqual([]);

  await mute.click();
  await expect(enable).toBeVisible();
  await expect(enable).toHaveAttribute("aria-pressed", "false");
  await expect(enable).toContainText("Sound off");
  const mutedFrame = await page.evaluate(() => {
    const probe = (window as SoundProbeWindow).soundProbe;
    probe.peak = 0;
    return probe.frames;
  });
  await nextTurn.click();
  await expect.poll(() => page.evaluate(
    () => (window as SoundProbeWindow).soundProbe.frames,
  )).toBeGreaterThan(mutedFrame + 6);
  expect(await page.evaluate(() => (window as SoundProbeWindow).soundProbe.peak)).toBe(0);
});

test("the sound control reports an unavailable Web Audio implementation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "webkitAudioContext", {
      configurable: true,
      value: undefined,
    });
  });

  await openPausedReplay(page);

  const enable = page.getByRole("button", { name: "Enable chess sounds", exact: true });
  await expect(enable).toBeVisible();
  await expect(enable).toBeDisabled();
  await expect(enable).toHaveAttribute("aria-pressed", "false");
  await expect(enable).toContainText("Sound off");
});
