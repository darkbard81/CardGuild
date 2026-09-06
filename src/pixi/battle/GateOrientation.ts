import type { GridPosition } from "../../game";

/**
 * A gate is an authored square terrain tile like the wall it is set into: the door, the
 * frame and the ironwork all live in the picture. The only thing the runtime decides is
 * which way up to place it, so that one canonical texture serves a wall running either
 * way and no direction ever needs its own art.
 *
 * The texture is drawn for a wall running north-south — the masonry jambs on the top and
 * bottom edges, the way through opening left and right — so that orientation is the
 * unrotated one.
 */
export type GateAxis = "north-south" | "east-west";

/**
 * Which way the wall runs through this square, from how many of its neighbours are part
 * of the barrier. A tie — a crossing, a lone gate with no wall at all — takes
 * north-south, so the same map always draws the same gate.
 */
export function gateAxis(
  position: GridPosition,
  isSolid: (x: number, y: number) => boolean,
): GateAxis {
  const vertical = Number(isSolid(position.x, position.y - 1)) + Number(isSolid(position.x, position.y + 1));
  const horizontal = Number(isSolid(position.x - 1, position.y)) + Number(isSolid(position.x + 1, position.y));
  return horizontal > vertical ? "east-west" : "north-south";
}

/**
 * How far to turn the gate texture, in radians. A quarter turn is the whole vocabulary:
 * the tile is square and the picture is symmetric about the passage, so a wall running
 * east-west needs the same art laid on its side and nothing more.
 */
export function gateTextureRotation(axis: GateAxis): number {
  return axis === "east-west" ? Math.PI / 2 : 0;
}
