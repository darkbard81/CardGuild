import type { PresentationAssetDefinition } from "./presentation-types";

/**
 * A board tile visual is the state of one square: the floors, the wall, and a gate in
 * each of its two states. They all use one contract — a top-down square drawn at twice
 * the runtime size — because they are all composited into the board texture the same
 * way, and because a shut gate has to line up with the wall it is set into to the pixel.
 *
 * There is no second, upright category any more. Anything that is the tile is a tile
 * visual; anything standing on it is a point prop.
 */
export const TILE_RUNTIME_SIZE = 128;

/** Canonical production size: one runtime cell drawn at 2x. */
export const TILE_SOURCE_SIZE = 256;

export interface TileCanvas {
  readonly width: number;
  readonly height: number;
}

/** Throws the first way this asset breaks the tile visual contract, or nothing. */
export function assertTileVisualContract(
  id: string,
  asset: PresentationAssetDefinition,
  canvas: TileCanvas,
): void {
  if (asset.kind !== "terrain") throw new Error(`Tile visual "${id}" must be terrain.`);
  if (asset.anchor.x !== 0.5 || asset.anchor.y !== 0.5) {
    throw new Error(`Tile visual "${id}" must sit on a centred anchor.`);
  }
  if (asset.displayWidth !== TILE_RUNTIME_SIZE || asset.displayHeight !== TILE_RUNTIME_SIZE) {
    throw new Error(`Tile visual "${id}" must be drawn ${TILE_RUNTIME_SIZE}x${TILE_RUNTIME_SIZE}.`);
  }
  if (asset.footprint?.width !== TILE_RUNTIME_SIZE || asset.footprint.height !== TILE_RUNTIME_SIZE) {
    throw new Error(`Tile visual "${id}" must claim one ${TILE_RUNTIME_SIZE}x${TILE_RUNTIME_SIZE} cell.`);
  }
  if (canvas.width !== TILE_SOURCE_SIZE || canvas.height !== TILE_SOURCE_SIZE) {
    throw new Error(`Tile visual "${id}" must be normalized to a ${TILE_SOURCE_SIZE}px square canvas.`);
  }
}

/**
 * Every state a tile can be drawn in has to have a picture, including both halves of the
 * gate pair: a gate that lost its open state would open into nothing at the moment a
 * lever is pulled, which is the one moment nobody is looking at the manifest.
 */
export const REQUIRED_TILE_VISUALS = [
  "open",
  "difficult",
  "impassable",
  "web",
  "blocked",
  "gateClosed",
  "gateOpen",
] as const;

export function assertRequiredTileVisuals(
  terrainVisuals: Readonly<Record<string, string>>,
  validated: ReadonlySet<string>,
): void {
  for (const key of REQUIRED_TILE_VISUALS) {
    const id = terrainVisuals[key];
    if (!id) throw new Error(`Terrain visual "${key}" is missing.`);
    if (!validated.has(id)) {
      throw new Error(`Terrain visual "${key}" must be a board tile visual, and "${id}" is not.`);
    }
  }
}
