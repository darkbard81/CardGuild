import { expect, type Page } from "@playwright/test";

/** Click the existing board wedge through the canvas's current projection, including zoom/pan. */
export async function chooseFacing(page: Page, direction: "north" | "east" | "south" | "west"): Promise<void> {
  const canvas = page.locator("#pixi-canvas");
  await expect(canvas).toHaveAttribute("data-facing-position", /^\d+,\d+$/);
  const point = await canvas.evaluate((element, facing) => {
    const [x, y] = (element.dataset.facingPosition ?? "").split(",").map(Number);
    const [width, height] = (element.dataset.boardSize ?? "").split("x").map(Number);
    const corners = JSON.parse(element.dataset.boardCorners ?? "[]") as Array<{ x: number; y: number }>;
    const offsets = { north: [0.5, 0.3], east: [0.7, 0.5], south: [0.5, 0.7], west: [0.3, 0.5] };
    const offset = offsets[facing];
    const u = (x! + offset[0]!) / width!;
    const v = (y! + offset[1]!) / height!;
    return {
      x: corners[0]!.x + u * (corners[1]!.x - corners[0]!.x) + v * (corners[3]!.x - corners[0]!.x),
      y: corners[0]!.y + u * (corners[1]!.y - corners[0]!.y) + v * (corners[3]!.y - corners[0]!.y),
    };
  }, direction);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Missing canvas bounds.");
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await expect(canvas).toHaveAttribute("data-facing-position", "");
}
