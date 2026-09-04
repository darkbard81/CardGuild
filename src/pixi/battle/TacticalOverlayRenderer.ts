import { Container, Graphics, Point } from "pixi.js";

import type { CombatState, Direction, GridPosition } from "../../game";
import type { BoardHighlights, MoveBand } from "./BattleView";
import type { BoardProjection } from "./BoardProjection";

function flat(points: readonly Point[]): number[] {
  return points.flatMap((point) => [point.x, point.y]);
}

export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if (!a || !b) continue;
    const intersects = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function facingPolygon(
  projection: BoardProjection,
  position: GridPosition,
  direction: Direction,
): Point[] {
  const { x, y } = position;
  const logical = direction === "north"
    ? [[0.5, 0.5], [0.22, 0.23], [0.78, 0.23]]
    : direction === "east"
      ? [[0.52, 0.5], [0.79, 0.24], [0.79, 0.76]]
      : direction === "south"
        ? [[0.5, 0.52], [0.78, 0.79], [0.22, 0.79]]
        : [[0.48, 0.5], [0.21, 0.76], [0.21, 0.24]];
  return logical.map(([col, row]) => projection.gridToScreen(x + (col ?? 0), y + (row ?? 0)));
}

/**
 * Reach is ambient information, not a selection, so the bands sit under the target
 * highlights with a lower alpha and a thinner edge. Brightness falls from step to fly,
 * which keeps the three readable when the hues are not.
 */
const BAND_STYLE: Readonly<Record<MoveBand, { fill: number; stroke: number; alpha: number }>> = {
  step: { fill: 0x6ee7c8, stroke: 0xa9f5de, alpha: 0.15 },
  stride: { fill: 0x3f8fd8, stroke: 0x8ec8ff, alpha: 0.11 },
  fly: { fill: 0x8b6ede, stroke: 0xc3a8ff, alpha: 0.11 },
};

/** Reach is a wash over the terrain, not a repaint: the edge carries the colour. */
const BAND_STROKE_ALPHA = 0.5;

export class TacticalOverlayRenderer {
  public render(
    state: CombatState,
    highlights: BoardHighlights,
    hover: GridPosition | null,
    projection: BoardProjection,
    layer: Container,
  ): void {
    // Drawn first so a selected target's highlight reads on top of the reach it sits in.
    for (const tile of highlights.moveBands) {
      const style = BAND_STYLE[tile.band];
      this.cell(layer, projection, tile.position, style.fill, style.alpha, style.stroke, 1, BAND_STROKE_ALPHA);
    }
    for (const position of highlights.tiles) {
      this.cell(layer, projection, position, 0x3ba5e8, 0.28, 0x8adfff, 2);
    }
    for (const actorId of highlights.actorIds) {
      const actor = state.actors[actorId];
      if (actor) this.cell(layer, projection, actor.position, 0xb93f35, 0.23, 0xffa093, 3);
    }
    for (const objectId of highlights.objectIds) {
      const object = state.map.objects[objectId];
      if (object) this.cell(layer, projection, object.position, 0xd49b3a, 0.24, 0xffdc83, 3);
    }
    if (hover) this.cell(layer, projection, hover, 0xffd76a, 0.16, 0xffe99e, 2);
    if (highlights.facingPosition) {
      this.cell(layer, projection, highlights.facingPosition, 0xffd76a, 0.15, 0xffdc71, 3);
      for (const direction of ["north", "east", "south", "west"] as const) {
        const polygon = facingPolygon(projection, highlights.facingPosition, direction);
        const graphic = new Graphics({ label: `face-${direction}` })
          .poly(flat(polygon), true)
          .fill({ color: 0x172334, alpha: 0.92 })
          .stroke({ width: 2, color: 0xffdf71, alpha: 1 });
        graphic.eventMode = "none";
        layer.addChild(graphic);
      }
    }
  }

  private cell(
    layer: Container,
    projection: BoardProjection,
    position: GridPosition,
    fill: number,
    alpha: number,
    stroke: number,
    width: number,
    strokeAlpha = 0.96,
  ): void {
    const corners = projection.getCellCorners(position.x, position.y);
    const graphic = new Graphics()
      .poly(flat(corners), true)
      .fill({ color: fill, alpha })
      .stroke({ width, color: stroke, alpha: strokeAlpha });
    graphic.eventMode = "none";
    layer.addChild(graphic);
  }
}
