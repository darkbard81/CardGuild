import { expect, type Page, test } from "@playwright/test";

const ROAD_MAP = { width: 3, height: 3 };
type Corner = { readonly x: number; readonly y: number };

function projectCorners(
  corners: readonly [Corner, Corner, Corner, Corner],
  map: { readonly width: number; readonly height: number },
  gridX: number,
  gridY: number,
): { readonly x: number; readonly y: number } {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const topWidth = topRight.x - topLeft.x;
  const bottomWidth = bottomRight.x - bottomLeft.x;
  const ratio = topWidth / bottomWidth;
  const u = gridX / map.width;
  const v = gridY / map.height;
  const denominator = 1 + (ratio - 1) * v;
  return {
    x: (topWidth * u + (ratio * bottomLeft.x - topLeft.x) * v + topLeft.x) / denominator,
    y: ((ratio * bottomRight.y - topLeft.y) * v + topLeft.y) / denominator,
  };
}

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

/** Mirrors DEFAULT_BOARD_SAFE_AREA: the board is projected inside the HUD gutters. */
const BOARD_SAFE_AREA = { left: 252, top: 96, right: 268, bottom: 178 };

function projectBoardPoint(
  width: number,
  height: number,
  map: { readonly width: number; readonly height: number },
  gridX: number,
  gridY: number,
): { readonly x: number; readonly y: number } {
  const areaWidth = Math.max(240, width - BOARD_SAFE_AREA.left - BOARD_SAFE_AREA.right);
  const areaHeight = Math.max(240, height - BOARD_SAFE_AREA.top - BOARD_SAFE_AREA.bottom);
  const centerX = BOARD_SAFE_AREA.left + areaWidth / 2;
  const topWidth = areaWidth * 0.76;
  const bottomWidth = areaWidth * 0.96;
  const topY = BOARD_SAFE_AREA.top + areaHeight * 0.06;
  const bottomY = BOARD_SAFE_AREA.top + areaHeight * 0.97;
  return projectCorners([
    { x: centerX - topWidth / 2, y: topY },
    { x: centerX + topWidth / 2, y: topY },
    { x: centerX + bottomWidth / 2, y: bottomY },
    { x: centerX - bottomWidth / 2, y: bottomY },
  ], map, gridX, gridY);
}

async function boardPoint(
  page: Page,
  gridX: number,
  gridY: number,
): Promise<{ readonly x: number; readonly y: number }> {
  const box = await page.locator("#pixi-canvas").boundingBox();
  if (!box) throw new Error("Pixi canvas does not have a bounding box.");
  return projectBoardPoint(box.width, box.height, ROAD_MAP, gridX, gridY);
}

async function clickBoardPoint(page: Page, gridX: number, gridY: number): Promise<void> {
  const position = await boardPoint(page, gridX, gridY);
  await page.locator("#pixi-canvas").click({
    position,
  });
}

/** Target-first input: pick a board square, then choose an action from the radial menu. */
async function pickRingAction(
  page: Page,
  gridX: number,
  gridY: number,
  actionId: string,
): Promise<void> {
  await clickBoardPoint(page, gridX, gridY);
  await expect(page.locator("#ring-root")).toBeVisible();
  await page.locator(`#ring-root .ring-option[data-action-id="${actionId}"]`).click();
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

test("loads the 2.5D board and keeps hover, movement, and facing on the square grid", async ({ page }, testInfo) => {
  const runtimeErrors = captureRuntimeErrors(page);
  const webpResponses: string[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".webp") && response.ok()) webpResponses.push(response.url());
  });
  await openBattle(page);

  await expect(page.locator("#pixi-canvas")).toBeVisible();
  await expect(page.locator("#pixi-status")).toHaveText("2.5D board ready");
  await expect(page.locator("#action-pips .available")).toHaveCount(3);
  await expect(page.locator("#hand-cards .tactical-card")).toHaveCount(6);
  await expect(page.locator("#app")).toHaveAttribute("data-state-hash", /^[0-9a-f]{16}$/);
  expect(new Set(webpResponses).size).toBe(1);
  expect(webpResponses.some((url) => url.endsWith("/assets/m2-atlas.webp"))).toBe(true);

  const initialHash = await page.locator("#app").getAttribute("data-state-hash");
  const target = await boardPoint(page, 1.5, 1.5);
  const canvasBox = await page.locator("#pixi-canvas").boundingBox();
  if (!canvasBox) throw new Error("Pixi canvas does not have a bounding box.");
  await page.mouse.move(canvasBox.x + target.x, canvasBox.y + target.y);
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-hover-cell", "1,1");
  await pickRingAction(page, 1.5, 1.5, "step");
  await expect(page.locator("#ring-root")).toBeHidden();
  await expect(page.locator("#board-prompt")).toContainText("바라볼 방향");
  await clickBoardPoint(page, 1.5, 1.7);

  await expect(page.locator("#hero-stats")).toContainText("south");
  await expect(page.locator("#action-pips .available")).toHaveCount(2);
  await expect(page.locator("#combat-log")).toContainText("now faces south");
  await expect(page.locator("#app")).not.toHaveAttribute("data-state-hash", initialHash ?? "");
  await page.waitForTimeout(500);
  const feet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
  const heroFoot = feet.find((entry) => entry.id === "hero");
  const expectedFoot = await boardPoint(page, 1.5, 1.8);
  expect(heroFoot?.x).toBeCloseTo(expectedFoot.x, 0);
  expect(heroFoot?.y).toBeCloseTo(expectedFoot.y, 0);

  await clickBoardPoint(page, 2.5, 1.5);
  await expect(page.locator('#ring-root .ring-option[data-action-id="strike"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ring-root")).toBeHidden();
  await pickRingAction(page, 2.5, 1.5, "strike");
  await expect(page.locator("#combat-log")).toContainText("used strike");
  await expect(page.locator("#action-pips .available")).toHaveCount(1);

  const beforeZoom = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-board-corners") ?? "[]") as [Corner, Corner, Corner, Corner];
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(100);
  const afterZoom = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-board-corners") ?? "[]") as [Corner, Corner, Corner, Corner];
  expect(afterZoom[1].x - afterZoom[0].x).toBeGreaterThan(beforeZoom[1].x - beforeZoom[0].x);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 36, canvasBox.y + canvasBox.height / 2 + 22, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.waitForTimeout(100);
  const afterPan = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-board-corners") ?? "[]") as [Corner, Corner, Corner, Corner];
  expect(afterPan[0].x).toBeGreaterThan(afterZoom[0].x + 30);
  const zoomedFeet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
  const zoomedHero = zoomedFeet.find((entry) => entry.id === "hero");
  const projectedHero = projectCorners(afterPan, ROAD_MAP, 1.5, 1.8);
  expect(zoomedHero?.x).toBeCloseTo(projectedHero.x, 0);
  expect(zoomedHero?.y).toBeCloseTo(projectedHero.y, 0);
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("cardguild-m2-perspective-board.png"), fullPage: true });
});

test("fits the 1024x768 minimum and independently resizes the battlefield camera", async ({ page }, testInfo) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await openBattle(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(250);
  const minimumCanvas = await page.locator("#pixi-canvas").evaluate((canvas) => ({
    width: canvas.clientWidth,
    height: canvas.clientHeight,
  }));
  expect(minimumCanvas.width).toBe(1024);
  expect(minimumCanvas.height).toBe(768);
  const overflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  expect(overflow.horizontal).toBeLessThanOrEqual(0);
  expect(overflow.vertical).toBeLessThanOrEqual(0);
  for (const selector of [".hero-card", ".hud-status", ".hud-side", ".hand-dock"]) {
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`HUD element ${selector} is not laid out.`);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1024.5);
    expect(box.y + box.height).toBeLessThanOrEqual(768.5);
  }
  await page.screenshot({ path: testInfo.outputPath("cardguild-m2-minimum.png"), fullPage: true });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(250);
  const wideWidth = await page.locator("#pixi-canvas").evaluate((canvas) => canvas.clientWidth);
  expect(wideWidth).toBeGreaterThan(850);
  const feet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
  const heroFoot = feet.find((entry) => entry.id === "hero");
  const expectedFoot = await boardPoint(page, 0.5, 1.8);
  expect(heroFoot?.x).toBeCloseTo(expectedFoot.x, 0);
  expect(heroFoot?.y).toBeCloseTo(expectedFoot.y, 0);
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("cardguild-m2-responsive.png"), fullPage: true });
});
