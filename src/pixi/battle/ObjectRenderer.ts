import { Container, Sprite } from "pixi.js";

import type { CombatState } from "../../game";
import type { AssetCatalog } from "../../presentation";
import type { BoardViewConfig } from "./BoardViewConfig";
import { DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";
import type { SortableVisual } from "./TerrainRenderer";

export class ObjectRenderer {
  public constructor(
    private readonly catalog: AssetCatalog,
    private readonly config: BoardViewConfig = DEFAULT_BOARD_VIEW_CONFIG,
  ) {}

  public render(state: CombatState): readonly SortableVisual[] {
    return Object.values(state.map.objects).map((object) => {
      const assetId = this.catalog.manifest.objectVisuals.lever;
      const asset = this.catalog.asset(assetId);
      const display = new Container({ label: object.id });
      const sprite = new Sprite(this.catalog.texture(assetId));
      sprite.anchor.set(asset.anchor.x, asset.anchor.y);
      sprite.height = asset.displayHeight ?? 88;
      sprite.scale.x = sprite.scale.y;
      sprite.alpha = object.used ? 0.58 : 1;
      sprite.eventMode = "none";
      display.addChild(sprite);
      return {
        display,
        position: object.position,
        footRowOffset: this.config.propFootRowOffset,
        layerPriority: 20,
        stableId: object.id,
      };
    });
  }
}
