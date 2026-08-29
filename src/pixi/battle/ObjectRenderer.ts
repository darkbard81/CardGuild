import { Container, Graphics, Sprite } from "pixi.js";

import type { CombatState } from "../../game";
import type { AssetCatalog } from "../../presentation";
import type { BoardHighlights } from "./BattleView";
import type { SortableVisual } from "./TerrainRenderer";
import { gridToIso } from "./IsometricProjection";

export class ObjectRenderer {
  public constructor(private readonly catalog: AssetCatalog) {}

  public render(state: CombatState, highlights: BoardHighlights): readonly SortableVisual[] {
    return Object.values(state.map.objects).map((object) => {
      const point = gridToIso(object.position);
      const assetId = this.catalog.manifest.objectVisuals.lever;
      const asset = this.catalog.asset(assetId);
      const display = new Container({ x: point.x, y: point.y + 5, label: object.id });
      const sprite = new Sprite(this.catalog.texture(assetId));
      sprite.anchor.set(asset.anchor.x, asset.anchor.y);
      sprite.height = asset.displayHeight ?? 52;
      sprite.scale.x = sprite.scale.y;
      sprite.alpha = object.used ? 0.58 : 1;
      sprite.eventMode = "none";
      display.addChild(sprite);
      if (highlights.objectIds.includes(object.id)) {
        const ring = new Graphics().ellipse(0, 1, 23, 10).stroke({ width: 3, color: 0xffdf71, alpha: 0.95 });
        ring.eventMode = "none";
        display.addChildAt(ring, 0);
      }
      return { display, position: object.position, layerPriority: 20, stableId: object.id };
    });
  }
}
