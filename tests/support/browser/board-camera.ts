import { expect, type Page } from "@playwright/test";

/** What the board looks like right now, as the canvas publishes it. */
export interface BoardReading {
  readonly width: number;
  readonly centerX: number;
  readonly zoom: number;
  readonly safeArea: string;
}

export interface Corner { readonly x: number; readonly y: number }

export async function boardCorners(page: Page): Promise<[Corner, Corner, Corner, Corner]> {
  const published = await page.locator("#pixi-canvas").getAttribute("data-board-corners");
  const corners = JSON.parse(published ?? "[]") as Corner[];
  if (corners.length !== 4) throw new Error("The board has not published its corners yet.");
  return corners as [Corner, Corner, Corner, Corner];
}

export async function safeArea(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  const published = await page.locator("#pixi-canvas").getAttribute("data-safe-area");
  return JSON.parse(published ?? "{}") as { left: number; top: number; right: number; bottom: number };
}

export async function boardReading(page: Page): Promise<BoardReading> {
  const canvas = page.locator("#pixi-canvas");
  const [corners, zoom, area] = await Promise.all([
    boardCorners(page),
    canvas.getAttribute("data-board-zoom"),
    canvas.getAttribute("data-safe-area"),
  ]);
  return {
    width: Math.max(...corners.map((corner) => corner.x)) - Math.min(...corners.map((corner) => corner.x)),
    centerX: corners.reduce((sum, corner) => sum + corner.x, 0) / corners.length,
    zoom: Number(zoom),
    safeArea: area ?? "",
  };
}

function sameReading(left: BoardReading, right: BoardReading): boolean {
  return left.width === right.width && left.centerX === right.centerX &&
    left.zoom === right.zoom && left.safeArea === right.safeArea;
}

/** Let the page draw, so two readings cannot come from the same frame. */
async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); }));
  }));
}

/**
 * The board once it has stopped moving.
 *
 * A gesture dispatch resolves before the page has handled it, and the HUD can still be
 * settling into its safe area, so a single read may come from a board that is still in
 * motion. Waiting for a fixed number of milliseconds is a guess that is either too short on
 * a loaded machine or wasted on an idle one; waiting for the board to stop is the state the
 * test actually means.
 *
 * Two things keep "stopped" from meaning "has not started yet". Consecutive readings are
 * separated by a real animation frame, so a board that simply has not been redrawn cannot
 * pass as a board that finished redrawing. And when the caller knows what the board looked
 * like before the gesture, `from` makes this wait for the change to appear first — two
 * readings of the old board are not a settled new one.
 */
export async function settledBoard(page: Page, from?: BoardReading): Promise<BoardReading> {
  if (from) {
    await expect.poll(async () => {
      await nextFrame(page);
      return sameReading(await boardReading(page), from);
    }, { timeout: 15_000, intervals: [50, 100, 200, 400] }).toBe(false);
  }
  let previous = await boardReading(page);
  await expect.poll(async () => {
    await nextFrame(page);
    const current = await boardReading(page);
    const quiet = sameReading(current, previous);
    previous = current;
    return quiet;
  }, { timeout: 15_000, intervals: [50, 100, 200, 400] }).toBe(true);
  return previous;
}
