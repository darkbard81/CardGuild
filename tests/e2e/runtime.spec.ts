import { expect, type Page, test } from "@playwright/test";
import { createCampaignAsHost } from "../support/browser/host-login";
import { chooseFacing } from "../support/browser/facing-input";

// The same pattern the asset build generates actor paths from, so a request-shape
// assertion here cannot describe a narrower contract than production supports.
import { ACTOR_RUNTIME_HREF } from "../../src/presentation/actor-asset-path";

/** Mirrors `FOCUS_MARGIN` in src/pixi/battle/BattleView.ts: the gap the camera aims for. */
const FOCUS_MARGIN = 48;

const ROAD_MAP = { width: 3, height: 3 };
type Corner = { readonly x: number; readonly y: number };

/**
 * The board is one fixed affine projection, so the published corners — grid (0,0),
 * (w,0), (w,h) and (0,h) — describe a parallelogram and a grid coordinate is a plain
 * bilinear blend of them. No perspective divide, and none of the four corners is
 * privileged: at a quarter turn they read as top, right, bottom and left on screen.
 */
function projectCorners(
  corners: readonly [Corner, Corner, Corner, Corner],
  map: { readonly width: number; readonly height: number },
  gridX: number,
  gridY: number,
): { readonly x: number; readonly y: number } {
  const [origin, alongX, far, alongY] = corners;
  const u = gridX / map.width;
  const v = gridY / map.height;
  const blend = (a: number, b: number, c: number, d: number): number =>
    a * (1 - u) * (1 - v) + b * u * (1 - v) + c * u * v + d * (1 - u) * v;
  return {
    x: blend(origin.x, alongX.x, far.x, alongY.x),
    y: blend(origin.y, alongX.y, far.y, alongY.y),
  };
}

/** The board's uniform scale, read back from the width its corners span. */
function boardScale(
  corners: readonly [Corner, Corner, Corner, Corner],
  map: { readonly width: number; readonly height: number },
): number {
  const span = corners[1].x - corners[3].x;
  return (span * Math.SQRT2) / ((map.width + map.height) * 128);
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
  await createCampaignAsHost(page, "Solo Host");
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

/** Sprite scale as a share of the board's own scale, which must not track window size. */
async function heroCellRatio(page: Page): Promise<number> {
  const corners = await boardCorners(page);
  const feet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; scale: number }>;
  const heroId = await controlledActorId(page);
  const hero = feet.find((entry) => entry.id === heroId);
  if (!hero) throw new Error("The hero has not published its layout.");
  return hero.scale / boardScale(corners, ROAD_MAP);
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

/**
 * Wait for the enemies to finish, by watching what the screen says rather than by sleeping
 * between looks. The probe starts tight and backs off, so a fast server is noticed almost
 * at once and a slow one is still given a full half minute.
 */
async function waitForRoadTurn(page: Page): Promise<void> {
  await expect.poll(async () => {
    if (await page.locator("#app").getAttribute("data-screen") !== "combat") return "settled";
    if (await page.locator("#result-modal").isVisible()) return "settled";
    if (await page.locator("#reaction-modal").isVisible()) {
      // The authoritative server can resolve the window between the visibility check and
      // the click, so a vanished button means the reaction is already settled, not a
      // failure. Take it when it is still there and keep waiting either way.
      await page.getByRole("button", { name: "Use Reaction" }).click({ timeout: 2_000 })
        .catch(() => undefined);
      return "reaction";
    }
    if ((await page.locator("#initiative-list .active").textContent())?.includes("Aerin")) return "settled";
    return "enemies";
  }, { timeout: 30_000, intervals: [50, 100, 200, 400] }).toBe("settled");
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
    // A turn that spent all three actions hands itself over, so the button is only
    // needed for the turns this loop leaves unfinished.
    const spent = await page.locator("#action-pips .available").count() === 0;
    const revision = await page.locator("#app").getAttribute("data-session-revision");
    if (!spent) await page.getByRole("button", { name: "End Turn" }).click();
    await expect(page.locator("#app")).not.toHaveAttribute("data-session-revision", revision ?? "");
  }
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure");
  await expect(page.locator("#adventure-content h1")).toHaveText("Choose one reward");
}

const ATLAS_PATH = "/assets/m3-atlas.webp";

/**
 * Presentation art now comes out of two stores: one atlas for tiles, props and UI, and a
 * file per actor standee. Asserting the shape of the split rather than a request count
 * keeps this from breaking every time the roster grows.
 */
function expectMixedAssetRequests(urls: readonly string[]): void {
  const paths = [...new Set(urls.map((url) => new URL(url).pathname))];
  expect(paths).toContain(ATLAS_PATH);
  const standalone = paths.filter((pathname) => pathname !== ATLAS_PATH);
  expect(standalone.length).toBeGreaterThan(0);
  for (const pathname of standalone) expect(pathname).toMatch(ACTOR_RUNTIME_HREF);
}

test("shows the Adventure shell reusing the lobby art, from the atlas and the standalone actors only", async ({ page }) => {
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
  expectMixedAssetRequests(webpRequests);

  // The whole run has to be readable at the supported minimum. A rail that scrolls hides
  // the finale, which is the one step the player is heading for.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(steps).toHaveCount(8);
  await expect.poll(async () => page.locator("#adventure-progress")
    .evaluate((rail) => rail.scrollHeight - rail.clientHeight)).toBeLessThanOrEqual(1);
  await expect(steps.last()).toBeInViewport();
  await expect(page.locator("#adventure-collection")).toBeInViewport();
  expect(runtimeErrors).toEqual([]);
});

test("equips in one click and fits the minimum loadout viewport", async ({ page }) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await openAdventure(page);
  await page.getByRole("button", { name: "Manage Loadout" }).click();
  await expect(page.locator(".loadout-option")).toHaveCount(4);
  await expect(page.locator(".loadout-deck-count")).toHaveText("10 Tactical Cards");
  const feet = page.locator('.equipment-slot[data-slot="feet"]');
  await feet.hover();
  await expect(page.locator("#loadout-detail")).toContainText("16 → 15");
  await expect(page.locator("#loadout-detail")).toContainText("Fly ×2");
  await feet.click();
  await expect(feet).toContainText("Empty feet");
  await expect(page.locator(".loadout-deck-count")).toHaveText("8 Tactical Cards");
  const boots = page.locator('.loadout-option[data-option-id="boots-of-fly"]');
  await expect(boots).toContainText("×1");
  await boots.click();
  await expect(feet).toContainText("Boots of Fly");
  await expect(page.locator(".loadout-deck-count")).toHaveText("10 Tactical Cards");
  await page.getByRole("tab", { name: "덱·능력치", exact: true }).click();
  await expect(page.locator(".deck-contribution")).toHaveCount(6);
  await expect(page.locator(".deck-panel")).toContainText("Halberd · martial expert");
  await expect(page.locator(".deck-panel")).toContainText("1d10+3 slashing");
  for (const tab of ["장비", "준비 카드", "덱·능력치"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.locator(".loadout-pagination")).toBeInViewport();
    expect(await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }))).toEqual({ x: 0, y: 0 });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  expect(runtimeErrors).toEqual([]);
});

test("hover, hold and keyboard inspection do not change prepared cards", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openAdventure(page);
  await page.getByRole("button", { name: "Manage Loadout" }).click();
  await page.getByRole("tab", { name: "준비 카드", exact: true }).click();
  const knockdown = page.locator(".prepared-card").filter({ hasText: "Knockdown" });
  const revision = await page.locator("#app").getAttribute("data-session-revision");
  await knockdown.hover();
  await page.mouse.down();
  // The hold opens it on its own timer; waiting for the panel is waiting exactly that long.
  await expect(page.locator("#loadout-detail")).toBeVisible();
  await page.mouse.up();
  await expect(knockdown).toHaveCount(1);
  await expect(page.locator("#app")).toHaveAttribute("data-session-revision", revision!);
  await page.keyboard.press("Escape");
  await expect(page.locator("#loadout-detail")).toBeHidden();
  await knockdown.click();
  await expect(page.locator(".prepared-card")).toHaveCount(1);
  await expect(page.locator(".loadout-deck-count")).toHaveText("9 Tactical Cards");
  const unavailable = page.locator('.loadout-option[data-option-id="card.intimidating-strike"]');
  await unavailable.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".prepared-card")).toHaveCount(1);
  await expect(page.locator(".loadout-status")).toContainText("only 1");
  await page.locator('.loadout-option[data-option-id="card.knockdown"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".prepared-card")).toHaveCount(2);
  await expect(page.locator(".loadout-deck-count")).toHaveText("10 Tactical Cards");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Manage Loadout" }).click();
  await expect(page.getByRole("tab", { name: "준비 카드", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".prepared-card")).toHaveCount(2);
});

test("carries a reward loadout through the shared resolver into the next encounter", async ({ page }) => {
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

  await page.getByRole("tab", { name: "준비 카드", exact: true }).click();
  await page.locator('.loadout-option[data-option-id="card.brace-behind-cover"]').click();
  await expect(page.locator(".loadout-deck-count")).toHaveText("11 Tactical Cards");
  await page.getByRole("tab", { name: "장비", exact: true }).click();
  await page.locator('.equipment-slot[data-slot="feet"]').click();
  await expect(page.locator('.equipment-slot[data-slot="feet"]')).toContainText("Empty");
  await page.locator('.equipment-slot[data-slot="shield"]').click();
  await expect(page.locator('.equipment-slot[data-slot="shield"]')).toContainText("Empty");
  await expect(page.locator(".loadout-deck-count")).toHaveText("9 Tactical Cards");
  await expect(page.locator(".collection-panel")).toContainText("Steel Shield");
  await expect(page.locator(".collection-panel")).toContainText("Boots of Fly");

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

  // The spear corridor is walled by four separate blocked squares. A wall is terrain,
  // painted into the board texture rather than standing on it, so it raises no upright
  // visual at all and nothing about it can drift when the camera moves. Four lone cells
  // means four exposed edges each: no seam is ever shared, so all sixteen are drawn.
  const canvas = page.locator("#pixi-canvas");
  await expect(canvas).toHaveAttribute("data-solid-region-fit", "4/16");
  // Walls and gates left the upright plane entirely, and with them the measurement that
  // only existed to check their width.
  expect(await canvas.getAttribute("data-structure-fit")).toBeNull();
  const beforeWheel = await canvas.getAttribute("data-board-corners");
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, -240);
  // The camera republishes its corners when the zoom lands, which is the signal that there
  // is a new frame to re-read the seams from.
  await expect(canvas).not.toHaveAttribute("data-board-corners", beforeWheel!);
  await expect(canvas).toHaveAttribute("data-solid-region-fit", "4/16");

  const nextMap = { width: 7, height: 4 };
  const hero = projectCorners(await boardCorners(page), nextMap, 0.5, 1.5);
  await page.locator("#pixi-canvas").click({ position: hero });
  // The shield came off in the loadout, so its context action is gone with it.
  await expect(page.locator('#ring-root .ring-option[data-action-id="raise-shield"]')).toHaveCount(0);
  await expect(page.locator('#ring-root .ring-option[data-action-id="brace-behind-cover"]')).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

/**
 * One viewport, because what this case owns is the wire: the exact intent the app sends and
 * the fact that cancelling sends nothing. How the direction picker behaves at each screen
 * size is a component contract, and Browser Unit runs it across three of them.
 */
{
  test("explicit facing preserves cancellation and sends one atomic intent", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const errors = captureRuntimeErrors(page);
    const intents: Array<{ type: string; facing?: string; target?: unknown }> = [];
    page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
      const message = JSON.parse(String(payload)) as { type: string; intent?: typeof intents[number] };
      if (message.type === "intent" && message.intent) intents.push(message.intent);
    }));
    await openBattle(page);
    const app = page.locator("#app");
    const canvas = page.locator("#pixi-canvas");
    const hash = await app.getAttribute("data-state-hash");
    const count = intents.length;
    // The self-ring offers Step. A Step is targeting, so cancelling its direction picker
    // restores the ring, with no gameplay mutation or traffic.
    await pickRingAction(page, 0.5, 1.5, "step");
    await expect(canvas).toHaveAttribute("data-facing-position", "0,1");
    await page.keyboard.press("Escape");
    await expect(page.locator("#ring-root")).toBeVisible();
    await expect(app).toHaveAttribute("data-state-hash", hash!);
    expect(intents).toHaveLength(count);
    await page.locator('#ring-root .ring-option[data-action-id="step"]').click();
    await chooseFacing(page, "north");
    await expect(page.locator("#action-pips .available")).toHaveCount(2);
    await expect(page.locator("#combat-log .log-line").first()).toContainText("now facing north");
    await expect(page.locator("#combat-log .log-line").first()).not.toContainText("moved");
    expect(intents.slice(count)).toEqual([{ type: "use-action", action: { kind: "basic", id: "step" }, target: { kind: "tile", position: { x: 0, y: 1 }, facing: "north" } }]);
    const afterStep = await app.getAttribute("data-state-hash");
    await page.locator("#end-turn").click();
    // End Turn is the decision and the direction is the rest of it: Esc is not an answer.
    await page.keyboard.press("Escape");
    await expect(canvas).toHaveAttribute("data-facing-position", "0,1");
    await expect(app).toHaveAttribute("data-state-hash", afterStep!);
    expect(intents).toHaveLength(count + 1);
    await chooseFacing(page, "east");
    await expect(page.locator("#combat-log")).toContainText("Aerin ended the turn.");
    expect(intents.slice(count + 1)).toEqual([{ type: "end-turn", facing: "east" }]);
    expect(errors).toEqual([]);
  });
}

test("loads the 2.5D board and keeps hover, movement, and facing on the square grid", async ({ page }) => {
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
  // The board draws its tiles out of the atlas and its standees out of their own files,
  // and every one of those requests came back OK for the standees to have rendered.
  expectMixedAssetRequests(webpResponses);

  // Target-first input only works if the player can see where they may go before they
  // click. The overlay is Graphics, so the canvas reports what it drew.
  const bands = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-move-bands") ?? "{}") as Record<string, number>;
  expect(bands.step).toBeGreaterThan(0);
  expect(bands.stride).toBeGreaterThan(0);
  // Road Ambush has no impassable ground, so Fly reaches nothing Stride cannot and earns
  // no squares of its own.
  expect(bands.fly).toBeUndefined();
  await expect(page.locator("#move-legend")).toBeVisible();
  await expect(page.locator("#move-legend")).toContainText("Step");
  await expect(page.locator("#move-legend")).toContainText("Stride");

  // The board plane turns and squashes. The standee plane does not: every body stands
  // upright and unsquashed on the diamond, only its own mirror flips it, and the base
  // under it is the one part that lies down on the plane.
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-board-projection", "affine-45-0.5");
  type Standee = { id: string; bodyFlip: number; bodyAspect: number; bodyRotation: number; baseSquash: number; badgeFlip: number };
  const standees = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-standee-plane") ?? "[]") as Standee[];
  expect(standees.length).toBeGreaterThan(1);
  for (const standee of standees) {
    expect(standee.bodyRotation).toBe(0);
    expect(standee.bodyAspect).toBe(1);
    expect(standee.baseSquash).toBe(0.5);
    expect(standee.badgeFlip).toBe(1);
  }
  // The lackey opens facing west, so its body is mirrored and nothing else about it is.
  expect(standees.find((standee) => standee.id === "goblin-lackey")?.bodyFlip).toBe(-1);
  const openingHeroId = await controlledActorId(page);
  expect(standees.find((standee) => standee.id === openingHeroId)?.bodyFlip).toBe(1);
  // No perspective anywhere: two standees at different depths are drawn the same size.
  const opening = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; y: number; scale: number }>;
  expect(new Set(opening.map((entry) => entry.scale)).size).toBe(1);
  expect(new Set(opening.map((entry) => entry.y)).size).toBe(opening.length);

  const initialHash = await page.locator("#app").getAttribute("data-state-hash");
  const target = await boardPoint(page, 1.5, 1.5);
  const canvasBox = await page.locator("#pixi-canvas").boundingBox();
  if (!canvasBox) throw new Error("Pixi canvas does not have a bounding box.");
  await page.mouse.move(canvasBox.x + target.x, canvasBox.y + target.y);
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-hover-cell", "1,1");
  await pickRingAction(page, 1.5, 1.5, "step");
  await expect(page.locator("#ring-root")).toBeHidden();
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", "");

  // Facing changed, and the card reports it on the sheet rather than in the summary.
  await expect(page.locator("#hero-stats .save-cell")).toHaveCount(3);
  await expect(page.locator("#hero-details")).toBeHidden();
  await openHeroDetails(page);
  await expect(page.locator("#hero-details")).toContainText("east");
  await expect(page.locator("#action-pips .available")).toHaveCount(2);
  // One line per action: what was used and everything it did. The cost and the rolls fold
  // underneath it.
  await expect(page.locator("#combat-log .log-line").first())
    .toContainText("used Step — moved 1 square by land");
  await expect(page.locator("#combat-log .log-detail").first()).toContainText("Cost 1 action");
  await expect(page.locator("#app")).not.toHaveAttribute("data-state-hash", initialHash ?? "");
  const heroId = await controlledActorId(page);
  // The standee walks there; the wait is for it to arrive, not for a guess at how long the
  // walk takes.
  await expect.poll(async () => {
    const standing = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
    const walker = standing.find((entry) => entry.id === heroId);
    const destination = await boardPoint(page, 1.5, 1.5);
    if (!walker) return false;
    return Math.hypot(walker.x - destination.x, walker.y - destination.y) < 1;
  }, { intervals: [50, 100, 200] }).toBe(true);
  const feet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
  const heroFoot = feet.find((entry) => entry.id === heroId);
  const expectedFoot = await boardPoint(page, 1.5, 1.5);
  expect(heroFoot?.x).toBeCloseTo(expectedFoot.x, 0);
  expect(heroFoot?.y).toBeCloseTo(expectedFoot.y, 0);

  await clickBoardPoint(page, 2.5, 1.5);
  await expect(page.locator('#ring-root .ring-option[data-action-id="strike"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ring-root")).toBeHidden();
  await pickRingAction(page, 2.5, 1.5, "strike");
  // The log names the action, not its id.
  await expect(page.locator("#combat-log")).toContainText("used Strike");
  await expect(page.locator("#action-pips .available")).toHaveCount(1);

  // A beat keeps its rolls folded away until asked. A tap opens it and it stays open with
  // the pointer nowhere near it, which is the only way in on a tablet.
  const foldedBeat = page.locator("#combat-log .log-line-expandable").first();
  const foldedDetail = page.locator("#combat-log .log-detail").first();
  await expect(foldedDetail).toBeHidden();
  await foldedBeat.click();
  await page.mouse.move(0, 0);
  await expect(foldedDetail).toBeVisible();

  // The card face carries a name, a cost and a picture. The words behind it are a press
  // away, which is what a finger has instead of a hover.
  const tripCard = page.locator('#hand-cards .tactical-card[data-action-id="trip"]').first();
  await expect(tripCard.locator(".card-art")).toBeVisible();
  await expect(page.locator("#card-detail")).toBeHidden();
  const tripBox = await tripCard.boundingBox();
  if (!tripBox) throw new Error("The Trip card has no bounding box.");
  await page.mouse.move(tripBox.x + tripBox.width / 2, tripBox.y + tripBox.height / 2);
  await page.mouse.down();
  await expect(page.locator("#card-detail")).toBeVisible();
  await expect(page.locator("#card-detail")).toContainText("Prone");
  await page.mouse.up();
  // Reading a card is not playing it.
  await expect(tripCard).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(page.locator("#card-detail")).toBeHidden();

  // Card-first path: choose the card, then one of the targets it highlights.
  await page.locator('#hand-cards .tactical-card[data-action-id="trip"]:not([disabled])').first().click();
  await expect(page.locator("#board-prompt")).toContainText("강조된 적");
  await clickBoardPoint(page, 2.5, 1.5);
  await expect(page.locator("#combat-log")).toContainText("used Trip");
  await expect(page.locator("#action-pips .available")).toHaveCount(0);
  await expect(page.locator("#initiative-list .active")).toHaveText("Aerin");
  // The last pip spent leaves End Turn as the only move, so the direction mode opens
  // itself. Opening it is not ending the turn: only the direction aimed at does that, and
  // Esc is not one.
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", /^\d+,\d+$/);
  await expect(page.locator("#combat-log")).not.toContainText("Aerin ended the turn.");
  const beforeEnd = await page.locator("#app").getAttribute("data-state-hash");
  await page.keyboard.press("Escape");
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", /^\d+,\d+$/);
  await expect(page.locator("#initiative-list .active")).toHaveText("Aerin");
  await expect(page.locator("#app")).toHaveAttribute("data-state-hash", beforeEnd!);
  await chooseFacing(page, "east");
  await expect(page.locator("#combat-log")).toContainText("Aerin ended the turn.");

  // The board sprite draws the whole texture as the board plane, so the texture has to be
  // exactly its own page. A padded page shrinks the art inside the plane and leaves actors
  // standing off the drawn board.
  const textureFit = await page.locator("#pixi-canvas").getAttribute("data-board-texture-fit");
  expect(textureFit).toMatch(/^(\d+x\d+)\/\1$/);

  const beforeZoomAttribute = await page.locator("#pixi-canvas").getAttribute("data-board-corners");
  const beforeZoom = await boardCorners(page);
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.wheel(0, -240);
  await expect(page.locator("#pixi-canvas")).not.toHaveAttribute("data-board-corners", beforeZoomAttribute!);
  const afterZoom = await boardCorners(page);
  expect(afterZoom[1].x - afterZoom[0].x).toBeGreaterThan(beforeZoom[1].x - beforeZoom[0].x);
  const beforePanAttribute = await page.locator("#pixi-canvas").getAttribute("data-board-corners");
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 36, canvasBox.y + canvasBox.height / 2 + 22, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.locator("#pixi-canvas")).not.toHaveAttribute("data-board-corners", beforePanAttribute!);
  const afterPan = await boardCorners(page);
  expect(afterPan[0].x).toBeGreaterThan(afterZoom[0].x + 30);
  const zoomedFeet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
  const zoomedHero = zoomedFeet.find((entry) => entry.id === heroId);
  const projectedHero = projectCorners(afterPan, ROAD_MAP, 1.5, 1.5);
  expect(zoomedHero?.x).toBeCloseTo(projectedHero.x, 0);
  expect(zoomedHero?.y).toBeCloseTo(projectedHero.y, 0);
  // Panning is bounded: the board centre stays on screen however far it is dragged.
  const beforeDragAttribute = await page.locator("#pixi-canvas").getAttribute("data-board-corners");
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 2, canvasBox.y + canvasBox.height * 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.locator("#pixi-canvas")).not.toHaveAttribute("data-board-corners", beforeDragAttribute!);
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
});

test("fits the 1024x768 minimum and independently resizes the battlefield camera", async ({ page }) => {
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

  const minimumRatio = await heroCellRatio(page);

  const heroId = await controlledActorId(page);
  const beforeResizeCorners = await page.locator("#pixi-canvas").getAttribute("data-board-corners");

  await page.setViewportSize({ width: 1600, height: 900 });
  /**
   * Two things have to be true, and each covers a frame the other lets through.
   *
   * First, the new viewport must have produced a board at all. Every check below compares
   * the standee against the board it is standing on, and a frame where neither has moved yet
   * agrees with itself perfectly — an unchanged sprite sits exactly on an unchanged square,
   * at exactly the ratio measured at 1024x768. Published corners that differ from the ones
   * taken before the resize are the evidence that a new generation exists.
   */
  await expect(page.locator("#pixi-canvas")).not.toHaveAttribute("data-board-corners", beforeResizeCorners!);
  /**
   * Second, the layout that comes out of it has to catch up. The canvas taking the new width
   * only says the DOM element resized; board projection and standee layout are recomputed
   * after that, and CI #127 caught the frame in between, where the board had already grown
   * while the hero still carried the old scale — a sprite measuring 1.91 cells instead of 1.
   */
  await expect.poll(async () => {
    const canvasWidth = await page.locator("#pixi-canvas").evaluate((canvas) => canvas.clientWidth);
    if (canvasWidth <= 850) return false;
    // The same tolerance the assertions below use, so nothing can settle into a state they
    // would then reject.
    if (Math.abs(await heroCellRatio(page) - minimumRatio) > 0.005) return false;
    const standing = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
    const standee = standing.find((entry) => entry.id === heroId);
    const square = await boardPoint(page, 0.5, 1.5);
    return standee !== undefined && Math.hypot(standee.x - square.x, standee.y - square.y) < 1;
  }, { intervals: [50, 100, 200, 400] }).toBe(true);

  // Board content is sized against its square, so widening the window enlarges the
  // squares and the standees together instead of leaving sprites oversized.
  expect(await heroCellRatio(page)).toBeCloseTo(minimumRatio, 2);
  const feet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as Array<{ id: string; x: number; y: number }>;
  const heroFoot = feet.find((entry) => entry.id === heroId);
  const expectedFoot = await boardPoint(page, 0.5, 1.5);
  expect(heroFoot?.x).toBeCloseTo(expectedFoot.x, 0);
  expect(heroFoot?.y).toBeCloseTo(expectedFoot.y, 0);
  expect(runtimeErrors).toEqual([]);
});

test("pans an off-screen actor back into view when its turn starts", async ({ page }) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await openBattle(page);
  const canvasBox = await page.locator("#pixi-canvas").boundingBox();
  if (!canvasBox) throw new Error("Pixi canvas does not have a bounding box.");
  type ActorLayout = { id: string; x: number; y: number; left: number; right: number; top: number; bottom: number };
  const actorFeet = async (id: string): Promise<ActorLayout> => {
    const feet = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]") as ActorLayout[];
    const actor = feet.find((entry) => entry.id === id);
    if (!actor) throw new Error(`${id} has not published its layout.`);
    return actor;
  };

  // "Visible" means the whole standee inside the gutters the HUD reserved, not merely a
  // contact point on the canvas: a body whose head and HP badge are behind a panel is
  // exactly what the camera is supposed to fetch back.
  const safe = JSON.parse(await page.locator("#pixi-canvas").getAttribute("data-safe-area") ?? "{}") as
    { left: number; top: number; right: number; bottom: number };
  expect(safe.right).toBeGreaterThan(0);
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  for (let index = 0; index < 8; index += 1) await page.mouse.wheel(0, -240);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 1.5, canvasBox.y + canvasBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await actorFeet("goblin-lackey")).x > canvasBox.width - safe.right,
    { intervals: [50, 100, 200] }).toBe(true);

  await page.locator("#end-turn").click();
  await chooseFacing(page, "east");
  // The camera travels back to it. Wait for the standee to be inside the reserved area
  // rather than for a fixed number of frames.
  await expect.poll(async () => {
    const arriving = await actorFeet("goblin-lackey");
    return arriving.left > safe.left && arriving.right < canvasBox.width - safe.right;
  }, { intervals: [50, 100, 200], timeout: 15_000 }).toBe(true);
  const goblin = await actorFeet("goblin-lackey");
  // Every edge of the standee, so a head or an HP badge left under the HUD still fails.
  expect(goblin.left).toBeGreaterThan(safe.left);
  expect(goblin.right).toBeLessThan(canvasBox.width - safe.right);
  expect(goblin.top).toBeGreaterThan(safe.top);
  // Fully zoomed in, a standee can be taller than the window the camera aims for. It
  // promises the head in that case — the badge and the face — and only promises all four
  // edges to one that fits.
  const focusWindow = canvasBox.height - safe.top - safe.bottom - 2 * FOCUS_MARGIN;
  if (goblin.bottom - goblin.top <= focusWindow) {
    expect(goblin.bottom).toBeLessThan(canvasBox.height - safe.bottom);
  }
  // The contact point comes back with it, and is not the thing that was checked.
  expect(goblin.x).toBeGreaterThan(safe.left);
  expect(goblin.x).toBeLessThan(canvasBox.width - safe.right);
  expect(runtimeErrors).toEqual([]);
});
