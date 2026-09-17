import { expect, test, type WebSocketRoute } from "@playwright/test";
import { createCampaignAsHost } from "../support/browser/host-login";
import { boardPoint } from "../support/browser/tactical-support";

test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

test("touch fan plays through the server and waits for its matching ACK", async ({ page }, info) => {
  let holdAck = false;
  let heldAck: string | undefined;
  let socket: WebSocketRoute | undefined;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket(/\/ws(?:\?|$)/, route => {
    socket = route;
    const server = route.connectToServer();
    route.onMessage(message => server.send(message));
    server.onMessage(message => {
      if (holdAck && JSON.parse(String(message)).type === "ack") heldAck = String(message);
      else route.send(message);
    });
  });
  await createCampaignAsHost(page, "HUD Touch");
  await page.getByRole("button", { name: "동료 2 비우기", exact: true }).click();
  await page.getByRole("button", { name: "동료 1 비우기", exact: true }).click();
  await page.locator("#apply-party").click();
  await page.locator("#begin-adventure").click();
  await page.getByRole("button", { name: "전투 시작", exact: true }).click();
  await expect(page.locator("#end-turn")).toBeEnabled();
  await page.screenshot({ path: info.outputPath("hud-default-1024.png") });
  const card = page.locator('#hand-cards [data-action-id="trip"]').first();
  await card.tap({ position: { x: 20, y: 20 } });
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#hand-toggle")).toHaveAttribute("aria-expanded", "true");
  await card.tap();
  await expect(page.locator('#character-panel [aria-selected="true"]')).toHaveText("ACTION");
  await page.screenshot({ path: info.outputPath("hud-action-1024.png") });
  holdAck = true;
  await page.locator("#pixi-canvas").tap({ position: await boardPoint(page, 2.5, 1.5) });
  await expect.poll(() => heldAck).toBeTruthy();
  await expect(page.locator("#combat-status")).toHaveText("요청 처리 중");
  await expect(page.locator("#end-turn")).toBeDisabled();
  await page.locator('#character-panel [role="tab"]').filter({ hasText: "SKILLS" }).tap();
  await expect(page.locator('#character-panel [aria-selected="true"]')).toHaveText("SKILLS");
  holdAck = false;
  socket!.send(heldAck!);
  await expect(page.locator("#end-turn")).toBeEnabled();
  await expect(page.locator("#combat-log")).toContainText("used Trip");
  expect(errors).toEqual([]);
});
