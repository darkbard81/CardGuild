import type { Container } from "pixi.js";

export interface WorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export class BattleCamera {
  public readonly minZoom = 0.55;
  public readonly defaultZoom = 1;
  public readonly maxZoom = 1.5;
  private zoom = this.defaultZoom;
  private x = 0;
  private y = 0;
  private bounds: WorldBounds | null = null;

  public fit(bounds: WorldBounds, viewportWidth: number, viewportHeight: number): void {
    this.bounds = bounds;
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const fit = Math.min((viewportWidth - 32) / width, (viewportHeight - 32) / height);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, fit));
    this.center(viewportWidth, viewportHeight);
  }

  public center(viewportWidth: number, viewportHeight: number): void {
    if (!this.bounds) return;
    const centerX = (this.bounds.minX + this.bounds.maxX) / 2;
    const centerY = (this.bounds.minY + this.bounds.maxY) / 2;
    this.x = viewportWidth / 2 - centerX * this.zoom;
    this.y = viewportHeight / 2 - centerY * this.zoom;
  }

  public focus(worldX: number, worldY: number, viewportWidth: number, viewportHeight: number): void {
    this.x = viewportWidth / 2 - worldX * this.zoom;
    this.y = viewportHeight / 2 - worldY * this.zoom;
  }

  public panBy(screenX: number, screenY: number): void {
    this.x += screenX;
    this.y += screenY;
  }

  public zoomBy(factor: number, viewportWidth: number, viewportHeight: number): void {
    const oldZoom = this.zoom;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const worldCenterX = (viewportWidth / 2 - this.x) / oldZoom;
    const worldCenterY = (viewportHeight / 2 - this.y) / oldZoom;
    this.x = viewportWidth / 2 - worldCenterX * this.zoom;
    this.y = viewportHeight / 2 - worldCenterY * this.zoom;
  }

  public apply(world: Container): void {
    world.scale.set(this.zoom);
    world.position.set(this.x, this.y);
  }
}
