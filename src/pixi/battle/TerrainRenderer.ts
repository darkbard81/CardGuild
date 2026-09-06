import { type Application, Container, Graphics, RenderTexture, Sprite, type Texture } from "pixi.js";

import type { CombatState, GridPosition, TileState } from "../../game";
import type { AssetCatalog } from "../../presentation";
import { pointPropHeight, tilemapAssetAt } from "../../presentation";
import type { BoardViewConfig } from "./BoardViewConfig";
import { DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";
import { collectSolidBoundarySegments, isSolidTile, solidBoundaryLine, type SolidBoundarySegment } from "./SolidBoundary";

/** Point props with no authored height fall back to this. */
const DEFAULT_PROP_HEIGHT = 96;

export interface SortableVisual {
  readonly display: Container;
  readonly position: GridPosition;
  readonly layerPriority: number;
  readonly stableId: string;
  /** Held at a constant screen size while the board scales, e.g. an HP badge. */
  readonly screenSpace?: Container;
}

function traits(tile: TileState): ReadonlySet<string> {
  return new Set(tile.traits.map((trait) => trait.id));
}

/**
 * Which surface a tile's own state puts on the board, if any. A wall and a gate are both
 * the state of the square they occupy rather than something standing on it, so both are
 * terrain: the gate's two states are two tiles, and swapping them is all "opening a
 * gate" means to the board. Ordinary ground says nothing here and keeps its floor.
 *
 * The traits are read in the order the rules resolve them — an open gate is no longer
 * blocked, so it must be asked about first — and nothing here decides anything: the
 * lever moved the traits long before a texture was chosen.
 */
export function tileStateVisual(
  tileTraits: ReadonlySet<string>,
  terrainVisuals: AssetCatalog["manifest"]["terrainVisuals"],
): string | null {
  if (tileTraits.has("gate-open")) return terrainVisuals.gateOpen;
  if (tileTraits.has("gate")) return terrainVisuals.gateClosed;
  if (tileTraits.has("blocked")) return terrainVisuals.blocked;
  return null;
}

export class TerrainRenderer {
  private boardTexture: Texture | null = null;
  private solidSummary = "";

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
      // previous encounter also used. Sizing the target to the board keeps the sprite's
      // texture and the projection's cells describing the same rectangle, and costs less
      // memory than the padded page it replaces.
      this.boardTexture = RenderTexture.create({ width, height, resolution: 1, antialias: false });
    }
    const composition = new Container({ label: "board-texture-composition" });
    const stateTiles = this.tilesByCell(state);
    const surfaces: { readonly position: GridPosition; readonly assetId: string }[] = [];
    const solid: GridPosition[] = [];
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
        if (!tile) continue;
        const tileTraits = traits(tile);
        const stateVisual = tileStateVisual(tileTraits, this.catalog.manifest.terrainVisuals);
        if (stateVisual) surfaces.push({ position: tile.position, assetId: stateVisual });
        if (isSolidTile(tileTraits)) solid.push(tile.position);
      }
    }
    // A wall or a gate is terrain, not a standee: it covers its own square on the same
    // plane as the floor, at the same size, so neighbours already share one continuous
    // surface and nothing drifts against the board when the camera moves.
    for (const surface of surfaces) {
      const block = new Sprite(this.catalog.texture(surface.assetId));
      block.anchor.set(0, 0);
      block.position.set(surface.position.x * cell, surface.position.y * cell);
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
    const segments = collectSolidBoundarySegments(solid);
    this.solidSummary = `${solid.length}/${segments.length}`;
    composition.addChild(this.solidBoundary(segments, cell));
    this.app.renderer.render({ container: composition, target: this.boardTexture, clear: true });
    composition.destroy({ children: true });
    return this.boardTexture;
  }

  /**
   * One stroke around the whole solid region and none along the seams inside it, drawn
   * over the square grid so the barrier's edge reads ahead of the ordinary cell lines.
   * Square caps let two perpendicular edges close their corner without a corner asset.
   */
  private solidBoundary(segments: readonly SolidBoundarySegment[], cell: number): Graphics {
    const boundary = new Graphics({ label: "solid-boundary" });
    for (const segment of segments) {
      const line = solidBoundaryLine(segment, cell);
      boundary.moveTo(line.x1, line.y1).lineTo(line.x2, line.y2);
    }
    const { width, color, alpha } = this.config.solidBoundary;
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
        // Scenery only. A lever is a real map object and ObjectRenderer owns it; a wall
        // or a gate is the tile's own state and was drawn into the board texture.
        const assetId = tilemapAssetAt(tilemap, "objects", index);
        if (!assetId || assetId === this.catalog.manifest.objectVisuals.lever) continue;
        visuals.push(this.prop(assetId, tile.position, tile.id, 10));
      }
    }
    return visuals;
  }

  /**
   * One sizing policy, because there is only one kind of thing on this plane now: a
   * point prop stands on a cell without being it, so it keeps the height it was authored
   * at and lets the width follow. Nothing about it says anything about movement, Fly or
   * line of sight — those come from the tile's traits through the rules, never from a
   * texture.
   */
  private prop(assetId: string, position: GridPosition, stableId: string, layerPriority: number): SortableVisual {
    const asset = this.catalog.asset(assetId);
    const display = new Container({ label: stableId });
    const sprite = new Sprite(this.catalog.texture(assetId));
    sprite.anchor.set(asset.anchor.x, asset.anchor.y);
    sprite.height = pointPropHeight(asset, DEFAULT_PROP_HEIGHT);
    sprite.scale.x = sprite.scale.y;
    sprite.eventMode = "none";
    display.addChild(sprite);
    return { display, position, layerPriority, stableId };
  }

  /**
   * Solid cells against exposed edges, as `cells/segments`. Adjacency is the whole point
   * of the boundary, and it is invisible from outside once it has been rasterised into
   * the board texture, so the counts are published for a test to read. A gate opening
   * drops out of the region and both numbers move.
   */
  public get solidRegionFit(): string {
    return this.solidSummary;
  }

  /**
   * The board texture's own size against the size of the page it lives on, as `WxH/WxH`.
   * The board sprite draws the whole page as the board plane, so the two must stay
   * equal; a padded page is the shape this renderer regressed into and is worth pinning.
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
