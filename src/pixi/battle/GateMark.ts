import type { GridPosition } from "../../game";

/**
 * A gate is not its own picture. It is a wall square with a door drawn on it, or an
 * ordinary floor square with the door standing open — both marked by Pixi rather than by
 * art, so a new gate costs no asset and a gate can never be the wrong way round.
 *
 * Which way round it is comes from the barrier it sits in: a gate in a wall running
 * north-south opens east-west, and the jambs are the two edges the wall continues
 * through. Nothing here decides anything; it reads the same `blocked` trait the outline
 * does.
 */
export type GateAxis = "north-south" | "east-west";

export type GateState = "closed" | "open";

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

export interface GateMarkRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GateMarkLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface GateMark {
  /** The shut door filling the opening, or nothing when the gate stands open. */
  readonly door: GateMarkRect | null;
  /** Iron banding across a shut door, and the seam where its two leaves meet. */
  readonly bands: readonly GateMarkLine[];
  /** The leaves folded back against each jamb, drawn only when the gate is open. */
  readonly leaves: readonly GateMarkRect[];
}

/** How much of the square each jamb takes, leaving the rest as the opening. */
const JAMB = 0.12;
/** Thickness of a folded-back leaf, as a share of the square. */
const LEAF = 0.1;
/** Where the iron bands cross a shut door, either side of its middle. */
const BAND_OFFSET = 0.17;

/**
 * The door's geometry in board-texture pixels. Laid out along the passage: the jambs sit
 * on the two edges the wall runs through, the opening spans everything between them, and
 * the seam runs across the opening where the two leaves meet.
 */
export function gateMark(
  position: GridPosition,
  axis: GateAxis,
  state: GateState,
  cell: number,
): GateMark {
  const left = position.x * cell;
  const top = position.y * cell;
  // `along` runs with the wall, `across` runs through the passage. Everything below is
  // written once in those terms and mapped back at the end.
  const vertical = axis === "north-south";
  const point = (along: number, across: number): { x: number; y: number } => (vertical
    ? { x: left + across * cell, y: top + along * cell }
    : { x: left + along * cell, y: top + across * cell });
  const rect = (alongStart: number, alongEnd: number): GateMarkRect => {
    const start = point(alongStart, 0);
    const end = point(alongEnd, 1);
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  };
  const line = (along: number): GateMarkLine => {
    const start = point(along, 0);
    const end = point(along, 1);
    return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  };
  const seam = (): GateMarkLine => {
    const start = point(JAMB, 0.5);
    const end = point(1 - JAMB, 0.5);
    return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  };
  if (state === "open") {
    return {
      door: null,
      bands: [],
      leaves: [rect(JAMB, JAMB + LEAF), rect(1 - JAMB - LEAF, 1 - JAMB)],
    };
  }
  return {
    door: rect(JAMB, 1 - JAMB),
    bands: [line(0.5 - BAND_OFFSET), line(0.5 + BAND_OFFSET), seam()],
    leaves: [],
  };
}
