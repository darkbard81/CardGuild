import type { PresentationAssetDefinition } from "./presentation-types";

/**
 * A tile-bound structure is an object that owns one terrain cell — a wall, a gate. It
 * says so by declaring a footprint, which is what lets the runtime size it without ever
 * asking which asset it is. Height is deliberately free: a low wall and a high wall
 * differ in silhouette, and neither difference means anything to the rules. Movement,
 * Fly and line of sight come from the tile's traits, never from a texture.
 */
export const STRUCTURE_RUNTIME_WIDTH = 128;

/** Canonical production width: one runtime cell drawn at 2x. */
export const STRUCTURE_SOURCE_WIDTH = 256;

/** A pixel or two of drift between gate states is rounding, not a moved frame. */
export const GATE_BOUNDS_TOLERANCE = 2;

export interface InkBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface StructureFrame {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly ink: InkBox | null;
}

export function isTileStructure(asset: PresentationAssetDefinition): boolean {
  return asset.kind === "object" && asset.footprint !== undefined;
}

/** Throws the first way this asset breaks the structure contract, or nothing. */
export function assertStructureContract(
  id: string,
  asset: PresentationAssetDefinition,
  frame: StructureFrame,
): void {
  if (asset.anchor.x !== 0.5 || asset.anchor.y !== 1) {
    throw new Error(`Structure "${id}" must sit on a bottom-centre anchor.`);
  }
  if (asset.footprint?.width !== STRUCTURE_RUNTIME_WIDTH || asset.footprint.height !== STRUCTURE_RUNTIME_WIDTH) {
    throw new Error(`Structure "${id}" must claim one ${STRUCTURE_RUNTIME_WIDTH}x${STRUCTURE_RUNTIME_WIDTH} cell.`);
  }
  if (asset.displayWidth !== STRUCTURE_RUNTIME_WIDTH) {
    throw new Error(`Structure "${id}" must declare a ${STRUCTURE_RUNTIME_WIDTH}px display width.`);
  }
  if (asset.displayHeight !== undefined) {
    throw new Error(`Structure "${id}" must not author a display height: its width drives it.`);
  }
  if (frame.canvas.width !== STRUCTURE_SOURCE_WIDTH) {
    throw new Error(`Structure "${id}" must be normalized to a ${STRUCTURE_SOURCE_WIDTH}px canvas width.`);
  }
  if (!frame.ink || frame.ink.width !== frame.canvas.width) {
    throw new Error(`Structure "${id}" must span its canvas width so one cell is the whole structure.`);
  }
  if (frame.ink.top + frame.ink.height !== frame.canvas.height) {
    throw new Error(`Structure "${id}" must stand on the bottom of its canvas.`);
  }
}

/** A point prop stands on a cell without claiming it, and is drawn at its own height. */
export function assertPointPropContract(id: string, asset: PresentationAssetDefinition): void {
  if (asset.displayHeight === undefined) {
    throw new Error(`Point prop "${id}" must author the display height it is drawn at.`);
  }
}

/**
 * One structure in two states: swapping the texture must not move or resize anything, so
 * the door can open without the gate jumping.
 */
export function assertGatePair(closed: StructureFrame, open: StructureFrame): void {
  if (closed.canvas.width !== open.canvas.width || closed.canvas.height !== open.canvas.height) {
    throw new Error("Gate states must share one canvas.");
  }
  if (!closed.ink || !open.ink) throw new Error("Gate states must both be drawn.");
  if (Math.abs(closed.ink.height - open.ink.height) > GATE_BOUNDS_TOLERANCE
    || Math.abs(closed.ink.top - open.ink.top) > GATE_BOUNDS_TOLERANCE) {
    throw new Error("Gate states must keep the same bounds: only the opening changes.");
  }
}

export type SpriteSizing =
  | { readonly axis: "width"; readonly value: number }
  | { readonly axis: "height"; readonly value: number };

/**
 * Which axis the renderer fixes. A structure is one cell wide and lets its height follow
 * the art; a point prop keeps the height it was authored at. Chosen from what the asset
 * declares, never from its id.
 */
export function spriteSizing(
  asset: PresentationAssetDefinition,
  fallbackPropHeight: number,
): SpriteSizing {
  return isTileStructure(asset)
    ? { axis: "width", value: asset.displayWidth ?? STRUCTURE_RUNTIME_WIDTH }
    : { axis: "height", value: asset.displayHeight ?? fallbackPropHeight };
}
