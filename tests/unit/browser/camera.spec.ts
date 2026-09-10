import { expect, test, type Page } from "@playwright/test";

import { boardCorners, safeArea, settledBoard } from "../../support/browser/board-camera";
import { mountComponent } from "../../support/browser/component-harness";

/**
 * The battlefield camera and the fit of the board inside the HUD.
 *
 * None of this needs a server, an account or a campaign: it is one board component reacting
 * to gestures and to the size of the window. These used to run against the real app, which
 * meant signing in and playing into an encounter first — a minute of production wiring to
 * ask a question about geometry. E2E keeps one representative board-fit case; the
 * permutations live here.
 */
test.beforeEach(async ({ page }) => {
  await mountComponent(page, "/tests/fixtures/tactical.ts");
});

/**
 * A tablet has no wheel and no middle button, so two fingers have to reach the same camera.
 * Chromium only accepts real multi-touch through the DevTools protocol.
 */
test.describe("touch camera", () => {
  test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });

  test("pinches to zoom and drags with two fingers the way the wheel and drag do", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    type TouchPhase = "touchStart" | "touchMove" | "touchEnd" | "touchCancel";
    const touch = (type: TouchPhase, points: readonly { x: number; y: number; id: number }[]): Promise<unknown> =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((point) => ({ ...point, radiusX: 12, radiusY: 12, force: 1 })),
      });

    const spread = async (): Promise<void> => {
      let left = { x: 520, y: 380, id: 1 };
      let right = { x: 620, y: 440, id: 2 };
      await touch("touchStart", [left, right]);
      for (let step = 0; step < 8; step += 1) {
        left = { ...left, x: left.x - 12, y: left.y - 8 };
        right = { ...right, x: right.x + 12, y: right.y + 8 };
        await touch("touchMove", [left, right]);
      }
      await touch("touchEnd", []);
    };

    const start = await settledBoard(page);
    await spread();
    const zoomedOnce = await settledBoard(page);
    // Spreading two fingers zooms in, the way turning the wheel away does, and the board
    // really is drawn larger for it.
    expect(zoomedOnce.zoom).toBeGreaterThan(start.zoom * 1.2);
    expect(zoomedOnce.width).toBeGreaterThan(start.width * 1.2);

    // Pinch on until the camera is pinned against its ceiling before the drag. That is the
    // state a two-finger drag used to zoom out of: at the ceiling the half-step that zooms
    // in is clamped away, leaving only the half that zooms out.
    await spread();
    const zoomed = await settledBoard(page);
    expect(zoomed.zoom).toBeGreaterThanOrEqual(zoomedOnce.zoom);
    await spread();
    // A further pinch changes nothing, which is how this knows it is at the ceiling.
    expect((await settledBoard(page)).zoom).toBe(zoomed.zoom);

    let left = { x: 520, y: 380, id: 1 };
    let right = { x: 640, y: 460, id: 2 };
    await touch("touchStart", [left, right]);
    for (let step = 0; step < 8; step += 1) {
      // One finger at a time, trailing finger first, which is how the browser delivers a
      // two-finger move anyway: a `pointermove` each. Taking the step that widens the gap
      // first is the order that used to lose zoom at the ceiling, and real hardware does
      // not promise the harmless order.
      left = { ...left, x: left.x - 14 };
      await touch("touchMove", [left, right]);
      right = { ...right, x: right.x - 14 };
      await touch("touchMove", [left, right]);
    }
    await touch("touchEnd", []);
    const panned = await settledBoard(page);
    expect(panned.centerX).toBeLessThan(zoomed.centerX - 50);
    // Fingers travelling together move the board without zooming, exactly. This reads the
    // camera rather than the board's on-screen width, because the width is the camera
    // multiplied by the fit: a HUD that reflows between the two readings resizes the board
    // on its own, which is not the gesture doing anything.
    expect(panned.zoom).toBe(zoomed.zoom);
    // Lifting out of a gesture is not a pick, so no radial menu opens behind it.
    await expect(page.locator("#ring-root")).toBeHidden();
  });
});

/**
 * A home-screen web app owns the whole screen, and an iPad mini is 744pt on its short
 * side — under both of the layout's minimums. The board has to stay on the screen anyway.
 */
test.describe("iPad mini", () => {
  async function expectBoardInsideItsGutters(page: Page): Promise<void> {
    const canvas = await page.locator("#pixi-canvas").boundingBox();
    if (!canvas) throw new Error("Pixi canvas does not have a bounding box.");
    const safe = await safeArea(page);
    const corners = await boardCorners(page);
    expect(Math.min(...corners.map((corner) => corner.y))).toBeGreaterThanOrEqual(safe.top - 0.5);
    expect(Math.max(...corners.map((corner) => corner.y))).toBeLessThanOrEqual(canvas.height - safe.bottom + 0.5);
    expect(Math.min(...corners.map((corner) => corner.x))).toBeGreaterThanOrEqual(safe.left - 0.5);
    expect(Math.max(...corners.map((corner) => corner.x))).toBeLessThanOrEqual(canvas.width - safe.right + 0.5);
  }

  for (const [name, width, height] of [["portrait", 744, 1133], ["landscape", 1133, 744]] as const) {
    test(`keeps the whole board on screen in ${name}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height });
      await settledBoard(page);

      // Nothing hangs off the bottom or the side: the page is exactly the screen.
      const overflow = await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      }));
      expect(overflow.horizontal).toBeLessThanOrEqual(0);
      expect(overflow.vertical).toBeLessThanOrEqual(0);

      const canvas = await page.locator("#pixi-canvas").boundingBox();
      if (!canvas) throw new Error("Pixi canvas does not have a bounding box.");
      expect(canvas.x).toBeGreaterThanOrEqual(0);
      expect(canvas.y).toBeGreaterThanOrEqual(0);
      expect(canvas.x + canvas.width).toBeLessThanOrEqual(width + 0.5);
      expect(canvas.y + canvas.height).toBeLessThanOrEqual(height + 0.5);

      // And the board inside it is fitted to the gutters the HUD actually reserved,
      // which is what a rotation used to leave half applied.
      await expectBoardInsideItsGutters(page);
      expect(errors).toEqual([]);
    });
  }

  test("re-fits the board after a rotation instead of leaving it half applied", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 744, height: 1133 });
    await settledBoard(page);
    await page.setViewportSize({ width: 1133, height: 744 });
    await settledBoard(page);

    const canvas = await page.locator("#pixi-canvas").boundingBox();
    if (!canvas) throw new Error("Pixi canvas does not have a bounding box.");
    expect(canvas.y + canvas.height).toBeLessThanOrEqual(744.5);
    // The old failure put the top edge inside the gutters and the bottom one under the
    // screen, so both ends are checked against the same measurement.
    await expectBoardInsideItsGutters(page);
    expect(errors).toEqual([]);
  });
});
