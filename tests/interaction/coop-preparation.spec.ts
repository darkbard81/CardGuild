import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { recruitmentAct, recruitmentContext, recruitmentReward, recruitIntent } from "../support/recruitment";
import { createResumedSessionCoreState, joinSessionCore } from "../../src/session";
import { createCampaignSave } from "../../src/server/campaign-save";
import { HERO, SECOND } from "../support/session";

const recruited = () => recruitmentAct(recruitmentReward(), recruitIntent);
function admitted() {
  const shared = recruitmentAct(recruited(), { type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
  const joined = joinSessionCore(shared, { playerId: "guest", displayName: "Guest" }, recruitmentContext);
  if (!joined.accepted) throw new Error(joined.error); return joined.state;
}

test("U-COOP Host explicitly shares an existing companion; invitation waits for committed state", async ({ page }, info) => {
  const backend = await controlledSession(page, recruited());
  const panel = page.getByRole("region", { name: "Co-op 준비", exact: true });
  await expect(panel.getByText("주인공 · Host 전용", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("초대 코드", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Aerin 정보", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "캐릭터 상세", exact: true })).toBeVisible();
  expect(backend.requests).toHaveLength(0);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await panel.getByRole("button", { name: "Aerin Co-op 허용", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  const next = backend.candidate(); backend.ack(true, next.revision);
  await expect(panel.getByLabel("초대 코드", { exact: true })).toHaveCount(0);
  backend.publish(next);
  await expect(panel.getByLabel("초대 코드", { exact: true })).toHaveValue(next.sessionId);
  expect(backend.requests[0]!.intent).toEqual({ type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
  await page.screenshot({ path: info.outputPath("coop-host.png") });
});

for (const order of ["ack-first", "snapshot-first"] as const) {
  test(`U-COOP Guest inspection is inert and claim needs ${order} ACK plus snapshot; rejection retains selection`, async ({ page }) => {
    const backend = await controlledSession(page, admitted(), "join", "guest");
    const panel = page.getByRole("region", { name: "Co-op 준비", exact: true });
    await expect(panel.getByText("하늘", { exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Aerin 정보", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
    await expect(sheet.getByRole("button", { name: "장비 해제 비교", exact: true })).toHaveCount(0);
    await sheet.getByRole("button", { name: "닫기", exact: true }).click();
    await panel.getByRole("button", { name: "Aerin 선택", exact: true }).click();
    expect(backend.requests).toHaveLength(0);
    const confirm = panel.getByRole("button", { name: "Aerin 선택 확정", exact: true });
    await confirm.click(); await expect.poll(() => backend.requests.length).toBe(1);
    backend.send({ v: backend.requests[0]!.v, type: "error", code: "STALE_REVISION", requestId: backend.requests[0]!.requestId, message: "다른 Guest의 선택이 먼저 반영되었습니다. 최신 목록을 확인하세요." });
    backend.publish();
    await expect(confirm).toBeEnabled();
    await expect(panel.getByRole("status")).toContainText("최신 목록");
    await confirm.click(); await expect.poll(() => backend.requests.length).toBe(2);
    const next = backend.candidate();
    if (order === "ack-first") backend.ack(true, next.revision); else backend.publish(next);
    await expect(panel).toHaveAttribute("aria-busy", "true");
    await expect(panel.getByRole("status")).not.toHaveText("적용되었습니다.");
    if (order === "ack-first") backend.publish(next); else backend.ack(true, next.revision);
    await expect(panel).toHaveAttribute("aria-busy", "false");
    await expect(panel.getByRole("button", { name: "선택 해제", exact: true })).toBeEnabled();
  });
}

test("U-COOP pending Guest blocks departure; solo confirmation can cancel and failure keeps Guest", async ({ page }) => {
  const backend = await controlledSession(page, admitted());
  const panel = page.getByRole("region", { name: "Co-op 준비", exact: true });
  await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toBeDisabled();
  await expect(panel.getByText(/Guest 동료 선택 대기 중/)).toBeVisible();
  await panel.getByRole("button", { name: "단독으로 진행", exact: true }).click();
  await panel.getByRole("button", { name: "취소", exact: true }).click();
  expect(backend.requests).toHaveLength(0);
  await panel.getByRole("button", { name: "단독으로 진행", exact: true }).click();
  await panel.getByRole("button", { name: "단독 진행 확인", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1); backend.reject();
  await expect(panel.getByRole("button", { name: "단독으로 진행", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toBeDisabled();
  expect(backend.state.seats).toHaveLength(2);
});

test("U-COOP Resume gates unselected Guests while preserving a read-only saved character preview", async ({ page }) => {
  const restored = createResumedSessionCoreState({ sessionId: "resume-66", playerId: "host", displayName: "Host" }, createCampaignSave(recruited()), recruitmentContext);
  const shared = recruitmentAct(restored, { type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
  const state = joinSessionCore(shared, { playerId: "guest", displayName: "Guest" }, recruitmentContext).state;
  const backend = await controlledSession(page, state);
  await expect(page.getByRole("button", { name: "모험 이어가기", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Aerin 정보", exact: true }).click();
  backend.control({ [HERO]: "host", [SECOND]: "host" });
  await expect(page.getByRole("dialog", { name: "캐릭터 상세", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "장비 해제 비교", exact: true })).toHaveCount(0);
});

test("U-COOP a connected claim invalidates an open Host Loadout comparison", async ({ page }) => {
  const backend = await controlledSession(page, admitted());
  await page.getByRole("button", { name: "Aerin 상세", exact: true }).click();
  await page.getByRole("button", { name: "장비 해제 비교", exact: true }).click();
  const next = { ...backend.state, revision: backend.state.revision + 1, guestClaims: { byMemberId: { [SECOND]: "guest" } } };
  backend.publish(next); backend.control({ [HERO]: "host", [SECOND]: "guest" });
  await expect(page.getByText("읽기 전용 · 다른 플레이어 또는 현재 단계", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "해제", exact: true })).toHaveCount(0);
  expect(backend.requests).toHaveLength(0);
});

test("U-COOP occupied companion reclaim requires confirmation; cancel and failed save preserve delegation", async ({ page }) => {
  const initial = admitted();
  const state = { ...initial, guestClaims: { byMemberId: { [SECOND]: "guest" } } };
  const backend = await controlledSession(page, state);
  const panel = page.getByRole("region", { name: "Co-op 준비", exact: true });
  await panel.getByRole("button", { name: "Aerin Co-op 해제", exact: true }).click();
  await expect(panel.getByText(/해당 Guest의 참가와 재접속이 종료/)).toBeVisible();
  await panel.getByRole("button", { name: "취소", exact: true }).click();
  expect(backend.requests).toHaveLength(0);
  await panel.getByRole("button", { name: "Aerin Co-op 해제", exact: true }).click();
  await panel.getByRole("button", { name: "조작권 회수 확인", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  backend.reject();
  await expect(panel.getByRole("button", { name: "Aerin Co-op 해제", exact: true })).toBeEnabled();
  expect(backend.state.guestClaims.byMemberId[SECOND]).toBe("guest");
  await expect(panel.getByText(/Guest · 접속 중/)).toBeVisible();
});
