import { Container, Sprite, Text } from "pixi.js";

import type { ActorState, CombatState } from "../../game";
import type { AssetCatalog } from "../../presentation";
import { facingAsset } from "../../presentation";
import type { BoardViewConfig } from "./BoardViewConfig";
import { DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";
import type { SortableVisual } from "./TerrainRenderer";

function actorVisual(catalog: AssetCatalog, actor: ActorState): { display: Container; badge: Container } {
  const display = new Container({ label: actor.id });
  const assetId = facingAsset(catalog.actorVisual(actor.definitionId), actor.facing);
  const asset = catalog.asset(assetId);
  const sprite = new Sprite(catalog.texture(assetId));
  sprite.anchor.set(asset.anchor.x, asset.anchor.y);
  sprite.height = asset.displayHeight ?? 144;
  sprite.scale.x = sprite.scale.y;
  sprite.eventMode = "none";
  sprite.alpha = actor.defeated ? 0.32 : 1;
  const hp = new Text({
    text: `${actor.hp}/${actor.maxHp}`,
    style: {
      fill: 0xfff4df,
      fontFamily: "system-ui",
      fontSize: 11,
      fontWeight: "800",
      stroke: { color: 0x160f0c, width: 4 },
    },
  });
  hp.anchor.set(0.5, 1);
  hp.position.y = -(asset.displayHeight ?? 144) - 5;
  hp.eventMode = "none";
  display.alpha = actor.defeated ? 0.5 : 1;
  display.addChild(sprite, hp);
  return { display, badge: hp };
}

export class ActorRenderer {
  public constructor(
    private readonly catalog: AssetCatalog,
    private readonly config: BoardViewConfig = DEFAULT_BOARD_VIEW_CONFIG,
  ) {}

  public render(state: CombatState): readonly SortableVisual[] {
    return Object.values(state.actors).map((actor) => {
      const visual = actorVisual(this.catalog, actor);
      return {
        display: visual.display,
        screenSpace: visual.badge,
        position: actor.position,
        footRowOffset: this.config.actorFootRowOffset,
        layerPriority: 30,
        stableId: actor.id,
      };
    });
  }
}
