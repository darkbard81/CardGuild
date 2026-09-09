import { describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../../content/production-content";
import type { GridPosition } from "../../game";
import { collectSolidBoundarySegments, isSolidTile, solidBoundaryLine, type SolidBoundarySegment } from "./SolidBoundary";

function cells(...pairs: readonly (readonly [number, number])[]): GridPosition[] {
  return pairs.map(([x, y]) => ({ x, y }));
}

function label(segments: readonly SolidBoundarySegment[]): string[] {
  return segments.map((segment) => `${segment.x},${segment.y} ${segment.edge}`);
}

describe("solid boundary topology", () => {
  it("outlines a lone solid cell on all four sides", () => {
    expect(label(collectSolidBoundarySegments(cells([2, 1])))).toEqual([
      "2,1 north",
      "2,1 east",
      "2,1 south",
      "2,1 west",
    ]);
  });

  it("drops the seam between two solid cells side by side", () => {
    const segments = collectSolidBoundarySegments(cells([1, 0], [2, 0]));
    expect(label(segments)).not.toContain("1,0 east");
    expect(label(segments)).not.toContain("2,0 west");
    expect(segments).toHaveLength(6);
    expect(label(segments)).toEqual([
      "1,0 north",
      "1,0 south",
      "1,0 west",
      "2,0 north",
      "2,0 east",
      "2,0 south",
    ]);
  });

  it("leaves a 2x2 block with only its eight outer edges", () => {
    // Four interior seams, so four of the sixteen cell edges are gone and the eight that
    // remain are exactly the perimeter.
    expect(label(collectSolidBoundarySegments(cells([0, 0], [1, 0], [0, 1], [1, 1])))).toEqual([
      "0,0 north",
      "0,0 west",
      "1,0 north",
      "1,0 east",
      "0,1 south",
      "0,1 west",
      "1,1 east",
      "1,1 south",
    ]);
  });

  it("follows an L shape into its concave corner", () => {
    const segments = label(collectSolidBoundarySegments(cells([0, 0], [1, 0], [0, 1])));
    expect(segments).toEqual([
      "0,0 north",
      "0,0 west",
      "1,0 north",
      "1,0 east",
      "1,0 south",
      "0,1 east",
      "0,1 south",
      "0,1 west",
    ]);
  });

  it("outlines a cell on the map edge, because off-board is not solid", () => {
    expect(label(collectSolidBoundarySegments(cells([0, 0])))).toContain("0,0 north");
    expect(label(collectSolidBoundarySegments(cells([0, 0])))).toContain("0,0 west");
  });

  it("does not depend on the order the cells arrive in, or on duplicates", () => {
    const shape = cells([2, 2], [3, 2], [2, 3], [2, 4]);
    const shuffled = [...shape].reverse();
    const withDuplicates = [...shape, ...shape];
    const expected = label(collectSolidBoundarySegments(shape));
    expect(label(collectSolidBoundarySegments(shuffled))).toEqual(expected);
    expect(label(collectSolidBoundarySegments(withDuplicates))).toEqual(expected);
  });

  it("places an edge on the cell border in board pixels", () => {
    expect(solidBoundaryLine({ x: 1, y: 2, edge: "north" }, 128)).toEqual({ x1: 128, y1: 256, x2: 256, y2: 256 });
    expect(solidBoundaryLine({ x: 1, y: 2, edge: "east" }, 128)).toEqual({ x1: 256, y1: 256, x2: 256, y2: 384 });
    expect(solidBoundaryLine({ x: 1, y: 2, edge: "south" }, 128)).toEqual({ x1: 128, y1: 384, x2: 256, y2: 384 });
    expect(solidBoundaryLine({ x: 1, y: 2, edge: "west" }, 128)).toEqual({ x1: 128, y1: 256, x2: 128, y2: 384 });
  });

  it("shares one line between the two cells that meet at a seam", () => {
    // The seam is not drawn, but the geometry has to agree that it is one line: an east
    // edge and its neighbour's west edge must land on the same pixels.
    expect(solidBoundaryLine({ x: 0, y: 0, edge: "east" }, 128)).toEqual(solidBoundaryLine({ x: 1, y: 0, edge: "west" }, 128));
  });
});

describe("what counts as solid", () => {
  const solidFrom = (...traitIds: readonly string[]): boolean => isSolidTile(new Set(traitIds));

  it("follows the blocked trait the rules already use", () => {
    expect(solidFrom("blocked")).toBe(true);
    // A shut gate is blocked, so it joins the barrier it sits in.
    expect(solidFrom("blocked", "gate")).toBe(true);
    // Opening it drops both traits, and with them the cell's place in the region.
    expect(solidFrom("open", "gate-open")).toBe(false);
    expect(solidFrom()).toBe(false);
    expect(solidFrom("difficult", "web")).toBe(false);
    // Impassable ground stops walkers but not fliers or sight, and reads as a hole in
    // the floor rather than a barrier: it is not part of the outline.
    expect(solidFrom("impassable")).toBe(false);
  });
});

describe("a gate in a wall", () => {
  const barrier = cells([4, 0], [4, 1], [4, 2], [4, 4], [4, 5], [4, 6]);
  const gate = { x: 4, y: 3 };

  it("closes the barrier into one contour with no seam at the gate", () => {
    const shut = collectSolidBoundarySegments([...barrier, gate]);
    // Seven cells in a column: twenty-eight edges, twelve of them shared seams.
    expect(shut).toHaveLength(16);
    expect(label(shut)).not.toContain("4,2 south");
    expect(label(shut)).not.toContain("4,3 north");
    expect(label(shut)).not.toContain("4,3 south");
    expect(label(shut)).not.toContain("4,4 north");
  });

  it("opens a hole in the contour when the gate stops being solid", () => {
    const open = label(collectSolidBoundarySegments(barrier));
    // The two runs are now separate, and the walls either side of the opening show the
    // edges the gate used to cover.
    expect(open).toHaveLength(16);
    expect(open).toContain("4,2 south");
    expect(open).toContain("4,4 north");
    // The gate's own cell has left the region entirely.
    expect(open.some((segment) => segment.startsWith("4,3 "))).toBe(false);
  });
});

describe("solid cells in shipped content", () => {
  const scenario = PRODUCTION_CONTENT.pack.scenarioSources["encounter.ruined-gate"];
  const tiles = scenario?.map.tiles ?? [];
  const solid = tiles
    .filter((tile) => isSolidTile(new Set(tile.traits.map((trait) => trait.id))))
    .map((tile) => tile.position);

  it("counts the shut gate as part of the barrier it sits in", () => {
    const gate = tiles.find((tile) => tile.traits.some((trait) => trait.id === "gate"));
    expect(gate).toBeDefined();
    expect(gate?.traits.some((trait) => trait.id === "blocked")).toBe(true);
    expect(solid).toContainEqual(gate?.position);
    expect(solid).toHaveLength(7);
  });

  it("draws no stroke on any seam inside the barrier", () => {
    const segments = collectSolidBoundarySegments(solid);
    // Seven cells have twenty-eight edges; six seams are shared, so twelve never drawn.
    expect(segments).toHaveLength(16);
    for (const segment of segments) {
      const neighbour = segment.edge === "north"
        ? { x: segment.x, y: segment.y - 1 }
        : segment.edge === "south" ? { x: segment.x, y: segment.y + 1 }
          : segment.edge === "east" ? { x: segment.x + 1, y: segment.y } : { x: segment.x - 1, y: segment.y };
      expect(solid).not.toContainEqual(neighbour);
    }
  });
});
