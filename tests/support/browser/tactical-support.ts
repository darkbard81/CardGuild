import { expect, type Page } from "@playwright/test";

export async function boardPoint(page: Page, x: number, y: number) {
  return page.locator("#pixi-canvas").evaluate((canvas, point) => {
    const corners = JSON.parse(canvas.dataset.boardCorners!) as { x: number; y: number }[];
    const [width, height] = canvas.dataset.boardSize!.split("x").map(Number);
    return { x: corners[0]!.x + point.x / width! * (corners[1]!.x - corners[0]!.x) + point.y / height! * (corners[3]!.x - corners[0]!.x),
      y: corners[0]!.y + point.x / width! * (corners[1]!.y - corners[0]!.y) + point.y / height! * (corners[3]!.y - corners[0]!.y) };
  }, { x, y });
}
export async function inspectStrike(page: Page) {
  await page.locator("#pixi-canvas").click({ position: await boardPoint(page, 2.5, 1.5) });
  await page.locator('#ring-root [data-action-id="strike"]').hover();
  await expect(page.locator(".target-ac")).toBeVisible();
}
