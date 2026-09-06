import type { GridPosition } from "../../game";

/**
 * A wall and a shut gate are both drawn as ordinary square terrain tiles, so several of
 * them next to each other already share one surface. What makes them read as one solid
 * mass rather than a row of squares is the outline: it is drawn only where the solid
 * region meets something that is not solid, and never on a seam inside it.
 *
 * Four cardinal neighbours per cell are enough for that. No autotile mask, no corner or
 * edge art, no direction-specific texture: convex and concave corners fall out of which
 * edges happen to be exposed. Cells off the board count as not solid, so a wall on the
 * map edge is outlined too.
 */
export type SolidEdge = "north" | "east" | "south" | "west";

/**
 * What the outline goes around. `blocked` is the trait the rules already use for "no
 * ground creature comes through here", which covers walls and shut gates alike and drops
 * a gate the moment a lever opens it — so the barrier's outline follows the gate's state
 * without anything here knowing what a gate is. This reads traits; it decides nothing.
 */
export function isSolidTile(traitIds: ReadonlySet<string>): boolean {
  return traitIds.has("blocked");
}

export interface SolidBoundarySegment {
  readonly x: number;
  readonly y: number;
  readonly edge: SolidEdge;
}

/** North, east, south, west — the order a segment list is emitted in, per cell. */
const EDGES: readonly { readonly edge: SolidEdge; readonly dx: number; readonly dy: number }[] = [
  { edge: "north", dx: 0, dy: -1 },
  { edge: "east", dx: 1, dy: 0 },
  { edge: "south", dx: 0, dy: 1 },
  { edge: "west", dx: -1, dy: 0 },
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * The exposed edges of a solid region, in row-major cell order and N/E/S/W within a cell,
 * so the same set of cells always produces the same segment list whatever order it
 * arrived in. Presentation only: this reads positions the rules already decided and
 * decides nothing about movement or line of sight.
 */
export function collectSolidBoundarySegments(cells: Iterable<GridPosition>): readonly SolidBoundarySegment[] {
  const solid = new Map<string, GridPosition>();
  for (const cell of cells) solid.set(key(cell.x, cell.y), cell);
  const ordered = [...solid.values()].sort((left, right) => left.y - right.y || left.x - right.x);
  const segments: SolidBoundarySegment[] = [];
  for (const cell of ordered) {
    for (const { edge, dx, dy } of EDGES) {
      if (solid.has(key(cell.x + dx, cell.y + dy))) continue;
      segments.push({ x: cell.x, y: cell.y, edge });
    }
  }
  return segments;
}

export interface SolidBoundaryLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** One exposed edge as a line in board-texture pixels, at the given cell size. */
export function solidBoundaryLine(segment: SolidBoundarySegment, cell: number): SolidBoundaryLine {
  const left = segment.x * cell;
  const top = segment.y * cell;
  const right = left + cell;
  const bottom = top + cell;
  switch (segment.edge) {
    case "north":
      return { x1: left, y1: top, x2: right, y2: top };
    case "east":
      return { x1: right, y1: top, x2: right, y2: bottom };
    case "south":
      return { x1: left, y1: bottom, x2: right, y2: bottom };
    case "west":
      return { x1: left, y1: top, x2: left, y2: bottom };
  }
}
