import { Container, Graphics, Sprite, Text } from "pixi.js";

import type { ActorState, CombatState, Direction } from "../../game";
import type { AssetCatalog } from "../../presentation";
import { facingStandee } from "../../presentation";
import type { BoardViewConfig, StandeeBaseStyle } from "./BoardViewConfig";
import { DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";
import type { SortableVisual } from "./TerrainRenderer";

const DEFAULT_STANDEE_HEIGHT = 144;

/**
 * The marker the standee stands on. It is the one part of an actor that belongs to the
 * board plane, so it takes the same vertical squash the board does and reads as a circle
 * lying flat on the diamond. The body above it never does.
 */
function standeeBase(style: StandeeBaseStyle): Graphics {
  const base = new Graphics({ label: "standee-base" })
    .circle(0, 0, style.radius)
    .fill({ color: style.fill, alpha: style.fillAlpha })
    .stroke({ width: style.strokeWidth, color: style.stroke, alpha: style.strokeAlpha });
  base.eventMode = "none";
  return base;
}

/**
 * Two drawings cover four facings: north shows the back, and east, south and west share
 * the front pose with west mirrored. Mirroring is a scale on the body alone — the base
 * under it and the badge above it are screen furniture and stay as they are.
 */
function standeeBody(catalog: AssetCatalog, actor: ActorState): { body: Sprite; height: number } {
  const facing = facingStandee(catalog.actorVisual(actor.definitionId), actor.facing);
  const asset = catalog.asset(facing.assetId);
  const height = asset.displayHeight ?? DEFAULT_STANDEE_HEIGHT;
  const body = new Sprite(catalog.texture(facing.assetId));
  body.label = "standee-body";
  body.anchor.set(asset.anchor.x, asset.anchor.y);
  body.height = height;
  body.scale.x = facing.flipX ? -body.scale.y : body.scale.y;
  body.eventMode = "none";
  return { body, height };
}

function actorVisual(
  catalog: AssetCatalog,
  actor: ActorState,
  config: BoardViewConfig,
): { display: Container; badge: Container } {
  const display = new Container({ label: actor.id });
  const base = standeeBase(config.standeeBase);
  base.scale.y = config.boardSquashY;
  const { body, height } = standeeBody(catalog, actor);
  body.alpha = actor.defeated ? 0.32 : 1;
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
  display.addChild(base, body, hp);
  return { display, badge: hp };
}

export class ActorRenderer {
  public constructor(
    private readonly catalog: AssetCatalog,
    private readonly config: BoardViewConfig = DEFAULT_BOARD_VIEW_CONFIG,
  ) {}

  public render(state: CombatState, preview?: { readonly actorId: string; readonly direction: Direction }): readonly SortableVisual[] {
    return Object.values(state.actors).map((actor) => {
      const visual = actorVisual(this.catalog, preview?.actorId === actor.id ? { ...actor, facing: preview.direction } : actor, this.config);
      return {
        display: visual.display,
        screenSpace: visual.badge,
        position: actor.position,
        layerPriority: 30,
        stableId: actor.id,
      };
    });
  }
}
