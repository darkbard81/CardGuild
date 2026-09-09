import { describe, expect, it } from "vitest";

import { gateAxis, gateTextureRotation } from "./GateOrientation";

const at = { x: 4, y: 3 };

function solidAt(...cells: readonly (readonly [number, number])[]): (x: number, y: number) => boolean {
  const keys = new Set(cells.map(([x, y]) => `${x},${y}`));
  return (x, y) => keys.has(`${x},${y}`);
}

describe("gate axis", () => {
  it("runs with the wall it is set into", () => {
    // A column of wall above and below: the wall runs north-south, so the way through is
    // east-west and the jambs are the two edges the wall continues into.
    expect(gateAxis(at, solidAt([4, 2], [4, 4]))).toBe("north-south");
    expect(gateAxis(at, solidAt([3, 3], [5, 3]))).toBe("east-west");
  });

  it("follows the majority when the barrier only reaches one side", () => {
    // A gate at the end of a wall still has an axis: whichever way most of its
    // neighbours run.
    expect(gateAxis(at, solidAt([4, 2]))).toBe("north-south");
    expect(gateAxis(at, solidAt([5, 3]))).toBe("east-west");
  });

  it("falls back the same way every time when nothing decides it", () => {
    // A crossing and a gate standing in the open both tie. Deterministic beats clever:
    // the same map must draw the same gate on every render.
    expect(gateAxis(at, solidAt([4, 2], [4, 4], [3, 3], [5, 3]))).toBe("north-south");
    expect(gateAxis(at, solidAt())).toBe("north-south");
  });
});

describe("gate texture rotation", () => {
  it("leaves the authored orientation alone and turns the other one a quarter", () => {
    // The art is drawn for a north-south wall, so that is the unrotated case. An
    // east-west wall reuses the same picture on its side rather than a second asset.
    expect(gateTextureRotation("north-south")).toBe(0);
    expect(gateTextureRotation("east-west")).toBeCloseTo(Math.PI / 2, 12);
  });

  it("never needs more than a quarter turn", () => {
    // The tile is square and the door is symmetric about the way through, so a half turn
    // would be the same picture. Two orientations cover every wall.
    const rotations = new Set([gateTextureRotation("north-south"), gateTextureRotation("east-west")]);
    expect(rotations.size).toBe(2);
    for (const rotation of rotations) expect(Math.abs(rotation)).toBeLessThanOrEqual(Math.PI / 2);
  });
});
