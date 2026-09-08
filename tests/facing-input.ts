import { expect, type Page } from "@playwright/test";

const NEIGHBOUR = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;

/**
 * A facing is chosen by picking the board square to look at, so this clicks the square
 * next to the actor in the wanted direction through the canvas's current projection —
 * zoom and pan included. One click both chooses and submits.
 */
export async function chooseFacing(page: Page, direction: keyof typeof NEIGHBOUR): Promise<void> {
  const canvas = page.locator("#pixi-canvas");
  await expect(canvas).toHaveAttribute("data-facing-position", /^\d+,\d+$/);
  const point = await canvas.evaluate((element, [dx, dy]) => {
    const [x, y] = (element.dataset.facingPosition ?? "").split(",").map(Number);
    const [width, height] = (element.dataset.boardSize ?? "").split("x").map(Number);
    const corners = JSON.parse(element.dataset.boardCorners ?? "[]") as Array<{ x: number; y: number }>;
    const u = (x! + dx! + 0.5) / width!;
    const v = (y! + dy! + 0.5) / height!;
    return {
      x: corners[0]!.x + u * (corners[1]!.x - corners[0]!.x) + v * (corners[3]!.x - corners[0]!.x),
      y: corners[0]!.y + u * (corners[1]!.y - corners[0]!.y) + v * (corners[3]!.y - corners[0]!.y),
    };
  }, NEIGHBOUR[direction]);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Missing canvas bounds.");
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await expect(canvas).toHaveAttribute("data-facing-position", "");
}
