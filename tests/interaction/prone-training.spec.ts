import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { trainingReady, resolveOpening, tutorialContext } from "../support/tutorial";
import { HERO } from "../support/session";

for (const method of ["skip", "escape", "complete"] as const) test(`U-PRONE ${method}: authoritative Trip precedes dialogue; persisted completion then one Ring Stand`, async ({ page }) => {
  const backend = await controlledSession(page, trainingReady(), "join", "host", "skip", tutorialContext);
  const scene = page.getByRole("dialog", { name: "미네르바의 상태 회복 안내", exact: true });
  await page.getByRole("button", { name: "전투 시작", exact: true }).click();
  await expect.poll(() => backend.requests.length).toBe(1);
  const started = backend.candidate();
  backend.ack(true, started.revision); backend.publish(started);
  await expect(page.getByRole("region", { name: "Tactical combat", exact: true })).toBeVisible();
  await expect(scene).toHaveCount(0);
  const applied = resolveOpening(started);
  backend.publish(applied.state, applied.events);
  await expect(scene).toContainText("AC가 2");
  expect(backend.state.combat!.actors[HERO]!.conditions.some(c => c.id === "prone")).toBe(true);
  await page.keyboard.press("Enter");
  await expect(scene).toContainText("Ring Menu");
  if (method === "skip") {
    backend.disconnect();
    await expect.poll(() => backend.handshakes).toBe(2);
    await expect(scene).toContainText("Ring Menu");
  }
  if (method === "skip") await scene.getByRole("button", { name: "건너뛰기" }).click();
  else if (method === "escape") await page.keyboard.press("Escape");
  else { await page.keyboard.press("Enter"); await page.mouse.click(70, 80); }
  await expect.poll(() => backend.requests.length).toBe(2);
  expect(backend.requests[1]!.intent).toEqual({ type: "complete-scene", sceneId: "guild-prone-recovery" });
  if (method === "skip") {
    backend.ack(false); backend.reject();
    await expect(scene).toContainText("다시 시도");
    await page.mouse.dblclick(70, 80);
    await expect.poll(() => backend.requests.length).toBe(3);
  }
  const count = backend.requests.length;
  const settled = backend.candidate();
  if (method === "skip") backend.publish(settled); else backend.ack(true, settled.revision);
  await expect(scene).toBeVisible();
  await page.mouse.click(70, 80);
  expect(backend.requests).toHaveLength(count);
  if (method === "skip") backend.ack(true, settled.revision); else backend.publish(settled);
  await expect(scene).toHaveCount(0);
  expect(backend.state.combat!.actors[HERO]!.conditions.some(c => c.id === "prone")).toBe(true);
  backend.publish(); // Replayed/resync snapshot must not show the completed scene again.
  await page.mouse.click(259, 386);
  const stand = page.getByRole("menuitem", { name: /^Stand / });
  await expect(stand).toBeVisible();
  await stand.click();
  await expect.poll(() => backend.requests.length).toBe(count + 1);
  expect(backend.requests.at(-1)!.intent).toMatchObject({ type: "use-action", action: { kind: "context", id: "stand" } });
  const standing = backend.candidate();
  backend.ack(true, standing.revision); backend.publish(standing);
  expect(backend.state.combat!.actors[HERO]!.conditions.some(c => c.id === "prone")).toBe(false);
  expect(backend.state.combat!.turn.actionsRemaining).toBe(2);
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
  await expect(scene).toHaveCount(0);
});
