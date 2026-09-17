import { expect, test } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";
import type {} from "../../fixtures/ring-menu";

test.beforeEach(async ({ page }) => {
  await mountComponent(page, "/tests/fixtures/ring-menu.ts");
});

test("does not inspect or execute on initial focus even after keyboard input", async ({ page }) => {
  expect(await page.evaluate(() => window.ringFixture.events)).toEqual([]);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.ringFixture.events)).toContainEqual({ kind: "hover", id: "stride" });
  await page.evaluate(() => { window.ringFixture.events.length = 0; window.ringFixture.show(); });
  await expect(page.locator('[data-option-id="strike"]')).toBeFocused();
  expect(await page.evaluate(() => window.ringFixture.events)).toEqual([]);
});

test("mouse hover inspects without selecting and the first click selects once", async ({ page }) => {
  const strike = page.locator('[data-option-id="strike"]');
  await strike.hover();
  expect(await page.evaluate(() => window.ringFixture.events)).toEqual([{ kind: "hover", id: "strike" }]);
  await strike.click();
  expect(await page.evaluate(() => window.ringFixture.events.filter(event => event.kind === "select"))).toEqual([{ kind: "select", id: "strike" }]);
});

for (const operation of ["show", "hide", "destroy"] as const) {
  test(`${operation} cleans up a pending hold and all retired option listeners`, async ({ page }) => {
    await page.clock.install();
    await page.evaluate(() => {
      window.ringFixture.retired = document.querySelector<HTMLElement>('[data-option-id="strike"]')!;
    });
    await page.locator('[data-option-id="strike"]').dispatchEvent("pointerdown", {
      pointerType: "touch", pointerId: 1, button: 0, clientX: 400, clientY: 208,
    });
    await page.clock.runFor(200);
    await page.evaluate(value => {
      const fixture = window.ringFixture;
      if (value === "show") fixture.show(); else fixture.ring[value]();
    }, operation);
    await page.clock.runFor(1000);
    await page.evaluate(() => {
      const option = window.ringFixture.retired!;
      option.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", pointerId: 1 }));
      option.dispatchEvent(new MouseEvent("click", { detail: 1 }));
      option.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
      option.dispatchEvent(new FocusEvent("focus"));
      window.dispatchEvent(new Event("scroll"));
    });
    expect(await page.evaluate(() => window.ringFixture.events)).toEqual([]);
    expect(await page.evaluate(() => window.ringFixture.ring.isOpen)).toBe(operation === "show");
  });
}
