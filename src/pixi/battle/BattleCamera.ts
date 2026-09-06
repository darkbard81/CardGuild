import type { BoardPlacement } from "./BoardProjection";
import type { BoardFrame, BoardViewConfig } from "./BoardViewConfig";
import { boardFitScale, boardSafeBox, cellDiamondWidth, DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";

/**
 * Zoom is expressed against the fitted board rather than as a bare multiplier: 1 always
 * shows the whole map inside the HUD safe area, and the ceiling is whatever it takes to
 * grow a cell diamond to `maxCellWidth`. A dense 9x7 map therefore reaches the same
 * close-up as a 3x3 one instead of both sharing a fixed 1.5x that means different
 * things. A map already fitted with cells at or past the target keeps `minZoomHeadroom`
 * of zoom anyway, so the wheel is never dead.
 *
 * The turn and the squash belong to the board plane, not to the camera: all this decides
 * is where the plane's centre sits and how large it is drawn.
 */
export class BattleCamera {
  public readonly defaultZoom = 1;
  private zoom = this.defaultZoom;
  private panX = 0;
  private panY = 0;

  public constructor(private readonly config: BoardViewConfig = DEFAULT_BOARD_VIEW_CONFIG) {}

  public reset(): void {
    this.zoom = this.defaultZoom;
    this.panX = 0;
    this.panY = 0;
  }

  /** Zoom needed to grow a fitted cell diamond to `maxCellWidth`, never below the headroom floor. */
  public maxZoom(frame: BoardFrame): number {
    const fitted = cellDiamondWidth(this.config) * boardFitScale(frame, this.config);
    if (fitted <= 0) return this.config.minZoomHeadroom;
    return Math.max(this.config.maxCellWidth / fitted, this.config.minZoomHeadroom);
  }

  public panBy(screenX: number, screenY: number, frame: BoardFrame): void {
    this.panX += screenX;
    this.panY += screenY;
    this.clamp(frame);
  }

  public zoomBy(factor: number, pointerX: number, pointerY: number, frame: BoardFrame): void {
    const oldZoom = this.zoom;
    const nextZoom = Math.max(this.defaultZoom, Math.min(this.maxZoom(frame), oldZoom * factor));
    if (nextZoom === oldZoom) return;
    // The board's centre is the safe area's centre plus the pan, and everything else on
    // the plane is that centre plus an offset that scales with the zoom. Holding the
    // offset under the pointer fixed is what keeps the square being pointed at still.
    const area = boardSafeBox(frame);
    const baseOffsetX = (pointerX - area.centerX - this.panX) / oldZoom;
    const baseOffsetY = (pointerY - area.centerY - this.panY) / oldZoom;
    this.zoom = nextZoom;
    this.panX = pointerX - area.centerX - baseOffsetX * nextZoom;
    this.panY = pointerY - area.centerY - baseOffsetY * nextZoom;
    this.clamp(frame);
  }

  /**
   * Keeps the zoom in range and the board's centre inside the safe area, so the board
   * can never be dragged off screen with no way back.
   */
  public clamp(frame: BoardFrame): void {
    this.zoom = Math.max(this.defaultZoom, Math.min(this.maxZoom(frame), this.zoom));
    const { originX, originY } = this.placement(frame);
    const { left, top, right, bottom } = frame.safeArea;
    const maxX = Math.max(left, frame.viewportWidth - right);
    const maxY = Math.max(top, frame.viewportHeight - bottom);
    this.panX += originX < left ? left - originX : originX > maxX ? maxX - originX : 0;
    this.panY += originY < top ? top - originY : originY > maxY ? maxY - originY : 0;
  }

  public placement(frame: BoardFrame): BoardPlacement {
    const area = boardSafeBox(frame);
    return {
      originX: area.centerX + this.panX,
      originY: area.centerY + this.panY,
      scale: boardFitScale(frame, this.config) * this.zoom,
    };
  }

  public get scale(): number {
    return this.zoom;
  }
}
