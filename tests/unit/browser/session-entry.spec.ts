import { expect, test } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";
import type {} from "../../fixtures/session-entry";

// Import the fixture's global type only; the fixture itself runs in the browser.
test.beforeEach(async ({ page }) => {
  await mountComponent(page, "/tests/fixtures/session-entry.ts");
});

for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 800 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`all forms keep fields before submit at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const screen of ["renderJoin", "renderLogin", "renderRegister", "renderNewAdventure"] as const) {
      await page.evaluate((method) => window.sessionEntryFixture.ui[method](), screen);
      const fields = page.locator("form input");
      const submit = page.locator('form button[type="submit"]');
      const button = (await submit.boundingBox())!;
      for (const input of await fields.all()) {
        const id = await input.getAttribute("id");
        await expect(page.locator(`label[for="${id}"]`)).toBeVisible();
        const bounds = (await input.boundingBox())!;
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(button.y);
        expect(bounds.width).toBeGreaterThan(150);
      }
      expect(button.height).toBeGreaterThanOrEqual(44);
      if (viewport.width >= 1024) {
        const card = (await page.locator(".session-entry").boundingBox())!;
        expect(card.width).toBeGreaterThanOrEqual(880);
        expect(card.y).toBeGreaterThanOrEqual(0);
        expect(card.y + card.height).toBeLessThanOrEqual(viewport.height);
        const inputs = await fields.all();
        const left = (await inputs.at(-2)!.boundingBox())!;
        const right = (await inputs.at(-1)!.boundingBox())!;
        expect(left.y).toBeCloseTo(right.y, 0);
        expect(right.x).toBeGreaterThan(left.x + left.width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await fields.first().focus();
      for (const input of (await fields.all()).slice(1)) {
        await page.keyboard.press("Tab");
        await expect(input).toBeFocused();
      }
      await page.keyboard.press("Tab");
      await expect(submit).toBeFocused();
    }
  });
}

test("Enter submits once, failure preserves drafts, and returning clears passwords", async ({ page }) => {
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByLabel("계정 이름", { exact: true }).fill("alice");
  await page.getByLabel("비밀번호", { exact: true }).fill("secret-password");
  await page.getByLabel("비밀번호", { exact: true }).press("Enter");
  await page.locator("form").dispatchEvent("submit");
  expect(await page.evaluate(() => window.sessionEntryFixture.calls)).toEqual([["alice", "secret-password"]]);
  await expect(page.locator("#account-back")).toBeDisabled();
  await page.evaluate(() => { window.sessionEntryFixture.ui.setBusy(false); window.sessionEntryFixture.ui.setStatus("다시 시도하세요."); });
  await expect(page.getByLabel("계정 이름", { exact: true })).toHaveValue("alice");
  await page.locator("#account-back").click();
  await expect(page.locator("#session-status")).toBeEmpty();
  await page.locator("#host-login").click();
  await expect(page.getByLabel("비밀번호", { exact: true })).toBeEmpty();
  await expect(page.getByLabel("계정 이름", { exact: true })).toHaveValue("alice");
});

test("invalid confirmation and whitespace code focus the field without submitting", async ({ page }) => {
  await page.evaluate(() => window.sessionEntryFixture.ui.renderRegister());
  await page.getByLabel("계정 이름", { exact: true }).fill("alice");
  await page.getByLabel("비밀번호", { exact: true }).fill("password-one");
  await page.getByLabel("비밀번호 확인").fill("password-two");
  await page.getByLabel("비밀번호 확인").press("Enter");
  await expect(page.getByLabel("비밀번호 확인")).toBeFocused();
  await expect(page.getByLabel("비밀번호 확인")).toHaveAttribute("aria-describedby", "session-status");
  await page.evaluate(() => window.sessionEntryFixture.ui.renderJoin());
  await page.getByLabel("초대 코드", { exact: true }).fill("   ");
  await page.getByLabel("초대 코드", { exact: true }).press("Enter");
  await expect(page.getByLabel("초대 코드", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.sessionEntryFixture.calls)).toEqual([]);
  await page.getByLabel("초대 코드", { exact: true }).fill("  session_AbC  ");
  await page.getByLabel("초대 코드", { exact: true }).press("Enter");
  expect(await page.evaluate(() => window.sessionEntryFixture.calls)).toEqual([["session_AbC", ""]]);
});

for (const screen of ["register", "new-adventure"] as const) {
  test(`${screen} submits from its last field with Enter`, async ({ page }) => {
    await page.evaluate((view) => {
      if (view === "register") window.sessionEntryFixture.ui.renderRegister();
      else window.sessionEntryFixture.ui.renderNewAdventure();
    }, screen);
    if (screen === "register") {
      await page.getByLabel("계정 이름", { exact: true }).fill("alice");
      await page.getByLabel("비밀번호", { exact: true }).fill("password-one");
      await page.getByLabel("비밀번호 확인").fill("password-one");
    } else {
      await page.getByLabel("모험 이름", { exact: true }).fill("A new adventure");
    }
    await page.locator("form input").last().press("Enter");
    expect(await page.evaluate(() => window.sessionEntryFixture.calls)).toEqual([
      screen === "register" ? ["alice", "password-one"] : ["A new adventure", ""],
    ]);
  });
}


test("iPad mini landscape presents the purposes side by side", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const start = (await page.locator("#entry-new-adventure").boundingBox())!;
  const join = (await page.locator("#entry-join").boundingBox())!;
  expect(start.y).toEqual(join.y);
  expect(join.x).toBeGreaterThan(start.x + start.width);
  expect(start.height).toBeGreaterThanOrEqual(100);
  await page.evaluate(() => window.sessionEntryFixture.ui.renderLanding({ accountId: "account", username: "alice" }));
  const resume = (await page.locator("#entry-continue").boundingBox())!;
  const signedStart = (await page.locator("#entry-new-adventure").boundingBox())!;
  expect(resume.y).toEqual(signedStart.y);
  expect(resume.x + resume.width).toBeLessThanOrEqual(1024);
});
