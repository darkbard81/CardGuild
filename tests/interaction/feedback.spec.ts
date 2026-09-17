import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { adventure, combatCheckpoint, HERO, reactionCheckpoint } from "../support/session";

for (const choice of ["Pass", "Use Reaction"] as const) {
  test(`U-BATTLE ${choice} submits the displayed reaction choice`, async ({ page }) => {
    const state = reactionCheckpoint();
    const pending = state.combat!.pendingReaction!;
    const backend = await controlledSession(page, state);
    await page.getByRole("button", { name: choice, exact: true }).click();
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
  });
}
