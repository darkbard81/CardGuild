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

/**
 * The plan-side half of the same contract. The source mode a generation plan declares is
 * what decides how a frame is normalized, so it has to decide the frame's shape too:
 * otherwise a structure could be processed width-first and still reach the manifest
 * looking like a point prop, and every check downstream would skip it.
 */
export interface FramePlanShape {
  readonly assetId: string;
  readonly kind: string;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly displaySize: { readonly width?: number; readonly height?: number };
  readonly footprint?: { readonly width: number; readonly height: number };
}

export function assertStructureFramePlan(frame: FramePlanShape, canvasWidth: number): void {
  if (canvasWidth !== STRUCTURE_SOURCE_WIDTH) {
    throw new Error(`${frame.assetId} is a structure and must use a ${STRUCTURE_SOURCE_WIDTH}px canvas width.`);
  }
  if (frame.kind !== "object") throw new Error(`${frame.assetId} is a structure and must be an object.`);
  if (frame.anchor.x !== 0.5 || frame.anchor.y !== 1) {
    throw new Error(`${frame.assetId} is a structure and must sit on a bottom-centre anchor.`);
  }
  if (frame.displaySize.width !== STRUCTURE_RUNTIME_WIDTH) {
    throw new Error(`${frame.assetId} is a structure and must declare a ${STRUCTURE_RUNTIME_WIDTH}px display width.`);
  }
  if (frame.displaySize.height !== undefined) {
    throw new Error(`${frame.assetId} is a structure: its width drives it, so it must not author a height.`);
  }
  if (frame.footprint?.width !== STRUCTURE_RUNTIME_WIDTH || frame.footprint.height !== STRUCTURE_RUNTIME_WIDTH) {
    throw new Error(`${frame.assetId} is a structure and must claim one ${STRUCTURE_RUNTIME_WIDTH}x${STRUCTURE_RUNTIME_WIDTH} cell.`);
  }
}

export function assertPointPropFramePlan(frame: FramePlanShape): void {
  if (frame.kind !== "object") throw new Error(`${frame.assetId} is a point prop and must be an object.`);
  if (frame.footprint !== undefined) {
    throw new Error(`${frame.assetId} claims a cell: declare it as a tile-structure source instead.`);
  }
  if (frame.displaySize.height === undefined) {
    throw new Error(`${frame.assetId} is a point prop and must author the height it is drawn at.`);
  }
}

/**
 * Walls and gates are structures by definition. Saying so here means a wall that lost its
 * footprint fails loudly instead of being waved through as a point prop.
 */
export const REQUIRED_STRUCTURE_VISUALS = ["wall", "gateClosed", "gateOpen"] as const;

export function assertRequiredStructures(
  objectVisuals: Readonly<Record<string, string>>,
  validated: ReadonlySet<string>,
): void {
  for (const key of REQUIRED_STRUCTURE_VISUALS) {
    const id = objectVisuals[key];
    if (!id) throw new Error(`Object visual "${key}" is missing.`);
    if (!validated.has(id)) {
      throw new Error(`Object visual "${key}" must be a tile-bound structure, and "${id}" is not.`);
    }
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
