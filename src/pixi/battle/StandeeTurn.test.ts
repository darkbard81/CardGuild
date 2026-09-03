import { describe, expect, it } from "vitest";

import { DEFAULT_STANDEE_TURN, turnedStandeeCorners } from "./StandeeTurn";

/** A standee as the art authors it: 100 wide, 152 tall, feet on the origin. */
const RECT = { left: -50, top: -152, right: 50, bottom: 0 };

function edgeHeights(corners: ReturnType<typeof turnedStandeeCorners>): { left: number; right: number } {
  return { left: corners[3].y - corners[0].y, right: corners[2].y - corners[1].y };
}

describe("standee turn", () => {
  it("leaves a standee that is not turned sideways exactly where the art put it", () => {
    for (const facing of ["north", "south"] as const) {
      expect(turnedStandeeCorners(RECT, facing)).toEqual([
        { x: -50, y: -152 },
        { x: 50, y: -152 },
        { x: 50, y: 0 },
        { x: -50, y: 0 },
      ]);
    }
  });

  it("brings the near edge towards the camera and compresses the silhouette", () => {
    const east = turnedStandeeCorners(RECT, "east");
    const heights = edgeHeights(east);
    // Facing east leans the right edge in, so that edge is nearer and therefore taller.
    expect(heights.right).toBeGreaterThan(heights.left);
    // A body rotated away from the camera covers less width than one facing it.
    const width = east[1].x - east[0].x;
    expect(width).toBeLessThan(RECT.right - RECT.left);
    expect(width).toBeGreaterThan((RECT.right - RECT.left) * 0.5);
    // Vertical edges stay vertical: rotating about a vertical axis gives every column
    // one depth, so the top and bottom edges keep the same width.
    expect(east[2].x - east[3].x).toBeCloseTo(width, 6);
  });

  it("keeps the feet on the square the actor stands on", () => {
    for (const facing of ["east", "west"] as const) {
      for (const corner of [turnedStandeeCorners(RECT, facing)[2], turnedStandeeCorners(RECT, facing)[3]]) {
        expect(Math.abs(corner.y - RECT.bottom)).toBeLessThan(2);
      }
    }
  });

  it("draws west as the mirror image of east, art included", () => {
    const east = turnedStandeeCorners(RECT, "east");
    const west = turnedStandeeCorners(RECT, "west");
    // Every corner is reflected about the pivot and keeps its place in the texture,
    // so the art flips with the quad instead of showing the same shoulder twice.
    const [westTopLeft, westTopRight, westBottomRight, westBottomLeft] = west;
    const [eastTopLeft, eastTopRight, eastBottomRight, eastBottomLeft] = east;
    for (const [mirrored, source] of [
      [westTopLeft, eastTopLeft],
      [westTopRight, eastTopRight],
      [westBottomRight, eastBottomRight],
      [westBottomLeft, eastBottomLeft],
    ] as const) {
      expect(mirrored.x).toBeCloseTo(-source.x, 6);
      expect(mirrored.y).toBeCloseTo(source.y, 6);
    }
    // The texture's left edge now sits on the right of the screen: that is the flip.
    expect(west[0].x).toBeGreaterThan(west[1].x);
    expect(east[0].x).toBeLessThan(east[1].x);
    // The near edge follows the character round, so it is on the screen-left for west.
    const heights = edgeHeights(west);
    expect(heights.right).toBeGreaterThan(heights.left);
    expect(west[1].x).toBeLessThan(west[0].x);
  });

  it("turns further when the configured rotation grows", () => {
    const gentle = turnedStandeeCorners(RECT, "east", { ...DEFAULT_STANDEE_TURN, rotationDegrees: 10 });
    const hard = turnedStandeeCorners(RECT, "east", { ...DEFAULT_STANDEE_TURN, rotationDegrees: 50 });
    expect(hard[1].x - hard[0].x).toBeLessThan(gentle[1].x - gentle[0].x);
  });
});
