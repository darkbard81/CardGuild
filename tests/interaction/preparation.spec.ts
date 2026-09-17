import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { HERO } from "../support/session";

for (const order of ["ack-first", "snapshot-first"] as const) {
  test(`U-PREPARE ${order}: comparison/cancel are inert and saving requires ACK plus applied state`, async ({ page }) => {
    const backend = await controlledSession(page);
    await page.getByRole("button", { name: "장비·카드 준비", exact: true }).click();
    const weapon = page.getByRole("button", { name: /^Halberd · 주손/ });
    await weapon.click();
    await expect(page.getByRole("region", { name: "선택 항목 비교" })).toBeVisible();
    expect(backend.requests).toHaveLength(0);
    await page.getByRole("button", { name: "비교 취소", exact: true }).click();
    expect(backend.requests).toHaveLength(0);
    await weapon.click();
    await page.getByRole("button", { name: "해제", exact: true }).click();
    await expect.poll(() => backend.requests.length).toBe(1);
    const candidate = backend.candidate();
    const saved = page.getByRole("status").filter({ hasText: "저장됨" });
    if (order === "ack-first") backend.ack(true, candidate.revision);
    else backend.publish(candidate);
    await expect(page.getByRole("button", { name: "닫기", exact: true })).toBeDisabled();
    await expect(saved).toHaveCount(0);
    if (order === "ack-first") backend.publish(candidate);
    else backend.ack(true, candidate.revision);
    await expect(saved).toBeVisible();
    await expect(page.getByRole("button", { name: /^빈 주손/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "닫기", exact: true })).toBeEnabled();
  });
}

test("U-PREPARE rejection permits retry; control loss turns an open comparison read-only", async ({ page }) => {
  const backend = await controlledSession(page);
  await page.getByRole("button", { name: "장비·카드 준비", exact: true }).click();
  await page.getByRole("button", { name: /^Halberd · 주손/ }).click();
  await page.getByRole("button", { name: "해제", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  backend.reject();
  await expect(page.getByRole("status").filter({ hasText: "Saving failed. Retry." })).toBeVisible();
  await expect(page.getByRole("button", { name: "해제", exact: true })).toBeEnabled();
  backend.control({ [HERO]: "guest" });
  await expect(page.getByText("읽기 전용 · 다른 플레이어")).toBeVisible();
  await expect(page.getByRole("button", { name: "해제", exact: true })).toHaveCount(0);
  expect(backend.requests).toHaveLength(1);
});

test("U-PREPARE dragging equipped gear only opens a comparison; focus survives a control snapshot", async ({ page }) => {
  const backend = await controlledSession(page);
  await page.getByRole("button", { name: "장비·카드 준비", exact: true }).click();
  const handle = page.getByRole("button", { name: "Halberd 끌어서 이동", exact: true });
  const drop = page.getByText("장비함으로 되돌리기 · 장착 장비를 끌어 놓으면 해제를 비교합니다.");
  await handle.dragTo(drop);
  await expect(page.getByRole("button", { name: "해제", exact: true })).toBeEnabled();
  expect(backend.requests).toHaveLength(0);
  const tab = page.getByRole("tab", { name: "준비 카드", exact: true });
  await tab.click();
  backend.control({ [HERO]: "host" });
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  expect(backend.requests).toHaveLength(0);
});

test("U-PREPARE touch long-press reveals readable detail without preparing or removing a card", async ({ page }, testInfo) => {
  await page.clock.install();
  const backend = await controlledSession(page);
  await page.getByRole("button", { name: "장비·카드 준비", exact: true }).click();
  await page.getByRole("tab", { name: "준비 카드", exact: true }).click();
  const card = page.getByRole("button", { name: /^Vicious Swing .*−/ });
  const bounds = await card.boundingBox();
  if (!bounds) throw new Error("Prepared card is not visible");
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 1 }] });
    // Advance the hold gesture's clock; this tests a deliberate duration contract.
    await page.clock.runFor(700);
    await expect(page.getByRole("tooltip")).toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.getByRole("button", { name: "해제", exact: true })).toHaveCount(0);
    expect(backend.requests).toHaveLength(0);
    const screenshot = testInfo.outputPath("preparation-touch-detail.png");
    await page.screenshot({ path: screenshot });
    await testInfo.attach("preparation-touch-detail", { path: screenshot, contentType: "image/png" });
  } finally { await cdp.detach(); }
});

test("U-PREPARE disconnect during confirmation cannot announce success and permits retry after reconnect", async ({ page }) => {
  const backend = await controlledSession(page);
  await page.getByRole("button", { name: "장비·카드 준비", exact: true }).click();
  await page.getByRole("button", { name: /^Halberd · 주손/ }).click();
  await page.getByRole("button", { name: "해제", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  backend.disconnect();
  await expect.poll(() => backend.requests.length).toBe(2);
  expect(backend.requests[1]!.requestId).toBe(backend.requests[0]!.requestId);
  await expect(page.getByRole("status").filter({ hasText: "저장됨" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "해제", exact: true })).toBeDisabled();
  const candidate = backend.candidate();
  backend.ack(true, candidate.revision); backend.publish(candidate);
  await expect(page.getByRole("status").filter({ hasText: "저장됨" })).toBeVisible();
});
