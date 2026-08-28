import { expect, type Page, test } from "@playwright/test";

const BOARD_COLUMNS = 9;
const BOARD_ROWS = 7;
const CELL_SIZE = 72;

function captureRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function openBattle(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#pixi-root")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#initiative-list .active")).toHaveText("Aerin");
}

async function boardGeometry(page: Page): Promise<{
  readonly scale: number;
  readonly worldX: number;
  readonly worldY: number;
}> {
  const box = await page.locator("#pixi-canvas").boundingBox();
  if (!box) throw new Error("Pixi canvas does not have a bounding box.");
  const boardWidth = BOARD_COLUMNS * CELL_SIZE;
  const boardHeight = BOARD_ROWS * CELL_SIZE;
  const scale = Math.max(0.2, Math.min((box.width - 24) / boardWidth, (box.height - 24) / boardHeight));
  return {
    scale,
    worldX: Math.max(12, (box.width - boardWidth * scale) / 2),
    worldY: Math.max(12, (box.height - boardHeight * scale) / 2),
  };
}

async function clickBoardTile(page: Page, x: number, y: number): Promise<void> {
  const geometry = await boardGeometry(page);
  await page.locator("#pixi-canvas").click({
    position: {
      x: geometry.worldX + (x * CELL_SIZE + CELL_SIZE / 2) * geometry.scale,
      y: geometry.worldY + (y * CELL_SIZE + CELL_SIZE / 2) * geometry.scale,
    },
  });
}

async function clickFacing(
  page: Page,
  x: number,
  y: number,
  direction: "north" | "east" | "south" | "west",
): Promise<void> {
  const geometry = await boardGeometry(page);
  const offsets = {
    north: { x: 0, y: -22 },
    east: { x: 22, y: 0 },
    south: { x: 0, y: 22 },
    west: { x: -22, y: 0 },
  } as const;
  const offset = offsets[direction];
  await page.locator("#pixi-canvas").click({
    position: {
      x: geometry.worldX + (x * CELL_SIZE + CELL_SIZE / 2 + offset.x) * geometry.scale,
      y: geometry.worldY + (y * CELL_SIZE + CELL_SIZE / 2 + offset.y) * geometry.scale,
    },
  });
}

test("initializes the deterministic PixiJS battle beside the DOM HUD", async ({ page }, testInfo) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await openBattle(page);

  const canvas = page.locator("#pixi-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.locator("#pixi-status")).toHaveText("Deterministic core ready");
  await expect(page.locator("#action-pips .available")).toHaveCount(3);
  await expect(page.locator("#hand-cards .tactical-card")).toHaveCount(6);
  await expect(page.locator("#app")).toHaveAttribute("data-state-hash", /^[0-9a-f]{16}$/);

  const canvasSize = await canvas.evaluate((element) => ({
    cssHeight: element.clientHeight,
    cssWidth: element.clientWidth,
    pixelHeight: element.height,
    pixelWidth: element.width,
  }));
  expect(canvasSize.cssWidth).toBeGreaterThan(500);
  expect(canvasSize.cssHeight).toBeGreaterThan(400);
  expect(canvasSize.pixelWidth).toBeGreaterThanOrEqual(canvasSize.cssWidth);
  expect(canvasSize.pixelHeight).toBeGreaterThanOrEqual(canvasSize.cssHeight);
  expect(runtimeErrors).toEqual([]);

  await page.screenshot({ path: testInfo.outputPath("cardguild-m0-initial.png"), fullPage: true });
});

test("selects an orthogonal destination and records explicit final facing", async ({ page }) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await openBattle(page);
  const initialHash = await page.locator("#app").getAttribute("data-state-hash");

  await page.locator('#basic-actions button[data-action-id="step"]').click();
  await expect(page.locator("#board-prompt")).toContainText("파란 타일");
  await clickBoardTile(page, 1, 4);
  await expect(page.locator("#board-prompt")).toContainText("바라볼 방향");
  await clickFacing(page, 1, 4, "south");

  await expect(page.locator("#hero-stats")).toContainText("south");
  await expect(page.locator("#action-pips .available")).toHaveCount(2);
  await expect(page.locator("#combat-log")).toContainText("now faces south");
  await expect(page.locator("#app")).not.toHaveAttribute("data-state-hash", initialHash ?? "");
  expect(runtimeErrors).toEqual([]);
});

test("plays context cards through AI turns and resolves a movement reaction", async ({ page }, testInfo) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await openBattle(page);

  await page.locator('#context-actions button[data-action-id="interact-lever"]').click();
  await clickBoardTile(page, 1, 2);
  await expect(page.locator("#combat-log")).toContainText("gate-lever");
  await expect(page.locator('#context-actions button[data-action-id="interact-lever"]')).toHaveCount(0);

  await page.locator('#context-actions button[data-action-id="raise-shield"]').click();
  await expect(page.locator("#hero-stats .stats-grid dd").first()).toHaveText("20");

  await page.locator('#hand-cards button[data-action-id="spirit-beacon"]:not(:disabled)').first().click();
  await expect(page.locator("#combat-log")).toContainText("created Spirit Beacon");
  await expect(page.locator('#context-actions button[data-action-id="sustain-spell"]')).toBeDisabled();

  await page.locator("#end-turn").click();
  await expect(page.locator("#round-value")).toHaveText("2", { timeout: 12_000 });
  await expect(page.locator("#initiative-list .active")).toHaveText("Aerin", { timeout: 12_000 });

  const sustain = page.locator('#context-actions button[data-action-id="sustain-spell"]');
  await expect(sustain).toBeEnabled();
  await sustain.click();
  await page.locator('#context-actions button[data-action-id="raise-shield"]').click();
  await page.locator("#end-turn").click();

  await expect(page.locator("#reaction-modal")).toBeVisible({ timeout: 12_000 });
  await expect(page.locator("#reaction-description")).toContainText("Goblin Brute");
  await page.locator("#reaction-use").click();
  await expect(page.locator("#reaction-modal")).toBeHidden();
  await expect(page.locator("#combat-log")).toContainText("used reactive-strike");
  await expect(page.locator("#discard-count")).not.toHaveText("0");
  expect(runtimeErrors).toEqual([]);

  await page.screenshot({ path: testInfo.outputPath("cardguild-m0-reaction.png"), fullPage: true });
});

test("reaches and renders a deterministic defeat outcome", async ({ page }) => {
  test.setTimeout(45_000);
  const runtimeErrors = captureRuntimeErrors(page);
  await openBattle(page);

  await page.locator('#context-actions button[data-action-id="interact-lever"]').click();
  await clickBoardTile(page, 1, 2);
  await page.locator("#end-turn").click();

  for (let step = 0; step < 100; step += 1) {
    if (await page.locator("#result-modal").isVisible()) break;
    if (await page.locator("#reaction-modal").isVisible()) {
      await page.locator("#reaction-pass").click();
    } else if ((await page.locator("#initiative-list .active").textContent()) === "Aerin") {
      await page.locator("#end-turn").click();
    }
    await page.waitForTimeout(260);
  }

  await expect(page.locator("#result-modal")).toBeVisible();
  await expect(page.locator("#result-title")).toHaveText("Defeat");
  await expect(page.locator("#app")).toHaveAttribute("data-outcome", "defeat");
  expect(runtimeErrors).toEqual([]);
});
