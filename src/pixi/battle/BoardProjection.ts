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
      this.gridToScreen(col, row),
      this.gridToScreen(col + 1, row),
      this.gridToScreen(col + 1, row + 1),
      this.gridToScreen(col, row + 1),
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
