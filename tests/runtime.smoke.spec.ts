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
    // PixiJS reports resource-lifetime mistakes — a texture freed while a shader still
    // binds it, say — as warnings, and those are bugs even when nothing throws.
    if (message.type() === "warning" && message.text().includes("PixiJS Warning")) errors.push(message.text());
  });
  return errors;
}

async function openAdventure(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "session");
  await page.locator("#session-display-name").fill("Solo Host");
  await page.locator("#create-session").click();
  await expect(page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "host");
  await page.locator("#party-slot-2").selectOption("");
  await page.locator("#party-slot-3").selectOption("");
  await page.locator("#apply-party").click();
  await expect(page.locator("#begin-adventure")).toBeEnabled();
  await page.locator("#begin-adventure").click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure");
}

async function openBattle(page: Page): Promise<void> {
  await openAdventure(page);
  await page.getByRole("button", { name: "Enter Encounter" }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 });
  await expect(page.locator("#app")).toHaveAttribute("data-encounter-id", "encounter.road-ambush");
  await expect(page.locator("#initiative-list .active")).toHaveText("Aerin");
}

/** The character sheet is behind a toggle now, so a test that reads it has to open it. */
async function openHeroDetails(page: Page): Promise<void> {
  const toggle = page.locator("#hero-details-toggle");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await expect(page.locator("#hero-details")).toBeVisible();
}

async function controlledActorId(page: Page): Promise<string> {
  const actorId = await page.locator("#app").getAttribute("data-controlled-actor-id");
  if (!actorId) throw new Error("The client has not published its controlled actor ID.");
  return actorId;
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
  const heroId = await controlledActorId(page);
  const hero = feet.find((entry) => entry.id === heroId);
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

async function strikeRoadEnemy(page: Page): Promise<boolean> {
  for (const [gridX, gridY] of [[2.5, 1.5], [1.5, 1.5]] as const) {
    if (await page.locator("#app").getAttribute("data-screen") !== "combat") return false;
    if (await page.locator("#result-modal").isVisible()) return false;
    await clickBoardPoint(page, gridX, gridY);
    const strike = page.locator('#ring-root .ring-option[data-action-id="strike"]');
    if (await strike.isVisible()) {
      const revision = await page.locator("#app").getAttribute("data-session-revision");
      await strike.click();
      await expect(page.locator("#app")).not.toHaveAttribute("data-session-revision", revision ?? "");
      return true;
    }
    await page.keyboard.press("Escape");
  }
  return false;
}

async function waitForRoadTurn(page: Page): Promise<void> {
  for (let step = 0; step < 20; step += 1) {
    if (await page.locator("#app").getAttribute("data-screen") !== "combat") return;
    if (await page.locator("#result-modal").isVisible()) return;
    if (await page.locator("#reaction-modal").isVisible()) {
      // The authoritative server can resolve the window between the visibility check and
      // the click, so a vanished button means the reaction is already settled, not a
      // failure. Take it when it is still there and keep waiting either way.
      await page.getByRole("button", { name: "Use Reaction" }).click({ timeout: 2_000 })
        .catch(() => undefined);
      continue;
    }
    if ((await page.locator("#initiative-list .active").textContent())?.includes("Aerin")) return;
    await page.waitForTimeout(300);
  }
  throw new Error("Road Ambush did not return control to Aerin.");
}

async function winRoadAmbush(page: Page): Promise<void> {
  for (let round = 0; round < 7; round += 1) {
    await waitForRoadTurn(page);
    if (await page.locator("#app").getAttribute("data-screen") !== "combat") break;
    if (await page.locator("#result-modal").isVisible()) break;
    while (await page.locator("#action-pips .available").count()) {
      if (!await strikeRoadEnemy(page)) break;
      if (await page.locator("#app").getAttribute("data-screen") !== "combat") break;
      if (await page.locator("#result-modal").isVisible()) break;
    }
    if (await page.locator("#app").getAttribute("data-screen") !== "combat") break;
    if (await page.locator("#result-modal").isVisible()) break;
    const revision = await page.locator("#app").getAttribute("data-session-revision");
    await page.getByRole("button", { name: "End Turn" }).click();
    await expect(page.locator("#app")).not.toHaveAttribute("data-session-revision", revision ?? "");
  }
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure");
  await expect(page.locator("#adventure-content h1")).toHaveText("Choose one reward");
}

test("shows the Adventure shell after reusing the lobby actor atlas without loading extra WebP assets", async ({ page }, testInfo) => {
  const runtimeErrors = captureRuntimeErrors(page);
  const webpRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(".webp")) webpRequests.push(request.url());
  });
  await openAdventure(page);

  await expect(page.locator("#adventure-content h1")).toHaveText("Road Ambush");
  // Every step of the run is on the rail, the last one marked as the finale.
  const steps = page.locator("#adventure-progress li");
  await expect(steps).toHaveCount(8);
  await expect(steps.first()).toHaveAttribute("aria-current", "step");
  await expect(steps.last()).toContainText("Finale");
  // A step that pays out says so before the party walks into it.
  await expect(page.locator("#adventure-progress li .progress-tag.reward").first()).toBeVisible();
  const owned = page.locator("#adventure-collection .collection-chip");
  await expect(owned.filter({ hasText: "Halberd" })).toHaveCount(1);
  await expect(owned.filter({ hasText: "Steel Shield" })).toHaveCount(1);
  await expect(owned.filter({ hasText: "Boots of Fly" })).toHaveCount(1);
  expect(new Set(webpRequests.map((url) => new URL(url).pathname))).toEqual(new Set(["/assets/m3-atlas.webp"]));

  // The whole run has to be readable at the supported minimum. A rail that scrolls hides
  // the finale, which is the one step the player is heading for.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(steps).toHaveCount(8);
  await expect.poll(async () => page.locator("#adventure-progress")
    .evaluate((rail) => rail.scrollHeight - rail.clientHeight)).toBeLessThanOrEqual(1);
  await expect(steps.last()).toBeInViewport();
  await expect(page.locator("#adventure-collection")).toBeInViewport();
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("cardguild-m3-adventure.png"), fullPage: true });
});

test("previews and atomically applies a responsive loadout change", async ({ page }, testInfo) => {
  const runtimeErrors = captureRuntimeErrors(page);
  const webpResponses: string[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".webp") && response.ok()) webpResponses.push(response.url());
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await openAdventure(page);
  await page.getByRole("button", { name: "Manage Loadout" }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "loadout");
  // Aerin owns four equipment pieces and starts with two prepared cards.
  await expect(page.locator(".collection-item")).toHaveCount(6);
  await expect(page.locator(".deck-contribution")).toHaveCount(6);
  await expect(page.locator(".deck-panel h2")).toHaveText("10 Tactical Cards");
  await expect(page.locator('.deck-contribution[data-card-id="card.fly"]')).toContainText("Boots of Fly / Fly");
  await expect(page.locator('.deck-contribution[data-card-id="card.trip"]')).toContainText("Halberd / Trip");
  expect(webpResponses.some((url) => url.endsWith("/assets/m3-atlas.webp"))).toBe(true);

  // The weapon rows are resolved Strike output, not raw weapon authoring.
  await expect(page.locator("#loadout-detail")).toContainText("Halberd · martial expert");
  await expect(page.locator("#loadout-detail")).toContainText("1d10+3 slashing");
  await page.locator('.equipment-slot[data-slot="weapon"]').click();
  await page.locator('.loadout-option[data-option-id="empty-weapon"]').click();
  await expect(page.locator("#loadout-detail")).toContainText("+8 → +6");
  await expect(page.locator("#loadout-detail")).toContainText("1d10+3 slashing → 1d4+3 bludgeoning");
  await expect(page.locator("#loadout-detail")).toContainText("Fist · unarmed trained");

  await expect(page.locator("#loadout-detail")).toContainText("Scale Mail · medium");
  await expect(page.locator("#loadout-detail")).toContainText("+3 item · DEX cap 2");
  await page.locator('.equipment-slot[data-slot="armor"]').click();
  await page.locator('.loadout-option[data-option-id="empty-armor"]').click();
  await expect(page.locator("#loadout-detail")).toContainText("18 → 15");
  await expect(page.locator("#loadout-detail")).toContainText("Unarmored · unarmored");

  await page.locator('.equipment-slot[data-slot="feet"]').click();
  await page.locator('.loadout-option[data-option-id="empty-feet"]').click();
  await expect(page.locator("#loadout-detail")).toContainText("16 → 15");
  await expect(page.locator("#loadout-detail")).toContainText("Fly ×2");
  await page.getByRole("button", { name: "Apply Change" }).click();
  await expect(page.locator(".deck-panel h2")).toHaveText("8 Tactical Cards");
  await expect(page.locator('.equipment-slot[data-slot="feet"]')).toContainText("Empty");
  await expect(page.locator(".collection-panel")).toContainText("Boots of Fly");
  await expect(page.locator(".collection-panel")).toContainText("×1");

  await page.locator('.equipment-slot[data-slot="feet"]').click();
  await page.locator('.loadout-option[data-option-id="boots-of-fly"]').click();
  await expect(page.locator("#loadout-detail")).toContainText("15 → 16");
  await page.getByRole("button", { name: "Apply Change" }).click();
  await expect(page.locator(".deck-panel h2")).toHaveText("10 Tactical Cards");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath("cardguild-m3-loadout-1024.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(mobileOverflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Done" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure");
  expect(runtimeErrors).toEqual([]);
});

test("carries a reward loadout through the shared resolver into the next encounter", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  const runtimeErrors = captureRuntimeErrors(page);
  await openBattle(page);
  await winRoadAmbush(page);

  await expect(page.locator("#adventure-content h1")).toHaveText("Choose one reward");
  // The reward card explains itself on the choice screen, not just by name.
  const braceChoice = page.locator('.reward-choice', { hasText: "Brace Behind Cover" });
  await expect(braceChoice).toContainText("1 액션");
  await braceChoice.click();
  await expect(page.locator("#app")).toHaveAttribute("data-adventure-phase", "between-encounters");
  await expect(page.locator("#adventure-collection .collection-chip").filter({ hasText: "Brace Behind Cover" })).toHaveCount(1);
  // An unworn reward is exactly what Manage Loadout is for, so the screen says so.
  await expect(page.locator(".loadout-nudge")).toContainText("미장착 보상 1개");
  // The next encounter names its threats before the party commits to it.
  await expect(page.locator(".encounter-threats")).toContainText("Goblin Spearman");
  await page.getByRole("button", { name: "Manage Loadout" }).click();

  await page.getByRole("button", { name: "+ Add Card" }).click();
  await page.locator('.loadout-option[data-option-id="card.brace-behind-cover"]').click();
  await expect(page.locator("#loadout-detail")).toContainText("Brace Behind Cover ×1 (Prepared Card)");
  await page.getByRole("button", { name: "Apply Change" }).click();
  await expect(page.locator(".deck-panel h2")).toHaveText("11 Tactical Cards");

  await page.locator('.equipment-slot[data-slot="feet"]').click();
  await page.locator('.loadout-option[data-option-id="empty-feet"]').click();
  await expect(page.locator("#loadout-detail")).toContainText("16 → 15");
  await page.getByRole("button", { name: "Apply Change" }).click();
  await page.locator('.equipment-slot[data-slot="shield"]').click();
  await page.locator('.loadout-option[data-option-id="empty-shield"]').click();
  await expect(page.locator("#loadout-detail")).toContainText("− Context: Raise Shield");
  await page.getByRole("button", { name: "Apply Change" }).click();
  await expect(page.locator(".deck-panel h2")).toHaveText("9 Tactical Cards");
  await expect(page.locator(".collection-panel")).toContainText("Steel Shield");
  await expect(page.locator(".collection-panel")).toContainText("Boots of Fly");
  await page.screenshot({ path: testInfo.outputPath("cardguild-m3-reward-loadout.png"), fullPage: true });

  await page.getByRole("button", { name: "Done" }).click();
  // The reward card is prepared now, and the only things left sitting in the collection are the
  // starter shield and boots this loadout just took off. Swapped-out starter gear is not an
  // unclaimed reward, so the notice is gone rather than stuck at "미장착 보상 2개".
  await expect(page.locator(".loadout-nudge")).toHaveCount(0);
  await page.getByRole("button", { name: "Enter Encounter" }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-encounter-id", "encounter.spear-line");
  // Aerin acts first in the spear corridor, so she opens on the dealt six rather than
  // having drawn the following turn's card during an enemy turn.
  await expect(page.locator("#hand-count")).toHaveText("6");
  // Nine cards remain after the loadout edits, so three are still undrawn.
  await expect(page.locator("#deck-count")).toHaveText("3");
  await expect(page.locator('.tactical-card[data-card-definition-id="card.brace-behind-cover"][data-card-source-kind="prepared"]')).toHaveCount(1);
  // The summary carries AC and the three save modifiers; the DCs behind them are
  // sheet material, so the toggle is the only way to read them.
  await expect(page.locator("#hero-details")).toBeHidden();
  await openHeroDetails(page);
  await expect(page.locator("#hero-details")).toContainText("Reflex DC");
  await expect(page.locator("#hero-details")).toContainText("15");

  const nextMap = { width: 7, height: 4 };
  const hero = projectCorners(await boardCorners(page), nextMap, 0.5, 1.5);
  await page.locator("#pixi-canvas").click({ position: hero });
  // The shield came off in the loadout, so its context action is gone with it.
  await expect(page.locator('#ring-root .ring-option[data-action-id="raise-shield"]')).toHaveCount(0);
  await expect(page.locator('#ring-root .ring-option[data-action-id="brace-behind-cover"]')).toBeVisible();
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("cardguild-m3-next-encounter.png"), fullPage: true });
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
  expect(webpResponses.some((url) => url.endsWith("/assets/m3-atlas.webp"))).toBe(true);

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

  // Facing changed, and the card reports it on the sheet rather than in the summary.
  await expect(page.locator("#hero-stats .save-cell")).toHaveCount(3);
  await expect(page.locator("#hero-details")).toBeHidden();
  await openHeroDetails(page);
  await expect(page.locator("#hero-details")).toContainText("south");
  await expect(page.locator("#action-pips .available")).toHaveCount(2);
  await expect(page.locator("#combat-log")).toContainText("now faces south");
  await expect(page.locator("#app")).not.toHaveAttribute("data-state-hash", initialHash ?? "");
  await page.waitForTimeout(500);
  const feet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
  const heroId = await controlledActorId(page);
  const heroFoot = feet.find((entry) => entry.id === heroId);
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

  // The mesh maps the whole board texture onto the projected quad, so the texture has to be
  // exactly its own page. A padded page shrinks the art inside the quad and leaves actors
  // standing off the drawn board.
  const textureFit = await page.locator("#pixi-canvas").getAttribute("data-board-texture-fit");
  expect(textureFit).toMatch(/^(\d+x\d+)\/\1$/);

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
  const zoomedHero = zoomedFeet.find((entry) => entry.id === heroId);
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
  await page.screenshot({ path: testInfo.outputPath("cardguild-m3-perspective-board.png"), fullPage: true });
});

test("fits the 1024x768 minimum and independently resizes the battlefield camera", async ({ page }, testInfo) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await openBattle(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect.poll(async () => {
    const canvas = await page.locator("#pixi-canvas").boundingBox();
    if (!canvas) return false;
    const publishedCorners = await boardCorners(page);
    const publishedBoard = {
      left: Math.min(...publishedCorners.map((corner) => corner.x)) + canvas.x,
      right: Math.max(...publishedCorners.map((corner) => corner.x)) + canvas.x,
      top: Math.min(...publishedCorners.map((corner) => corner.y)) + canvas.y,
      bottom: Math.max(...publishedCorners.map((corner) => corner.y)) + canvas.y,
    };
    const panels = page.locator("[data-hud-gutter]");
    for (let index = 0; index < await panels.count(); index += 1) {
      const box = await panels.nth(index).boundingBox();
      if (!box) return false;
      if (
        box.x < publishedBoard.right && box.x + box.width > publishedBoard.left &&
        box.y < publishedBoard.bottom && box.y + box.height > publishedBoard.top
      ) return false;
    }
    return true;
  }).toBe(true);
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
      `${await panel.getAttribute("class")} overlaps the board quad: ${JSON.stringify({ box, board })}`,
    ).toBe(false);
  }
  await page.screenshot({ path: testInfo.outputPath("cardguild-m3-minimum.png"), fullPage: true });

  const minimumRatio = await heroCellRatio(page);

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(250);
  const wideWidth = await page.locator("#pixi-canvas").evaluate((canvas) => canvas.clientWidth);
  expect(wideWidth).toBeGreaterThan(850);
  // Board content is sized against its square, so widening the window enlarges the
  // squares and the standees together instead of leaving sprites oversized.
  expect(await heroCellRatio(page)).toBeCloseTo(minimumRatio, 2);
  const feet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
  const heroId = await controlledActorId(page);
  const heroFoot = feet.find((entry) => entry.id === heroId);
  const expectedFoot = await boardPoint(page, 0.5, 1.8);
  expect(heroFoot?.x).toBeCloseTo(expectedFoot.x, 0);
  expect(heroFoot?.y).toBeCloseTo(expectedFoot.y, 0);
  expect(runtimeErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("cardguild-m3-responsive.png"), fullPage: true });
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
  expect((await actorFeet("goblin-lackey")).x).toBeGreaterThan(canvasBox.width);

  await page.locator("#end-turn").click();
  await page.waitForTimeout(600);
  const goblin = await actorFeet("goblin-lackey");
  expect(goblin.x).toBeGreaterThan(0);
  expect(goblin.x).toBeLessThan(canvasBox.width);
  expect(goblin.y).toBeGreaterThan(0);
  expect(goblin.y).toBeLessThan(canvasBox.height);
  expect(runtimeErrors).toEqual([]);
});
