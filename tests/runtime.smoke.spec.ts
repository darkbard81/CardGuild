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

/**
 * The board quad is framed inside HUD gutters the app measures from the live overlay,
 * so the test reads the published corners instead of re-deriving them from constants.
 */
async function boardCorners(page: Page): Promise<[Corner, Corner, Corner, Corner]> {
  const published = await page.locator("#pixi-canvas").getAttribute("data-board-corners");
  const corners = JSON.parse(published ?? "[]") as Corner[];
  if (corners.length !== 4) throw new Error("The board has not published its corners yet.");
  return corners as [Corner, Corner, Corner, Corner];
}

/** Sprite height as a share of the square it stands on, which must not track window size. */
async function heroCellRatio(page: Page): Promise<number> {
  const corners = await boardCorners(page);
  const feet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; scale: number }>;
  const hero = feet.find((entry) => entry.id === "hero");
  if (!hero) throw new Error("The hero has not published its layout.");
  const bottomWidth = (corners[2].x - corners[3].x) / ROAD_MAP.width;
  return hero.scale / (bottomWidth / 128);
}

async function boardPoint(
  page: Page,
  gridX: number,
  gridY: number,
): Promise<{ readonly x: number; readonly y: number }> {
  return projectCorners(await boardCorners(page), ROAD_MAP, gridX, gridY);
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

  // Card-first path: choose the card, then one of the targets it highlights.
  await page.locator('#hand-cards .tactical-card[data-action-id="trip"]:not([disabled])').first().click();
  await expect(page.locator("#board-prompt")).toContainText("강조된 적");
  await clickBoardPoint(page, 2.5, 1.5);
  await expect(page.locator("#combat-log")).toContainText("used trip");
  await expect(page.locator("#action-pips .available")).toHaveCount(0);

  const beforeZoom = await boardCorners(page);
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(100);
  const afterZoom = await boardCorners(page);
  expect(afterZoom[1].x - afterZoom[0].x).toBeGreaterThan(beforeZoom[1].x - beforeZoom[0].x);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 36, canvasBox.y + canvasBox.height / 2 + 22, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.waitForTimeout(100);
  const afterPan = await boardCorners(page);
  expect(afterPan[0].x).toBeGreaterThan(afterZoom[0].x + 30);
  const zoomedFeet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
  const zoomedHero = zoomedFeet.find((entry) => entry.id === "hero");
  const projectedHero = projectCorners(afterPan, ROAD_MAP, 1.5, 1.8);
  expect(zoomedHero?.x).toBeCloseTo(projectedHero.x, 0);
  expect(zoomedHero?.y).toBeCloseTo(projectedHero.y, 0);
  // Panning is bounded: the board centre stays on screen however far it is dragged.
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 2, canvasBox.y + canvasBox.height * 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.waitForTimeout(100);
  const dragged = await boardCorners(page);
  const boardCentre = {
    x: dragged.reduce((total, corner) => total + corner.x, 0) / dragged.length,
    y: dragged.reduce((total, corner) => total + corner.y, 0) / dragged.length,
  };
  expect(boardCentre.x).toBeGreaterThan(0);
  expect(boardCentre.x).toBeLessThan(canvasBox.width);
  expect(boardCentre.y).toBeGreaterThan(0);
  expect(boardCentre.y).toBeLessThan(canvasBox.height);

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
  const canvasBox = await page.locator("#pixi-canvas").boundingBox();
  if (!canvasBox) throw new Error("Pixi canvas does not have a bounding box.");
  const corners = await boardCorners(page);
  const board = {
    left: Math.min(...corners.map((corner) => corner.x)) + canvasBox.x,
    right: Math.max(...corners.map((corner) => corner.x)) + canvasBox.x,
    top: Math.min(...corners.map((corner) => corner.y)) + canvasBox.y,
    bottom: Math.max(...corners.map((corner) => corner.y)) + canvasBox.y,
  };
  const gutters = page.locator("[data-hud-gutter]");
  const gutterCount = await gutters.count();
  expect(gutterCount).toBeGreaterThan(0);
  for (let index = 0; index < gutterCount; index += 1) {
    const panel = gutters.nth(index);
    const box = await panel.boundingBox();
    if (!box) throw new Error("A HUD gutter element is not laid out.");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1024.5);
    expect(box.y + box.height).toBeLessThanOrEqual(768.5);
    // No board square may hide under a HUD panel.
    const overlaps =
      box.x < board.right && box.x + box.width > board.left
      && box.y < board.bottom && box.y + box.height > board.top;
    expect(
      overlaps,
      `${await panel.getAttribute("class")} overlaps the board quad`,
    ).toBe(false);
  }
  await page.screenshot({ path: testInfo.outputPath("cardguild-m2-minimum.png"), fullPage: true });

  const minimumRatio = await heroCellRatio(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(250);
  const wideWidth = await page.locator("#pixi-canvas").evaluate((canvas) => canvas.clientWidth);
  expect(wideWidth).toBeGreaterThan(850);
  // Board content is sized against its square, so widening the window enlarges the
  // squares and the standees together instead of leaving sprites oversized.
  expect(await heroCellRatio(page)).toBeCloseTo(minimumRatio, 2);
  const feet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
  const heroFoot = feet.find((entry) => entry.id === "hero");
  const expectedFoot = await boardPoint(page, 0.5, 1.8);
  expect(heroFoot?.x).toBeCloseTo(expectedFoot.x, 0);
  expect(heroFoot?.y).toBeCloseTo(expectedFoot.y, 0);
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("cardguild-m2-responsive.png"), fullPage: true });
});

test("pans an off-screen actor back into view when its turn starts", async ({ page }) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await openBattle(page);
  const canvasBox = await page.locator("#pixi-canvas").boundingBox();
  if (!canvasBox) throw new Error("Pixi canvas does not have a bounding box.");
  const actorFeet = async (id: string): Promise<{ x: number; y: number }> => {
    const feet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
    const actor = feet.find((entry) => entry.id === id);
    if (!actor) throw new Error(`${id} has not published its layout.`);
    return actor;
  };

  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  for (let index = 0; index < 8; index += 1) await page.mouse.wheel(0, -240);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 1.5, canvasBox.y + canvasBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.waitForTimeout(150);
  expect((await actorFeet("goblin-skirmisher")).x).toBeGreaterThan(canvasBox.width);

  await page.locator("#end-turn").click();
  await page.waitForTimeout(600);
  const goblin = await actorFeet("goblin-skirmisher");
  expect(goblin.x).toBeGreaterThan(0);
  expect(goblin.x).toBeLessThan(canvasBox.width);
  expect(goblin.y).toBeGreaterThan(0);
  expect(goblin.y).toBeLessThan(canvasBox.height);
  expect(runtimeErrors).toEqual([]);
});
