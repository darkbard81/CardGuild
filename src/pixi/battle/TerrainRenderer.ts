import { type Application, Container, Graphics, RenderTexture, Sprite, type Texture } from "pixi.js";

import type { CombatState, GridPosition, TileState } from "../../game";
import type { AssetCatalog } from "../../presentation";
import { isTileStructure, spriteSizing, tilemapAssetAt } from "../../presentation";
import type { BoardViewConfig } from "./BoardViewConfig";
import { DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";
import { collectWallBoundarySegments, isWallTile, wallBoundaryLine, type WallBoundarySegment } from "./WallBoundary";

/** Point props with no authored height fall back to this. */
const DEFAULT_PROP_HEIGHT = 96;

export interface SortableVisual {
  readonly display: Container;
  readonly position: GridPosition;
  readonly footRowOffset: number;
  readonly layerPriority: number;
  readonly stableId: string;
  /** Held at a constant screen size while the board scales, e.g. an HP badge. */
  readonly screenSpace?: Container;
  /** A tile-bound structure: drawn one terrain cell wide, whatever its height. */
  readonly cellBound?: boolean;
}

function traits(tile: TileState): ReadonlySet<string> {
  return new Set(tile.traits.map((trait) => trait.id));
}

export class TerrainRenderer {
  private boardTexture: Texture | null = null;
  private wallSummary = "";

  public constructor(
    private readonly app: Application,
    private readonly catalog: AssetCatalog,
    private readonly config: BoardViewConfig = DEFAULT_BOARD_VIEW_CONFIG,
  ) {}

  private tilesByCell(state: CombatState): ReadonlyMap<string, TileState> {
    return new Map(Object.values(state.map.tiles).map((tile) => [`${tile.position.x},${tile.position.y}`, tile]));
  }

  public renderBoard(state: CombatState): Texture {
    const tilemap = this.catalog.tilemap(state.scenarioId);
    if (tilemap.width !== state.map.width || tilemap.height !== state.map.height) {
      throw new Error(`Presentation tilemap "${state.scenarioId}" dimensions do not match combat state.`);
    }
    const cell = this.config.boardTextureCellSize;
    const width = tilemap.width * cell;
    const height = tilemap.height * cell;
    if (!this.boardTexture || this.boardTexture.width !== width || this.boardTexture.height !== height) {
      this.boardTexture?.destroy(true);
      // Exactly the board's own size. A pooled texture is rounded up to a power of two and
      // handed back with a smaller frame over a larger source, and that pairing is shared
      // between encounters — a 5x3 board asks for 640x384 and gets a 1024x512 source the
      // previous encounter also used. Sizing the target to the board keeps the mesh's
      // texture and the projection's cells describing the same rectangle, and costs less
      // memory than the padded page it replaces.
      this.boardTexture = RenderTexture.create({ width, height, resolution: 1, antialias: false });
    }
    const composition = new Container({ label: "board-texture-composition" });
    const stateTiles = this.tilesByCell(state);
    const walls: GridPosition[] = [];
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
        const tile = stateTiles.get(`${col},${row}`);
        if (tile && isWallTile(traits(tile))) walls.push(tile.position);
      }
    }
    // A wall is terrain, not a standee: it covers its own square on the same plane as the
    // floor, at the same size, so neighbouring walls already share one continuous surface
    // and nothing drifts against the board when the camera moves.
    const wallVisual = this.catalog.manifest.terrainVisuals.blocked;
    for (const position of walls) {
      const block = new Sprite(this.catalog.texture(wallVisual));
      block.anchor.set(0, 0);
      block.position.set(position.x * cell, position.y * cell);
      block.setSize(cell, cell);
      composition.addChild(block);
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
    const segments = collectWallBoundarySegments(walls);
    this.wallSummary = `${walls.length}/${segments.length}`;
    composition.addChild(this.wallBoundary(segments, cell));
    this.app.renderer.render({ container: composition, target: this.boardTexture, clear: true });
    composition.destroy({ children: true });
    return this.boardTexture;
  }

  /**
   * One stroke around the whole wall region and none along the seams inside it, drawn
   * over the square grid so the wall edge reads ahead of the ordinary cell lines. Square
   * caps let two perpendicular edges close their corner without a corner asset.
   */
  private wallBoundary(segments: readonly WallBoundarySegment[], cell: number): Graphics {
    const boundary = new Graphics({ label: "wall-boundary" });
    for (const segment of segments) {
      const line = wallBoundaryLine(segment, cell);
      boundary.moveTo(line.x1, line.y1).lineTo(line.x2, line.y2);
    }
    const { width, color, alpha } = this.config.wallBoundary;
    boundary.stroke({ width, color, alpha, cap: "square" });
    return boundary;
  }

  public renderProps(state: CombatState): readonly SortableVisual[] {
    const tilemap = this.catalog.tilemap(state.scenarioId);
    const stateTiles = this.tilesByCell(state);
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
        // A blocked tile has no prop of its own: it is wall surface on the board texture.
        if (tileTraits.has("gate-open")) assetId = this.catalog.manifest.objectVisuals.gateOpen;
        else if (tileTraits.has("gate")) assetId = this.catalog.manifest.objectVisuals.gateClosed;
        else if (tileTraits.has("blocked")) assetId = null;
        if (!assetId) continue;
        visuals.push(this.prop(assetId, tile.position, tile.id, 10));
      }
    }
    return visuals;
  }

  /**
   * Two sizing policies, chosen by what the asset declares rather than by what it is
   * called. A tile-bound structure — a wall, a gate — owns one terrain cell, so it is
   * drawn one cell wide and its height follows the art it was drawn at. A point prop
   * stands on a cell without claiming it, so it keeps its authored height.
   *
   * Neither says anything about movement, Fly or line of sight: those come from the
   * tile's traits through the game rules, never from a texture.
   */
  private prop(assetId: string, position: GridPosition, stableId: string, layerPriority: number): SortableVisual {
    const asset = this.catalog.asset(assetId);
    const display = new Container({ label: stableId });
    const sprite = new Sprite(this.catalog.texture(assetId));
    sprite.anchor.set(asset.anchor.x, asset.anchor.y);
    const cellBound = isTileStructure(asset);
    const sizing = spriteSizing(asset, DEFAULT_PROP_HEIGHT);
    if (sizing.axis === "width") {
      sprite.width = sizing.value;
      sprite.scale.y = sprite.scale.x;
    } else {
      sprite.height = sizing.value;
      sprite.scale.x = sprite.scale.y;
    }
    sprite.eventMode = "none";
    display.addChild(sprite);
    return {
      display,
      position,
      footRowOffset: this.config.propFootRowOffset,
      layerPriority,
      stableId,
      cellBound,
    };
  }

  /**
   * Wall cells against exposed edges, as `cells/segments`. Adjacency is the whole point
   * of the boundary, and it is invisible from outside once it has been rasterised into
   * the board texture, so the counts are published for a test to read.
   */
  public get wallRegionFit(): string {
    return this.wallSummary;
  }

  /**
   * The board texture's own size against the size of the page it lives on, as `WxH/WxH`.
   * The mesh maps the whole page onto the projected quad, so the two must stay equal;
   * a padded page is the shape this renderer regressed into and is worth pinning.
   */
  public get boardTextureFit(): string {
    const texture = this.boardTexture;
    if (!texture) return "";
    return `${texture.width}x${texture.height}/${texture.source.width}x${texture.source.height}`;
  }

  public destroy(): void {
    this.boardTexture?.destroy(true);
    this.boardTexture = null;
  }
}
