import type { GridPosition } from "../../game";

/**
 * A wall is drawn as an ordinary square terrain tile, so several blocked cells next to
 * each other already share one surface. What makes them read as one mass rather than a
 * row of squares is the outline: it is drawn only where the wall region meets something
 * that is not wall, and never on the seam between two walls.
 *
 * Four cardinal neighbours per cell are enough for that. No autotile mask, no corner or
 * edge art, no direction-specific wall texture: convex and concave corners fall out of
 * which edges happen to be exposed. Cells off the board count as not-wall, so a wall on
 * the map edge is outlined too.
 */
export type WallEdge = "north" | "east" | "south" | "west";

/**
 * A wall is a blocked tile that no gate has claimed. A closed gate is blocked too, but it
 * is a structure of its own with two states, so it keeps its own visual and never becomes
 * wall surface. This only reads traits the rules already decided; it decides nothing.
 */
export function isWallTile(traitIds: ReadonlySet<string>): boolean {
  return traitIds.has("blocked") && !traitIds.has("gate") && !traitIds.has("gate-open");
}

export interface WallBoundarySegment {
  readonly x: number;
  readonly y: number;
  readonly edge: WallEdge;
}

/** North, east, south, west — the order a segment list is emitted in, per cell. */
const EDGES: readonly { readonly edge: WallEdge; readonly dx: number; readonly dy: number }[] = [
  { edge: "north", dx: 0, dy: -1 },
  { edge: "east", dx: 1, dy: 0 },
  { edge: "south", dx: 0, dy: 1 },
  { edge: "west", dx: -1, dy: 0 },
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * The exposed edges of a wall region, in row-major cell order and N/E/S/W within a cell,
 * so the same set of cells always produces the same segment list whatever order it
 * arrived in. Presentation only: this reads positions the rules already decided and
 * decides nothing about movement or line of sight.
 */
export function collectWallBoundarySegments(cells: Iterable<GridPosition>): readonly WallBoundarySegment[] {
  const walls = new Map<string, GridPosition>();
  for (const cell of cells) walls.set(key(cell.x, cell.y), cell);
  const ordered = [...walls.values()].sort((left, right) => left.y - right.y || left.x - right.x);
  const segments: WallBoundarySegment[] = [];
  for (const cell of ordered) {
    for (const { edge, dx, dy } of EDGES) {
      if (walls.has(key(cell.x + dx, cell.y + dy))) continue;
      segments.push({ x: cell.x, y: cell.y, edge });
    }
  }
  return segments;
}

export interface WallBoundaryLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** One exposed edge as a line in board-texture pixels, at the given cell size. */
export function wallBoundaryLine(segment: WallBoundarySegment, cell: number): WallBoundaryLine {
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
