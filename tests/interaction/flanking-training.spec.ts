import { expect, test } from "@playwright/test";
import { dispatchSessionIntent, joinSessionCore } from "../../src/session";
import { controlledSession } from "../support/browser-backend";
import { HERO, SECOND } from "../support/session";
import { recruitedParty, tutorialAct as act, tutorialContext as context } from "../support/tutorial";

for (const viewer of ["host", "guest"]) test(`U-FLANK ${viewer}: real party, Minerva briefing, board movement and current flanking preview`, async ({ page }, info) => {
  let ready = recruitedParty();
  if (viewer === "guest") {
    ready = act(ready, { type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
    const joined = joinSessionCore(ready, { playerId: viewer, displayName: "Guest" }, context);
    if (!joined.accepted) throw new Error(joined.error);
    const claimed = dispatchSessionIntent(joined.state, viewer, { type: "select-character", memberId: SECOND }, context,
      { connectedPlayerIds: ["host", viewer], effectiveControllerByMemberId: { [HERO]: "host", [SECOND]: "host" } });
    if (!claimed.accepted) throw new Error(claimed.error);
    ready = claimed.state;
  }
  // The controlled backend stages only the turn boundary. All measured moves and attacks use real intents.
  const started = act(ready, { type: "start-encounter" });
  const active = { ...started, combat: { ...started.combat!, turn: { ...started.combat!.turn,
    activeActorId: SECOND, activeIndex: started.combat!.turn.initiativeOrder.indexOf(SECOND),
  } } };
  const backend = await controlledSession(page, viewer === "host" ? ready : active, "join", viewer, "skip", context);
  const scene = page.getByRole("dialog", { name: "미네르바의 협공 안내", exact: true });
  if (viewer === "host") {
    await expect(page.getByRole("button", { name: "Aerin Co-op 허용", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Arlen 정보", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "전투 시작", exact: true }).click();
    await expect(scene).toContainText("Aerin과 함께");
    await expect(page.locator("#app")).toHaveAttribute("data-screen", "combat");
    await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await expect(scene).toContainText("피해를 전부 무효화");
    expect(backend.requests).toHaveLength(0);
    await scene.getByRole("button", { name: "건너뛰기", exact: true }).click();
    await expect.poll(() => backend.requests.length).toBe(1);
    expect(backend.requests[0]!.intent).toEqual({ type: "start-encounter" });
    backend.candidate(); // The real admission boundary must accept the recruited party.
    backend.ack(true, active.revision); backend.publish(active);
  } else await expect(scene).toHaveCount(0);
  const end = page.getByRole("button", { name: "End Turn", exact: true });
  await expect(end).toBeEnabled();
  const count = backend.requests.length;
  await page.locator("#action-preview-summary").click();
  await page.mouse.click(379, 446);
  const strike = page.getByRole("menuitem", { name: /^Strike / });
  await strike.hover();
  const detail = page.locator("#selected-detail");
  await expect(detail).toContainText("Flanking이 아니면 피해가 0");
  await page.keyboard.press("Escape");
  await page.mouse.click(499, 504);
  await page.getByRole("menuitem", { name: /^Stride / }).click();
  await expect.poll(() => backend.requests.length).toBe(count + 1);
  expect(backend.requests.at(-1)!.intent).toEqual({ type: "use-action", action: { kind: "basic", id: "stride" }, target: { kind: "tile", position: { x: 2, y: 1 } } });
  const moved = backend.candidate();
  backend.ack(true, moved.revision); backend.publish(moved);
  await expect(end).toBeEnabled();
  await page.mouse.click(379, 446); await strike.hover();
  await expect(detail).toContainText("Off-Guard -2");
  await expect(detail).toContainText("Flanking");
  await expect(detail.getByText("협공 아군: Arlen", { exact: true })).toBeVisible();
  await expect(detail).toContainText("12 → 10");
  await expect(detail).not.toContainText("피해가 0");
  await detail.getByText("협공 아군: Arlen", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`flanking-${viewer}.png`) });
  // An authoritative partner change invalidates the open preview immediately.
  backend.publish({ ...moved, revision: moved.revision + 1, combat: { ...moved.combat!, actors: {
    ...moved.combat!.actors, [HERO]: { ...moved.combat!.actors[HERO]!, position: { x: 0, y: 2 } },
  } } });
  await expect(detail).not.toContainText("협공 아군: Arlen");
  await page.keyboard.press("Escape");
  await page.mouse.click(379, 446); await strike.hover();
  await expect(detail).toContainText("Flanking이 아니면 피해가 0");
  expect(backend.requests).toHaveLength(count + 1);
});


test("U-FLANK ranged protagonist receives an actionable preparation reason and can depart after unequipping the bow", async ({ page }) => {
  const backend = await controlledSession(page, recruitedParty(69, "human.ranger"), "join", "host", "skip", context);
  const departure = page.getByRole("button", { name: "전투 시작", exact: true });
  await expect(departure).toBeDisabled();
  await expect(page.getByText(/협공 훈련에는 근접 위협을 만드는 아군 두 명/)).toBeVisible();
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  await page.getByRole("button", { name: "장비 해제 비교", exact: true }).click();
  await page.getByRole("button", { name: "해제", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  const ready = backend.candidate(); backend.ack(true, ready.revision); backend.publish(ready);
  await expect(page.getByRole("button", { name: "닫기", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(departure).toBeEnabled();
  await departure.click();
  await expect(page.getByRole("dialog", { name: "미네르바의 협공 안내", exact: true })).toBeVisible();
});
