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
    // Entering the mode is not a command, and neither is leaving it again.
    await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", "1,1");
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("facing-select.png") });
    await page.keyboard.press("Escape");
    await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", "");
    await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
    await page.locator("#end-turn").click();
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

test("returns to the previously selected card when a refused facing is cancelled", async ({ page }) => {
  const card = page.locator('#hand-cards [data-action-id="trip"]').first();
  await card.click();
  await page.locator("#end-turn").click();
  await page.evaluate(() => { window.tacticalFixture.rejectAfterSend = true; });
  const hash = await page.locator("#app").getAttribute("data-state-hash");
  await page.locator("#pixi-canvas").click({ position: await boardPoint(page, 0.5, 1.5) });
  // The server refused it, so the choice is open again and nothing has moved.
  await expect(page.locator("#board-prompt")).toHaveText("Rejected by fixture");
  await expect(page.locator("#pixi-canvas")).toHaveAttribute("data-facing-position", "1,1");
  await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
  await page.keyboard.press("Escape");
  await expect(card).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.tacticalFixture.events)).toEqual([]);
});
