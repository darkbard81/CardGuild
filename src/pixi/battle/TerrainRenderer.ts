import { Container, Sprite } from "pixi.js";

import type { CombatState, TileState } from "../../game";
import type { AssetCatalog } from "../../presentation";
import { tilemapAssetAt } from "../../presentation";
import type { DepthKey } from "./DepthOrder";
import { gridToIso } from "./IsometricProjection";

export interface SortableVisual extends DepthKey {
  readonly display: Container;
}

function sizedSprite(catalog: AssetCatalog, assetId: string, fallbackHeight: number): Sprite {
  const asset = catalog.asset(assetId);
  const sprite = new Sprite(catalog.texture(assetId));
  sprite.anchor.set(asset.anchor.x, asset.anchor.y);
  if (asset.displayWidth !== undefined && asset.displayHeight !== undefined) {
    sprite.setSize(asset.displayWidth, asset.displayHeight);
  } else {
    sprite.height = asset.displayHeight ?? fallbackHeight;
    sprite.scale.x = sprite.scale.y;
  }
  sprite.eventMode = "none";
  return sprite;
}

function raisedAssetId(catalog: AssetCatalog, tile: TileState): string | null {
  const traits = new Set(tile.traits.map((trait) => trait.id));
  if (traits.has("gate")) return catalog.manifest.objectVisuals.gateClosed;
  if (traits.has("gate-open")) return catalog.manifest.objectVisuals.gateOpen;
  if (traits.has("blocked")) return catalog.manifest.terrainVisuals.blocked;
  return null;
}

export class TerrainRenderer {
  public constructor(private readonly catalog: AssetCatalog) {}

  public render(
    state: CombatState,
    groundLayer: Container,
    transitionLayer: Container,
  ): readonly SortableVisual[] {
    const tilemap = this.catalog.tilemap(state.scenarioId);
    if (tilemap.width !== state.map.width || tilemap.height !== state.map.height) {
      throw new Error(`Presentation tilemap "${state.scenarioId}" dimensions do not match combat state.`);
    }
    const stateTiles = new Map(
      Object.values(state.map.tiles).map((tile) => [`${tile.position.x},${tile.position.y}`, tile]),
    );
    const positions = Array.from({ length: tilemap.width * tilemap.height }, (_, index) => ({
      index,
      position: { x: index % tilemap.width, y: Math.floor(index / tilemap.width) },
    })).sort((left, right) =>
      left.position.x + left.position.y - (right.position.x + right.position.y)
      || left.position.y - right.position.y
      || left.position.x - right.position.x,
    );
    const raised: SortableVisual[] = [];

    for (const { index, position } of positions) {
      const tile = stateTiles.get(`${position.x},${position.y}`);
      if (!tile) throw new Error(`Combat state is missing tile ${position.x},${position.y}.`);
      const point = gridToIso(position);
      const groundAssetId = tilemapAssetAt(tilemap, "ground", index);
      if (!groundAssetId) throw new Error(`Presentation tilemap is missing ground at ${position.x},${position.y}.`);
      const ground = sizedSprite(this.catalog, groundAssetId, 48);
      ground.position.set(point.x, point.y);
      groundLayer.addChild(ground);

      const transitionAssetId = tilemapAssetAt(tilemap, "transitions", index);
      if (transitionAssetId) {
        const overlay = sizedSprite(this.catalog, transitionAssetId, 32);
        overlay.position.set(point.x, point.y);
        transitionLayer.addChild(overlay);
      }

      const mappedObjectId = tilemapAssetAt(tilemap, "objects", index);
      const propId = mappedObjectId === this.catalog.manifest.objectVisuals.lever
        ? null
        : raisedAssetId(this.catalog, tile);
      if (propId) {
        const display = new Container({ x: point.x, y: point.y + 6, label: tile.id });
        display.addChild(sizedSprite(this.catalog, propId, 76));
        raised.push({ display, position: tile.position, layerPriority: 10, stableId: tile.id });
      }
    }
    return raised;
  }
}
