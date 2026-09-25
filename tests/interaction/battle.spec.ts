import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { combatCheckpoint, HERO } from "../support/session";

// Screen targets independently inspected in the 1024×768 product screenshot: the 3×3
// Guild practice board is already rotated 45 degrees. These are pixel input targets, not
// calls back into the product's inverse projection or test-only scene-graph exports.
const hero = { x: 260, y: 386 };
const east = { x: 379, y: 446 };

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
  await page.getByRole("button", { name: "턴 종료", exact: true }).click();
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
  await page.getByRole("button", { name: "턴 종료", exact: true }).click();
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 280, y: 350, id: 1 }, { x: 400, y: 350, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 260, y: 355, id: 1 }, { x: 430, y: 355, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: 430, y: 355, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator("#board-prompt")).toContainText("턴을 마칠 때 바라볼 위치");
    expect(backend.requests).toHaveLength(0);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 600, y: 530, id: 3 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => backend.requests.map(r => r.intent.type)).toEqual(["end-turn"]);
  } finally { await cdp.detach(); }
});

test("U-END-TURN cancel preserves the interaction and zero actions need no confirmation", async ({ page }, testInfo) => {
  const backend = await controlledSession(page, combatCheckpoint());
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "남은 행동 포기 확인", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("end-turn-confirm.png") });
  await page.getByRole("button", { name: "계속 행동", exact: true }).click();
  expect(backend.requests).toHaveLength(0);
  await page.mouse.click(east.x, east.y);
  await expect(page.getByRole("menuitem", { name: /Step/ })).toBeVisible();
  backend.publish({ ...backend.state, revision: backend.state.revision + 1, combat: {
    ...backend.state.combat!, turn: { ...backend.state.combat!.turn, actionsRemaining: 0 },
  } });
  await expect(page.getByRole("dialog", { name: "남은 행동 포기 확인", exact: true })).toBeHidden();
  await expect(page.locator("#board-prompt")).toContainText("바라볼");
  await page.mouse.click(east.x, east.y);
  await expect.poll(() => backend.requests.map(request => request.intent.type)).toEqual(["end-turn"]);
});

test.describe("touch inspection", () => {
  test.use({ hasTouch: true });
test("U-INSPECT ring and hand detail modes never send gameplay requests", async ({ page }) => {
  const backend = await controlledSession(page, combatCheckpoint());
  await page.getByRole("button", { name: "카드 상세 보기", exact: true }).tap();
  const card = page.locator(".tactical-card").filter({ visible: true }).first();
  await card.tap();
  await expect(page.locator("#card-detail")).toBeVisible();
  expect(backend.requests).toHaveLength(0);
  await page.getByRole("button", { name: "손패 접기", exact: true }).tap();
  await expect(page.locator("#card-detail")).toBeHidden();
  await page.touchscreen.tap(hero.x, hero.y);
  await page.getByRole("button", { name: "행동 상세 보기", exact: true }).tap();
  await page.getByRole("menuitem", { name: /Step/ }).tap();
  await expect(page.getByRole("menuitem", { name: /Step/ })).toBeVisible();
  expect(backend.requests).toHaveLength(0);
  await page.getByRole("button", { name: "상세 모드 · 실행으로 전환", exact: true }).tap();
  await page.getByRole("menuitem", { name: /Step/ }).tap();
  await expect(page.locator("#board-prompt")).toContainText("제자리 Step");
});

});

test("U-TARGET invalid target retains the selected card and allows a corrected target", async ({ page }) => {
  const base = combatCheckpoint();
  const combat = base.combat!;
  const zones = combat.cardZones[HERO]!;
  const state = { ...base, combat: { ...combat,
    actors: { ...combat.actors, "slime-trainee": { ...combat.actors["slime-trainee"]!, position: { x: 1, y: 1 } } },
    cardZones: { ...combat.cardZones, [HERO]: { ...zones, hand: [{ ...zones.hand[0]!, definitionId: "card.vicious-swing" }] } },
  } };
  const backend = await controlledSession(page, state);
  await page.getByRole("button", { name: "손패 펼치기", exact: true }).click();
  const card = page.getByRole("button", { name: /Vicious Swing/ });
  await card.click();
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(hero.x, hero.y);
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#board-prompt")).toContainText("선택은 유지됩니다");
  expect(backend.requests).toHaveLength(0);
  await page.mouse.click(east.x, east.y);
  await expect.poll(() => backend.requests.map(request => request.intent.type)).toEqual(["use-action"]);
});
