import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { combatCheckpoint, HERO } from "../support/session";

// Screen targets independently inspected in the 1024×768 product screenshot: the 3×3
// Road Ambush board is already rotated 45 degrees. These are pixel input targets, not
// calls back into the product's inverse projection or test-only scene-graph exports.
const hero = { x: 235, y: 300 };
const east = { x: 342, y: 354 };

test("U-BATTLE hover and Step direction cancellation are inert; End Turn commits only its chosen facing", async ({ page }, testInfo) => {
  const backend = await controlledSession(page, combatCheckpoint());
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
  await page.mouse.move(hero.x, hero.y);
  expect(backend.requests).toHaveLength(0);
  await page.mouse.click(hero.x, hero.y);
  await expect(page.getByRole("menu", { name: "Aerin", exact: true }).getByRole("menuitem", { name: /Step/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /Step/ }).click();
  await expect(page.locator("#board-prompt")).toContainText("제자리 Step");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Aerin", exact: true }).getByRole("menuitem", { name: /Step/ })).toBeVisible();
  expect(backend.requests).toHaveLength(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await expect(page.locator("#board-prompt")).toContainText("턴을 마칠 때 바라볼 위치");
  await page.keyboard.press("Escape");
  await expect(page.locator("#board-prompt")).toContainText("턴을 마칠 때 바라볼 위치");
  expect(backend.requests).toHaveLength(0);
  await page.mouse.click(east.x, east.y);
  await expect.poll(() => backend.requests.map(r => r.intent)).toEqual([{ type: "end-turn", facing: "east" }]);
  const screenshot = testInfo.outputPath("board-facing.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("board-facing", { path: screenshot, contentType: "image/png" });
});

test("U-BOARD zoom, pan and resize still select the visible rotated tile and dispatch its intended move", async ({ page }) => {
  const backend = await controlledSession(page, combatCheckpoint());
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
  await page.mouse.move(east.x, east.y);
  await page.mouse.wheel(0, -100);
  // Zoom is anchored at the pointer: the tile under the pointer remains the same tile.
  await page.mouse.click(east.x, east.y);
  await expect(page.getByRole("menu", { name: "Tile 1,1", exact: true }).getByRole("menuitem", { name: /Step/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.move(east.x, east.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(east.x + 20, east.y + 10, { steps: 3 });
  await page.mouse.up({ button: "middle" });
  await page.setViewportSize({ width: 1100, height: 768 });
  await page.mouse.click(east.x + 20 + 38, east.y + 10);
  await expect(page.getByRole("menu", { name: "Tile 1,1", exact: true }).getByRole("menuitem", { name: /Step/ })).toBeVisible();
  expect(backend.requests).toHaveLength(0);
  await page.getByRole("menuitem", { name: /Step/ }).click();
  await expect.poll(() => backend.requests.map(r => r.intent)).toEqual([{ type: "use-action", action: { kind: "basic", id: "step" }, target: { kind: "tile", position: { x: 1, y: 1 } } }]);
});

test("U-BATTLE a control change discards an open target menu before it can issue stale input", async ({ page }) => {
  const backend = await controlledSession(page, combatCheckpoint());
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
  await page.mouse.click(east.x, east.y);
  await expect(page.getByRole("menuitem", { name: /Step/ })).toBeVisible();
  backend.control({ [HERO]: "guest" });
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: /Step/ })).toBeHidden();
  await page.mouse.click(east.x, east.y);
  expect(backend.requests).toHaveLength(0);
});

test("U-BOARD pinch/pan release cannot answer End Turn; the next deliberate tap can", async ({ page }) => {
  const backend = await controlledSession(page, combatCheckpoint());
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 280, y: 350, id: 1 }, { x: 400, y: 350, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 260, y: 355, id: 1 }, { x: 430, y: 355, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: 430, y: 355, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator("#board-prompt")).toContainText("턴을 마칠 때 바라볼 위치");
    expect(backend.requests).toHaveLength(0);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 450, y: 400, id: 3 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => backend.requests.map(r => r.intent.type)).toEqual(["end-turn"]);
  } finally { await cdp.detach(); }
});
