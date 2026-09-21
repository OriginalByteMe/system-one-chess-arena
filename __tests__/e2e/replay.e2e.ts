import { expect, test, type Page } from "@playwright/test";
import type { RevealedGame } from "../../src/core/types.ts";

import { FIRST_PLY, GAME_ID, MOVE_COUNT, SEASON_ID } from "./fixture.ts";

const watchPath = `/watch/${encodeURIComponent(SEASON_ID)}/${encodeURIComponent(GAME_ID)}`;

async function openReplay(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto(watchPath, { waitUntil: "commit" });
  await expect(page.getByRole("region", { name: "Broadcast board" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Skip to the board" })).toHaveCount(0);
  const pause = page.getByRole("button", { name: "Pause replay" });
  const replaying = await pause.isVisible();
  if (replaying) await pause.click();
  // Pause app playback before advancing the clock, and let the entrance's
  // animation finish naturally rather than freezing its dismissal.
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1_000)));
  if (replaying) await page.getByRole("button", { name: "Play replay", exact: true }).press("Enter");
}

test("archived replay plays from its first move and reveals the winner only after checkmate", async ({ page }) => {
  await openReplay(page);
  const board = page.getByRole("region", { name: "Broadcast board" });
  const result = page.getByRole("button", { name: "Back to the board" });
  await expect(board).toContainText(`Examining ply ${FIRST_PLY}`);
  await expect(result).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause replay" })).toBeEnabled();

  for (let index = 1; index < MOVE_COUNT; index += 1) {
    await page.clock.runFor(2_000);
    await expect(board).toContainText(`Examining ply ${FIRST_PLY + index}`);
    await expect(result).toHaveCount(0);
  }
  // The final decision is still being examined. Its move must land before
  // the result appears, including the queen's actual final square.
  await expect(board.locator('[data-square="h5"]')).toHaveText(/[♕♛]/);
  await page.clock.runFor(2_000);
  await expect(result).toBeVisible();
  await result.press("Enter");
  await page.clock.runFor(100);
  await expect(board.locator('[data-square="f7"]')).toHaveText(/[♕♛]/);
  await expect(board.locator('[data-square="h5"]')).toBeEmpty();
  await expect(page.getByRole("button", { name: "Play replay" })).toBeDisabled();
  await page.getByRole("button", { name: "Previous turn", exact: true }).press("Enter");
  await expect(board.locator('[data-square="h5"]')).toHaveText(/[♕♛]/);
  await page.getByRole("button", { name: "Next turn", exact: true }).press("Enter");
  await expect(board.locator('[data-square="f7"]')).toHaveText(/[♕♛]/);

  await page.getByRole("button", { name: "Restart replay" }).press("Enter");
  await expect(board).toContainText(`Examining ply ${FIRST_PLY}`);
  await expect(board.locator('[data-square="d1"]')).toHaveText(/[♕♛]/);
  await expect(result).toHaveCount(0);
  await page.clock.runFor(2_000);
  await expect(board).toContainText(`Examining ply ${FIRST_PLY + 1}`);
});

test("pause, manual navigation and raw decisions stay on the chosen turn", async ({ page }) => {
  await openReplay(page);
  const board = page.getByRole("region", { name: "Broadcast board" });
  await page.getByRole("button", { name: "Pause replay" }).press("Enter");
  await page.clock.runFor(10_000);
  await expect(board).toContainText(`Examining ply ${FIRST_PLY}`);

  await page.getByRole("button", { name: "Next turn", exact: true }).press("Enter");
  await expect(board).toContainText(`Examining ply ${FIRST_PLY + 1}`);
  await page.getByRole("button", { name: "Raw JSON", exact: true }).press("Enter");
  const raw = JSON.parse(await page.locator("pre[aria-label]").innerText()) as { ply: number; move: string };
  expect(raw.ply).toBe(FIRST_PLY + 1);
  expect(raw.move).toBe("e7e5");
  await page.getByRole("button", { name: "Previous turn", exact: true }).press("Enter");
  await expect(board).toContainText(`Examining ply ${FIRST_PLY}`);
  await expect(page.getByRole("button", { name: "Previous turn", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Play replay", exact: true }).press("Enter");
  await page.clock.runFor(2_000);
  await expect(board).toContainText(`Examining ply ${FIRST_PLY + 1}`);
  await page.getByRole("button", { name: "Next turn", exact: true }).press("Enter");
  await page.clock.runFor(10_000);
  await expect(board).toContainText(`Examining ply ${FIRST_PLY + 2}`);
  await expect(page.getByRole("button", { name: "Play replay", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Back to the board" })).toHaveCount(0);
});

test("an on-air broadcast finishing stays at the live edge instead of restarting", async ({ page, request }) => {
  const endpoint = `/api/seasons/${encodeURIComponent(SEASON_ID)}/games/${encodeURIComponent(GAME_ID)}`;
  const response = await request.get(endpoint);
  expect(response.ok()).toBe(true);
  const recorded = await response.json() as RevealedGame;
  const { outcome: _outcome, ...withoutOutcome } = recorded;
  const onAir = {
    ...withoutOutcome,
    decisions: recorded.decisions.slice(0, 3),
    fen: recorded.decisions[3]!.fen,
    window: { ...recorded.window, status: "on-air" },
  };
  let finished = false;
  // Control this boundary without waiting on wall-clock publication times;
  // the archive and every other request still come from the seeded real API.
  await page.route(`**${endpoint}`, (route) => route.fulfill({
    status: 200,
    headers: { "cache-control": "no-store" },
    json: finished ? recorded : onAir,
  }));
  await openReplay(page);
  const board = page.getByRole("region", { name: "Broadcast board" });
  await expect(board).toContainText(`Examining ply ${FIRST_PLY + 2}`);
  await expect(page.getByRole("group", { name: "Replay playback" })).toHaveCount(0);
  finished = true;
  await page.clock.runFor(1_000);
  await expect(page.getByRole("button", { name: "Back to the board" })).toBeVisible();
  await expect(board).toContainText(`Examining ply ${FIRST_PLY + MOVE_COUNT - 1}`);
  await expect(board.locator('[data-square="f7"]')).toHaveText(/[♕♛]/);
  await expect(page.getByRole("group", { name: "Replay playback" })).toHaveCount(0);
});
