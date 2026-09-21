import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  BLACK,
  BRACKET_ID,
  GAME_ID,
  SEASON_ID,
  WHITE,
} from "./fixture.ts";

const REPLAY_HREF = `/watch/${encodeURIComponent(SEASON_ID)}/${encodeURIComponent(GAME_ID)}`;

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

async function expectSquareBoard(board: Locator): Promise<void> {
  await expect(board).toBeVisible();
  const squares = board.locator(":scope > div");
  await expect(squares).toHaveCount(64);

  const geometry = await squares.evaluateAll((elements) => {
    const boxes = elements.map((element) => element.getBoundingClientRect());
    const widths = boxes.map((box) => box.width);
    const heights = boxes.map((box) => box.height);

    return {
      widthSpread: Math.max(...widths) - Math.min(...widths),
      heightSpread: Math.max(...heights) - Math.min(...heights),
      largestAspectDifference: Math.max(
        ...boxes.map((box) => Math.abs(box.width - box.height)),
      ),
    };
  });

  expect(geometry.widthSpread).toBeLessThanOrEqual(0.5);
  expect(geometry.heightSpread).toBeLessThanOrEqual(0.5);
  expect(geometry.largestAspectDifference).toBeLessThanOrEqual(0.5);
}

async function expectMatchCardsDoNotOverlap(bracket: Locator): Promise<void> {
  const cards = bracket.locator('article[aria-label^="Match "]');
  await expect(cards).toHaveCount(7);

  const overlaps = await cards.evaluateAll((elements) => {
    const cardsWithBounds = elements.map((element) => ({
      label: element.getAttribute("aria-label") ?? "unlabelled match",
      bounds: element.getBoundingClientRect(),
    }));
    const collisions: string[] = [];

    for (let left = 0; left < cardsWithBounds.length; left += 1) {
      const first = cardsWithBounds[left];
      if (first === undefined) continue;
      for (let right = left + 1; right < cardsWithBounds.length; right += 1) {
        const second = cardsWithBounds[right];
        if (second === undefined) continue;
        const overlapWidth =
          Math.min(first.bounds.right, second.bounds.right) -
          Math.max(first.bounds.left, second.bounds.left);
        const overlapHeight =
          Math.min(first.bounds.bottom, second.bounds.bottom) -
          Math.max(first.bounds.top, second.bounds.top);
        if (overlapWidth > 1 && overlapHeight > 1) {
          collisions.push(`${first.label} overlaps ${second.label}`);
        }
      }
    }

    return collisions;
  });

  expect(overlaps, "bracket match cards must occupy separate visual areas").toEqual([]);
}

async function expectBrandImageLoaded(page: Page): Promise<void> {
  const brandImage = page.locator("header img").first();
  await expect(brandImage).toBeVisible();
  await expect
    .poll(() =>
      brandImage.evaluate(
        (image) =>
          image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
}

test.describe("public AgentMate site", () => {
  test("keeps the homepage bracket, board, links, and roster controls usable", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.locator("#arena-title")).toBeVisible();
    await expectBrandImageLoaded(page);

    const bracketTitle = page.locator("#elimination-title");
    const bracket = page.getByRole("region", { name: "Elimination bracket" });
    await expect(bracketTitle).toBeVisible();
    await expect(bracket).toBeVisible();
    expect(await bracket.evaluate((element) => element.closest("details") === null)).toBe(
      true,
    );
    await expectMatchCardsDoNotOverlap(bracket);

    await expectSquareBoard(
      page.getByRole("img", { name: "Current board position" }).first(),
    );

    const roster = page.locator("#roster");
    const competitorLink = roster.getByRole("link", {
      name: new RegExp(`^${WHITE}$`, "i"),
    });
    await expect(competitorLink).toHaveAttribute("href", `/competitor/${WHITE}`);

    const replayLink = page
      .locator("#replays")
      .getByRole("link", { name: new RegExp(`${WHITE} vs ${BLACK}`, "i") });
    await expect(replayLink).toHaveAttribute("href", REPLAY_HREF);

    const traitGuide = roster.locator("details").first();
    await traitGuide.locator("summary").click();
    const traitSelect = traitGuide.getByLabel("Explore a trait");
    await expect(traitSelect).toBeVisible();
    const secondTrait = traitSelect.locator("option").nth(1);
    const secondTraitValue = await secondTrait.getAttribute("value");
    const secondTraitLabel = (await secondTrait.textContent())?.trim();
    expect(secondTraitValue).not.toBeNull();
    expect(secondTraitLabel).toBeTruthy();
    await traitSelect.selectOption(secondTraitValue!);
    await expect(traitSelect).toHaveValue(secondTraitValue!);
    await expect(
      traitGuide.locator("p").filter({ hasText: secondTraitLabel! }).first(),
    ).toBeVisible();

    const replayPersona = roster
      .getByRole("button", { name: new RegExp(`Replay ${WHITE} animation`, "i") })
      .first();
    const pose = async () =>
      (await replayPersona.getByRole("img").screenshot({ animations: "allow" })).toString("base64");
    await replayPersona.focus();
    const initialPose = await pose();
    await replayPersona.press("Enter");
    await expect.poll(pose).not.toEqual(initialPose);

    await expectNoDocumentOverflow(page);
  });

  test("navigates the seeded bracket, season, leaderboard, profile, and rivalry", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Open full bracket" }).click();

    await expect(page).toHaveURL(new RegExp(`/bracket/${BRACKET_ID}$`));
    const fullBracket = page.getByRole("region", { name: "Elimination bracket" });
    await expect(fullBracket).toBeVisible();
    await expectMatchCardsDoNotOverlap(fullBracket);
    const seededReplay = fullBracket.locator(`a[href="${REPLAY_HREF}"]`);
    await expect(seededReplay).toHaveCount(1);
    await expect(seededReplay).toBeVisible();
    await expectNoDocumentOverflow(page);

    await page.getByRole("link", { name: "Season schedule" }).click();
    await expect(page).toHaveURL(new RegExp(`/season/${SEASON_ID}$`));
    await expect(page.getByRole("heading", { name: `Season / ${SEASON_ID}` })).toBeVisible();
    const seasonReplay = page.getByRole("link", {
      name: new RegExp(`${WHITE}.*${BLACK}`, "i"),
    });
    await expect(seasonReplay).toHaveAttribute("href", REPLAY_HREF);
    await expectSquareBoard(
      page.getByRole("img", { name: "Current board position" }).first(),
    );
    await expectNoDocumentOverflow(page);

    await page.getByRole("main").getByRole("link", { name: "Leaderboard" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/season/${SEASON_ID}/leaderboard$`),
    );
    const standings = page.getByRole("region", {
      name: "Ranked season standings",
    });
    await expect(standings).toBeVisible();
    await standings
      .getByRole("link", { name: new RegExp(`^${WHITE}`, "i") })
      .click();

    await expect(page).toHaveURL(new RegExp(`/competitor/${WHITE}$`));
    await expect(
      page.getByRole("region", { name: "Competitor profile" }),
    ).toBeVisible();
    const rivals = page.getByRole("region", { name: "Rival records" });
    await expect(rivals).toBeVisible();
    await rivals.getByRole("link", { name: "Head to head" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/competitor/${WHITE}/vs/${BLACK}$`),
    );
    await expect(page.getByRole("region", { name: "Rivalry history" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Watch replay" })).toHaveAttribute(
      "href",
      REPLAY_HREF,
    );
    await expectNoDocumentOverflow(page);
  });

  test("shows an empty season without inventing games", async ({ page }) => {
    await page.route(`**/api/seasons/${SEASON_ID}/dashboard`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    });

    await page.goto(`/season/${SEASON_ID}`);

    await expect(page.getByRole("heading", { name: `Season / ${SEASON_ID}` })).toBeVisible();
    await expect(page.getByText(/no games/i)).toBeVisible();
    await expect(page.locator(`a[href^="/watch/${SEASON_ID}/"]`)).toHaveCount(0);
    await expectNoDocumentOverflow(page);
  });

  test("offers a retry after an API error and then renders real season data", async ({
    page,
  }) => {
    let siteRequests = 0;
    await page.route("**/api/site", async (route) => {
      siteRequests += 1;
      if (siteRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "temporary test outage" }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/");

    await expect(page.getByRole("status")).toBeVisible();
    const retry = page.getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible();
    await retry.click();

    await expect.poll(() => siteRequests).toBeGreaterThanOrEqual(2);
    await expect(page.locator("#arena-title")).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Elimination bracket" }),
    ).toBeVisible();
    await expectNoDocumentOverflow(page);
  });
});
