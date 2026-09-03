import { Container, PerspectiveMesh, Sprite, Text } from "pixi.js";

import type { ActorState, CombatState } from "../../game";
import type { AssetCatalog } from "../../presentation";
import { facingAsset } from "../../presentation";
import type { BoardViewConfig } from "./BoardViewConfig";
import { DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";
import { turnedStandeeCorners } from "./StandeeTurn";
import type { SortableVisual } from "./TerrainRenderer";

/** Subdivision for the turned standee. A flat quad needs far less than the board. */
const TURNED_STANDEE_VERTICES = 10;

const DEFAULT_STANDEE_HEIGHT = 144;

/**
 * Only two standees are drawn, front and back, so east and west would otherwise look
 * exactly like south. The front art is turned instead: the same projective transform
 * the art direction wrote as a CSS perspective, applied to the quad's corners and
 * drawn as a mesh, which a canvas sprite cannot express on its own.
 */
function standeeArt(catalog: AssetCatalog, actor: ActorState): { art: Container; height: number } {
  const assetId = facingAsset(catalog.actorVisual(actor.definitionId), actor.facing);
  const asset = catalog.asset(assetId);
  const texture = catalog.texture(assetId);
  const height = asset.displayHeight ?? DEFAULT_STANDEE_HEIGHT;
  const width = texture.height > 0 ? height * (texture.width / texture.height) : height;
  const rect = {
    left: -width * asset.anchor.x,
    right: width * (1 - asset.anchor.x),
    top: -height * asset.anchor.y,
    bottom: height * (1 - asset.anchor.y),
  };
  if (actor.facing !== "east" && actor.facing !== "west") {
    const sprite = new Sprite(texture);
    sprite.anchor.set(asset.anchor.x, asset.anchor.y);
    sprite.height = height;
    sprite.scale.x = sprite.scale.y;
    return { art: sprite, height };
  }
  const corners = turnedStandeeCorners(rect, actor.facing);
  const mesh = new PerspectiveMesh({
    texture,
    verticesX: TURNED_STANDEE_VERTICES,
    verticesY: TURNED_STANDEE_VERTICES,
    x0: corners[0].x,
    y0: corners[0].y,
    x1: corners[1].x,
    y1: corners[1].y,
    x2: corners[2].x,
    y2: corners[2].y,
    x3: corners[3].x,
    y3: corners[3].y,
  });
  return { art: mesh, height };
}

function actorVisual(catalog: AssetCatalog, actor: ActorState): { display: Container; badge: Container } {
  const display = new Container({ label: actor.id });
  const { art, height } = standeeArt(catalog, actor);
  art.eventMode = "none";
  art.alpha = actor.defeated ? 0.32 : 1;
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
  hp.position.y = -height - 5;
  hp.eventMode = "none";
  display.alpha = actor.defeated ? 0.5 : 1;
  display.addChild(art, hp);
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
