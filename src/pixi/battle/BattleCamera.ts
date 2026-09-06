import type { BoardPlacement } from "./BoardProjection";
import type { BoardFrame, BoardViewConfig } from "./BoardViewConfig";
import { boardFitScale, boardSafeBox, closeUpFrame, DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";

/**
 * Zoom is expressed against the fitted board rather than as a bare multiplier: 1 always
 * shows the whole map inside the HUD safe area, and the ceiling is whatever it takes to
 * fill that same area with `closeUpCells` squares. Both ends are therefore framings
 * rather than sizes — "the whole map" and "three squares" — so a dense 9x7 map reaches
 * the same close-up as a sparse one, and the same close-up on a laptop as on a large
 * display. A map already smaller than the close-up keeps `minZoomHeadroom` of zoom
 * anyway, so the wheel is never dead.
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

  /**
   * Zoom needed to fill the frame with the close-up's squares, never below the headroom
   * floor. Both scales come from the same fit, so this is the ratio between framing the
   * whole map and framing a corner of it. Every board is the same 2:1 shape once turned
   * and squashed, so the two always fit on the same axis and the ratio comes out as their
   * sizes in squares — which is why the range does not move when the window does.
   */
  public maxZoom(frame: BoardFrame): number {
    const fitted = boardFitScale(frame, this.config);
    if (fitted <= 0) return this.config.minZoomHeadroom;
    const closeUp = boardFitScale(closeUpFrame(frame, this.config), this.config);
    return Math.max(closeUp / fitted, this.config.minZoomHeadroom);
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
