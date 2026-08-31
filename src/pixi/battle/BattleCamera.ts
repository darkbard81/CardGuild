import { Point } from "pixi.js";

import type { BoardCorners } from "./BoardProjection";
import type { BoardFrame, BoardViewConfig } from "./BoardViewConfig";
import { baseBoardCorners, DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";

/**
 * Zoom is expressed against the fitted board rather than as a bare multiplier: 1 always
 * shows the whole map inside the HUD safe area, and the ceiling is whatever it takes to
 * grow a square to `maxCellWidth`. A dense 9x7 map therefore reaches the same close-up
 * as a 3x3 one instead of both sharing a fixed 1.5x that means different things. A map
 * already fitted with squares at or past the target keeps `minZoomHeadroom` of zoom
 * anyway, so the wheel is never dead.
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

  /** Zoom needed to grow a fitted square to `maxCellWidth`, never below the headroom floor. */
  public maxZoom(frame: BoardFrame): number {
    const fitted = this.fittedCellWidth(frame);
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
    const centerX = frame.viewportWidth / 2;
    const centerY = frame.viewportHeight / 2;
    const baseOffsetX = (pointerX - centerX - this.panX) / oldZoom;
    const baseOffsetY = (pointerY - centerY - this.panY) / oldZoom;
    this.zoom = nextZoom;
    this.panX = pointerX - centerX - baseOffsetX * nextZoom;
    this.panY = pointerY - centerY - baseOffsetY * nextZoom;
    this.clamp(frame);
  }

  /**
   * Keeps the zoom in range and the board's centre inside the safe area, so the board
   * can never be dragged off screen with no way back.
   */
  public clamp(frame: BoardFrame): void {
    this.zoom = Math.max(this.defaultZoom, Math.min(this.maxZoom(frame), this.zoom));
    const corners = this.corners(frame);
    const centerX = corners.reduce((total, corner) => total + corner.x, 0) / corners.length;
    const centerY = corners.reduce((total, corner) => total + corner.y, 0) / corners.length;
    const { left, top, right, bottom } = frame.safeArea;
    const maxX = Math.max(left, frame.viewportWidth - right);
    const maxY = Math.max(top, frame.viewportHeight - bottom);
    this.panX += centerX < left ? left - centerX : centerX > maxX ? maxX - centerX : 0;
    this.panY += centerY < top ? top - centerY : centerY > maxY ? maxY - centerY : 0;
  }

  public corners(frame: BoardFrame): BoardCorners {
    const centerX = frame.viewportWidth / 2;
    const centerY = frame.viewportHeight / 2;
    const transformed = this.baseCorners(frame).map((corner) => new Point(
      centerX + (corner.x - centerX) * this.zoom + this.panX,
      centerY + (corner.y - centerY) * this.zoom + this.panY,
    ));
    const [topLeft, topRight, bottomRight, bottomLeft] = transformed;
    if (!topLeft || !topRight || !bottomRight || !bottomLeft) throw new Error("Board camera needs four corners.");
    return [topLeft, topRight, bottomRight, bottomLeft];
  }

  public get scale(): number {
    return this.zoom;
  }

  private baseCorners(frame: BoardFrame): ReturnType<typeof baseBoardCorners> {
    return baseBoardCorners(frame.viewportWidth, frame.viewportHeight, this.config, frame.safeArea);
  }

  private fittedCellWidth(frame: BoardFrame): number {
    const base = this.baseCorners(frame);
    return (base[2].x - base[3].x) / Math.max(1, frame.columns);
  }
}
