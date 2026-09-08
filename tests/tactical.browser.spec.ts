import { expect, test } from "@playwright/test";
import { boardPoint, inspectStrike } from "./tactical-support";
import { chooseFacing } from "./facing-input";
import type { TacticalCase } from "./fixtures/tactical";



test.beforeEach(async ({ page }) => {
  await page.route(/\/src\/main\.ts(\?|$)/, (route) => route.fulfill({ contentType: "application/javascript", body: 'import "/tests/fixtures/tactical.ts";' }));
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
});

for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 768, height: 1024 }]) {
  test(`reads each relationship and previews facing at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
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
      if (mode === "both" || mode === "flanking") {
        await expect(page.locator(".flanking-partners")).toContainText("Brom");
        await expect(page.locator(".ring-tactical-context")).toHaveText("Flanking");
      }
      await page.screenshot({ path: testInfo.outputPath(`${mode}.png`) });
    }
    await page.keyboard.press("Escape");
    await page.locator("#end-turn").click();
    const hash = await page.locator("#app").getAttribute("data-state-hash");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".facing-controls")).toContainText("south");
    await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("facing-preview.png") });
    await page.keyboard.press("Escape");
    await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
    await expect(page.locator("#confirm-facing")).toHaveCount(0);
    await page.locator("#end-turn").click();
    await page.keyboard.press("ArrowDown");
    await page.locator("#confirm-facing").click();
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([{ type: "end-turn", facing: "south" }]);
    expect(await page.evaluate(() => window.tacticalFixture.state.actors.hero!.facing)).toBe("south");
    expect(errors).toEqual([]);
  });
}

test("refreshes partners and keeps attack execution identical to preview", async ({ page }) => {
  await page.evaluate(() => window.tacticalFixture.reset("both"));
  await inspectStrike(page);
  const tactical = await page.locator("#pixi-canvas").evaluate((canvas) => JSON.parse(canvas.dataset.tactical!).tactical as unknown);
  await page.locator('#ring-root [data-action-id="strike"]').click();
  const executed = await page.evaluate(() => window.tacticalFixture.events.find((event) => event.type === "CHECK_ROLLED"));
  expect(executed?.type === "CHECK_ROLLED" ? executed.tactical : null).toEqual(tactical);
  await page.evaluate(() => window.tacticalFixture.loseAlly());
  await inspectStrike(page);
  await expect(page.locator(".off-guard-causes")).toHaveText("Rear");
  await expect(page.locator(".flanking-partners")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const cleared = await page.locator("#pixi-canvas").evaluate((canvas) => JSON.parse(canvas.dataset.tactical!));
  expect(cleared.tactical).toBeUndefined();
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

test("projects the actual rear outline after zoom, pan and resize", async ({ page }) => {
  await page.evaluate(() => window.tacticalFixture.reset("both"));
  await inspectStrike(page);
  const assertOutline = async () => {
    const points = await Promise.all([boardPoint(page, 1, 1), boardPoint(page, 2, 1), boardPoint(page, 2, 2), boardPoint(page, 1, 2)]);
    const bounds = await page.evaluate(() => window.tacticalFixture.bounds("rear-active"));
    expect(bounds).not.toBeNull();
    expect(Math.abs(bounds!.x - Math.min(...points.map((point) => point.x)))).toBeLessThan(4);
    expect(Math.abs(bounds!.y - Math.min(...points.map((point) => point.y)))).toBeLessThan(4);
    expect(Math.abs(bounds!.width - (Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x))))).toBeLessThan(7);
  };
  await assertOutline();
  const canvas = page.locator("#pixi-canvas");
  const before = await canvas.getAttribute("data-board-corners");
  await page.keyboard.press("Escape");
  const anchor = await boardPoint(page, 1.5, 1.5);
  await canvas.hover({ position: anchor });
  await page.mouse.wheel(0, -250);
  await expect(canvas).not.toHaveAttribute("data-board-corners", before!);
  await inspectStrike(page);
  await assertOutline();
  await page.keyboard.press("Escape");
  const pan = await boardPoint(page, 1.5, 1.5);
  await canvas.hover({ position: pan });
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(pan.x + 35, pan.y + 20, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  await inspectStrike(page);
  await assertOutline();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 768, height: 1024 });
  await inspectStrike(page);
  await assertOutline();
});

test("keeps failed facing submission retryable without a premature mutation", async ({ page }) => {
  await page.locator("#end-turn").click();
  await page.keyboard.press("ArrowLeft");
  await page.evaluate(() => { window.tacticalFixture.rejectNext = true; });
  const hash = await page.locator("#app").getAttribute("data-state-hash");
  await page.locator("#confirm-facing").click();
  await expect(page.locator("#confirm-facing")).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
  expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
  await page.locator("#confirm-facing").click();
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
  test("inspects through the ring, previews facing before confirmation and retains card one-tap execution", async ({ page }) => {
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
    await canvas.tap({ position: await boardPoint(page, 1.5, 1.3) });
    await expect(page.locator(".facing-controls")).toContainText("north");
    await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
    expect(await page.evaluate(() => window.tacticalFixture.intents)).toEqual([]);
    await page.locator("#cancel-facing").tap();
    await page.evaluate(() => window.tacticalFixture.addStrikeCard());
    await page.locator('#hand-cards [data-action-id="strike"]').tap();
    await canvas.tap({ position: await boardPoint(page, 2.5, 1.5) });
    await expect.poll(() => page.evaluate(() => window.tacticalFixture.intents.length)).toBe(1);
    expect(await page.evaluate(() => window.tacticalFixture.events.some((event) => event.type === "CHECK_ROLLED" && event.tactical?.causes.length === 2))).toBe(true);
  });
});


test("restores the selected direction and previous card after server rejection", async ({ page }) => {
  const card = page.locator('#hand-cards [data-action-id="trip"]').first();
  await card.click();
  await page.locator("#end-turn").click();
  await page.keyboard.press("ArrowLeft");
  await page.evaluate(() => { window.tacticalFixture.rejectAfterSend = true; });
  const hash = await page.locator("#app").getAttribute("data-state-hash");
  await page.locator("#confirm-facing").click();
  await expect(page.locator(".facing-controls")).toContainText("west");
  await expect(page.locator("#board-prompt")).toHaveText("Rejected by fixture");
  await expect(page.locator("#app")).toHaveAttribute("data-state-hash", hash!);
  await page.locator("#cancel-facing").click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.tacticalFixture.events)).toEqual([]);
});

/**
 * The final-facing widget opens on the same snapshot that starts the Step's movement, so
 * the first direction is usually picked while the standee is still sliding. Choosing one
 * sends nothing, and must therefore leave that animation alone.
 */
test("previews a facing mid-move without cancelling the movement animation", async ({ page }) => {
  await page.evaluate(() => { window.tacticalFixture.reset("front"); window.tacticalFixture.setActions(1); });
  const canvas = page.locator("#pixi-canvas");
  const feet = () => canvas.evaluate((element) => {
    const entry = (JSON.parse((element as HTMLCanvasElement).dataset.actorFeet!) as { id: string; x: number; y: number }[])
      .find((actor) => actor.id === "hero")!;
    return { x: entry.x, y: entry.y };
  });
  const bodyFlip = () => canvas.evaluate((element) =>
    (JSON.parse((element as HTMLCanvasElement).dataset.standeePlane!) as { id: string; bodyFlip: number }[])
      .find((actor) => actor.id === "hero")!.bodyFlip);
  expect(await bodyFlip()).toBe(1);
  await canvas.click({ position: await boardPoint(page, 3.5, 1.5) });
  await page.locator('#ring-root [data-action-id="stride"]').click();
  // No waiting before the key: the widget opens synchronously with the snapshot, and the
  // point of the test is to arrive while the two squares are still being walked.
  await page.keyboard.press("ArrowDown");
  const midMove = await feet();
  expect(await bodyFlip()).toBe(-1);
  // The Stride is the only thing sent: picking a direction adds no command of its own.
  expect(await page.evaluate(() => window.tacticalFixture.intents.map((intent) => intent.type))).toEqual(["use-action"]);
  let settled = await feet();
  await expect.poll(async () => {
    const next = await feet();
    const stable = next.x === settled.x && next.y === settled.y;
    settled = next;
    return stable;
  }).toBe(true);
  expect(midMove).not.toEqual(settled);
  await expect(page.locator(".facing-controls")).toContainText("south");
  await expect(page.locator("#confirm-facing")).toBeVisible();
});
