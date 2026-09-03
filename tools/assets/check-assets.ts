import { access, readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { PRODUCTION_CONTENT } from "../../src/content/production-content";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface AssetEntry {
  readonly frame: string;
  readonly kind: "actor" | "terrain" | "object" | "ui";
  readonly anchor: Point;
  readonly displayWidth?: number;
  readonly displayHeight?: number;
  readonly footprint?: { readonly width: number; readonly height: number };
}

interface AssetManifest {
  readonly version: number;
  readonly atlas: {
    readonly path: string;
    readonly imagePath: string;
    readonly width: number;
    readonly height: number;
  };
  readonly assets: Readonly<Record<string, AssetEntry>>;
  readonly actorVisuals: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly equipmentVisuals: Readonly<Record<string, string>>;
  readonly cardVisuals: Readonly<Record<string, string>>;
}

interface ContentDefinition {
  readonly id: string;
}

interface AtlasFrame {
  readonly frame: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly anchor: Point;
}

interface AtlasData {
  readonly frames: Readonly<Record<string, AtlasFrame>>;
  readonly meta: {
    readonly image: string;
    readonly size: { readonly w: number; readonly h: number };
    readonly scale: string;
  };
}

interface Tilemap {
  readonly width: number;
  readonly height: number;
  readonly palettes: Readonly<Record<"ground" | "transitions" | "objects", readonly string[]>>;
  readonly layers: Readonly<Record<"ground" | "transitions" | "objects", readonly number[]>>;
  readonly meta: Readonly<Record<"tileIds" | "objectIds" | "type" | "walkable" | "cost", readonly unknown[]>>;
}

interface TilemapPack {
  readonly version: number;
  readonly maps: Readonly<Record<string, Tilemap>>;
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function assertUnitPoint(id: string, point: Point): void {
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw new Error(`Asset "${id}" anchor must be within 0..1.`);
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function assertAtlasFrame(id: string, frame: AtlasFrame, atlas: AtlasData): void {
  const { x, y, w, h } = frame.frame;
  if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w <= 0 || h <= 0) {
    throw new Error(`Atlas frame "${id}" has invalid geometry.`);
  }
  if (x + w > atlas.meta.size.w || y + h > atlas.meta.size.h) {
    throw new Error(`Atlas frame "${id}" extends outside the atlas.`);
  }
  assertUnitPoint(id, frame.anchor);
}

async function assertCleanAlpha(id: string, filePath: string, kind: AssetEntry["kind"]): Promise<void> {
  const image = sharp(filePath, { failOn: "error" });
  const metadata = await image.metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height || !metadata.hasAlpha) {
    throw new Error(`Processed asset "${id}" must be a readable straight-alpha PNG.`);
  }
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cornerOffsets = [
    3,
    (info.width - 1) * 4 + 3,
    (info.height - 1) * info.width * 4 + 3,
    (info.height * info.width - 1) * 4 + 3,
  ];
  if ((kind === "actor" || kind === "object" || kind === "ui") && cornerOffsets.some((offset) => (data[offset] ?? 255) !== 0)) {
    throw new Error(`Processed asset "${id}" has background pixels in a canvas corner.`);
  }
  let visible = 0;
  let contaminated = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3] ?? 0;
    if (alpha === 0) continue;
    visible += 1;
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    if (alpha < 250 && red > 185 && green < 100 && blue > 185) contaminated += 1;
  }
  if (visible === 0) throw new Error(`Processed asset "${id}" is empty.`);
  if (contaminated / visible > 0.002) throw new Error(`Processed asset "${id}" retains magenta edge contamination.`);
  if (kind === "actor" && (metadata.width !== 256 || metadata.height !== 384)) {
    throw new Error(`Processed actor "${id}" must use the 256x384 standee canvas.`);
  }
  if (kind === "object" && ![256, 384].includes(metadata.width)) {
    throw new Error(`Processed object "${id}" has the wrong normalized canvas.`);
  }
  if (kind === "ui" && (metadata.width !== 256 || metadata.height !== 256)) {
    throw new Error(`Processed UI icon "${id}" must use a 256x256 canvas.`);
  }
}

function assertVisualMap(
  label: string,
  definitions: readonly ContentDefinition[],
  visuals: Readonly<Record<string, string>>,
  manifest: AssetManifest,
): void {
  const expected = [...definitions].map((definition) => definition.id).sort();
  const actual = Object.keys(visuals).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} visual IDs must match the production content pack exactly.`);
  }
  for (const [definitionId, assetId] of Object.entries(visuals)) {
    if (manifest.assets[assetId]?.kind !== "ui") {
      throw new Error(`${label} visual "${definitionId}" references missing UI asset "${assetId}".`);
    }
  }
}

function assertTilemapPack(pack: TilemapPack, manifest: AssetManifest): void {
  if (pack.version !== 1) throw new Error("Presentation tilemap version must be 1.");
  for (const [scenarioId, map] of Object.entries(pack.maps)) {
    const length = map.width * map.height;
    if (!Number.isInteger(map.width) || map.width <= 0 || !Number.isInteger(map.height) || map.height <= 0) {
      throw new Error(`Tilemap "${scenarioId}" dimensions must be positive integers.`);
    }
    for (const layerName of ["ground", "transitions", "objects"] as const) {
      const palette = map.palettes[layerName];
      const layer = map.layers[layerName];
      if (layer.length !== length) throw new Error(`Tilemap "${scenarioId}" layer "${layerName}" has the wrong length.`);
      for (const assetId of palette) {
        if (!manifest.assets[assetId]) throw new Error(`Tilemap "${scenarioId}" references missing asset "${assetId}".`);
      }
      for (const value of layer) {
        const minimum = layerName === "ground" ? 0 : -1;
        if (!Number.isInteger(value) || value < minimum || value >= palette.length) {
          throw new Error(`Tilemap "${scenarioId}" layer "${layerName}" contains invalid index ${value}.`);
        }
      }
    }
    for (const [name, values] of Object.entries(map.meta)) {
      if (values.length !== length) throw new Error(`Tilemap "${scenarioId}" metadata "${name}" has the wrong length.`);
    }
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const presentationRoot = path.join(root, "presentation", "m3");
  const manifest = await readJson<AssetManifest>(path.join(presentationRoot, "asset-manifest.json"));
  const sources = await readJson<Readonly<Record<string, string>>>(path.join(presentationRoot, "asset-sources.json"));
  const tilemaps = await readJson<TilemapPack>(path.join(presentationRoot, "tilemaps.json"));
  // Visual coverage is checked against whatever pack actually ships (#12), not against the
  // legacy fixture the presentation directory is still named after.
  const equipment: readonly ContentDefinition[] = Object.values(PRODUCTION_CONTENT.pack.combatContent.equipment);
  const cards: readonly ContentDefinition[] = Object.values(PRODUCTION_CONTENT.pack.combatContent.cards);
  if (manifest.version !== 4) throw new Error("Presentation asset manifest version must be 4.");
  if (manifest.atlas.path !== "/assets/m3-atlas.json" || manifest.atlas.imagePath !== "/assets/m3-atlas.webp") {
    throw new Error("Presentation atlas paths are not canonical.");
  }

  const atlasDataPath = path.join(root, "public", manifest.atlas.path.slice(1));
  const atlas = await readJson<AtlasData>(atlasDataPath);
  const atlasImagePath = path.join(path.dirname(atlasDataPath), atlas.meta.image);
  await access(atlasImagePath);
  const atlasMetadata = await sharp(atlasImagePath).metadata();
  if (atlasMetadata.format !== "webp" || !atlasMetadata.hasAlpha || !atlasMetadata.width || !atlasMetadata.height) {
    throw new Error("Runtime atlas must be a readable alpha WebP image.");
  }
  if (!isPowerOfTwo(atlasMetadata.width) || atlasMetadata.width !== atlasMetadata.height) {
    throw new Error("Runtime atlas must be square and power-of-two.");
  }
  if (atlas.meta.size.w !== atlasMetadata.width || atlas.meta.size.h !== atlasMetadata.height || atlas.meta.scale !== "1") {
    throw new Error("Runtime atlas metadata does not match its image.");
  }
  if (manifest.atlas.width !== atlasMetadata.width || manifest.atlas.height !== atlasMetadata.height) {
    throw new Error("Presentation manifest atlas dimensions do not match its image.");
  }

  const ids = Object.keys(manifest.assets).sort();
  if (JSON.stringify(ids) !== JSON.stringify(Object.keys(sources).sort())) {
    throw new Error("Asset source IDs and manifest asset IDs must match exactly.");
  }
  if (JSON.stringify(ids) !== JSON.stringify(Object.keys(atlas.frames).sort())) {
    throw new Error("Atlas frame IDs and manifest asset IDs must match exactly.");
  }
  for (const id of ids) {
    const asset = manifest.assets[id];
    const frame = atlas.frames[id];
    const source = sources[id];
    if (!asset || !frame || !source) throw new Error(`Asset "${id}" is incomplete.`);
    if (asset.frame !== id) throw new Error(`Asset "${id}" must use its ID as the atlas frame name.`);
    assertUnitPoint(id, asset.anchor);
    assertAtlasFrame(id, frame, atlas);
    if (JSON.stringify(asset.anchor) !== JSON.stringify(frame.anchor)) {
      throw new Error(`Asset "${id}" anchor drifted between manifest and atlas.`);
    }
    if (asset.displayWidth !== undefined && asset.displayWidth <= 0) throw new Error(`Asset "${id}" displayWidth must be positive.`);
    if (asset.displayHeight !== undefined && asset.displayHeight <= 0) throw new Error(`Asset "${id}" displayHeight must be positive.`);
    if (asset.footprint && (asset.footprint.width !== 128 || asset.footprint.height !== 128)) {
      throw new Error(`Terrain asset "${id}" must declare the 128x128 square footprint.`);
    }
    await assertCleanAlpha(id, path.join(root, source), asset.kind);
  }

  for (const [definitionId, visual] of Object.entries(manifest.actorVisuals)) {
    for (const side of ["front", "back"]) {
      const id = visual[side];
      if (!id || manifest.assets[id]?.kind !== "actor") {
        throw new Error(`Actor visual "${definitionId}" is missing a valid ${side} asset.`);
      }
    }
  }
  assertVisualMap("Equipment", equipment, manifest.equipmentVisuals, manifest);
  assertVisualMap("Card", cards, manifest.cardVisuals, manifest);
  assertTilemapPack(tilemaps, manifest);
  process.stdout.write(`Assets OK: ${ids.length} atlas frames, ${Object.keys(manifest.actorVisuals).length} two-sided actors, ${Object.keys(tilemaps.maps).length} layered tilemaps\n`);
}

await main();
