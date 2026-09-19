import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { adventure, combatCheckpoint, HERO, reactionCheckpoint } from "../support/session";

for (const choice of ["Pass", "Use Reaction"] as const) {
  test(`U-BATTLE ${choice} submits the displayed reaction choice`, async ({ page }, testInfo) => {
    const state = reactionCheckpoint();
    const pending = state.combat!.pendingReaction!;
    const backend = await controlledSession(page, state);
    const description = page.locator("#reaction-description");
    await expect(description).toContainText("기본 Strike:");
    await expect(description).toContainText("반응 1회");
    if (choice === "Use Reaction") await page.screenshot({ path: testInfo.outputPath("reaction-preview.png") });
    await page.getByRole("button", { name: choice, exact: true }).click();
    await expect(description).toContainText("요청 처리 중");
    await expect(description).toContainText("기본 Strike:");
    await expect(page.getByRole("button", { name: choice, exact: true })).toBeDisabled();
    await expect.poll(() => backend.requests.map(r => r.intent)).toEqual([choice === "Pass"
      ? { type: "pass-reaction", triggerId: pending.triggerId }
      : { type: "use-reaction", triggerId: pending.triggerId, cardInstanceId: pending.candidates[0]!.cardInstanceId }]);
    const candidate = backend.candidate();
    backend.ack(true, candidate.revision); backend.publish(candidate);
    await expect(page.getByRole("dialog", { name: "Reactive Strike?", exact: true })).toBeHidden();
  });
}

test("U-FEEDBACK pending growth offers a focused choice and leaves the next action available after confirmation", async ({ page }) => {
  const ready = adventure();
  const member = ready.adventure!.party.members[HERO]!;
  const grown = { ...ready, adventure: { ...ready.adventure!, party: { members: {
    [HERO]: { ...member, progression: { level: 3, experience: 100, advancements: [] } },
  } } } };
  const backend = await controlledSession(page, grown);
  await page.getByRole("button", { name: "Aerin 성장 선택", exact: true }).click();
  const skill = page.getByLabel("Skill Increase");
  await expect(skill).toBeFocused();
  await skill.selectOption("athletics");
  await expect(page.locator(".advancement-preview")).toContainText("athletics modifier");
  await expect(page.locator(".advancement-preview")).toContainText("athletics DC");
  await page.getByRole("button", { name: "성장 확정", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  const candidate = backend.candidate();
  backend.ack(true, candidate.revision); backend.publish(candidate);
  await expect(page.getByRole("button", { name: "전투 시작", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "성장 확정", exact: true })).toHaveCount(0);
});

test("U-FEEDBACK resync clears stale targeting; session closure presents a route back to entry", async ({ page }) => {
  const backend = await controlledSession(page, combatCheckpoint());
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await page.getByRole("button", { name: "턴 종료", exact: true }).click();
  backend.publish({ ...backend.state, revision: backend.state.revision + 1 });
  await expect(page.locator("#board-prompt")).toContainText("보드에서 적");
  backend.terminal();
  await expect(page.getByRole("button", { name: "새 모험 시작", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeHidden();
  expect(backend.requests).toHaveLength(0);
});

for (const phase of ["failed", "complete"] as const) {
  test(`U-FEEDBACK ${phase} replaces stale combat controls with the saved result`, async ({ page }) => {
    const state = combatCheckpoint();
    const backend = await controlledSession(page, state);
    await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
    backend.publish({ ...state, revision: state.revision + 1, combat: null, adventure: { ...state.adventure!, phase, pendingReward: null, currentEncounterId: null } });
    await expect(page.getByRole("heading", { name: phase === "failed" ? "The party was defeated" : "Goblin Trouble resolved", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeHidden();
    await page.getByRole("button", { name: "시작 화면으로", exact: true }).click();
    await expect(page.getByRole("button", { name: "새 모험 시작", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "새 모험 시작", exact: true })).toBeVisible();
  });
}

for (const order of ["ack-first", "snapshot-first"] as const) {
test(`U-REWARD inspection is inert and explicit acquisition waits for ${order}`, async ({ page }, testInfo) => {
  const base = adventure();
  const state = { ...base, adventure: { ...base.adventure!, phase: "reward" as const,
    pendingReward: { rewardId: "ui-reward", encounterId: "encounter.road-ambush", choices: ["card.brace-behind-cover", "card.careful-advance", "card.force-barrage"].map(definitionId => ({ kind: "card" as const, definitionId })) } } };
  const backend = await controlledSession(page, state);
  const take = page.getByRole("button", { name: "이 보상 획득", exact: true });
  await expect(take).toBeDisabled();
  await page.locator(".reward-choice").nth(1).click();
  await page.locator(".reward-choice").first().click();
  await expect(take).toBeEnabled();
  await expect(take).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("reward-comparison.png") });
  expect(backend.requests).toHaveLength(0);
  await take.click();
  await expect.poll(() => backend.requests.map(request => request.intent)).toEqual([
    { type: "choose-reward", rewardId: "ui-reward", choiceIndex: 0 },
  ]);
  await expect(page.getByRole("button", { name: "보상 적용 중…", exact: true })).toBeDisabled();
  backend.reject();
  await expect(take).toBeEnabled();
  await take.click();
  await expect.poll(() => backend.requests.length).toBe(2);
  if (order === "ack-first") {
    backend.ack(true, state.revision + 1);
    await expect(page.getByRole("button", { name: "보상 적용 중…", exact: true })).toBeDisabled();
  }
  backend.publish({ ...state, revision: state.revision + 1, adventure: {
    ...state.adventure!, phase: "between-encounters", pendingReward: null,
    collection: { ...state.adventure!.collection, cards: { ...state.adventure!.collection.cards,
      "card.brace-behind-cover": (state.adventure!.collection.cards["card.brace-behind-cover"] ?? 0) + 1 } },
  } });
  if (order === "snapshot-first") {
    await expect(page.getByText("보상 적용 결과 확인 중…", { exact: true })).toBeVisible();
    backend.ack(true, state.revision + 1);
  }
  await expect(page.getByText("Collection에 추가되었습니다 · 장비·카드 준비에서 Loadout에 반영하세요.", { exact: true })).toBeVisible();
});

}

test("U-REACTION observers can inspect the battlefield without decision buttons", async ({ page }) => {
  const state = reactionCheckpoint();
  const backend = await controlledSession(page, state);
  backend.control({ [HERO]: "guest" });
  await expect(page.getByRole("dialog", { name: "Reactive Strike?", exact: true })).toBeHidden();
  await expect(page.getByText(/님이 Reaction을 선택하고 있습니다/)).toBeVisible();
  await page.getByRole("button", { name: "Aerin 상세", exact: true }).click();
  await expect(page.getByRole("region", { name: "기본 정보와 방어", exact: true })).toBeVisible();
  expect(backend.requests).toHaveLength(0);
});

test("U-STARTUP renderer initialization failure offers a visible retry", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => { throw new Error("U-STARTUP graphics unavailable"); };
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "게임을 시작하지 못했습니다", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 시도", exact: true })).toBeEnabled();
});
