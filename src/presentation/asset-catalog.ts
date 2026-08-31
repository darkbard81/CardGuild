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
