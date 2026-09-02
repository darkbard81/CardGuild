import { type Application, Container, Graphics, Sprite, type Texture, TexturePool } from "pixi.js";

import type { CombatState, GridPosition, TileState } from "../../game";
import type { AssetCatalog } from "../../presentation";
import { tilemapAssetAt } from "../../presentation";
import type { BoardViewConfig } from "./BoardViewConfig";
import { DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";

export interface SortableVisual {
  readonly display: Container;
  readonly position: GridPosition;
  readonly footRowOffset: number;
  readonly layerPriority: number;
  readonly stableId: string;
  /** Held at a constant screen size while the board scales, e.g. an HP badge. */
  readonly screenSpace?: Container;
}

function traits(tile: TileState): ReadonlySet<string> {
  return new Set(tile.traits.map((trait) => trait.id));
}

export class TerrainRenderer {
  private boardTexture: Texture | null = null;

  public constructor(
    private readonly app: Application,
    private readonly catalog: AssetCatalog,
    private readonly config: BoardViewConfig = DEFAULT_BOARD_VIEW_CONFIG,
  ) {}

  public renderBoard(state: CombatState): Texture {
    const tilemap = this.catalog.tilemap(state.scenarioId);
    if (tilemap.width !== state.map.width || tilemap.height !== state.map.height) {
      throw new Error(`Presentation tilemap "${state.scenarioId}" dimensions do not match combat state.`);
    }
    const cell = this.config.boardTextureCellSize;
    const width = tilemap.width * cell;
    const height = tilemap.height * cell;
    if (!this.boardTexture || this.boardTexture.width !== width || this.boardTexture.height !== height) {
      if (this.boardTexture) TexturePool.returnTexture(this.boardTexture);
      this.boardTexture = TexturePool.getOptimalTexture(width, height, 1, false);
    }
    const composition = new Container({ label: "board-texture-composition" });
    for (let row = 0; row < tilemap.height; row += 1) {
      for (let col = 0; col < tilemap.width; col += 1) {
        const index = row * tilemap.width + col;
        const groundId = tilemapAssetAt(tilemap, "ground", index);
        if (!groundId) throw new Error(`Presentation tilemap is missing ground at ${col},${row}.`);
        const ground = new Sprite(this.catalog.texture(groundId));
        // Atlas frames carry a centred default anchor; board tiles are laid out top-left.
        ground.anchor.set(0, 0);
        ground.position.set(col * cell, row * cell);
        ground.setSize(cell, cell);
        composition.addChild(ground);
        const transitionId = tilemapAssetAt(tilemap, "transitions", index);
        if (transitionId) {
          const overlay = new Sprite(this.catalog.texture(transitionId));
          overlay.anchor.set(0, 0);
          overlay.position.copyFrom(ground.position);
          overlay.setSize(cell, cell);
          composition.addChild(overlay);
        }
      }
    }
    const grid = new Graphics({ label: "square-grid" });
    for (let col = 0; col <= tilemap.width; col += 1) {
      grid.moveTo(col * cell, 0).lineTo(col * cell, height);
    }
    for (let row = 0; row <= tilemap.height; row += 1) {
      grid.moveTo(0, row * cell).lineTo(width, row * cell);
    }
    grid.stroke({ width: 3, color: 0x171713, alpha: 0.78 });
    composition.addChild(grid);
    this.app.renderer.render({ container: composition, target: this.boardTexture, clear: true });
    composition.destroy({ children: true });
    return this.boardTexture;
  }

  public renderProps(state: CombatState): readonly SortableVisual[] {
    const tilemap = this.catalog.tilemap(state.scenarioId);
    const stateTiles = new Map(Object.values(state.map.tiles).map((tile) => [`${tile.position.x},${tile.position.y}`, tile]));
    const visuals: SortableVisual[] = [];
    for (let row = 0; row < tilemap.height; row += 1) {
      for (let col = 0; col < tilemap.width; col += 1) {
        const index = row * tilemap.width + col;
        const tile = stateTiles.get(`${col},${row}`);
        if (!tile) continue;
        const mapped = tilemapAssetAt(tilemap, "objects", index);
        let assetId: string | null = mapped;
        const tileTraits = traits(tile);
        if (mapped === this.catalog.manifest.objectVisuals.lever) assetId = null;
        if (tileTraits.has("gate-open")) assetId = this.catalog.manifest.objectVisuals.gateOpen;
        else if (tileTraits.has("gate")) assetId = this.catalog.manifest.objectVisuals.gateClosed;
        else if (tileTraits.has("blocked")) assetId = this.catalog.manifest.objectVisuals.wall;
        if (!assetId) continue;
        visuals.push(this.prop(assetId, tile.position, tile.id, 10));
      }
    }
    return visuals;
  }

  private prop(assetId: string, position: GridPosition, stableId: string, layerPriority: number): SortableVisual {
    const asset = this.catalog.asset(assetId);
    const display = new Container({ label: stableId });
    const sprite = new Sprite(this.catalog.texture(assetId));
    sprite.anchor.set(asset.anchor.x, asset.anchor.y);
    sprite.height = asset.displayHeight ?? 96;
    sprite.scale.x = sprite.scale.y;
    sprite.eventMode = "none";
    display.addChild(sprite);
    return { display, position, footRowOffset: this.config.propFootRowOffset, layerPriority, stableId };
  }

  public destroy(): void {
    if (this.boardTexture) TexturePool.returnTexture(this.boardTexture);
    this.boardTexture = null;
  }
}
