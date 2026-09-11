import { expect, test, type Locator, type Page } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";
import { boardPoint } from "../../support/browser/tactical-support";

/**
 * The three battle surfaces that name Traits — the selected Action inspector, the
 * long-pressed card detail and the hero sheet's Strike row — all render the same chips
 * from the same registry, with the same mouse, keyboard and touch contract.
 */

const CARD_LONG_PRESS_MS = 380;
/** What the character-rules fixture says about `attack`, straight from its registry. */
const ATTACK = {
  name: "Attack",
  source: "pf2e-remaster",
  category: "action",
  description: "공격 행동입니다. 같은 턴에 반복하면 다중 공격 페널티가 누적됩니다.",
};

const tooltip = (page: Page): Locator => page.locator(".trait-tooltip");
const tripCard = (page: Page): Locator => page.locator('#hand-cards [data-action-id="trip"]').first();

async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  const viewport = page.viewportSize()!;
  const bounds = (await locator.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.y).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 8);
}

/** Opens a card's detail the way a finger does: by holding the card. */
async function holdCard(page: Page, card: Locator): Promise<void> {
  await card.dispatchEvent("pointerdown", { pointerType: "touch", button: 0 });
  await expect(page.locator("#card-detail")).toBeVisible({ timeout: CARD_LONG_PRESS_MS + 2000 });
  await card.dispatchEvent("pointerup", { pointerType: "touch" });
}

/** Picks a card from the hand, which puts its Action in the inspector with no ring over it. */
async function selectTrip(page: Page): Promise<void> {
  await tripCard(page).click();
  await expect(tripCard(page)).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(600, 600);
  await expect(page.locator("#selected-detail .trait-chips .trait-chip")).toHaveText(["Attack", "Skill", "Trip"]);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await mountComponent(page, "/tests/fixtures/tactical.ts");
});

test("renders the registry's name, category and source on every surface and one description in the tooltip", async ({ page }) => {
  await selectTrip(page);
  const chip = page.locator('#selected-detail .trait-chip[data-trait-id="attack"]');
  await expect(chip).toHaveText(ATTACK.name);
  await expect(chip).toHaveAttribute("data-trait-category", ATTACK.category);
  await expect(chip).toHaveAttribute("data-trait-source", ATTACK.source);
  expect(await chip.evaluate((node) => (node as HTMLButtonElement).type)).toBe("button");

  await page.locator("#hero-details-toggle").click();
  const strikeChips = page.locator("#hero-details .trait-chips .trait-chip");
  await expect(strikeChips).toHaveText(["Reach", "Trip", "Weapon"]);
  await expect(strikeChips.nth(0)).toHaveAttribute("data-trait-source", "pf2e-remaster");
  await expect(strikeChips.nth(1)).toHaveAttribute("data-trait-category", "weapon");
  await expect(strikeChips.nth(2)).toHaveAttribute("data-trait-source", "cardguild");

  await holdCard(page, tripCard(page));
  const cardChips = page.locator("#card-detail .trait-chips .trait-chip");
  await expect(cardChips).toHaveText(["Attack", "Skill", "Trip"]);
  // No surface keeps a string of its own: the joined text is gone for good.
  await expect(page.locator(".detail-traits")).toHaveCount(0);

  await cardChips.first().hover();
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page)).toHaveAttribute("role", "tooltip");
  await expect(tooltip(page).locator(".trait-tooltip-name")).toHaveText(ATTACK.name);
  await expect(tooltip(page).locator(".trait-tooltip-meta")).toHaveText("PF2e Remaster · Action");
  await expect(tooltip(page).locator(".trait-tooltip-description")).toHaveText(ATTACK.description);
  await expect(cardChips.first()).toHaveAttribute("aria-describedby", await tooltip(page).getAttribute("id") as string);
  // The tooltip is the same element wherever it is opened from: one description, one node.
  await expect(tooltip(page)).toHaveCount(1);
  expect(await tooltip(page).evaluate((node) => node.parentElement === document.body)).toBe(true);
});

test("hovers to peek, clicks to pin, and closes on Escape before the detail beneath it", async ({ page }) => {
  await selectTrip(page);
  const chip = page.locator('#selected-detail .trait-chip[data-trait-id="skill"]');
  await chip.hover();
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page)).toHaveAttribute("data-pinned", "false");
  await expectInsideViewport(page, tooltip(page));
  await page.mouse.move(600, 600);
  await expect(tooltip(page)).toBeHidden();

  await chip.click();
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page)).toHaveAttribute("data-pinned", "true");
  await page.mouse.move(600, 600);
  await expect(tooltip(page)).toBeVisible();
  // Pressing the chip was about the chip: the card stays picked and nothing was sent.
  await expect(tripCard(page)).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
  await page.mouse.click(600, 600);
  await expect(tooltip(page)).toBeHidden();

  await holdCard(page, tripCard(page));
  await page.locator('#card-detail .trait-chip[data-trait-id="trip"]').click();
  await expect(tooltip(page).locator(".trait-tooltip-name")).toHaveText("Trip");
  await expect(page.locator("#card-detail")).toBeVisible();
  // The first Escape is the tooltip's alone; the second reaches the card detail.
  await page.keyboard.press("Escape");
  await expect(tooltip(page)).toBeHidden();
  await expect(page.locator("#card-detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#card-detail")).toBeHidden();
});

test("reads with the keyboard: focus peeks, Enter pins, a second Enter closes, Escape leaves the pick alone", async ({ page }) => {
  await page.locator("#hero-details-toggle").click();
  const chip = page.locator('#hero-details .trait-chip[data-trait-id="reach"]');
  await page.locator("#hero-details-toggle").focus();
  await page.keyboard.press("Tab");
  await expect(chip).toBeFocused();
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page)).toHaveAttribute("data-pinned", "false");
  await expect(tooltip(page).locator(".trait-tooltip-name")).toHaveText("Reach");
  await page.keyboard.press("Enter");
  await expect(tooltip(page)).toHaveAttribute("data-pinned", "true");
  await page.keyboard.press("Enter");
  await expect(tooltip(page)).toBeHidden();
  await page.keyboard.press("Space");
  await expect(tooltip(page)).toBeVisible();
  await page.keyboard.press("Tab");
  // Pinned: leaving the chip keeps it. Only Escape or a press elsewhere lets go.
  await expect(tooltip(page)).toBeVisible();
  await page.mouse.click(600, 600);
  await expect(tooltip(page)).toBeHidden();

  // In the inspector, Escape takes the tooltip and nothing else: the card stays picked.
  await selectTrip(page);
  const attack = page.locator('#selected-detail .trait-chip[data-trait-id="attack"]');
  await attack.focus();
  await page.keyboard.press("Enter");
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page).locator(".trait-tooltip-name")).toHaveText("Attack");
  await page.keyboard.press("Escape");
  await expect(tooltip(page)).toBeHidden();
  await expect(tripCard(page)).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
});

test("keeps focus and the pinned tooltip through a re-render of the same detail, and drops both when it changes", async ({ page }) => {
  await page.locator("#hero-details-toggle").click();
  await page.locator("#hero-details-toggle").focus();
  await page.keyboard.press("Tab");
  const chip = page.locator('#hero-details .trait-chip[data-trait-id="reach"]');
  await expect(chip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tooltip(page)).toHaveAttribute("data-pinned", "true");
  const before = await chip.evaluate((node) => node.getBoundingClientRect().top);
  // A new snapshot rebuilds the hero sheet; the Strike row is the same, so nothing moves.
  await page.evaluate(() => window.tacticalFixture.nudgeHp(7));
  await expect(page.locator(".hp-row strong").first()).toHaveText("7/21");
  await expect(chip).toBeFocused();
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page)).toHaveAttribute("data-pinned", "true");
  expect(await chip.evaluate((node) => node.getBoundingClientRect().top)).toBe(before);
  await page.keyboard.press("Escape");

  // The inspector re-renders on every board hover while a card is picked; its subject
  // is the same Action, so its chips and the pinned tooltip stay put.
  await selectTrip(page);
  await page.locator('#selected-detail .trait-chip[data-trait-id="trip"]').click();
  await expect(tooltip(page).locator(".trait-tooltip-name")).toHaveText("Trip");
  await page.locator("#pixi-canvas").hover({ position: await boardPoint(page, 2.5, 1.5) });
  await expect(page.locator("#selected-detail .preview-grid")).toBeVisible();
  await expect(tooltip(page)).toBeVisible();
  await expect(tooltip(page)).toHaveAttribute("data-pinned", "true");
  await expect(page.locator("#selected-detail .trait-chip")).toHaveText(["Attack", "Skill", "Trip"]);
  // A snapshot resets the pick, so the inspector loses its subject: chips and tooltip go.
  await page.evaluate(() => window.tacticalFixture.nudgeHp(9));
  await expect(page.locator(".hp-row strong").first()).toHaveText("9/21");
  await expect(page.locator("#selected-detail .trait-chip")).toHaveCount(0);
  await expect(tooltip(page)).toBeHidden();
});

test("tears the tooltip down with the screen", async ({ page }) => {
  await selectTrip(page);
  await page.locator('#selected-detail .trait-chip[data-trait-id="attack"]').click();
  await expect(tooltip(page)).toBeVisible();
  await page.evaluate(() => window.tacticalFixture.destroy());
  await expect(tooltip(page)).toHaveCount(0);
});

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } });

  test("taps to pin and taps again to close, without playing the card or closing its detail", async ({ page }) => {
    await tripCard(page).tap();
    await expect(tripCard(page)).toHaveAttribute("aria-pressed", "true");
    const chip = page.locator('#selected-detail .trait-chip[data-trait-id="attack"]');
    await chip.tap();
    await expect(tooltip(page)).toBeVisible();
    await expect(tooltip(page)).toHaveAttribute("data-pinned", "true");
    await expectInsideViewport(page, tooltip(page));
    await chip.tap();
    await expect(tooltip(page)).toBeHidden();
    // Neither tap was a command or a pick.
    await expect(tripCard(page)).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
    await chip.tap();
    await expect(tooltip(page)).toBeVisible();
    await page.touchscreen.tap(550, 550);
    await expect(tooltip(page)).toBeHidden();

    // A card's chips are inside the detail the hold opened, so a tap there is neither
    // "play this card" nor "put the detail away".
    await tripCard(page).tap();
    await expect(tripCard(page)).toHaveAttribute("aria-pressed", "false");
    await holdCard(page, tripCard(page));
    const cardChip = page.locator('#card-detail .trait-chip[data-trait-id="skill"]');
    await cardChip.tap();
    await expect(tooltip(page)).toBeVisible();
    await expect(tooltip(page).locator(".trait-tooltip-name")).toHaveText("Skill");
    await expect(page.locator("#card-detail")).toBeVisible();
    await expect(tripCard(page)).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
    await page.touchscreen.tap(550, 550);
    await expect(tooltip(page)).toBeHidden();
    await expect(page.locator("#card-detail")).toBeHidden();
  });

  /**
   * The ring's backdrop covers the stage so a stray tap closes the menu and reaches
   * nothing else. The inspector under it describes the armed option, and its chips are
   * the one thing the backdrop hands a tap on to.
   */
  test("reaches the inspector's chips through the open ring, and only with a tap", async ({ page }) => {
    const canvas = page.locator("#pixi-canvas");
    await canvas.tap({ position: await boardPoint(page, 2.5, 1.5) });
    await page.locator('#ring-root [data-action-id="strike"]').tap();
    const chip = page.locator('#selected-detail .trait-chip[data-trait-id="attack"]');
    await expect(chip).toBeVisible();
    const centre = async () => {
      const box = (await chip.boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    let at = await centre();
    await page.touchscreen.tap(at.x, at.y);
    await expect(tooltip(page)).toBeVisible();
    await expect(tooltip(page)).toHaveAttribute("data-pinned", "true");
    await expect(tooltip(page).locator(".trait-tooltip-name")).toHaveText("Attack");
    // The ring is still up, still armed on Strike, and nothing was sent.
    await expect(page.locator("#ring-root")).toBeVisible();
    await expect(chip).toBeVisible();
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
    at = await centre();
    await page.touchscreen.tap(at.x, at.y);
    await expect(tooltip(page)).toBeHidden();
    await expect(page.locator("#ring-root")).toBeVisible();

    // A press that starts on a chip and travels is a drag on the backdrop, not a tap.
    at = await centre();
    const root = page.locator("#ring-root");
    await root.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 7, button: 0, clientX: at.x, clientY: at.y });
    await root.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 7, clientX: at.x + 30, clientY: at.y + 30 });
    await expect(tooltip(page)).toBeHidden();
    await expect(page.locator("#ring-root")).toBeVisible();

    // A tap anywhere else on the backdrop is still the dismissal it always was.
    at = await centre();
    await page.touchscreen.tap(at.x, at.y);
    await expect(tooltip(page)).toBeVisible();
    await page.touchscreen.tap(550, 550);
    await expect(page.locator("#ring-root")).toBeHidden();
    await expect(tooltip(page)).toBeHidden();
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
  });

  test("does not open on a press that moved or was cancelled", async ({ page }) => {
    await page.locator("#hero-details-toggle").tap();
    const chip = page.locator('#hero-details .trait-chip[data-trait-id="trip"]');
    await chip.dispatchEvent("pointerdown", { pointerType: "touch", button: 0, clientX: 100, clientY: 300 });
    await chip.dispatchEvent("pointermove", { pointerType: "touch", clientX: 100, clientY: 340 });
    await chip.dispatchEvent("pointerup", { pointerType: "touch" });
    await chip.dispatchEvent("click", { detail: 1 });
    await expect(tooltip(page)).toBeHidden();
    await chip.dispatchEvent("pointerdown", { pointerType: "touch", button: 0, clientX: 100, clientY: 300 });
    await chip.dispatchEvent("pointercancel", { pointerType: "touch" });
    await chip.dispatchEvent("click", { detail: 1 });
    await expect(tooltip(page)).toBeHidden();
    await chip.tap();
    await expect(tooltip(page)).toBeVisible();
  });
});

test("stays inside a narrow phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#hero-details-toggle").click();
  const chip = page.locator('#hero-details .trait-chip[data-trait-id="weapon"]');
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  await expect(tooltip(page)).toBeVisible();
  await expectInsideViewport(page, tooltip(page));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
