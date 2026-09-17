import { expect, test } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";
import type {} from "../../fixtures/session-entry";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await mountComponent(page, "/tests/fixtures/ui-theme.ts");
  await expect(page.locator("#account-login")).toBeVisible();
});

test("root tokens restyle real controls and panels across screens", async ({ page }) => {
  await page.addStyleTag({ content: `@layer theme { :root {
    --ui-surface-primary: rgb(12, 34, 56);
    --ui-surface-button: rgb(23, 45, 67);
    --ui-border-primary: rgb(78, 90, 12);
    --ui-surface-input: rgb(34, 56, 78);
    --ui-radius-control: 13px;
    --ui-radius-panel: 19px;
  } }` });
  for (const selector of ["#account-login", ".adventure-action.ui-button--primary", ".loadout-done", "#reaction-use", "#end-turn"]) {
    const button = page.locator(selector).first();
    await expect(button).toHaveClass(/ui-button/);
    await expect(button).toHaveCSS("background-color", "rgb(12, 34, 56)");
    await expect(button).toHaveCSS("border-top-color", "rgb(78, 90, 12)");
    await expect(button).toHaveCSS("border-top-left-radius", "13px");
  }
  for (const selector of ["#account-back", ".loadout-tab", "#reaction-pass"]) {
    await expect(page.locator(selector).first()).toHaveCSS("border-top-left-radius", "13px");
  }
  await expect(page.locator("#account-back")).toHaveCSS("background-color", "rgb(23, 45, 67)");
  await expect(page.locator("#reaction-pass")).toHaveCSS("background-color", "rgb(23, 45, 67)");
  await expect(page.locator("#account-password")).toHaveCSS("background-color", "rgb(34, 56, 78)");
  for (const selector of [".session-card", ".adventure-map-card", ".loadout-panel", ".hud-card", ".modal-card", "#card-detail"]) {
    await expect(page.locator(selector).first()).toHaveCSS("border-top-left-radius", "19px");
  }
  expect((await page.locator(".session-card").boundingBox())!.width).toBeGreaterThan(880);
});

test("semantic selected, disabled, invalid and keyboard focus states share tokens", async ({ page }) => {
  await page.addStyleTag({ content: `@layer theme { :root {
    --ui-surface-selected: rgb(10, 20, 30);
    --ui-color-error-text: rgb(200, 20, 30);
    --ui-focus-ring: 3px solid rgb(20, 200, 30);
    --ui-opacity-disabled: 0.3;
  } }` });
  await expect(page.locator('.loadout-tab[aria-selected="true"]').first()).toHaveCSS("background-color", "rgb(10, 20, 30)");
  await expect(page.locator('.loadout-tab[aria-selected="true"]').first()).toBeEnabled();
  await page.getByLabel("계정 이름", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#account-password")).toHaveCSS("outline-color", "rgb(20, 200, 30)");
  await page.evaluate(() => window.sessionEntryFixture.ui.reportEntryError("오류", "account-password"));
  await expect(page.locator("#account-password")).toHaveCSS("border-top-color", "rgb(200, 20, 30)");
  await expect(page.locator("#session-status")).toHaveCSS("color", "rgb(200, 20, 30)");
  await page.evaluate(() => window.sessionEntryFixture.ui.setBusy(true));
  await expect(page.locator("#account-login")).toBeDisabled();
  await expect(page.locator("#account-login")).toHaveCSS("opacity", "0.3");
});

test("the theme layer overrides a compound variant without specificity escalation", async ({ page }) => {
  await page.addStyleTag({ content: "@layer theme { .ui-button { background: rgb(44, 55, 66); } }" });
  await expect(page.locator("#account-login")).toHaveCSS("background-color", "rgb(44, 55, 66)");
  await expect(page.locator("#account-back")).toHaveCSS("background-color", "rgb(44, 55, 66)");
});
