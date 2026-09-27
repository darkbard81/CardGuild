import { expect, test } from "@playwright/test";
import { dispatchSessionIntent, joinSessionCore } from "../../src/session";
import { controlledSession } from "../support/browser-backend";
import { HERO, SECOND } from "../support/session";
import { recruitedParty, tutorialWin, tutorialAct as act, tutorialContext as context } from "../support/tutorial";

for (const viewer of ["host", "guest"]) test(`U-KNOWLEDGE-TRAINING ${viewer}: briefing, real recall, ACK/snapshot unlock and manual detail`, async ({ page }, info) => {
  let ready: import("../../src/session").SessionCoreState = tutorialWin(recruitedParty(15, "human.wizard"));
  if (viewer === "guest") {
    ready = act(ready, { type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
    const joined = joinSessionCore(ready, { playerId: viewer, displayName: "Guest" }, context);
    if (!joined.accepted) throw new Error(joined.error);
    const claimed = dispatchSessionIntent(joined.state, viewer, { type: "select-character", memberId: SECOND }, context,
      { connectedPlayerIds: ["host", viewer], effectiveControllerByMemberId: { [HERO]: "host", [SECOND]: "host" } });
    if (!claimed.accepted) throw new Error(claimed.error);
    ready = claimed.state;
  }
  const actorId = viewer === "host" ? HERO : SECOND;
  const started = act(ready, { type: "start-encounter" });
  const active = { ...started, combat: { ...started.combat!, turn: { ...started.combat!.turn,
    activeActorId: actorId, activeIndex: started.combat!.turn.initiativeOrder.indexOf(actorId),
  } } };
  const backend = await controlledSession(page, viewer === "host" ? ready : active, "join", viewer, "skip", context);
  const scene = page.getByRole("dialog", { name: "미네르바의 지식 회상 안내", exact: true });
  if (viewer === "host") {
    await page.getByRole("button", { name: "전투 시작", exact: true }).click();
    await expect(scene).toContainText("마지막 길드 훈련");
    await page.keyboard.press("Enter"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
    await expect(scene).toContainText("반드시 성공");
    expect(backend.requests).toHaveLength(0);
    await scene.getByRole("button", { name: "건너뛰기", exact: true }).click();
    await expect.poll(() => backend.requests.length).toBe(1);
    expect(backend.requests[0]!.intent).toEqual({ type: "start-encounter" });
    backend.candidate(); backend.ack(true, active.revision); backend.publish(active);
  } else await expect(scene).toHaveCount(0);
  const end = page.getByRole("button", { name: "End Turn", exact: true });
  await expect(end).toBeEnabled();
  const before = backend.requests.length;
  await page.mouse.click(379, 446);
  await page.getByRole("menuitem", { name: /상세 잠김/ }).click();
  await expect(page.getByRole("dialog", { name: "캐릭터 상세", exact: true })).toHaveCount(0);
  await page.mouse.click(379, 446);
  await page.getByRole("menuitem", { name: /Recall Knowledge/ }).click();
  await expect.poll(() => backend.requests.length).toBe(before + 1);
  expect(backend.requests.at(-1)!.intent).toEqual({ type: "use-action", action: { kind: "basic", id: "recall-knowledge" }, target: { kind: "actor", actorId: "android-trainee" } });
  const candidate = backend.candidate();
  backend.ack(true, candidate.revision);
  await expect(page.getByRole("button", { name: /상세 잠김/ })).toBeVisible();
  const sheet = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
  backend.publish(candidate);
  await expect(end).toBeEnabled();
  await expect(sheet).toHaveCount(0);
  await page.mouse.click(379, 446);
  await page.getByRole("menuitem", { name: /^캐릭터 상세/ }).click();
  await expect(sheet).toContainText("길드 훈련 안드로이드");
  await expect(sheet).toContainText("AC");
  await expect(sheet).toContainText("Athletics");
  await page.screenshot({ path: info.outputPath(`knowledge-${viewer}.png`) });
  await page.keyboard.press("Escape");
  // Reconnect restores the committed snapshot without replaying the scene or sending an action.
  const handshakes = backend.handshakes;
  backend.disconnect();
  await expect.poll(() => backend.handshakes).toBeGreaterThan(handshakes);
  await expect(end).toBeEnabled();
  await expect(scene).toHaveCount(0);
  await expect(page.getByRole("button", { name: "길드 훈련 안드로이드 상세", exact: true })).toBeVisible();
  expect(backend.requests).toHaveLength(before + 1);
});
