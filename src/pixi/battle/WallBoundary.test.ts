import { describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../../content/production-content";
import type { GridPosition } from "../../game";
import { collectWallBoundarySegments, isWallTile, wallBoundaryLine, type WallBoundarySegment } from "./WallBoundary";

function cells(...pairs: readonly (readonly [number, number])[]): GridPosition[] {
  return pairs.map(([x, y]) => ({ x, y }));
}

function label(segments: readonly WallBoundarySegment[]): string[] {
  return segments.map((segment) => `${segment.x},${segment.y} ${segment.edge}`);
}

describe("wall boundary topology", () => {
  it("outlines a lone wall on all four sides", () => {
    expect(label(collectWallBoundarySegments(cells([2, 1])))).toEqual([
      "2,1 north",
      "2,1 east",
      "2,1 south",
      "2,1 west",
    ]);
  });

  it("drops the seam between two walls side by side", () => {
    const segments = collectWallBoundarySegments(cells([1, 0], [2, 0]));
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
    expect(label(collectWallBoundarySegments(cells([0, 0], [1, 0], [0, 1], [1, 1])))).toEqual([
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
    const segments = label(collectWallBoundarySegments(cells([0, 0], [1, 0], [0, 1])));
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

  it("outlines a wall on the map edge, because off-board is not wall", () => {
    expect(label(collectWallBoundarySegments(cells([0, 0])))).toContain("0,0 north");
    expect(label(collectWallBoundarySegments(cells([0, 0])))).toContain("0,0 west");
  });

  it("does not depend on the order the cells arrive in, or on duplicates", () => {
    const shape = cells([2, 2], [3, 2], [2, 3], [2, 4]);
    const shuffled = [...shape].reverse();
    const withDuplicates = [...shape, ...shape];
    const expected = label(collectWallBoundarySegments(shape));
    expect(label(collectWallBoundarySegments(shuffled))).toEqual(expected);
    expect(label(collectWallBoundarySegments(withDuplicates))).toEqual(expected);
  });

  it("places an edge on the cell border in board pixels", () => {
    expect(wallBoundaryLine({ x: 1, y: 2, edge: "north" }, 128)).toEqual({ x1: 128, y1: 256, x2: 256, y2: 256 });
    expect(wallBoundaryLine({ x: 1, y: 2, edge: "east" }, 128)).toEqual({ x1: 256, y1: 256, x2: 256, y2: 384 });
    expect(wallBoundaryLine({ x: 1, y: 2, edge: "south" }, 128)).toEqual({ x1: 128, y1: 384, x2: 256, y2: 384 });
    expect(wallBoundaryLine({ x: 1, y: 2, edge: "west" }, 128)).toEqual({ x1: 128, y1: 256, x2: 128, y2: 384 });
  });

  it("shares one line between the two cells that meet at a seam", () => {
    // The seam is not drawn, but the geometry has to agree that it is one line: an east
    // edge and its neighbour's west edge must land on the same pixels.
    expect(wallBoundaryLine({ x: 0, y: 0, edge: "east" }, 128)).toEqual(wallBoundaryLine({ x: 1, y: 0, edge: "west" }, 128));
  });
});

describe("wall cells in shipped content", () => {
  const scenario = PRODUCTION_CONTENT.pack.scenarioSources["encounter.ruined-gate"];
  const tiles = scenario?.map.tiles ?? [];
  const walls = tiles
    .filter((tile) => isWallTile(new Set(tile.traits.map((trait) => trait.id))))
    .map((tile) => tile.position);

  it("leaves the gate out of the wall region it stands in", () => {
    // The gate corridor is one column of blocked tiles with the gate in the middle. The
    // gate is blocked too, so only the trait check keeps it a structure with two states
    // instead of being paved over as wall surface.
    const gate = tiles.find((tile) => tile.traits.some((trait) => trait.id === "gate"));
    expect(gate).toBeDefined();
    expect(gate?.traits.some((trait) => trait.id === "blocked")).toBe(true);
    expect(walls).not.toContainEqual(gate?.position);
    expect(walls).toHaveLength(6);
  });

  it("draws no stroke on the seams inside the two wall runs", () => {
    const segments = collectWallBoundarySegments(walls);
    // Six cells have twenty-four edges; the four seams inside the two runs of three are
    // shared, so eight of those edges are never drawn.
    expect(segments).toHaveLength(16);
    for (const segment of segments) {
      const neighbour = segment.edge === "north"
        ? { x: segment.x, y: segment.y - 1 }
        : segment.edge === "south" ? { x: segment.x, y: segment.y + 1 }
          : segment.edge === "east" ? { x: segment.x + 1, y: segment.y } : { x: segment.x - 1, y: segment.y };
      expect(walls).not.toContainEqual(neighbour);
    }
  });
});
