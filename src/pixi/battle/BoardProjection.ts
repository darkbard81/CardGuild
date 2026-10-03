import { TERRAIN_ELEVATION_STEP } from "../../presentation/terrain-elevation";
import { Point } from "pixi.js";

import type { BoardViewConfig } from "./BoardViewConfig";
import { DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";

export type BoardCorners = readonly [Point, Point, Point, Point];

/**
 * Where the board plane sits on screen: its centre, and the one uniform scale the whole
 * plane is drawn at. The turn and the squash are fixed by the config, so these three
 * numbers are everything the camera decides.
 */
export interface BoardPlacement {
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
}

const IDENTITY_PLACEMENT: BoardPlacement = { originX: 0, originY: 0, scale: 1 };

/**
 * The board is one fixed affine projection, not a camera looking at a plane:
 *
 *   screen = Translate(origin) x UniformScale(s) x ScaleY(squash) x Rotate(turn) x local
 *
 * applied in that order, with the grid centred on its own middle. Every cell is
 * therefore the same 2:1 diamond wherever it sits — a square on the far edge is drawn
 * exactly as large as one on the near edge, and parallel grid lines stay parallel.
 * There is no vanishing point and no row-dependent size anywhere in this file.
 *
 * The grid this projects is still the orthogonal square grid the rules use. Nothing
 * here is visible to movement, line of sight or facing.
 */
export class BoardProjection {
  private columns = 1;
  private rows = 1;
  private placement: BoardPlacement = IDENTITY_PLACEMENT;
  private elevations: readonly number[] = [];

  public setElevations(values: readonly number[] = []): void { this.elevations = values; }

  public elevationAt(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.columns || row >= this.rows) return 0;
    return this.elevations[Math.floor(row) * this.columns + Math.floor(col)] ?? 0;
  }

  public interpolatedElevation(col: number, row: number): number {
    const x = Math.floor(col), y = Math.floor(row), fx = col - x, fy = row - y;
    return this.elevationAt(x, y) * (1 - fx) * (1 - fy) + this.elevationAt(x + 1, y) * fx * (1 - fy)
      + this.elevationAt(x, y + 1) * (1 - fx) * fy + this.elevationAt(x + 1, y + 1) * fx * fy;
  }

  public screenToSurfaceGrid(x: number, y: number): Point {
    const tile = this.pickSurface(x, y);
    return this.screenToGrid(x, y + (tile ? this.elevationAt(tile.x, tile.y) : 0) * TERRAIN_ELEVATION_STEP * this.placement.scale);
  }

  public surfaceToScreen(col: number, row: number, elevation = this.elevationAt(col, row)): Point {
    const point = this.gridToScreen(col, row);
    point.y -= elevation * TERRAIN_ELEVATION_STEP * this.placement.scale;
    return point;
  }

  /** Frontmost visible surface wins; exposed sides occlude surfaces behind them. */
  public pickSurface(x: number, y: number): { x: number; y: number } | null {
    const cells = Array.from({ length: this.columns * this.rows }, (_, index) => ({ x: index % this.columns, y: Math.floor(index / this.columns) }));
    cells.sort((a, b) => b.x + b.y - a.x - a.y || b.y - a.y);
    const inside = (points: readonly Point[]): boolean => {
      let result = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i]!; const b = points[j]!;
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result;
      }
      return result;
    };
    for (const cell of cells) {
      const corners = this.getCellCorners(cell.x, cell.y);
      if (inside(corners)) return cell;
      const height = this.elevationAt(cell.x, cell.y);
      for (const [a, b, neighbour] of [[3, 2, this.elevationAt(cell.x, cell.y + 1)], [2, 1, this.elevationAt(cell.x + 1, cell.y)]] as const) {
        const drop = Math.max(0, height - neighbour) * TERRAIN_ELEVATION_STEP * this.placement.scale;
        if (drop > 0 && inside([corners[a]!, corners[b]!, new Point(corners[b]!.x, corners[b]!.y + drop), new Point(corners[a]!.x, corners[a]!.y + drop)])) return null;
      }
    }
    return null;
  }

  public constructor(private readonly config: BoardViewConfig = DEFAULT_BOARD_VIEW_CONFIG) {}

  public update(columns: number, rows: number, placement: BoardPlacement): void {
    if (columns <= 0 || rows <= 0) throw new Error("Board dimensions must be positive.");
    if (!(placement.scale > 0)) throw new Error("Board scale must be positive.");
    this.columns = columns;
    this.rows = rows;
    this.placement = placement;
  }

  public gridToScreen(col: number, row: number): Point {
    const cell = this.config.boardTextureCellSize;
    const localX = (col - this.columns / 2) * cell;
    const localY = (row - this.rows / 2) * cell;
    const { cosine, sine } = this.turn;
    const { originX, originY, scale } = this.placement;
    return new Point(
      originX + (localX * cosine - localY * sine) * scale,
      originY + (localX * sine + localY * cosine) * this.config.boardSquashY * scale,
    );
  }

  public screenToGrid(x: number, y: number): Point {
    const cell = this.config.boardTextureCellSize;
    const { cosine, sine } = this.turn;
    const { originX, originY, scale } = this.placement;
    const turnedX = (x - originX) / scale;
    const turnedY = (y - originY) / (scale * this.config.boardSquashY);
    return new Point(
      (turnedX * cosine + turnedY * sine) / cell + this.columns / 2,
      (turnedY * cosine - turnedX * sine) / cell + this.rows / 2,
    );
  }

  public getCellCorners(col: number, row: number): Point[] {
    return [
      this.surfaceToScreen(col, row, this.elevationAt(col, row)),
      this.surfaceToScreen(col + 1, row, this.elevationAt(col, row)),
      this.surfaceToScreen(col + 1, row + 1, this.elevationAt(col, row)),
      this.surfaceToScreen(col, row + 1, this.elevationAt(col, row)),
    ];
  }

  /**
   * Scale for anything standing on the board: the plane's own uniform scale, restated
   * against the cell width the art was authored for. It takes no row, because in a fixed
   * affine projection a standee is the same size wherever it stands.
   */
  public getContentScale(): number {
    return this.placement.scale * this.config.boardTextureCellSize / this.config.referenceCellWidth;
  }

  /** Screen width of one cell's left-to-right diagonal; its height is that times the squash. */
  public getCellDiamondWidth(): number {
    const { cosine, sine } = this.turn;
    return this.config.boardTextureCellSize * (Math.abs(cosine) + Math.abs(sine)) * this.placement.scale;
  }

  /** The board's own four corners, in grid order: (0,0), (columns,0), (columns,rows), (0,rows). */
  public get corners(): BoardCorners {
    return [
      this.gridToScreen(0, 0),
      this.gridToScreen(this.columns, 0),
      this.gridToScreen(this.columns, this.rows),
      this.gridToScreen(0, this.rows),
    ];
  }

  private get turn(): { readonly cosine: number; readonly sine: number } {
    return {
      cosine: Math.cos(this.config.boardRotationRadians),
      sine: Math.sin(this.config.boardRotationRadians),
    };
  }
}
