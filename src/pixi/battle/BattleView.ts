import {
  type Application,
  Container,
  type FederatedPointerEvent,
  Graphics,
  Rectangle,
  type Ticker,
} from "pixi.js";

import type { CombatEvent, CombatState, Direction, GridPosition } from "../../game";
import type { AssetCatalog } from "../../presentation";
import { ActorRenderer } from "./ActorRenderer";
import { BattleCamera, type WorldBounds } from "./BattleCamera";
import { compareDepth } from "./DepthOrder";
import { gridToIso, isoToGrid } from "./IsometricProjection";
import { ObjectRenderer } from "./ObjectRenderer";
import { TacticalOverlayRenderer, facingOffset } from "./TacticalOverlayRenderer";
import { TerrainRenderer } from "./TerrainRenderer";

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

function boardBounds(state: CombatState): WorldBounds {
  const maxGroundY = (state.map.width + state.map.height - 2) * 16;
  return {
    minX: -(state.map.height - 1) * 32 - 48,
    maxX: (state.map.width - 1) * 32 + 48,
    minY: -112,
    maxY: maxGroundY + 58,
  };
}

export class BattleView {
  private readonly world = new Container({ label: "battle-world" });
  private readonly groundLayer = new Container({ label: "ground" });
  private readonly groundOverlayLayer = new Container({ label: "ground-overlays" });
  private readonly sortableWorldLayer = new Container({ label: "sortable-world" });
  private readonly tacticalOverlayLayer = new Container({ label: "tactical-overlays" });
  private readonly facingLayer = new Container({ label: "facing" });
  private readonly feedbackLayer = new Container({ label: "feedback" });
  private readonly terrainRenderer: TerrainRenderer;
  private readonly objectRenderer: ObjectRenderer;
  private readonly actorRenderer: ActorRenderer;
  private readonly tacticalRenderer = new TacticalOverlayRenderer();
  private readonly camera = new BattleCamera();
  private readonly animations: AnimationRecord[] = [];
  private readonly pointerHandler = (event: FederatedPointerEvent): void => this.handlePointer(event);
  private readonly resizeObserver: ResizeObserver;
  private readonly wheelHandler = (event: WheelEvent): void => {
    event.preventDefault();
    this.camera.zoomBy(event.deltaY < 0 ? 1.1 : 0.9, this.app.screen.width, this.app.screen.height);
    this.camera.apply(this.world);
  };
  private readonly pointerDownHandler = (event: PointerEvent): void => {
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      this.panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.app.canvas.setPointerCapture(event.pointerId);
    }
  };
  private readonly pointerMoveHandler = (event: PointerEvent): void => {
    if (!this.panPointer || this.panPointer.id !== event.pointerId) return;
    this.camera.panBy(event.clientX - this.panPointer.x, event.clientY - this.panPointer.y);
    this.panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.camera.apply(this.world);
  };
  private readonly pointerUpHandler = (event: PointerEvent): void => {
    if (this.panPointer?.id === event.pointerId) this.panPointer = null;
  };
  private resizeFrame: number | null = null;
  private panPointer: { readonly id: number; readonly x: number; readonly y: number } | null = null;
  private state: CombatState | null = null;
  private boardKey = "";
  private currentHighlights: BoardHighlights = { tiles: [], actorIds: [], objectIds: [], facingPosition: null };

  public constructor(
    private readonly app: Application,
    catalog: AssetCatalog,
    private readonly handlers: BattleViewHandlers,
  ) {
    this.terrainRenderer = new TerrainRenderer(catalog);
    this.objectRenderer = new ObjectRenderer(catalog);
    this.actorRenderer = new ActorRenderer(catalog);
    this.world.addChild(
      this.groundLayer,
      this.groundOverlayLayer,
      this.sortableWorldLayer,
      this.tacticalOverlayLayer,
      this.facingLayer,
      this.feedbackLayer,
    );
    this.app.stage.addChild(this.world);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
    this.app.stage.on("pointertap", this.pointerHandler);
    this.app.canvas.addEventListener("wheel", this.wheelHandler, { passive: false });
    this.app.canvas.addEventListener("pointerdown", this.pointerDownHandler);
    this.app.canvas.addEventListener("pointermove", this.pointerMoveHandler);
    this.app.canvas.addEventListener("pointerup", this.pointerUpHandler);
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeFrame !== null) window.cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = window.requestAnimationFrame(() => {
        this.resizeFrame = null;
        this.app.resize();
        this.fitCamera();
      });
    });
    const root = this.app.canvas.parentElement;
    if (root) this.resizeObserver.observe(root);
  }

  public render(state: CombatState, highlights: BoardHighlights, events: readonly CombatEvent[] = []): void {
    this.cancelAnimations();
    this.state = state;
    this.currentHighlights = highlights;
    for (const layer of [
      this.groundLayer,
      this.groundOverlayLayer,
      this.sortableWorldLayer,
      this.tacticalOverlayLayer,
      this.facingLayer,
      this.feedbackLayer,
    ]) clearLayer(layer);

    const sortable = [
      ...this.terrainRenderer.render(state, this.groundLayer, this.groundOverlayLayer),
      ...this.objectRenderer.render(state, highlights),
      ...this.actorRenderer.render(state, highlights),
    ].sort(compareDepth);
    for (const visual of sortable) this.sortableWorldLayer.addChild(visual.display);
    this.tacticalRenderer.renderHighlights(highlights, this.tacticalOverlayLayer);
    this.tacticalRenderer.renderFacing(highlights.facingPosition, this.facingLayer);
    this.renderFeedback(state, events);

    const nextBoardKey = `${state.scenarioId}:${state.map.width}x${state.map.height}`;
    if (this.boardKey !== nextBoardKey) {
      this.boardKey = nextBoardKey;
      this.fitCamera();
    } else {
      this.camera.apply(this.world);
    }
  }

  public focusActor(actorId: string): void {
    const actor = this.state?.actors[actorId];
    if (!actor) return;
    const point = gridToIso(actor.position);
    this.camera.focus(point.x, point.y, this.app.screen.width, this.app.screen.height);
    this.camera.apply(this.world);
  }

  private fitCamera(): void {
    if (!this.state || this.app.screen.width <= 0 || this.app.screen.height <= 0) return;
    this.camera.fit(boardBounds(this.state), this.app.screen.width, this.app.screen.height);
    this.camera.apply(this.world);
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
  }

  private renderFeedback(state: CombatState, events: readonly CombatEvent[]): void {
    for (const event of events) {
      if (event.type !== "DAMAGE_DEALT") continue;
      const actor = state.actors[event.targetActorId];
      if (!actor) continue;
      const point = gridToIso(actor.position);
      const ring = new Graphics().ellipse(point.x, point.y + 4, 25, 11).stroke({ width: 5, color: 0xff6259, alpha: 0.95 });
      this.feedbackLayer.addChild(ring);
      let elapsed = 0;
      const callback = (ticker: Ticker): void => {
        elapsed += ticker.deltaMS;
        ring.alpha = Math.max(0, 1 - elapsed / 450);
        ring.scale.set(1 + elapsed / 900);
        if (elapsed >= 450) this.app.ticker.remove(callback);
      };
      this.animations.push({ callback });
      this.app.ticker.add(callback);
    }
  }

  private handlePointer(event: FederatedPointerEvent): void {
    if (!this.state || this.panPointer) return;
    const local = this.world.toLocal(event.global);
    const facingPosition = this.currentHighlights.facingPosition;
    if (facingPosition) {
      const center = gridToIso(facingPosition);
      for (const direction of ["north", "east", "south", "west"] as const) {
        const offset = facingOffset(direction);
        if (Math.hypot(local.x - center.x - offset.x, local.y - center.y - offset.y) <= 12) {
          this.handlers.onFacing(direction);
          return;
        }
      }
    }
    const position = isoToGrid(local);
    if (!position || position.x < 0 || position.y < 0 || position.x >= this.state.map.width || position.y >= this.state.map.height) return;
    const actor = Object.values(this.state.actors).find(
      (candidate) => !candidate.defeated && candidate.position.x === position.x && candidate.position.y === position.y,
    );
    if (actor) {
      this.handlers.onActor(actor.id);
      return;
    }
    const object = Object.values(this.state.map.objects).find(
      (candidate) => !candidate.used && candidate.position.x === position.x && candidate.position.y === position.y,
    );
    if (object) {
      this.handlers.onObject(object.id);
      return;
    }
    this.handlers.onTile(position);
  }

  private cancelAnimations(): void {
    for (const animation of this.animations) this.app.ticker.remove(animation.callback);
    this.animations.length = 0;
  }

  public destroy(): void {
    this.resizeObserver.disconnect();
    if (this.resizeFrame !== null) window.cancelAnimationFrame(this.resizeFrame);
    this.cancelAnimations();
    this.app.stage.off("pointertap", this.pointerHandler);
    this.app.canvas.removeEventListener("wheel", this.wheelHandler);
    this.app.canvas.removeEventListener("pointerdown", this.pointerDownHandler);
    this.app.canvas.removeEventListener("pointermove", this.pointerMoveHandler);
    this.app.canvas.removeEventListener("pointerup", this.pointerUpHandler);
    this.world.destroy({ children: true });
  }
}
