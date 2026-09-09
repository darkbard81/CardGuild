import type { PresentationAssetDefinition } from "./presentation-types";

/**
 * Two presentation categories, told apart by one question: is the picture the state of
 * the tile itself, or a thing standing on a tile that would still be there without it?
 *
 *   Board tile visual — floor, difficult ground, chasm, web, wall, gate open or shut.
 *                       Drawn into the board texture and carried by the board plane.
 *   Point prop        — a lever, a chest, a crate. It stands *on* a cell without being
 *                       it, upright on the standee plane, sharing only a contact point.
 *
 * A gate used to be a third thing — a tile-bound structure, one cell wide and standing
 * up — and that middle category is gone: a shut gate is the tile's state, so it is a
 * tile visual like the wall it sits in. Nothing about either category decides gameplay.
 * Movement, Fly and line of sight come from the tile's traits, never from a texture.
 */

/** A point prop stands on a cell without claiming it, and is drawn at its own height. */
export function assertPointPropContract(id: string, asset: PresentationAssetDefinition): void {
  if (asset.displayHeight === undefined) {
    throw new Error(`Point prop "${id}" must author the display height it is drawn at.`);
  }
}

/**
 * The plan-side half of the same contract. The source mode a generation plan declares is
 * what decides how a frame is normalized, so it has to decide the frame's shape too:
 * otherwise a prop could be processed one way and reach the manifest looking like
 * another, and every check downstream would skip it.
 */
export interface FramePlanShape {
  readonly assetId: string;
  readonly kind: string;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly displaySize: { readonly width?: number; readonly height?: number };
  readonly footprint?: { readonly width: number; readonly height: number };
}

export function assertPointPropFramePlan(frame: FramePlanShape): void {
  if (frame.kind !== "object") throw new Error(`${frame.assetId} is a point prop and must be an object.`);
  if (frame.footprint !== undefined) {
    throw new Error(`${frame.assetId} claims a cell: a thing that is the tile is a terrain source, not an object.`);
  }
  if (frame.displaySize.height === undefined) {
    throw new Error(`${frame.assetId} is a point prop and must author the height it is drawn at.`);
  }
  // The runtime draws a point prop height-first, so a width here would be read by nobody.
  // Refusing it keeps the plan from stating something that quietly does not happen.
  if (frame.displaySize.width !== undefined) {
    throw new Error(`${frame.assetId} is a point prop: its height drives it, so a width is never read.`);
  }
}

/** Height the runtime draws a point prop at, from what the asset itself declares. */
export function pointPropHeight(asset: PresentationAssetDefinition, fallback: number): number {
  return asset.displayHeight ?? fallback;
}
