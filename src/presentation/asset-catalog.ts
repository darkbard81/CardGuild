import { Assets, type Spritesheet, type Texture } from "pixi.js";

import atlasMapJson from "../../presentation/m3/atlas-map.json";
import manifestJson from "../../presentation/m3/asset-manifest.json";
import tilemapsJson from "../../presentation/m3/tilemaps.json";
import type {
  ActorVisualDefinition,
  DomAtlasStyle,
  PresentationAssetDefinition,
  PresentationAssetId,
  PresentationAssetManifest,
  PresentationAtlasMap,
  PresentationTilemap,
  PresentationTilemapPack,
} from "./presentation-types";
import { validatePresentationTilemaps } from "./tilemap";

/**
 * How much of the drawing's height the portrait square takes. Measured against every
 * actor in the pack: 0.3 frames the head for anything that stands upright and the front
 * of anything that does not, while a larger share drifts down onto the chest.
 */
const PORTRAIT_INK_FRACTION = 0.3;

export class AssetCatalog {
  private readonly textures = new Map<PresentationAssetId, Texture>();
  private initialized = false;

  public constructor(
    public readonly manifest: PresentationAssetManifest,
    public readonly tilemaps: PresentationTilemapPack,
    private readonly atlasMap: PresentationAtlasMap,
  ) {
    validatePresentationTilemaps(tilemaps, manifest);
  }

  public async loadEncounterBundle(): Promise<void> {
    if (this.initialized) return;
    const atlasAlias = `${this.manifest.bundle}.atlas`;
    await Assets.init({
      manifest: {
        bundles: [
          {
            name: this.manifest.bundle,
            assets: [{ alias: atlasAlias, src: this.manifest.atlas.path }],
          },
        ],
      },
    });
    const loaded = await Assets.loadBundle(this.manifest.bundle) as Record<string, Spritesheet>;
    const sheet = loaded[atlasAlias];
    if (!sheet) throw new Error(`Presentation atlas "${atlasAlias}" did not load.`);
    for (const [id, asset] of Object.entries(this.manifest.assets)) {
      const texture = sheet.textures[asset.frame];
      if (!texture) throw new Error(`Presentation frame "${asset.frame}" is missing from the atlas.`);
      this.textures.set(id, texture);
    }
    this.initialized = true;
  }

  public asset(id: PresentationAssetId): PresentationAssetDefinition {
    const asset = this.manifest.assets[id];
    if (!asset) throw new Error(`Presentation asset "${id}" is not registered.`);
    return asset;
  }

  public texture(id: PresentationAssetId): Texture {
    const texture = this.textures.get(id);
    if (!texture) throw new Error(`Presentation asset "${id}" has not been loaded.`);
    return texture;
  }

  public actorVisual(definitionId: string): ActorVisualDefinition {
    const visual = this.manifest.actorVisuals[definitionId];
    if (!visual) throw new Error(`Actor visual "${definitionId}" is not registered.`);
    return visual;
  }

  public tilemap(scenarioId: string): PresentationTilemap {
    const tilemap = this.tilemaps.maps[scenarioId];
    if (!tilemap) throw new Error(`Presentation tilemap "${scenarioId}" is not registered.`);
    return tilemap;
  }

  public equipmentVisual(equipmentId: string): PresentationAssetId | null {
    return this.manifest.equipmentVisuals[equipmentId] ?? null;
  }

  public cardVisual(cardDefinitionId: string): PresentationAssetId | null {
    return this.manifest.cardVisuals[cardDefinitionId] ?? null;
  }

  public domAtlasStyle(id: PresentationAssetId, size: number): DomAtlasStyle {
    const frame = this.atlasMap.frames[id]?.frame;
    if (!frame) throw new Error(`Presentation atlas frame "${id}" is not registered.`);
    if (!Number.isFinite(size) || size <= 0) throw new Error("DOM atlas size must be positive.");
    const scaleX = size / frame.w;
    const scaleY = size / frame.h;
    return {
      backgroundImage: `url("${this.manifest.atlas.imagePath}")`,
      backgroundPosition: `${-frame.x * scaleX}px ${-frame.y * scaleY}px`,
      backgroundSize: `${this.manifest.atlas.width * scaleX}px ${this.manifest.atlas.height * scaleY}px`,
      width: `${size}px`,
      height: `${size}px`,
    };
  }

  /**
   * A square crop of the top of the drawing — a face for anything that stands upright,
   * and the front of anything that does not. Framed from the measured ink box, so a
   * creature whose art leaves the top of its canvas empty is not shown as an empty box.
   */
  public domPortraitStyle(id: PresentationAssetId, size: number): DomAtlasStyle {
    const frame = this.atlasMap.frames[id]?.frame;
    if (!frame) throw new Error(`Presentation atlas frame "${id}" is not registered.`);
    if (!Number.isFinite(size) || size <= 0) throw new Error("DOM portrait size must be positive.");
    const ink = this.asset(id).ink;
    const side = Math.min(frame.w, ink ? frame.h * ink.height * PORTRAIT_INK_FRACTION : frame.h);
    const top = ink ? frame.h * ink.top : 0;
    const centerX = ink ? frame.w * (ink.left + ink.width / 2) : frame.w / 2;
    const scale = size / side;
    return {
      backgroundImage: `url("${this.manifest.atlas.imagePath}")`,
      backgroundPosition:
        `${-(frame.x + centerX - side / 2) * scale}px ${-(frame.y + top) * scale}px`,
      backgroundSize: `${this.manifest.atlas.width * scale}px ${this.manifest.atlas.height * scale}px`,
      width: `${size}px`,
      height: `${size}px`,
    };
  }

  public domAtlasPortraitStyle(id: PresentationAssetId, height: number): DomAtlasStyle {
    const frame = this.atlasMap.frames[id]?.frame;
    if (!frame) throw new Error(`Presentation atlas frame "${id}" is not registered.`);
    if (!Number.isFinite(height) || height <= 0) throw new Error("DOM atlas height must be positive.");
    const scale = height / frame.h;
    return {
      backgroundImage: `url("${this.manifest.atlas.imagePath}")`,
      backgroundPosition: `${-frame.x * scale}px ${-frame.y * scale}px`,
      backgroundSize: `${this.manifest.atlas.width * scale}px ${this.manifest.atlas.height * scale}px`,
      width: `${frame.w * scale}px`,
      height: `${height}px`,
    };
  }

  public async unload(): Promise<void> {
    if (!this.initialized) return;
    this.textures.clear();
    await Assets.unloadBundle(this.manifest.bundle);
    this.initialized = false;
  }
}

export async function loadPresentationPack(): Promise<AssetCatalog> {
  const catalog = createPresentationCatalog();
  await catalog.loadEncounterBundle();
  return catalog;
}

export function createPresentationCatalog(): AssetCatalog {
  return new AssetCatalog(
    manifestJson as unknown as PresentationAssetManifest,
    tilemapsJson as unknown as PresentationTilemapPack,
    atlasMapJson as unknown as PresentationAtlasMap,
  );
}
