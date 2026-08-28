import {
  Application,
  Container,
  type FederatedPointerEvent,
  Graphics,
  Rectangle,
  Text,
  type Ticker,
} from "pixi.js";

import { positionKey } from "../game";
import type {
  CombatEvent,
  CombatState,
  Direction,
  GridPosition,
  TileState,
} from "../game";

const CELL_SIZE = 72;
const TILE_INSET = 3;

export interface BoardHighlights {
  readonly tiles: readonly GridPosition[];
  readonly actorIds: readonly string[];
  readonly objectIds: readonly string[];
  readonly facingPosition: GridPosition | null;
}

export interface BattleViewHandlers {
  readonly onTile: (position: GridPosition) => void;
  readonly onActor: (actorId: string) => void;
  readonly onObject: (objectId: string) => void;
  readonly onFacing: (facing: Direction) => void;
}

interface AnimationRecord {
  readonly callback: (ticker: Ticker) => void;
}

function clearLayer(layer: Container): void {
  for (const child of layer.removeChildren()) child.destroy({ children: true });
}

function tileColor(label: string): number {
  switch (label) {
    case "Rubble":
      return 0x6f624e;
    case "Chasm":
      return 0x10121a;
    case "Wall":
      return 0x342f35;
    case "Web":
      return 0x48596a;
    default:
      return 0x465743;
  }
}

function terrainLabel(tile: TileState): string {
  if (tile.traits.some((entry) => entry.id === "blocked")) return "Wall";
  if (tile.traits.some((entry) => entry.id === "impassable")) return "Chasm";
  if (tile.traits.some((entry) => entry.id === "web")) return "Web";
  if (tile.traits.some((entry) => entry.id === "difficult")) return "Rubble";
  return "Open";
}

function directionRotation(direction: Direction): number {
  switch (direction) {
    case "north":
      return 0;
    case "east":
      return Math.PI / 2;
    case "south":
      return Math.PI;
    case "west":
      return -Math.PI / 2;
  }
}

function directionOffset(direction: Direction): GridPosition {
  switch (direction) {
    case "north":
      return { x: 0, y: -22 };
    case "east":
      return { x: 22, y: 0 };
    case "south":
      return { x: 0, y: 22 };
    case "west":
      return { x: -22, y: 0 };
  }
}

export class BattleView {
  private readonly world = new Container({ label: "battle-world" });
  private readonly terrainLayer = new Container({ label: "terrain" });
  private readonly highlightLayer = new Container({ label: "highlights" });
  private readonly objectLayer = new Container({ label: "objects" });
  private readonly actorLayer = new Container({ label: "actors" });
  private readonly facingLayer = new Container({ label: "facing-picker" });
  private readonly feedbackLayer = new Container({ label: "feedback" });
  private readonly previousPositions = new Map<string, GridPosition>();
  private readonly animations: AnimationRecord[] = [];
  private readonly resizeHandler = (): void => this.layout();
  private readonly pointerHandler = (event: FederatedPointerEvent): void => this.handlePointer(event);
  private state: CombatState | null = null;
  private currentHighlights: BoardHighlights = {
    tiles: [],
    actorIds: [],
    objectIds: [],
    facingPosition: null,
  };

  public constructor(
    private readonly app: Application,
    private readonly handlers: BattleViewHandlers,
  ) {
    this.world.eventMode = "none";
    for (const layer of [
      this.terrainLayer,
      this.highlightLayer,
      this.objectLayer,
      this.actorLayer,
      this.facingLayer,
      this.feedbackLayer,
    ]) {
      layer.eventMode = "none";
    }
    this.app.stage.eventMode = "static";
    this.app.stage.interactiveChildren = false;
    this.app.stage.cursor = "pointer";
    this.app.stage.on("pointertap", this.pointerHandler);
    this.world.addChild(
      this.terrainLayer,
      this.highlightLayer,
      this.objectLayer,
      this.actorLayer,
      this.facingLayer,
      this.feedbackLayer,
    );
    this.app.stage.addChild(this.world);
    window.addEventListener("resize", this.resizeHandler);
  }

  public render(
    state: CombatState,
    highlights: BoardHighlights,
    events: readonly CombatEvent[] = [],
  ): void {
    this.cancelAnimations();
    this.state = state;
    this.currentHighlights = highlights;
    this.drawTerrain(state);
    this.drawHighlights(highlights);
    this.drawObjects(state, highlights);
    this.drawActors(state, highlights);
    this.drawFacingPicker(highlights.facingPosition);
    this.drawFeedback(state, events);
    this.layout();
  }

  private drawTerrain(state: CombatState): void {
    clearLayer(this.terrainLayer);
    for (const tile of Object.values(state.map.tiles).sort(
      (left, right) => left.position.y - right.position.y || left.position.x - right.position.x,
    )) {
      const label = terrainLabel(tile);
      const group = new Container({
        x: tile.position.x * CELL_SIZE,
        y: tile.position.y * CELL_SIZE,
        label: `tile-${positionKey(tile.position)}`,
      });
      group.eventMode = "static";
      group.interactiveChildren = false;
      group.cursor = "pointer";
      group.hitArea = new Rectangle(0, 0, CELL_SIZE, CELL_SIZE);
      group.on("pointertap", () => this.handlers.onTile(tile.position));

      const tileGraphic = new Graphics()
        .roundRect(TILE_INSET, TILE_INSET, CELL_SIZE - TILE_INSET * 2, CELL_SIZE - TILE_INSET * 2, 7)
        .fill({ color: tileColor(label), alpha: label === "Wall" ? 0.98 : 0.88 })
        .stroke({ width: 1, color: 0x90937c, alpha: 0.28 });
      tileGraphic.eventMode = "none";
      group.addChild(tileGraphic);

      if (label !== "Open") {
        const terrainText = new Text({
          text: label === "Rubble" ? "RUB" : label === "Chasm" ? "CHASM" : label === "Web" ? "WEB" : "WALL",
          style: { fill: 0xe7ddbd, fontFamily: "system-ui", fontSize: 10, fontWeight: "700" },
        });
        terrainText.position.set(8, CELL_SIZE - 19);
        terrainText.alpha = 0.76;
        terrainText.eventMode = "none";
        group.addChild(terrainText);
      }
      this.terrainLayer.addChild(group);
    }
  }

  private drawHighlights(highlights: BoardHighlights): void {
    clearLayer(this.highlightLayer);
    for (const position of highlights.tiles) {
      const highlight = new Graphics()
        .roundRect(
          position.x * CELL_SIZE + TILE_INSET,
          position.y * CELL_SIZE + TILE_INSET,
          CELL_SIZE - TILE_INSET * 2,
          CELL_SIZE - TILE_INSET * 2,
          7,
        )
        .fill({ color: 0x4e9bd8, alpha: 0.3 })
        .stroke({ width: 3, color: 0x7bc8ff, alpha: 0.95 });
      highlight.eventMode = "none";
      this.highlightLayer.addChild(highlight);
    }
  }

  private drawObjects(state: CombatState, highlights: BoardHighlights): void {
    clearLayer(this.objectLayer);
    for (const object of Object.values(state.map.objects)) {
      const highlighted = highlights.objectIds.includes(object.id);
      const group = new Container({
        x: object.position.x * CELL_SIZE + CELL_SIZE / 2,
        y: object.position.y * CELL_SIZE + CELL_SIZE / 2,
        label: object.id,
      });
      group.eventMode = object.used ? "none" : "static";
      group.interactiveChildren = false;
      group.cursor = object.used ? "default" : "pointer";
      group.hitArea = new Rectangle(-18, -18, 36, 36);
      group.on("pointertap", () => this.handlers.onObject(object.id));
      const graphic = new Graphics()
        .roundRect(-15, -15, 30, 30, 6)
        .fill({ color: object.used ? 0x34383d : 0xb8873e, alpha: 0.98 })
        .stroke({ width: highlighted ? 4 : 2, color: highlighted ? 0xffdc71 : 0x281d12 });
      const label = new Text({
        text: object.used ? "✓" : "L",
        style: { fill: 0xfff1c8, fontFamily: "system-ui", fontSize: 18, fontWeight: "800" },
      });
      label.anchor.set(0.5);
      graphic.eventMode = "none";
      label.eventMode = "none";
      group.addChild(graphic, label);
      this.objectLayer.addChild(group);
    }
  }

  private drawActors(state: CombatState, highlights: BoardHighlights): void {
    clearLayer(this.actorLayer);
    for (const actor of Object.values(state.actors).sort((left, right) => left.id.localeCompare(right.id))) {
      const destination = {
        x: actor.position.x * CELL_SIZE + CELL_SIZE / 2,
        y: actor.position.y * CELL_SIZE + CELL_SIZE / 2,
      };
      const previous = this.previousPositions.get(actor.id);
      const group = new Container({ x: destination.x, y: destination.y, label: actor.id });
      group.eventMode = actor.defeated ? "none" : "static";
      group.interactiveChildren = false;
      group.cursor = actor.defeated ? "default" : "pointer";
      group.hitArea = new Rectangle(-28, -30, 56, 60);
      group.on("pointertap", () => this.handlers.onActor(actor.id));
      group.alpha = actor.defeated ? 0.35 : 1;

      const isHero = actor.team === "heroes";
      const selected = highlights.actorIds.includes(actor.id);
      const body = new Graphics()
        .circle(0, 2, 25)
        .fill({ color: isHero ? 0x3c8f79 : 0xa3443f })
        .stroke({ width: selected ? 5 : 3, color: selected ? 0xffde73 : isHero ? 0xa6f0d7 : 0xffaaa3 });
      const initials = new Text({
        text: actor.name
          .split(" ")
          .map((part) => part[0])
          .join("")
          .slice(0, 2),
        style: { fill: 0xffffff, fontFamily: "system-ui", fontSize: 15, fontWeight: "900" },
      });
      initials.anchor.set(0.5);
      initials.position.y = 1;
      const hp = new Text({
        text: `${actor.hp}/${actor.maxHp}`,
        style: { fill: 0xffe3d9, fontFamily: "system-ui", fontSize: 10, fontWeight: "700" },
      });
      hp.anchor.set(0.5);
      hp.position.y = 34;
      const facing = new Graphics()
        .poly([0, -7, 6, 5, -6, 5], true)
        .fill({ color: 0xffe06f });
      facing.position.set(0, -27);
      facing.rotation = directionRotation(actor.facing);
      body.eventMode = "none";
      initials.eventMode = "none";
      hp.eventMode = "none";
      facing.eventMode = "none";
      group.addChild(body, initials, hp, facing);
      this.actorLayer.addChild(group);

      if (previous && (previous.x !== actor.position.x || previous.y !== actor.position.y)) {
        const start = {
          x: previous.x * CELL_SIZE + CELL_SIZE / 2,
          y: previous.y * CELL_SIZE + CELL_SIZE / 2,
        };
        group.position.set(start.x, start.y);
        let elapsed = 0;
        const callback = (ticker: Ticker): void => {
          elapsed += ticker.deltaMS;
          const progress = Math.min(1, elapsed / 220);
          const eased = 1 - (1 - progress) * (1 - progress);
          group.position.set(
            start.x + (destination.x - start.x) * eased,
            start.y + (destination.y - start.y) * eased,
          );
          if (progress >= 1) this.app.ticker.remove(callback);
        };
        this.animations.push({ callback });
        this.app.ticker.add(callback);
      }
      this.previousPositions.set(actor.id, { ...actor.position });
    }
  }

  private drawFacingPicker(position: GridPosition | null): void {
    clearLayer(this.facingLayer);
    if (!position) return;
    const center = {
      x: position.x * CELL_SIZE + CELL_SIZE / 2,
      y: position.y * CELL_SIZE + CELL_SIZE / 2,
    };
    for (const direction of ["north", "east", "south", "west"] as const) {
      const offset = directionOffset(direction);
      const button = new Graphics({ label: `face-${direction}` })
        .circle(0, 0, 13)
        .fill({ color: 0x172334, alpha: 0.98 })
        .stroke({ width: 3, color: 0xffdf71 })
        .poly([0, -9, 7, 5, 0, 2, -7, 5], true)
        .fill(0xffdf71);
      button.position.set(center.x + offset.x, center.y + offset.y);
      button.rotation = directionRotation(direction);
      button.eventMode = "static";
      button.cursor = "pointer";
      button.hitArea = new Rectangle(-14, -14, 28, 28);
      button.on("pointertap", () => this.handlers.onFacing(direction));
      this.facingLayer.addChild(button);
    }
  }

  private drawFeedback(state: CombatState, events: readonly CombatEvent[]): void {
    clearLayer(this.feedbackLayer);
    for (const event of events) {
      if (event.type !== "DAMAGE_DEALT") continue;
      const actor = state.actors[event.targetActorId];
      if (!actor) continue;
      const ring = new Graphics()
        .circle(
          actor.position.x * CELL_SIZE + CELL_SIZE / 2,
          actor.position.y * CELL_SIZE + CELL_SIZE / 2,
          31,
        )
        .stroke({ width: 6, color: 0xff6259, alpha: 0.95 });
      ring.eventMode = "none";
      this.feedbackLayer.addChild(ring);
      let elapsed = 0;
      const callback = (ticker: Ticker): void => {
        elapsed += ticker.deltaMS;
        ring.alpha = Math.max(0, 1 - elapsed / 450);
        ring.scale.set(1 + elapsed / 900);
        if (elapsed >= 450) {
          this.app.ticker.remove(callback);
          ring.destroy();
        }
      };
      this.animations.push({ callback });
      this.app.ticker.add(callback);
    }
  }

  private layout(): void {
    if (!this.state) return;
    const boardWidth = this.state.map.width * CELL_SIZE;
    const boardHeight = this.state.map.height * CELL_SIZE;
    const scale = Math.max(
      0.2,
      Math.min((this.app.screen.width - 24) / boardWidth, (this.app.screen.height - 24) / boardHeight),
    );
    this.world.scale.set(scale);
    this.world.position.set(
      Math.max(12, (this.app.screen.width - boardWidth * scale) / 2),
      Math.max(12, (this.app.screen.height - boardHeight * scale) / 2),
    );
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
  }

  private handlePointer(event: FederatedPointerEvent): void {
    if (!this.state) return;
    const local = this.world.toLocal(event.global);
    const facingPosition = this.currentHighlights.facingPosition;
    if (facingPosition) {
      const center = {
        x: facingPosition.x * CELL_SIZE + CELL_SIZE / 2,
        y: facingPosition.y * CELL_SIZE + CELL_SIZE / 2,
      };
      const dx = local.x - center.x;
      const dy = local.y - center.y;
      if (Math.abs(dx) <= 38 && Math.abs(dy) <= 38) {
        const direction: Direction =
          Math.abs(dx) > Math.abs(dy)
            ? dx >= 0
              ? "east"
              : "west"
            : dy >= 0
              ? "south"
              : "north";
        this.handlers.onFacing(direction);
        return;
      }
    }

    for (const object of Object.values(this.state.map.objects)) {
      if (object.used) continue;
      const centerX = object.position.x * CELL_SIZE + CELL_SIZE / 2;
      const centerY = object.position.y * CELL_SIZE + CELL_SIZE / 2;
      if (Math.hypot(local.x - centerX, local.y - centerY) <= 21) {
        this.handlers.onObject(object.id);
        return;
      }
    }

    for (const actor of Object.values(this.state.actors)) {
      if (actor.defeated) continue;
      const centerX = actor.position.x * CELL_SIZE + CELL_SIZE / 2;
      const centerY = actor.position.y * CELL_SIZE + CELL_SIZE / 2;
      if (Math.hypot(local.x - centerX, local.y - centerY) <= 29) {
        this.handlers.onActor(actor.id);
        return;
      }
    }

    const position = { x: Math.floor(local.x / CELL_SIZE), y: Math.floor(local.y / CELL_SIZE) };
    if (
      position.x >= 0 &&
      position.y >= 0 &&
      position.x < this.state.map.width &&
      position.y < this.state.map.height
    ) {
      this.handlers.onTile(position);
    }
  }

  private cancelAnimations(): void {
    for (const animation of this.animations) this.app.ticker.remove(animation.callback);
    this.animations.length = 0;
  }

  public destroy(): void {
    window.removeEventListener("resize", this.resizeHandler);
    this.cancelAnimations();
    this.app.stage.off("pointertap", this.pointerHandler);
    this.world.destroy({ children: true });
  }
}
