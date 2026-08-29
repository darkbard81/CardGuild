import { expect, type Page, test } from "@playwright/test";

const ROAD_MAP = { width: 3, height: 3 };

function captureRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function openAdventure(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure");
}

async function openBattle(page: Page): Promise<void> {
  await openAdventure(page);
  await page.getByRole("button", { name: "Begin Adventure" }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 });
  await expect(page.locator("#app")).toHaveAttribute("data-encounter-id", "encounter.road-ambush");
  await expect(page.locator("#initiative-list .active")).toHaveText("Aerin");
}

async function clickIsoPoint(
  page: Page,
  gridX: number,
  gridY: number,
  offset: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): Promise<void> {
  const box = await page.locator("#pixi-canvas").boundingBox();
  if (!box) throw new Error("Pixi canvas does not have a bounding box.");
  const minX = -(ROAD_MAP.height - 1) * 32 - 48;
  const maxX = (ROAD_MAP.width - 1) * 32 + 48;
  const minY = -112;
  const maxY = (ROAD_MAP.width + ROAD_MAP.height - 2) * 16 + 58;
  const zoom = Math.max(
    0.55,
    Math.min(1.5, Math.min((box.width - 32) / (maxX - minX), (box.height - 32) / (maxY - minY))),
  );
  const worldX = box.width / 2 - ((minX + maxX) / 2) * zoom;
  const worldY = box.height / 2 - ((minY + maxY) / 2) * zoom;
  await page.locator("#pixi-canvas").click({
    position: {
      x: worldX + ((gridX - gridY) * 32 + offset.x) * zoom,
      y: worldY + ((gridX + gridY) * 16 + offset.y) * zoom,
    },
  });
}

test("shows the Adventure shell before loading encounter WebP assets", async ({ page }, testInfo) => {
  const runtimeErrors = captureRuntimeErrors(page);
  const webpRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(".webp")) webpRequests.push(request.url());
  });
  await openAdventure(page);

  await expect(page.locator("#adventure-content h1")).toHaveText("Goblin Trouble");
  await expect(page.locator("#adventure-progress li")).toHaveCount(3);
  await expect(page.locator("#adventure-collection")).toContainText("No rewards yet");
  expect(webpRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("cardguild-m2-adventure.png"), fullPage: true });
});

test("loads the isometric WebP atlas and records explicit movement facing", async ({ page }, testInfo) => {
  const runtimeErrors = captureRuntimeErrors(page);
  const webpResponses: string[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".webp") && response.ok()) webpResponses.push(response.url());
  });
  await openBattle(page);

  await expect(page.locator("#pixi-canvas")).toBeVisible();
  await expect(page.locator("#pixi-status")).toHaveText("Isometric presentation ready");
  await expect(page.locator("#action-pips .available")).toHaveCount(3);
  await expect(page.locator("#hand-cards .tactical-card")).toHaveCount(6);
  await expect(page.locator("#app")).toHaveAttribute("data-state-hash", /^[0-9a-f]{16}$/);
  expect(new Set(webpResponses).size).toBe(1);
  expect(webpResponses.some((url) => url.endsWith("/assets/m2-atlas.webp"))).toBe(true);

  const initialHash = await page.locator("#app").getAttribute("data-state-hash");
  await page.locator('#basic-actions button[data-action-id="step"]').click();
  await clickIsoPoint(page, 1, 1);
  await expect(page.locator("#board-prompt")).toContainText("바라볼 방향");
  await clickIsoPoint(page, 1, 1, { x: -25, y: 15 });

  await expect(page.locator("#hero-stats")).toContainText("south");
  await expect(page.locator("#action-pips .available")).toHaveCount(2);
  await expect(page.locator("#combat-log")).toContainText("now faces south");
  await expect(page.locator("#app")).not.toHaveAttribute("data-state-hash", initialHash ?? "");
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("cardguild-m2-isometric.png"), fullPage: true });
});

test("reflows HUD and independently resizes the battlefield camera", async ({ page }, testInfo) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await openBattle(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileCanvas = await page.locator("#pixi-canvas").evaluate((canvas) => ({
    width: canvas.clientWidth,
    height: canvas.clientHeight,
  }));
  expect(mobileCanvas.width).toBeGreaterThan(350);
  expect(mobileCanvas.height).toBeGreaterThan(210);
  expect(await page.locator(".battle-layout").evaluate((node) => getComputedStyle(node).display)).toBe("flex");

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(250);
  const wideWidth = await page.locator("#pixi-canvas").evaluate((canvas) => canvas.clientWidth);
  expect(wideWidth).toBeGreaterThan(850);
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("cardguild-m2-responsive.png"), fullPage: true });
});
