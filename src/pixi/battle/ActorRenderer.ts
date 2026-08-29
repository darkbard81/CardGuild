import { Container, Graphics, Sprite, Text } from "pixi.js";

import type { ActorState, CombatState } from "../../game";
import type { AssetCatalog } from "../../presentation";
import { facingAsset } from "../../presentation";
import type { BoardHighlights } from "./BattleView";
import type { SortableVisual } from "./TerrainRenderer";
import { gridToIso } from "./IsometricProjection";

function actorVisual(catalog: AssetCatalog, actor: ActorState, selected: boolean): Container {
  const display = new Container({ label: actor.id });
  const ring = new Graphics()
    .ellipse(0, 4, 22, 9)
    .fill({ color: actor.team === "heroes" ? 0x2d8b63 : 0x9e332c, alpha: 0.58 })
    .stroke({ width: selected ? 3 : 2, color: selected ? 0xffdf71 : actor.team === "heroes" ? 0x8df0c2 : 0xff8f82 });
  ring.eventMode = "none";
  const assetId = facingAsset(catalog.actorVisual(actor.definitionId), actor.facing);
  const asset = catalog.asset(assetId);
  const sprite = new Sprite(catalog.texture(assetId));
  sprite.anchor.set(asset.anchor.x, asset.anchor.y);
  sprite.height = asset.displayHeight ?? 72;
  sprite.scale.x = sprite.scale.y;
  sprite.eventMode = "none";
  sprite.alpha = actor.defeated ? 0.3 : 1;
  const hp = new Text({
    text: `${actor.hp}/${actor.maxHp}`,
    style: { fill: 0xffeee6, fontFamily: "system-ui", fontSize: 9, fontWeight: "700", stroke: { color: 0x1a0e0b, width: 3 } },
  });
  hp.anchor.set(0.5);
  hp.position.y = 16;
  hp.eventMode = "none";
  display.alpha = actor.defeated ? 0.5 : 1;
  display.addChild(ring, sprite, hp);
  return display;
}

export class ActorRenderer {
  public constructor(private readonly catalog: AssetCatalog) {}

  public render(state: CombatState, highlights: BoardHighlights): readonly SortableVisual[] {
    return Object.values(state.actors).map((actor) => {
      const point = gridToIso(actor.position);
      const display = actorVisual(this.catalog, actor, highlights.actorIds.includes(actor.id));
      display.position.set(point.x, point.y + 5);
      return { display, position: actor.position, layerPriority: 30, stableId: actor.id };
    });
  }
}
