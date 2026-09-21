import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { recruitIntent, recruitmentAct, recruitmentReward } from "../support/recruitment";
import { HERO, SECOND } from "../support/session";
import { createResumedSessionCoreState } from "../../src/session";
import { recruitmentContext } from "../support/recruitment";
import { restoreCampaignSave } from "../../src/server/campaign-save";
import { saveRecord } from "../support/session";

for (const order of ["ack-first", "snapshot-first"] as const) {
  test(`U-RECRUIT seed=65 ${order}: detail is inert, explicit recruitment retries and waits for ACK plus snapshot`, async ({ page }, testInfo) => {
    const initial = recruitmentReward();
    const backend = await controlledSession(page, initial);
    await expect(page.getByRole("heading", { name: "새 동료", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Aerin 앞모습" })).toBeVisible();
    await expect(page.getByText(/^시작 장비:/)).toContainText("Halberd");
    await expect(page.getByText(/^Fighter\./)).toBeVisible();
    const confirm = page.getByRole("button", { name: "동료 합류", exact: true });
    await expect(confirm).toBeDisabled();
    await page.getByRole("button", { name: "Aerin 합류 전 상세", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
    await expect(sheet).toContainText("Aerin");
    await expect(sheet.getByRole("button", { name: "장비 해제 비교", exact: true })).toHaveCount(0);
    await sheet.getByRole("button", { name: "닫기", exact: true }).click();
    expect(backend.requests).toHaveLength(0);
    await page.getByRole("button", { name: "Aerin 선택", exact: true }).click();
    await expect(confirm).toBeEnabled();
    const box = await confirm.boundingBox(); expect(box!.y + box!.height).toBeLessThanOrEqual(768);
    await page.screenshot({ path: testInfo.outputPath("companion-reward-1024.png") });
    await confirm.click();
    await expect.poll(() => backend.requests.length).toBe(1);
    expect(backend.requests[0]!.intent).toEqual(recruitIntent);
    await expect(page.getByRole("button", { name: "동료 합류 중…", exact: true })).toBeDisabled();
    backend.reject();
    await expect(confirm).toBeEnabled();
    await expect(page.getByText("보상을 적용하지 못했습니다. 선택을 확인하고 다시 시도하세요.", { exact: true })).toBeVisible();
    await confirm.click(); await expect.poll(() => backend.requests.length).toBe(2);
    const candidate = recruitmentAct(initial, recruitIntent);
    if (order === "ack-first") backend.ack(true, candidate.revision);
    else backend.publish(candidate);
    await expect(page.getByText(/^동료가 합류했습니다\./)).toHaveCount(0);
    if (order === "ack-first") await expect(page.getByRole("button", { name: "동료 합류 중…", exact: true })).toBeDisabled();
    else await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toBeDisabled();
    if (order === "ack-first") backend.publish(candidate);
    else backend.ack(true, candidate.revision);
    backend.control({ [HERO]: "host", [SECOND]: "host" });
    await expect(page.getByText(/^동료가 합류했습니다\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toBeEnabled();
    await expect(page.getByLabel("초대 코드", { exact: true })).toBeHidden();
    await page.getByRole("button", { name: "Aerin 상세", exact: true }).click();
    await expect(sheet).toContainText("Aerin");
    await expect(sheet.getByRole("button", { name: "장비 해제 비교", exact: true })).toBeVisible();
    expect(backend.requests).toHaveLength(2);
  });
}

test("U-RECRUIT restored created party remains host-controlled without automatically publishing an invite", async ({ page }) => {
  const recruited = recruitmentAct(recruitmentReward(), recruitIntent);
  const projection = restoreCampaignSave(saveRecord(recruited), recruitmentContext).projection;
  const restored = createResumedSessionCoreState({ sessionId: "resume-recruitment", playerId: "host", displayName: "Host" }, projection, recruitmentContext);
  await controlledSession(page, restored);
  await expect(page.getByRole("button", { name: "모험 이어가기", exact: true })).toBeEnabled();
  await expect(page.getByText("Host 조작", { exact: true })).toBeVisible();
  await expect(page.getByLabel("새 초대 코드", { exact: true })).toHaveCount(0);
});
