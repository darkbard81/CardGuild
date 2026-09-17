import { expect, test } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";
import type {} from "../../fixtures/campaign-ui";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await mountComponent(page, "/tests/fixtures/campaign-ui.ts");
});
for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`campaign and resume layout at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await expect(page.locator(".campaign-card")).toContainText("전투 2 / 8 완료");
    await expect(page.locator(".campaign-card")).toContainText("Lyra · Lv 3");
    await expect(page.locator("time")).toHaveAttribute("datetime", "2023-11-14T22:13:20.000Z");
    await page.screenshot({ path: `/tmp/cardguild-campaign-list-${viewport.width}.png` });
    await page.evaluate(() => {
      const f = window.campaignUiFixture;
      f.list([{ ...f.campaign, name: "아주 긴 모험 이름".repeat(15) }]);
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.campaignUiFixture.resume());
    await expect(page.locator(".resume-character")).toHaveCount(3);
    await expect(page.locator("#resume-adventure")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("#resume-adventure").scrollIntoViewIfNeeded();
    if (viewport.width >= 1024) {
      const bounds = (await page.locator(".resume-card").boundingBox())!;
      expect(bounds.width).toBeGreaterThan(880);
      expect(bounds.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.screenshot({ path: `/tmp/cardguild-campaign-resume-${viewport.width}.png` });
  });
}

test("all saved phases describe the destination and terminal results honestly", async ({ page }) => {
  for (const [phase, label] of [["ready", "모험 준비"], ["combat", "전투 중"], ["reward", "보상 선택"],
    ["between-encounters", "다음 전투 준비"], ["complete", "모험 완료"], ["failed", "모험 실패"]] as const) {
    await page.evaluate(phase => {
      const f = window.campaignUiFixture;
      f.list([{ ...f.campaign, progress: { ...f.campaign.progress!, phase } }]);
    }, phase);
    await expect(page.locator(".campaign-progress")).toContainText(label);
    await expect(page.locator(".campaign-card button")).toHaveText(phase === "complete" || phase === "failed" ? "저장된 결과 보기" : "이어하기");
  }
});

test("empty and unreadable saves explain unavailability without a fake save timestamp", async ({ page }) => {
  for (const status of ["empty", "SAVE_CORRUPT", "SAVE_SCHEMA_UNSUPPORTED", "SAVE_CONTENT_MISMATCH"] as const) {
    await page.evaluate(saveStatus => {
      const f = window.campaignUiFixture;
      f.list([{ ...f.campaign, saveStatus, progress: null, savedAt: null }]);
    }, status);
    await expect(page.locator(".campaign-card button")).toBeDisabled();
    await expect(page.locator(".campaign-card .session-description")).not.toBeEmpty();
    await expect(page.locator("time")).toHaveCount(0);
  }
  await page.evaluate(() => window.campaignUiFixture.list([]));
  await expect(page.locator(".campaign-empty")).toContainText("새 모험");
  await expect(page.locator("#entry-new-adventure")).toBeEnabled();
});

test("Continue blocks duplicates and recovers its label after failure", async ({ page }) => {
  await page.locator(".campaign-card button").focus();
  await page.keyboard.press("Enter");
  await page.locator(".campaign-card button").dispatchEvent("click");
  expect(await page.evaluate(() => window.campaignUiFixture.calls)).toEqual(["campaign-test"]);
  await expect(page.locator(".campaign-card button")).toHaveText("모험을 불러오는 중…");
  await page.evaluate(() => { const f = window.campaignUiFixture; f.ui.setBusy(false); f.ui.settleContinue(); });
  await expect(page.locator(".campaign-card button")).toBeEnabled();
  await expect(page.locator(".campaign-card button")).toHaveText("이어하기");
  await page.locator("#campaigns-refresh").click();
  expect(await page.evaluate(() => window.campaignUiFixture.calls)).toContain("refresh");
});

test("guests select characters while offline claims show host control", async ({ page }) => {
  await page.evaluate(() => window.campaignUiFixture.resume(true));
  await expect(page.locator("#resume-adventure")).toBeDisabled();
  await page.getByRole("button", { name: "Lyra 선택" }).click();
  expect(await page.evaluate(() => window.campaignUiFixture.calls)).toEqual(["party.hero-2"]);
  await page.evaluate(() => window.campaignUiFixture.resume(false, true));
  const lyra = page.locator('.resume-character[data-member-id="party.hero-2"]');
  await expect(lyra).toContainText("Guest 선택함");
  await expect(lyra).toContainText("현재 조작: Host (호스트)");
  await expect(page.locator('.resume-players [data-seat="2"]')).toContainText("오프라인 · Lyra");
  await expect(page.locator("#apply-party")).toHaveCount(0);
});

test("clipboard success waits for completion and failure selects manual copy", async ({ page }) => {
  await page.evaluate(() => {
    window.campaignUiFixture.resume();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
  });
  await page.locator("#copy-session-id").click();
  await expect(page.locator("#session-status")).toContainText("직접 복사");
  await expect(page.locator("#invite-session-id")).toBeFocused();
  expect(await page.locator("#invite-session-id").evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!)).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.campaignUiFixture.ui.setStatus("");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: () => new Promise<void>(resolve => window.addEventListener("test-copy-finished", () => resolve(), { once: true })),
    } });
  });
  await page.locator("#copy-session-id").click();
  await expect(page.locator("#session-status")).toBeEmpty();
  await page.evaluate(() => window.dispatchEvent(new Event("test-copy-finished")));
  await expect(page.locator("#session-status")).toContainText("복사했습니다");
});
