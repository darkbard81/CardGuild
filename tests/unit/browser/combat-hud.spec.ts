import { expect, test } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";
import { settledBoard } from "../../support/browser/board-camera";
import type {} from "../../fixtures/hand-card";
import type {} from "../../fixtures/tactical";

test.use({ viewport: { width: 1024, height: 768 } });

test("keeps actor inspection separate from the active summary and hand owner", async ({ page }) => {
  await mountComponent(page, "/tests/fixtures/hand-card.ts");
  await expect(page.locator('[data-hud-gutter="left"]')).toHaveCount(0);
  await expect(page.locator("#selected-detail")).toBeHidden();
  await expect(page.locator("#character-panel h2")).toBeHidden();
  await expect(page.locator("#character-panel progress")).toHaveCount(0);
  await page.locator('#initiative-list [data-actor-id="goblin-skirmisher"] button').click();
  await expect(page.locator("#app")).toHaveAttribute("data-inspected-actor-id", "goblin-skirmisher");
  await expect(page.locator("#hero-heading")).toHaveText("Aerin");
  await expect(page.locator("#character-panel h2")).toBeVisible();
  await expect(page.locator("#character-panel progress")).toHaveCount(1);
  await expect(page.locator("#character-panel")).not.toContainText("Class DC");
  await expect(page.locator("#app")).toHaveAttribute("data-controlled-actor-id", "hero");
  await page.evaluate(() => window.handCardFixture.setActive("goblin-brute"));
  await expect(page.locator("#app")).toHaveAttribute("data-inspected-actor-id", "goblin-skirmisher");
  await expect(page.locator("#app")).toHaveAttribute("data-active-actor-id", "goblin-brute");
  await page.locator("#inspect-active").click();
  await expect(page.locator("#app")).toHaveAttribute("data-inspected-actor-id", "goblin-brute");
  expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual([]);
});

for (const count of [0, 1, 7, 8, 9]) test(`pages ${count} cards and preserves existing nodes on snapshots`, async ({ page }) => {
  await mountComponent(page, "/tests/fixtures/hand-card.ts");
  await page.evaluate(count => window.handCardFixture.setCount(count), count);
  await expect(page.locator(".tactical-card:visible")).toHaveCount(Math.min(count, 8));
  if (count) {
    await page.locator(".tactical-card").first().evaluate(node => { window.handCardFixture.retired = node as HTMLElement; });
    await page.evaluate(() => window.handCardFixture.render());
    expect(await page.locator(".tactical-card").first().evaluate(node => node === window.handCardFixture.retired)).toBe(true);
  }
  if (count > 8) { await page.locator("#hand-next").click(); await expect(page.locator(".tactical-card:visible")).toHaveCount(1); await expect(page.locator("#hand-page")).toHaveText("9–9 / 9"); }
});

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("the first collapsed gesture only opens; the next tap activates", async ({ page }) => {
    await mountComponent(page, "/tests/fixtures/hand-card.ts");
    const card = page.locator('[data-action-id="trip"]');
    await card.tap({ position: { x: 60, y: 20 } });
    await expect(page.locator("#hand-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual([]);
    await card.tap();
    expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual(["card.trip"]);
  });
  test("cancelled opening gesture cannot activate through its trailing click", async ({ page }) => {
    await mountComponent(page, "/tests/fixtures/hand-card.ts");
    const card = page.locator('[data-action-id="trip"]');
    await card.dispatchEvent("pointerdown", { pointerType: "pen", pointerId: 7 });
    await card.dispatchEvent("pointercancel", { pointerType: "pen", pointerId: 7 });
    await card.dispatchEvent("click", { detail: 1 });
    expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual([]);
  });
});

test("hand overlay preserves camera, selected targeting, and explicit common tab choice", async ({ page }, info) => {
  await mountComponent(page, "/tests/fixtures/tactical.ts");
  const before = await settledBoard(page);
  await page.screenshot({ path: info.outputPath("combat-hud-collapsed.png") });
  await page.locator('#character-panel [role="tab"]').filter({ hasText: "SKILLS" }).click();
  await page.locator("#hand-toggle").click();
  expect(await settledBoard(page)).toEqual(before);
  await page.screenshot({ path: info.outputPath("combat-hud-expanded.png") });
  const card = page.locator('#hand-cards [data-action-id="trip"]').first();
  await card.click();
  await expect(page.locator('#character-panel [aria-selected="true"]')).toHaveText("ACTION");
  await page.screenshot({ path: info.outputPath("combat-hud-action.png") });
  await page.locator("#hand-toggle").click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  expect(await settledBoard(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(page.locator('#character-panel [aria-selected="true"]')).toHaveText("SKILLS");
  await expect(card).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
  await page.evaluate(() => window.tacticalFixture.connection("reconnecting"));
  await expect(page.locator("#end-turn")).toBeDisabled();
  await expect(page.locator("#combat-status")).toContainText("재연결");
  await page.locator('#character-panel [role="tab"]').filter({ hasText: "CORE" }).click();
  await expect(page.locator("#character-panel")).toContainText("Facing");
  await page.evaluate(() => window.tacticalFixture.connection("connected"));
  await expect(page.locator("#end-turn")).toBeEnabled();
});

test("keyboard navigates across hand pages and Escape closes detail before targeting", async ({ page }) => {
  await mountComponent(page, "/tests/fixtures/hand-card.ts");
  await page.evaluate(() => window.handCardFixture.setCount(9));
  await page.keyboard.press("Tab");
  await page.locator(".tactical-card").first().focus();
  await page.keyboard.press("End");
  await expect(page.locator('[data-source-id="hand-8"]')).toBeFocused();
  await expect(page.locator("#hand-page")).toHaveText("9–9 / 9");
  await expect(page.locator("#card-detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#card-detail")).toBeHidden();
  await expect(page.locator("#hand-toggle")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Home");
  await expect(page.locator('[data-source-id="hand-0"]')).toBeFocused();
});
