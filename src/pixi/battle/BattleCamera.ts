import type { BoardPlacement } from "./BoardProjection";
import type { BoardFrame, BoardViewConfig } from "./BoardViewConfig";
import {
  boardFitScale,
  boardPlaneExtent,
  boardSafeBox,
  closeUpFrame,
  DEFAULT_BOARD_VIEW_CONFIG,
} from "./BoardViewConfig";

/**
 * One axis of the pan clamp: how far the board's centre may travel. The safe-area
 * interval, widened until either end of the board can be brought to the middle of the
 * safe area — which is what "you can look at any square" means once the board is larger
 * than the screen. Half the board's on-screen size is exactly that reach.
 */
function travel(
  safeMin: number,
  safeMax: number,
  areaCenter: number,
  boardSize: number,
): { readonly min: number; readonly max: number } {
  const half = boardSize / 2;
  return { min: Math.min(safeMin, areaCenter - half), max: Math.max(safeMax, areaCenter + half) };
}

/**
 * Zoom is expressed against the fitted board rather than as a bare multiplier: 1 always
 * shows the whole map inside the HUD safe area, and the ceiling is whatever it takes to
 * fill that same area with `closeUpCells` squares. Both ends are therefore framings
 * rather than sizes — "the whole map" and "one square" — so a dense 9x7 map reaches the
 * same close-up as a sparse one, and the same close-up on a laptop as on a large display.
 * A single square is a close-up of a character rather than of the map: a standee is drawn
 * a little under a cell diamond wide, so at the ceiling its body spans about the whole
 * safe area. `minZoomHeadroom` keeps the wheel alive on the one map that is already its
 * own close-up.
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
   * sizes in squares — `(columns + rows) / 2` at one close-up cell — which is why the
   * range does not move when the window does.
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
   * Keeps the zoom in range and the board somewhere it can be dragged back from.
   *
   * Two rules, and the pan may use whichever is looser. Pinning the board's *centre*
   * inside the safe area is what stops a fitted board being flung off screen, but on its
   * own it also caps how far a zoomed-in board can travel: at the ceiling a 9x7 board is
   * several screens wide, and a centre that may only cross the safe area reaches barely a
   * quarter of it. So the centre may travel far enough that either end of the board can be
   * brought to the middle of the safe area, which is what makes every square lookable at.
   *
   * The union is what makes this safe to widen. A board narrower than the safe area needs
   * less than that reach, so the second interval collapses inside the first and a fitted
   * board keeps exactly the freedom it has today — including being dragged into a corner,
   * which is the state `ensureActorVisible` exists to recover from. Whatever the zoom,
   * some part of the board still covers the centre of the screen.
   */
  public clamp(frame: BoardFrame): void {
    this.zoom = Math.max(this.defaultZoom, Math.min(this.maxZoom(frame), this.zoom));
    const { originX, originY, scale } = this.placement(frame);
    const area = boardSafeBox(frame);
    const extent = boardPlaneExtent(frame, this.config);
    const { left, top, right, bottom } = frame.safeArea;
    const spanX = travel(left, Math.max(left, frame.viewportWidth - right), area.centerX, extent.width * scale);
    const spanY = travel(top, Math.max(top, frame.viewportHeight - bottom), area.centerY, extent.height * scale);
    this.panX += originX < spanX.min ? spanX.min - originX : originX > spanX.max ? spanX.max - originX : 0;
    this.panY += originY < spanY.min ? spanY.min - originY : originY > spanY.max ? spanY.max - originY : 0;
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
