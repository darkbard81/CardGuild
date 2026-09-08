import { expect, test } from "@playwright/test";
import { boardPoint, inspectStrike } from "./tactical-support";
import { chooseFacing } from "./facing-input";
import type { TacticalCase } from "./fixtures/tactical";

/** Board graphics that used to explain the rules; none of them may come back. */
const REMOVED_GRAPHICS = ["rear-active", "rear-position", "arc-north", "arc-east", "arc-south", "arc-west",
  "face-north", "face-east", "face-south", "face-west", "flanking-partner-ally"];

test.beforeEach(async ({ page }) => {
  await page.route(/\/src\/main\.ts(\?|$)/, (route) => route.fulfill({ contentType: "application/javascript", body: 'import "/tests/fixtures/tactical.ts";' }));
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
});

for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 768, height: 1024 }]) {
  test(`reads each relationship in the HUD alone at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const mode of ["front", "rear", "flanking", "both"] as TacticalCase[]) {
      await page.evaluate((value) => window.tacticalFixture.reset(value), mode);
      await inspectStrike(page);
      await expect(page.locator(".target-ac")).toHaveText(mode === "front" ? "16" : "16 → 14");
      await expect(page.locator(".off-guard-effect")).toHaveCount(mode === "front" ? 0 : 1);
      if (mode !== "front") await expect(page.locator(".off-guard-effect")).toHaveText("Off-Guard -2");
      if (mode === "both") await expect(page.locator(".off-guard-causes")).toHaveText("Rear · Flanking");
      if (mode === "both" || mode === "flanking") await expect(page.locator(".flanking-partners")).toContainText("Brom");
      // The board carries position and input only: no rule overlay, no rule text.
      const drawn = await page.evaluate((labels) => labels.filter((label) => window.tacticalFixture.bounds(label)), REMOVED_GRAPHICS);
      expect(drawn).toEqual([]);
      const text = await page.evaluate(() => window.tacticalFixture.boardText());
      expect(text.filter((value) => ["Rear", "Flanking", "뒤"].includes(value))).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${mode}.png`) });
    }
    await page.keyboard.press("Escape");
    await page.locator("#end-turn").click();
    const hash = await page.locator("#app").getAttribute("data-state-hash");
    // Opening the question is not a command; only answering it is.
    await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", "1,1");
    await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("facing-select.png") });
    // Looking at the square below the actor is what "south" means.
    await page.locator("#pixi-canvas").click({ position: await boardPoint(page, 1.5, 2.5) });
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([{ type: "end-turn", facing: "south" }]);
    expect(await page.evaluate(() => window.tacticalFixture.state.actors.hero!.facing)).toBe("south");
    expect(errors).toEqual([]);
  });
}

test("refreshes partners and keeps attack execution identical to preview", async ({ page }) => {
  await page.evaluate(() => window.tacticalFixture.reset("both"));
  await inspectStrike(page);
  await expect(page.locator(".target-ac")).toHaveText("16 → 14");
  await page.locator('#ring-root [data-action-id="strike"]').click();
  // What the inspector promised is what the roll used: same AC, same causes, same partner.
  const executed = await page.evaluate(() => window.tacticalFixture.events.find((event) => event.type === "CHECK_ROLLED"));
  expect(executed?.type === "CHECK_ROLLED" ? executed.tactical : null).toMatchObject({
    acBeforeOffGuard: 16, ac: 14, causes: ["rear", "flanking"], partnerIds: ["ally"], penalty: -2, penaltyApplied: true,
  });
  await page.evaluate(() => window.tacticalFixture.loseAlly());
  await inspectStrike(page);
  await expect(page.locator(".off-guard-causes")).toHaveText("Rear");
  await expect(page.locator(".flanking-partners")).toHaveCount(0);
});

test("plays Front, movement into Rear, ally Flanking, both causes and the next-turn change", async ({ page }) => {
  await inspectStrike(page);
  await expect(page.locator(".off-guard-effect")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator("#pixi-canvas").click({ position: await boardPoint(page, 3.5, 1.5) });
  await page.locator('#ring-root [data-action-id="stride"]').click();
  await expect.poll(() => page.evaluate(() => window.tacticalFixture.state.actors.hero!.position)).toEqual({ x: 3, y: 1 });
  await inspectStrike(page);
  await expect(page.locator(".off-guard-causes")).toHaveText("Rear");
  await page.locator('#ring-root [data-action-id="strike"]').click();
  await page.locator("#end-turn").click();
  await chooseFacing(page, "west");
  await page.evaluate(() => window.tacticalFixture.send({ type: "end-turn", facing: "west" }));
  await expect.poll(() => page.evaluate(() => window.tacticalFixture.state.turn.activeActorId)).toBe("ally");
  await page.locator("#pixi-canvas").click({ position: await boardPoint(page, 1.5, 1.5) });
  await page.locator('#ring-root [data-action-id="stride"]').click();
  await inspectStrike(page);
  await expect(page.locator(".off-guard-causes")).toHaveText("Flanking");
  await page.keyboard.press("Escape");
  await page.locator("#end-turn").click();
  await chooseFacing(page, "east");
  await inspectStrike(page);
  await expect(page.locator(".off-guard-causes")).toHaveText("Rear · Flanking");
  await page.keyboard.press("Escape");
  await page.locator("#end-turn").click();
  await chooseFacing(page, "east");
  await page.evaluate(() => window.tacticalFixture.send({ type: "end-turn", facing: "west" }));
  await inspectStrike(page);
  await expect(page.locator(".off-guard-effect")).toHaveCount(0);
});

/**
 * The direction is read from the board square the pointer is over, not from where the
 * pointer sits on the screen, so the same square means the same thing however the camera
 * has been moved.
 */
test("derives the facing from the board square after zoom, pan and resize", async ({ page }) => {
  const canvas = page.locator("#pixi-canvas");
  const pickNorth = async () => {
    await page.locator("#end-turn").click();
    await canvas.click({ position: await boardPoint(page, 1.5, 0.5) });
    return page.evaluate(() => window.tacticalFixture.state.actors.hero!.facing);
  };
  const before = await canvas.getAttribute("data-board-corners");
  await canvas.hover({ position: await boardPoint(page, 1.5, 1.5) });
  await page.mouse.wheel(0, -400);
  await expect(canvas).not.toHaveAttribute("data-board-corners", before!);
  expect(await pickNorth()).toBe("north");
  await page.evaluate(() => window.tacticalFixture.reset("front"));
  const pan = await boardPoint(page, 1.5, 1.5);
  await canvas.hover({ position: pan });
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(pan.x + 45, pan.y + 30, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  expect(await pickNorth()).toBe("north");
  await page.evaluate(() => window.tacticalFixture.reset("front"));
  await page.setViewportSize({ width: 768, height: 1024 });
  expect(await pickNorth()).toBe("north");
});

test("keeps a refused facing retryable without a premature mutation", async ({ page }) => {
  await page.locator("#end-turn").click();
  await page.evaluate(() => { window.tacticalFixture.rejectNext = true; });
  const hash = await page.locator("#app").getAttribute("data-state-hash");
  await page.locator("#pixi-canvas").click({ position: await boardPoint(page, 0.5, 1.5) });
  // Refused before it left: still choosing, still the same authoritative state.
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", "1,1");
  await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
  expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
  await page.locator("#pixi-canvas").click({ position: await boardPoint(page, 0.5, 1.5) });
  expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([{ type: "end-turn", facing: "west" }]);
});

test("shows real AC when another circumstance penalty wins", async ({ page }) => {
  await page.evaluate(() => { window.tacticalFixture.reset("both"); window.tacticalFixture.setPenalty(-4); });
  await inspectStrike(page);
  await expect(page.locator(".target-ac")).toHaveText("12");
  await expect(page.locator(".off-guard-effect")).toHaveCount(1);
  await expect(page.locator(".off-guard-summary")).toContainText("추가 AC 감소 없음");
  await expect(page.locator(".off-guard-causes")).toHaveText("Rear · Flanking");
});

test.describe("touch tactical feedback", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } });
  test("inspects through the ring, turns by tapping a square and retains card one-tap execution", async ({ page }) => {
    await page.evaluate(() => window.tacticalFixture.reset("both"));
    const canvas = page.locator("#pixi-canvas");
    await canvas.tap({ position: await boardPoint(page, 2.5, 1.5) });
    await page.locator('#ring-root [data-action-id="strike"]').tap();
    await expect(page.locator(".off-guard-causes")).toHaveText("Rear · Flanking");
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
    await page.touchscreen.tap(550, 550);
    await expect(page.locator("#ring-root")).toBeHidden();
    await page.locator("#end-turn").tap();
    const hash = await page.locator("#app").getAttribute("data-state-hash");
    await expect(canvas).toHaveAttribute("data-facing-position", "1,1");
    await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
    // One tap on the square north of the actor both chooses the facing and ends the turn.
    await canvas.tap({ position: await boardPoint(page, 1.5, 0.5) });
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([{ type: "end-turn", facing: "north" }]);
    await page.evaluate(() => { window.tacticalFixture.reset("both"); window.tacticalFixture.addStrikeCard(); });
    await page.locator('#hand-cards [data-action-id="strike"]').tap();
    await canvas.tap({ position: await boardPoint(page, 2.5, 1.5) });
    await expect.poll(() => page.evaluate(() => window.tacticalFixture.intents.length)).toBe(1);
    expect(await page.evaluate(() => window.tacticalFixture.events.some((event) => event.type === "CHECK_ROLLED" && event.tactical?.causes.length === 2))).toBe(true);
  });
});

test("leaves a refused End Turn facing open, since it has no way back", async ({ page }) => {
  await page.locator("#end-turn").click();
  await page.evaluate(() => { window.tacticalFixture.rejectAfterSend = true; });
  const hash = await page.locator("#app").getAttribute("data-state-hash");
  await page.locator("#pixi-canvas").click({ position: await boardPoint(page, 0.5, 1.5) });
  // It left, the server refused it, and so the question stands with nothing moved.
  await expect(page.locator("#board-prompt")).toHaveText("Rejected by fixture");
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", "1,1");
  await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
  expect(await page.evaluate(() => window.tacticalFixture.events)).toEqual([]);
  // The same aim is still available, and this time it takes.
  await page.locator("#pixi-canvas").click({ position: await boardPoint(page, 0.5, 1.5) });
  expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([
    { type: "end-turn", facing: "west" }, { type: "end-turn", facing: "west" },
  ]);
  expect(await page.evaluate(() => window.tacticalFixture.state.actors.hero!.facing)).toBe("west");
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", "");
});

/**
 * Pressing End Turn is the decision; the direction is the rest of it. Nothing short of an
 * answer gets out of the mode, so neither the keyboard, nor a card, nor a pointer nowhere
 * near the board may be read as a way back.
 */
test("commits to the End Turn direction until it is answered", async ({ page }) => {
  const canvas = page.locator("#pixi-canvas");
  const card = page.locator('#hand-cards [data-action-id="trip"]').first();
  await card.click();
  await page.locator("#end-turn").click();
  const hash = await page.locator("#app").getAttribute("data-state-hash");
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-facing-position", "1,1");
  await card.click();
  await expect(canvas).toHaveAttribute("data-facing-position", "1,1");
  await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
  expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
  // Far off the board is still an aim, not an escape.
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width - 4, y: box.height / 2 } });
  expect(await page.evaluate(() => window.tacticalFixture.intents.map((intent) => intent.type))).toEqual(["end-turn"]);
  await expect(canvas).toHaveAttribute("data-facing-position", "");
});

/** A Step is targeting, not a decision already taken, so Escape still puts the card back. */
test("returns to the selected card when a Step's direction is cancelled", async ({ page }) => {
  await page.evaluate(() => window.tacticalFixture.addStepCard());
  const card = page.locator('#hand-cards [data-action-id="step"]').first();
  await card.click();
  const hash = await page.locator("#app").getAttribute("data-state-hash");
  await page.locator("#pixi-canvas").click({ position: await boardPoint(page, 1.5, 1.5) });
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", "1,1");
  expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", "");
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
  expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
});

/**
 * An actor standing against a wall of the map still has to be able to face outward, and
 * mouse and finger have no arrow keys to fall back on. The pointer is read as the board
 * coordinate it lands on, so aiming past the edge is an aim like any other.
 */
type MapSize = { width: number; height: number };
const EDGES = [
  { edge: "top", cell: (size: MapSize) => ({ x: Math.floor(size.width / 2), y: 0 }), aim: [0.5, -0.5], facing: "north" },
  { edge: "bottom", cell: (size: MapSize) => ({ x: Math.floor(size.width / 2), y: size.height - 1 }), aim: [0.5, 1.5], facing: "south" },
  { edge: "left", cell: (size: MapSize) => ({ x: 0, y: Math.floor(size.height / 2) }), aim: [-0.5, 0.5], facing: "west" },
  { edge: "right", cell: (size: MapSize) => ({ x: size.width - 1, y: Math.floor(size.height / 2) }), aim: [1.5, 0.5], facing: "east" },
] as const;

for (const { edge, cell, aim, facing } of EDGES) {
  test(`aims off the ${edge} edge of the map with the pointer and with a finger`, async ({ page }) => {
    const canvas = page.locator("#pixi-canvas");
    const size = await page.evaluate(() => window.tacticalFixture.placeHero(0, 0));
    const at = cell(size);
    await page.evaluate(([x, y]) => window.tacticalFixture.placeHero(x!, y!), [at.x, at.y]);
    await page.locator("#end-turn").click();
    await expect(canvas).toHaveAttribute("data-facing-position", `${at.x},${at.y}`);
    await canvas.click({ position: await boardPoint(page, at.x + aim[0], at.y + aim[1]) });
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([{ type: "end-turn", facing }]);
    expect(await page.evaluate(() => window.tacticalFixture.state.actors.hero!.facing)).toBe(facing);
  });
}

test.describe("touch aiming off the map", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } });
  for (const { edge, cell, aim, facing } of EDGES) {
    test(`taps past the ${edge} edge to face outward`, async ({ page }) => {
      const canvas = page.locator("#pixi-canvas");
      const size = await page.evaluate(() => window.tacticalFixture.placeHero(0, 0));
      const at = cell(size);
      await page.evaluate(([x, y]) => window.tacticalFixture.placeHero(x!, y!), [at.x, at.y]);
      await page.locator("#end-turn").tap();
      await expect(canvas).toHaveAttribute("data-facing-position", `${at.x},${at.y}`);
      await canvas.tap({ position: await boardPoint(page, at.x + aim[0], at.y + aim[1]) });
      expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([{ type: "end-turn", facing }]);
    });
  }
});
