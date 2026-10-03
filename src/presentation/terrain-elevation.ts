import type { PresentationTilemap, PresentationTilemapPack } from "./presentation-types";

/** Presentation only: no jump, movement, save-schema or combat-rule changes. */
export const MAX_TERRAIN_ELEVATION = 8;
export const TERRAIN_ELEVATION_STEP = 32;
export interface TerrainElevationDocument {
  readonly version: 1;
  readonly maps: Readonly<Record<string, readonly number[]>>;
}
export function validateElevations(values: readonly number[], length: number): void {
  if (!Array.isArray(values) || values.length !== length || Array.from(values).some(value =>
    !Number.isInteger(value) || value < 0 || value > MAX_TERRAIN_ELEVATION)) {
    throw new Error(`높이는 타일 수와 같은 길이의 0~${MAX_TERRAIN_ELEVATION} 정수 배열이어야 합니다.`);
  }
}
export function elevationAt(map: PresentationTilemap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  return map.meta.elevations?.[y * map.width + x] ?? 0;
}
/** Visible front faces, measured down from this tile's own top (never the neighbour's top). */
export function exposedTerrainFaces(map: PresentationTilemap, x: number, y: number): { left: number; right: number } {
  const top = elevationAt(map, x, y);
  return { left: Math.max(0, top - elevationAt(map, x, y + 1)), right: Math.max(0, top - elevationAt(map, x + 1, y)) };
}
export function applyTerrainElevations(pack: PresentationTilemapPack, input: unknown): PresentationTilemapPack {
  if (!input || typeof input !== "object" || !("version" in input) || input.version !== 1 ||
    !("maps" in input) || !input.maps || typeof input.maps !== "object" || Array.isArray(input.maps)) {
    throw new Error("높이 파일은 version: 1, maps 객체가 필요합니다.");
  }
  const maps = { ...pack.maps };
  for (const [id, values] of Object.entries(input.maps)) {
    const map = maps[id];
    if (!map) throw new Error(`알 수 없는 맵: ${id}`);
    validateElevations(values as readonly number[], map.width * map.height);
    maps[id] = { ...map, meta: { ...map.meta, elevations: [...values as number[]] } };
  }
  return { ...pack, maps };
}

/** Side sheets have their own contract and never enter the square-top atlas validator. */
export function terrainSideMaterials(input: unknown, assets: Readonly<Record<string, { readonly kind: string }>>): Readonly<Record<string, string>> {
  if (!input || typeof input !== "object" || !("version" in input) || input.version !== 1 ||
    !("materials" in input) || !input.materials || typeof input.materials !== "object" || Array.isArray(input.materials)) {
    throw new Error("Side materials require version 1 and a materials object.");
  }
  const result: Record<string, string> = {};
  for (const [id, path] of Object.entries(input.materials)) {
    if (assets[id]?.kind !== "terrain" || typeof path !== "string" || !/^\/assets\/[a-zA-Z0-9_/-]+\.(png|webp)$/.test(path))
      throw new Error(`Invalid terrain side material: ${id}`);
    result[id] = path;
  }
  return result;
}
