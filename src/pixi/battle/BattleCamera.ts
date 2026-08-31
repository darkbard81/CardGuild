import { Point } from "pixi.js";

import type { BoardCorners } from "./BoardProjection";
import type { BoardViewConfig } from "./BoardViewConfig";
import { baseBoardCorners, DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";

export class BattleCamera {
  public readonly minZoom = 0.72;
  public readonly defaultZoom = 1;
  public readonly maxZoom = 1.5;
  private zoom = this.defaultZoom;
  private panX = 0;
  private panY = 0;

  public constructor(private readonly config: BoardViewConfig = DEFAULT_BOARD_VIEW_CONFIG) {}

  public reset(): void {
    this.zoom = this.defaultZoom;
    this.panX = 0;
    this.panY = 0;
  }

  public panBy(screenX: number, screenY: number): void {
    this.panX += screenX;
    this.panY += screenY;
  }

  public zoomBy(factor: number, pointerX: number, pointerY: number, viewportWidth: number, viewportHeight: number): void {
    const oldZoom = this.zoom;
    const nextZoom = Math.max(this.minZoom, Math.min(this.maxZoom, oldZoom * factor));
    if (nextZoom === oldZoom) return;
    const centerX = viewportWidth / 2;
    const centerY = viewportHeight / 2;
    const baseOffsetX = (pointerX - centerX - this.panX) / oldZoom;
    const baseOffsetY = (pointerY - centerY - this.panY) / oldZoom;
    this.zoom = nextZoom;
    this.panX = pointerX - centerX - baseOffsetX * nextZoom;
    this.panY = pointerY - centerY - baseOffsetY * nextZoom;
  }

  public centerScreenPoint(point: Point, viewportWidth: number, viewportHeight: number): void {
    this.panX += viewportWidth / 2 - point.x;
    this.panY += viewportHeight / 2 - point.y;
  }

  public corners(viewportWidth: number, viewportHeight: number): BoardCorners {
    const centerX = viewportWidth / 2;
    const centerY = viewportHeight / 2;
    const transformed = baseBoardCorners(viewportWidth, viewportHeight, this.config).map((corner) => new Point(
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
}
