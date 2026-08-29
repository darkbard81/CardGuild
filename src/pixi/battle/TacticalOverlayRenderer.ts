import { Container, Graphics } from "pixi.js";

import type { Direction, GridPosition } from "../../game";
import type { BoardHighlights } from "./BattleView";
import { diamondPoints, gridToIso } from "./IsometricProjection";

export function facingOffset(direction: Direction): { readonly x: number; readonly y: number } {
  switch (direction) {
    case "north": return { x: 25, y: -15 };
    case "east": return { x: 25, y: 15 };
    case "south": return { x: -25, y: 15 };
    case "west": return { x: -25, y: -15 };
  }
}

export class TacticalOverlayRenderer {
  public renderHighlights(highlights: BoardHighlights, layer: Container): void {
    for (const position of highlights.tiles) {
      const center = gridToIso(position);
      const graphic = new Graphics()
        .poly(diamondPoints(center, undefined, 2), true)
        .fill({ color: 0x3ba5e8, alpha: 0.28 })
        .stroke({ width: 2, color: 0x83d8ff, alpha: 0.98 });
      graphic.eventMode = "none";
      layer.addChild(graphic);
    }
  }

  public renderFacing(position: GridPosition | null, layer: Container): void {
    if (!position) return;
    const center = gridToIso(position);
    for (const direction of ["north", "east", "south", "west"] as const) {
      const offset = facingOffset(direction);
      const button = new Graphics({ label: `face-${direction}` })
        .circle(center.x + offset.x, center.y + offset.y, 9)
        .fill({ color: 0x172334, alpha: 0.98 })
        .stroke({ width: 2, color: 0xffdf71 })
        .poly([
          center.x + offset.x, center.y + offset.y - 5,
          center.x + offset.x + 4, center.y + offset.y + 3,
          center.x + offset.x - 4, center.y + offset.y + 3,
        ], true)
        .fill(0xffdf71);
      button.eventMode = "none";
      layer.addChild(button);
    }
  }
}
