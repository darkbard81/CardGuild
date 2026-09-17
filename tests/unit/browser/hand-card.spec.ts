import { expect, test, type Locator } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";
import type {} from "../../fixtures/hand-card";

async function press(card: Locator): Promise<void> {
  await card.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 1, button: 0, clientX: 100, clientY: 100 });
}
async function release(card: Locator): Promise<void> {
  await card.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 1 });
  await card.dispatchEvent("click", { detail: 1 });
}

test.beforeEach(async ({ page }) => { await mountComponent(page, "/tests/fixtures/hand-card.ts"); });

test.describe("touch hand gestures", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 768, height: 1024 } });
  test("one native tap selects once, including a different card after pointer focus", async ({ page }) => {
    await page.locator('[data-action-id="trip"]').tap();
    await page.locator('[data-action-id="fly"]').tap();
    expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual(["card.trip", "card.fly"]);
    expect(await page.evaluate(() => window.handCardFixture.previews)).toEqual([]);
  });
  test("holds for detail without selection and accepts a fresh native tap", async ({ page }) => {
    const card = page.locator('[data-action-id="trip"]');
    await press(card);
    await expect(page.locator("#card-detail")).toBeVisible();
    await release(card);
    expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual([]);
    await expect(card).toHaveAttribute("aria-pressed", "false");
    await card.tap();
    expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual(["card.trip"]);
  });
  for (const cancellation of ["drag", "pointercancel", "scroll", "hide"] as const) {
    test(`${cancellation} cancels selection and the pending hold, then a fresh tap selects once`, async ({ page }) => {
      await page.clock.install();
      const card = page.locator('[data-action-id="trip"]');
      await press(card);
      if (cancellation === "drag") await card.dispatchEvent("pointermove", { pointerType: "touch", pointerId: 1, clientX: 130, clientY: 100 });
      else if (cancellation === "pointercancel") await card.dispatchEvent("pointercancel", { pointerType: "touch", pointerId: 1 });
      else if (cancellation === "scroll") await page.evaluate(() => document.dispatchEvent(new Event("scroll")));
      else await page.evaluate(() => window.handCardFixture.hide());
      await page.clock.runFor(500);
      await release(card);
      await expect(page.locator("#card-detail")).toBeHidden();
      expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual([]);
      await card.tap();
      expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual(["card.trip"]);
    });
  }
  for (const reason of ["lock", "disable"] as const) {
    test(`${reason} prevents tap selection while retaining hold detail`, async ({ page }) => {
      await page.evaluate(value => window.handCardFixture[value](), reason);
      const card = page.locator('[data-action-id="trip"]');
      await expect(card).toHaveAttribute("aria-disabled", "true");
      // aria-disabled cards remain inspectable; Playwright's actionability gate needs force.
      await card.tap({ force: true });
      await press(card);
      await expect(page.locator("#card-detail")).toBeVisible();
      await release(card);
      expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual([]);
      await expect(card).toHaveAttribute("aria-pressed", "false");
    });
  }
});

for (const operation of ["render", "destroy"] as const) {
  test(`${operation} removes pending holds and retired card listeners`, async ({ page }) => {
    await page.clock.install();
    const card = page.locator('[data-action-id="trip"]');
    await card.evaluate(node => { window.handCardFixture.retired = node as HTMLElement; });
    await press(card);
    await page.evaluate(value => window.handCardFixture[value](), operation);
    await page.clock.runFor(500);
    await page.evaluate(() => {
      const card = window.handCardFixture.retired!;
      card.dispatchEvent(new MouseEvent("click", { detail: 1 }));
      card.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
      card.dispatchEvent(new FocusEvent("focus"));
    });
    await expect(page.locator("#card-detail")).toBeHidden();
    expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual([]);
    expect(await page.evaluate(() => window.handCardFixture.previews)).toEqual([]);
  });
}

test("mouse hover and keyboard focus inspect without selection; click and keys select once", async ({ page }) => {
  const card = page.locator('[data-action-id="trip"]');
  await card.hover();
  expect(await page.evaluate(() => window.handCardFixture.previews)).toEqual(["card.trip"]);
  expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual([]);
  await card.click();
  await page.keyboard.press("Tab");
  await expect(page.locator("#card-detail")).toContainText("Fly");
  expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual(["card.trip"]);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => window.handCardFixture.selections)).toEqual(["card.trip", "card.fly", "card.fly"]);
});
