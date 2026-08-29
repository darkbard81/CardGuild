import type {
  PresentationAssetManifest,
  PresentationTilemap,
  PresentationTilemapPack,
} from "./presentation-types";

function assertLayer(
  scenarioId: string,
  layerName: string,
  values: readonly number[],
  paletteLength: number,
  expectedLength: number,
  allowEmpty: boolean,
): void {
  if (values.length !== expectedLength) {
    throw new Error(`Tilemap "${scenarioId}" layer "${layerName}" must contain ${expectedLength} entries.`);
  }
  for (const [index, value] of values.entries()) {
    if (!Number.isInteger(value) || value < (allowEmpty ? -1 : 0) || value >= paletteLength) {
      throw new Error(`Tilemap "${scenarioId}" layer "${layerName}" has invalid index ${value} at ${index}.`);
    }
  }
}

function assertMetadataLength(scenarioId: string, name: string, values: readonly unknown[], expectedLength: number): void {
  if (values.length !== expectedLength) {
    throw new Error(`Tilemap "${scenarioId}" metadata "${name}" must contain ${expectedLength} entries.`);
  }
}

function assertPalette(
  scenarioId: string,
  name: string,
  values: readonly string[],
  manifest: PresentationAssetManifest,
): void {
  for (const assetId of values) {
    if (!manifest.assets[assetId]) {
      throw new Error(`Tilemap "${scenarioId}" palette "${name}" references unknown asset "${assetId}".`);
    }
  }
}

export function validatePresentationTilemaps(
  pack: PresentationTilemapPack,
  manifest: PresentationAssetManifest,
): void {
  if (pack.version !== 1) throw new Error("Presentation tilemap version must be 1.");
  for (const [scenarioId, map] of Object.entries(pack.maps)) {
    if (!Number.isInteger(map.width) || map.width <= 0 || !Number.isInteger(map.height) || map.height <= 0) {
      throw new Error(`Tilemap "${scenarioId}" dimensions must be positive integers.`);
    }
    const length = map.width * map.height;
    assertPalette(scenarioId, "ground", map.palettes.ground, manifest);
    assertPalette(scenarioId, "transitions", map.palettes.transitions, manifest);
    assertPalette(scenarioId, "objects", map.palettes.objects, manifest);
    assertLayer(scenarioId, "ground", map.layers.ground, map.palettes.ground.length, length, false);
    assertLayer(scenarioId, "transitions", map.layers.transitions, map.palettes.transitions.length, length, true);
    assertLayer(scenarioId, "objects", map.layers.objects, map.palettes.objects.length, length, true);
    assertMetadataLength(scenarioId, "tileIds", map.meta.tileIds, length);
    assertMetadataLength(scenarioId, "objectIds", map.meta.objectIds, length);
    assertMetadataLength(scenarioId, "type", map.meta.type, length);
    assertMetadataLength(scenarioId, "walkable", map.meta.walkable, length);
    assertMetadataLength(scenarioId, "cost", map.meta.cost, length);
    if (new Set(map.meta.tileIds).size !== length) {
      throw new Error(`Tilemap "${scenarioId}" tile IDs must be unique.`);
    }
  }
}

export function tilemapAssetAt(
  map: PresentationTilemap,
  layer: keyof PresentationTilemap["layers"],
  index: number,
): string | null {
  const paletteIndex = map.layers[layer][index];
  if (paletteIndex === undefined || paletteIndex < 0) return null;
  return map.palettes[layer][paletteIndex] ?? null;
}
