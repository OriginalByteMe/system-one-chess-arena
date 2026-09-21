import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  PREPARED_FIRST_PLY,
  PREPARED_GAME_ID,
  SEASON_ID,
} from "./fixture.ts";

const watchPath = `/watch/${encodeURIComponent(SEASON_ID)}/${encodeURIComponent(PREPARED_GAME_ID)}`;

async function openPausedReplay(page: Page): Promise<Locator> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto(watchPath, { waitUntil: "commit" });

  const board = page.getByRole("region", { name: "Broadcast board" });
  await expect(board).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Skip to the board" })).toHaveCount(0);
  await page.getByRole("button", { name: "Pause replay" }).press("Enter");
  return board;
}

async function expectBookFrameHasNoDecision(page: Page, board: Locator): Promise<void> {
  const inspector = page.locator('section[aria-labelledby="turn-record-heading"]');
  await expect(board).toContainText(/Book opening.*Italian Game/i);
  await expect(inspector.getByText("No revealed decision is selected yet.")).toBeVisible();
  await expect(inspector.locator('[aria-label^="Stored DecisionRecord for ply"]')).toHaveCount(0);
  await expect(page.getByText(/Each arrow is a move .* weighed here/i)).toHaveCount(0);
}

test("prepared replay starts normally, plays the book without AI stats, and hands off to the first decision", async ({
  page,
}) => {
  const board = await openPausedReplay(page);
  const next = page.getByRole("button", { name: "Next turn", exact: true });

  // The archived game's first recorded FEN is already six book plies in, but
  // replay begins from a real normal board rather than teleporting there.
  await expect(board.locator('[data-square="e2"]')).toHaveText(/[♙♟]/);
  await expect(board.locator('[data-square="e4"]')).toBeEmpty();
  await expect(board.locator('[data-square="g1"]')).toHaveText(/[♘♞]/);
  await expectBookFrameHasNoDecision(page, board);
  const whiteOpening = page.getByRole("complementary", { name: "Architect opening" });
  const blackOpening = page.getByRole("complementary", { name: "Mason opening" });
  await expect(whiteOpening).toBeVisible();
  await expect(blackOpening).toBeVisible();
  await expect(whiteOpening.getByRole("listitem")).toHaveText(["1.e4", "2.Nf3", "3.Bc4"]);
  await expect(blackOpening.getByRole("listitem")).toHaveText(["1.e5", "2.Nc6", "3.Bc5"]);
  await page.clock.runFor(4_000);
  await expect(whiteOpening).toBeVisible();
  await expect(blackOpening).toBeVisible();
  await expect(board).toContainText("not chosen by Jev");

  await next.press("Enter");
  await expect(board.locator('[data-square="e2"]')).toBeEmpty();
  await expect(board.locator('[data-square="e4"]')).toHaveText(/[♙♟]/);
  await expectBookFrameHasNoDecision(page, board);
  await expect(whiteOpening.locator('[aria-current="step"]')).toHaveAttribute("aria-label", "e4, played");
  await expect(blackOpening.locator('[aria-current="step"]')).toHaveCount(0);

  // Reach the last book-only frame: e4 e5 Nf3 Nc6 Bc4. These positions must
  // remain presentation history, never fabricated DecisionRecords.
  for (let move = 1; move < 5; move += 1) {
    await next.press("Enter");
  }
  await expect(board.locator('[data-square="c4"]')).toHaveText(/[♗♝]/);
  await expect(board.locator('[data-square="f8"]')).toHaveText(/[♗♝]/);
  await expectBookFrameHasNoDecision(page, board);
  await expect(whiteOpening).toBeVisible();
  await expect(blackOpening).toBeVisible();

  // Bc5 completes the prepared line and enters frame zero of the real saved
  // decisions. The board and inspector now come from the seeded API record.
  await next.press("Enter");
  await expect(board.locator('[data-square="c5"]')).toHaveText(/[♗♝]/);
  await expect(board).toContainText(`Examining ply ${PREPARED_FIRST_PLY}`);
  await expect(whiteOpening).toHaveCount(0);
  await expect(blackOpening).toHaveCount(0);
  const inspector = page.locator('section[aria-labelledby="turn-record-heading"]');
  await expect(
    inspector.getByText(
      new RegExp(`Ply ${PREPARED_FIRST_PLY}.*Architect playing white`, "i"),
    ),
  ).toBeVisible();
  await expect(inspector.getByRole("definition").filter({ hasText: /^72%$/ })).toBeVisible();

  await page.getByRole("button", { name: "Restart replay" }).press("Enter");
  await expect(board.locator('[data-square="e2"]')).toHaveText(/[♙♟]/);
  await expect(board.locator('[data-square="e4"]')).toBeEmpty();
  await expect(board.locator('[data-square="g1"]')).toHaveText(/[♘♞]/);
  await expectBookFrameHasNoDecision(page, board);
  await expect(whiteOpening).toBeVisible();
  await expect(blackOpening).toBeVisible();
});
