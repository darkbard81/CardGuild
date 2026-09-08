import { Container, Graphics, Point, Text } from "pixi.js";

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
    labels: Container = layer,
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
    const facing = highlights.actorFacing;
    if (facing) {
      for (const direction of facing.arcDirections) {
        const current = direction === facing.facing;
        const marker = new Graphics({ label: `arc-${direction}` })
          .poly(flat(facingPolygon(projection, facing.position, direction)), true)
          .fill({ color: 0xffdf71, alpha: current ? 0.55 : 0.12 })
          .stroke({ color: 0xffdf71, width: current ? 2 : 1, alpha: 0.8 });
        marker.eventMode = "none";
        layer.addChild(marker);
      }
      this.rearCell(state, layer, labels, projection, facing.rearCell, false, "뒤");
    }
    if (highlights.targetFacing) {
      this.rearCell(state, layer, labels, projection, highlights.targetFacing.rearCell,
        highlights.tactical?.causes.includes("rear") ?? false, "Rear");
    }
    for (const id of highlights.tactical?.partnerIds ?? []) {
      const partner = state.actors[id];
      if (!partner) continue;
      this.cell(layer, projection, partner.position, 0x80e6d0, 0.06, 0x80e6d0, 3);
      const centre = projection.gridToScreen(partner.position.x + 0.5, partner.position.y + 0.5);
      const inner = projection.getCellCorners(partner.position.x, partner.position.y)
        .map((point) => new Point(centre.x + (point.x - centre.x) * 0.82, centre.y + (point.y - centre.y) * 0.82));
      const outline = new Graphics({ label: `flanking-partner-${id}` }).poly(flat(inner), true)
        .stroke({ color: 0x80e6d0, width: 1 });
      outline.eventMode = "none";
      layer.addChild(outline);
    }
    if (highlights.tactical?.causes.includes("flanking")) {
      const target = state.actors[highlights.tactical.targetId];
      if (target) this.label(labels, projection, target.position, "Flanking", 0x80e6d0);
    }
    if (highlights.facingPosition) {
      this.cell(layer, projection, highlights.facingPosition, 0xffd76a, 0.15, 0xffdc71, 3);
      for (const direction of ["north", "east", "south", "west"] as const) {
        const polygon = facingPolygon(projection, highlights.facingPosition, direction);
        // The picked wedge is the only preview of an unsent facing, so it reads as lit
        // rather than merely tinted against the unpicked three.
        const picked = highlights.previewFacing?.direction === direction;
        const graphic = new Graphics({ label: `face-${direction}` })
          .poly(flat(polygon), true)
          .fill({ color: picked ? 0xf2c463 : 0x172334, alpha: 0.92 })
          .stroke({ width: picked ? 3 : 2, color: picked ? 0xfff3d0 : 0xffdf71, alpha: 1 });
        graphic.eventMode = "none";
        layer.addChild(graphic);
      }
    }
  }

  private label(layer: Container, projection: BoardProjection, position: GridPosition, value: string, color: number): void {
    const point = projection.gridToScreen(position.x + 0.5, position.y + 0.86);
    const label = new Text({ text: value, style: { fontFamily: "system-ui", fontSize: 11, fontWeight: "bold", fill: color,
      stroke: { color: 0x111820, width: 3 } } });
    label.anchor.set(0.5);
    label.position.copyFrom(point);
    label.eventMode = "none";
    layer.addChild(label);
  }

  private rearCell(state: CombatState, layer: Container, labels: Container, projection: BoardProjection, position: GridPosition, active: boolean, label: string): void {
    if (position.x < 0 || position.y < 0 || position.x >= state.map.width || position.y >= state.map.height) return;
    const corners = projection.getCellCorners(position.x, position.y);
    const outline = new Graphics({ label: active ? "rear-active" : "rear-position" });
    if (active) outline.poly(flat(corners), true).stroke({ color: 0xcaa5ef, width: 3 });
    else for (let i = 0; i < corners.length; i++) {
      const from = corners[i]!;
      const to = corners[(i + 1) % corners.length]!;
      for (let dash = 0; dash < 6; dash += 2) {
        outline.moveTo(from.x + (to.x - from.x) * dash / 6, from.y + (to.y - from.y) * dash / 6)
          .lineTo(from.x + (to.x - from.x) * (dash + 1) / 6, from.y + (to.y - from.y) * (dash + 1) / 6);
      }
      outline.stroke({ color: 0xcaa5ef, width: 1.5, alpha: 0.8 });
    }
    outline.eventMode = "none";
    layer.addChild(outline);
    this.label(labels, projection, position, label, 0xe4c9ff);
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
