import { describe, expect, it } from "vitest";

import { gateAxis, gateMark } from "./GateMark";

const CELL = 128;
const at = { x: 4, y: 3 };

function solidAt(...cells: readonly (readonly [number, number])[]): (x: number, y: number) => boolean {
  const keys = new Set(cells.map(([x, y]) => `${x},${y}`));
  return (x, y) => keys.has(`${x},${y}`);
}

describe("gate axis", () => {
  it("runs with the wall it is set into", () => {
    // A column of wall above and below: the wall runs north-south, so the way through
    // is east-west and the jambs are the two edges the wall continues into.
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

describe("gate mark", () => {
  it("fills the opening between the jambs when it is shut", () => {
    const shut = gateMark(at, "north-south", "closed", CELL);
    expect(shut.leaves).toEqual([]);
    // The wall runs north-south, so the jambs take the top and bottom of the square and
    // the door spans the full way through.
    expect(shut.door?.x).toBeCloseTo(512, 6);
    expect(shut.door?.y).toBeCloseTo(399.36, 6);
    expect(shut.door?.width).toBeCloseTo(128, 6);
    expect(shut.door?.height).toBeCloseTo(97.28, 6);
    expect(shut.bands).toHaveLength(3);
    // Two bands across the door, and the seam where the leaves meet running the other way.
    expect(shut.bands[0]).toEqual({ x1: 512, y1: 426.24, x2: 640, y2: 426.24 });
    expect(shut.bands[2]).toEqual({ x1: 576, y1: 399.36, x2: 576, y2: 496.64 });
  });

  it("turns the whole mark with the wall", () => {
    const vertical = gateMark(at, "north-south", "closed", CELL);
    const horizontal = gateMark(at, "east-west", "closed", CELL);
    // The same door, a quarter turn round: what was tall is wide and what was wide is tall.
    expect(horizontal.door?.width).toBeCloseTo(vertical.door?.height ?? 0, 9);
    expect(horizontal.door?.height).toBeCloseTo(vertical.door?.width ?? 0, 9);
    // The seam turns with it, so it always crosses the way through rather than lying along it.
    expect(vertical.bands[2]?.x1).toBe(vertical.bands[2]?.x2);
    expect(horizontal.bands[2]?.y1).toBe(horizontal.bands[2]?.y2);
  });

  it("folds the leaves back against the jambs when it is open", () => {
    const open = gateMark(at, "north-south", "open", CELL);
    expect(open.door).toBeNull();
    expect(open.bands).toEqual([]);
    expect(open.leaves).toHaveLength(2);
    // One leaf against each jamb, leaving the middle of the square clear to walk through.
    const [first, second] = open.leaves;
    expect(first?.y).toBeCloseTo(399.36, 6);
    expect(second?.y).toBeCloseTo(483.84, 6);
    for (const leaf of open.leaves) expect(leaf.height).toBeCloseTo(12.8, 6);
    // The middle of the square is clear between them, which is the whole point.
    const middle = 3 * CELL + CELL / 2;
    expect((first?.y ?? 0) + (first?.height ?? 0)).toBeLessThan(middle);
    expect(second?.y ?? 0).toBeGreaterThan(middle);
  });

  it("stays inside its own square", () => {
    for (const axis of ["north-south", "east-west"] as const) {
      for (const state of ["closed", "open"] as const) {
        const mark = gateMark(at, axis, state, CELL);
        const shapes = [...(mark.door ? [mark.door] : []), ...mark.leaves];
        for (const shape of shapes) {
          expect(shape.x).toBeGreaterThanOrEqual(at.x * CELL - 0.001);
          expect(shape.y).toBeGreaterThanOrEqual(at.y * CELL - 0.001);
          expect(shape.x + shape.width).toBeLessThanOrEqual((at.x + 1) * CELL + 0.001);
          expect(shape.y + shape.height).toBeLessThanOrEqual((at.y + 1) * CELL + 0.001);
        }
      }
    }
  });
});
