import { Assets, type Spritesheet, type Texture } from "pixi.js";

import atlasMapJson from "../../presentation/m3/atlas-map.json";
import manifestJson from "../../presentation/m3/asset-manifest.json";
import tilemapsJson from "../../presentation/m3/tilemaps.json";
import type {
  ActorVisualDefinition,
  DomAssetStyle,
  DomFillStyle,
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

/**
 * One asset's pixels as CSS sees them: a picture to point `background-image` at, the size
 * of that picture, and the box inside it the asset occupies. An atlas frame is a box
 * inside a big sheet; a standalone actor file is the whole of its own picture. Saying it
 * this way once is what keeps every DOM helper below from asking where the art is stored.
 */
interface DomFrame {
  readonly imagePath: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

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

  /**
   * The atlas and every standalone actor image, loaded as one bundle so a single unload
   * still takes the whole encounter's art with it. Actors are loaded eagerly: the party
   * and its enemies are picked before the board exists, so nothing here is per-encounter
   * yet, and a lazy path would buy latency at the cost of a lifecycle nobody needs.
   */
  public async loadEncounterBundle(): Promise<void> {
    if (this.initialized) return;
    const atlasAlias = `${this.manifest.bundle}.atlas`;
    const imageAssets = Object.entries(this.manifest.assets).flatMap(([id, asset]) =>
      asset.source.type === "image" ? [{ alias: id, src: asset.source.path }] : []);
    await Assets.init({
      manifest: {
        bundles: [
          {
            name: this.manifest.bundle,
            assets: [{ alias: atlasAlias, src: this.manifest.atlas.path }, ...imageAssets],
          },
        ],
      },
    });
    const loaded = await Assets.loadBundle(this.manifest.bundle) as Record<string, unknown>;
    const sheet = loaded[atlasAlias] as Spritesheet | undefined;
    if (!sheet) throw new Error(`Presentation atlas "${atlasAlias}" did not load.`);
    for (const [id, asset] of Object.entries(this.manifest.assets)) {
      if (asset.source.type === "atlas") {
        const texture = sheet.textures[asset.source.frame];
        if (!texture) throw new Error(`Presentation frame "${asset.source.frame}" is missing from the atlas.`);
        this.textures.set(id, texture);
        continue;
      }
      const texture = loaded[id] as Texture | undefined;
      if (!texture) throw new Error(`Presentation image "${asset.source.path}" did not load.`);
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

  private domFrame(id: PresentationAssetId): DomFrame {
    const source = this.asset(id).source;
    if (source.type === "image") {
      return {
        imagePath: source.path,
        imageWidth: source.width,
        imageHeight: source.height,
        x: 0,
        y: 0,
        w: source.width,
        h: source.height,
      };
    }
    const frame = this.atlasMap.frames[source.frame]?.frame;
    if (!frame) throw new Error(`Presentation atlas frame "${source.frame}" is not registered.`);
    return {
      imagePath: this.manifest.atlas.imagePath,
      imageWidth: this.manifest.atlas.width,
      imageHeight: this.manifest.atlas.height,
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
    };
  }

  /** One asset drawn into a square of the given side, whatever it is stored in. */
  public domAssetStyle(id: PresentationAssetId, size: number): DomAssetStyle {
    if (!Number.isFinite(size) || size <= 0) throw new Error("DOM asset size must be positive.");
    const frame = this.domFrame(id);
    const scaleX = size / frame.w;
    const scaleY = size / frame.h;
    return {
      backgroundImage: `url("${frame.imagePath}")`,
      backgroundPosition: `${-frame.x * scaleX}px ${-frame.y * scaleY}px`,
      backgroundSize: `${frame.imageWidth * scaleX}px ${frame.imageHeight * scaleY}px`,
      width: `${size}px`,
      height: `${size}px`,
    };
  }

  /**
   * A square crop of the top of the drawing — a face for anything that stands upright,
   * and the front of anything that does not. Framed from the measured ink box, so a
   * creature whose art leaves the top of its canvas empty is not shown as an empty box.
   */
  public domPortraitStyle(id: PresentationAssetId, size: number): DomAssetStyle {
    if (!Number.isFinite(size) || size <= 0) throw new Error("DOM portrait size must be positive.");
    const frame = this.domFrame(id);
    const ink = this.asset(id).ink;
    const side = Math.min(frame.w, ink ? frame.h * ink.height * PORTRAIT_INK_FRACTION : frame.h);
    const top = ink ? frame.h * ink.top : 0;
    const centerX = ink ? frame.w * (ink.left + ink.width / 2) : frame.w / 2;
    const scale = size / side;
    return {
      backgroundImage: `url("${frame.imagePath}")`,
      backgroundPosition:
        `${-(frame.x + centerX - side / 2) * scale}px ${-(frame.y + top) * scale}px`,
      backgroundSize: `${frame.imageWidth * scale}px ${frame.imageHeight * scale}px`,
      width: `${size}px`,
      height: `${size}px`,
    };
  }

  /**
   * One asset as a background that scales with its element, so a card can hand its
   * picture whatever room it has instead of the picture fixing the room. The frame is
   * placed by percentage, which is what makes a sprite sheet resize cleanly; a standalone
   * image is its own whole picture, so the same arithmetic lands on `0% 0% / 100% 100%`.
   */
  public domFillStyle(id: PresentationAssetId): DomFillStyle {
    const frame = this.domFrame(id);
    const spanX = frame.imageWidth - frame.w;
    const spanY = frame.imageHeight - frame.h;
    return {
      backgroundImage: `url("${frame.imagePath}")`,
      backgroundPosition:
        `${spanX <= 0 ? 0 : (frame.x / spanX) * 100}% ${spanY <= 0 ? 0 : (frame.y / spanY) * 100}%`,
      backgroundSize: `${(frame.imageWidth / frame.w) * 100}% ${(frame.imageHeight / frame.h) * 100}%`,
    };
  }

  /** A whole standee at a given height, keeping the drawing's own proportions. */
  public domStandeeStyle(id: PresentationAssetId, height: number): DomAssetStyle {
    if (!Number.isFinite(height) || height <= 0) throw new Error("DOM standee height must be positive.");
    const frame = this.domFrame(id);
    const scale = height / frame.h;
    return {
      backgroundImage: `url("${frame.imagePath}")`,
      backgroundPosition: `${-frame.x * scale}px ${-frame.y * scale}px`,
      backgroundSize: `${frame.imageWidth * scale}px ${frame.imageHeight * scale}px`,
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
