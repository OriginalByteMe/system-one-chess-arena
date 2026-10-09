import { expect, test } from "@playwright/test";

// CI's headless Chromium has no real GPU, so this cannot load a model. What it
// can hold is the part that must never break: the page opens, probes the
// device, and reaches a verdict the visitor can act on without a console error.
test("the local lab reaches a verdict about this device without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/local");
  await expect(page.getByRole("heading", { level: 1, name: /own GPU/i })).toBeVisible();

  // Either this browser cannot run a model (no WebGPU, or a software renderer),
  // or it can and offers a download. Both are a settled answer.
  const unsupported = page.getByRole("alert").filter({ hasText: /WebGPU|software renderer/i });
  const offered = page.getByRole("button", { name: /load/i });
  await expect(unsupported.or(offered)).toBeVisible({ timeout: 30_000 });

  expect(errors).toEqual([]);
});

test("the local lab is linked from the masthead and discloses what it fetches", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Running a model on your device" })).toBeVisible();
  await page.getByRole("link", { name: "Run locally" }).first().click();
  await expect(page).toHaveURL(/\/local$/);
});
