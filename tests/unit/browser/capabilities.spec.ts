import { expect, test } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";
import { boardPoint } from "../../support/browser/tactical-support";
import type {} from "../../fixtures/tactical";

for (const touch of [false, true]) {
  test.describe(touch ? "touch capabilities" : "mouse capabilities", () => {
    test.use({ hasTouch: touch, isMobile: touch, viewport: { width: 1024, height: 768 } });
    test.beforeEach(async ({ page }) => {
      await mountComponent(page, "/tests/fixtures/tactical.ts");
      await page.evaluate(() => window.tacticalFixture.capabilityCase());
    });
    test("keeps Trip in Hand and preserves target, preview and commit", async ({ page }) => {
      const canvas = page.locator("#pixi-canvas");
      const enemy = await boardPoint(page, 2.5, 1.5);
      if (touch) await canvas.tap({ position: enemy }); else await canvas.click({ position: enemy });
      await expect(page.locator('#ring-root [data-action-id="strike"]')).toHaveCount(1);
      await expect(page.locator('#ring-root [data-action-id="trip"]')).toHaveCount(0);
      expect(await page.locator('#ring-root [data-action-id]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.actionId))).toEqual(["strike"]);
      if (touch) await page.locator("#ring-root").tap({ position: { x: 1, y: 1 } }); else await page.keyboard.press("Escape");
      const trip = page.locator('#hand-cards [data-action-id="trip"]');
      if (touch) await trip.tap(); else await trip.click();
      await expect(page.locator("#ring-root")).toBeHidden();
      await expect(page.locator("#selected-detail .detail-heading strong")).toHaveText("Trip");
      if (!touch) {
        await canvas.hover({ position: enemy });
        await expect(page.locator("#selected-detail .preview-grid")).toContainText("Check / DC");
      }
      if (touch) await canvas.tap({ position: enemy }); else await canvas.click({ position: enemy });
      await expect.poll(() => page.evaluate(() => window.tacticalFixture.intents.length)).toBe(1);
      const result = await page.evaluate(() => ({ intents: window.tacticalFixture.intents, events: window.tacticalFixture.events }));
      expect(result.intents[0]).toMatchObject({ type: "use-action", action: { kind: "card", id: "cap-card.trip" }, target: { kind: "actor", actorId: "goblin-skirmisher" } });
      expect(result.events.some(event => event.type === "CHECK_ROLLED" && event.label === "Trip")).toBe(true);
    });
    test("keeps a locked hand card inspectable without submitting an intent", async ({ page }) => {
      await page.evaluate(() => window.tacticalFixture.setCardLevel("card.trip", 2));
      const trip = page.locator('#hand-cards [data-action-id="trip"]');
      await expect(trip).toHaveAttribute("aria-disabled", "true");
      await expect(trip).toContainText("Lv. 2");
      if (touch) {
        await trip.dispatchEvent("pointerdown", { pointerType: "touch", button: 0 });
      } else await trip.focus();
      await expect(page.locator("#card-detail")).toContainText("요구 레벨 2 · 현재 레벨 1");
      await trip.dispatchEvent("pointerup", { pointerType: touch ? "touch" : "mouse" });
      await trip.dispatchEvent("click");
      expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
    });
    test("shows only Step and Stride on an empty tile while Fly remains playable from Hand", async ({ page }) => {
      const canvas = page.locator("#pixi-canvas");
      const tile = await boardPoint(page, 1.5, 0.5);
      if (touch) await canvas.tap({ position: tile }); else await canvas.click({ position: tile });
      expect((await page.locator('#ring-root [data-action-id]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.actionId))).sort()).toEqual(["step", "stride"]);
      if (touch) await page.locator("#ring-root").tap({ position: { x: 1, y: 1 } }); else await page.keyboard.press("Escape");
      const fly = page.locator('#hand-cards [data-action-id="fly"]');
      if (touch) await fly.tap(); else await fly.click();
      if (touch) await canvas.tap({ position: tile }); else await canvas.click({ position: tile });
      await expect.poll(() => page.evaluate(() => window.tacticalFixture.state.actors.hero!.position)).toEqual({ x: 1, y: 0 });
      expect(await page.evaluate(() => window.tacticalFixture.intents[0])).toMatchObject({ action: { kind: "card", id: "cap-card.fly" } });
    });
    for (const [condition, actionId] of [["grabbed", "escape-grab"], ["prone", "stand"], [undefined, "raise-shield"], ["lever", "interact-lever"]] as const) {
      test(`retains contextual Basic ${actionId}`, async ({ page }) => {
        await page.evaluate(value => window.tacticalFixture.capabilityCase(value), condition);
        const position = await boardPoint(page, 1.5, condition === "lever" ? 2.5 : 1.5);
        const canvas = page.locator("#pixi-canvas");
        if (touch) await canvas.tap({ position }); else await canvas.click({ position });
        await expect(page.locator(`#ring-root [data-action-id="${actionId}"]`)).toBeVisible();
        await expect(page.locator('#ring-root [data-action-id="trip"], #ring-root [data-action-id="fly"]')).toHaveCount(0);
      });
    }
  });
}
