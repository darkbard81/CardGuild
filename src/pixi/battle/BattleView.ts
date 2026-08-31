import {
  type Application,
  Container,
  type FederatedPointerEvent,
  Graphics,
  PerspectiveMesh,
  Point,
  Rectangle,
  RenderLayer,
  type Ticker,
} from "pixi.js";

import type { CombatEvent, CombatState, Direction, GridPosition } from "../../game";
import type { AssetCatalog } from "../../presentation";
import { ActorRenderer } from "./ActorRenderer";
import { BattleCamera } from "./BattleCamera";
import { BoardProjection } from "./BoardProjection";
import type { BoardViewConfig } from "./BoardViewConfig";
import { DEFAULT_BOARD_VIEW_CONFIG } from "./BoardViewConfig";
import { ObjectRenderer } from "./ObjectRenderer";
import { facingPolygon, pointInPolygon, TacticalOverlayRenderer } from "./TacticalOverlayRenderer";
import { TerrainRenderer, type SortableVisual } from "./TerrainRenderer";

export interface BoardHighlights {
  readonly tiles: readonly GridPosition[];
  readonly actorIds: readonly string[];
  readonly objectIds: readonly string[];
  readonly facingPosition: GridPosition | null;
}

export type BoardPick =
  | { readonly kind: "tile"; readonly position: GridPosition }
  | { readonly kind: "actor"; readonly actorId: string; readonly position: GridPosition }
  | { readonly kind: "object"; readonly objectId: string; readonly position: GridPosition };

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface BattleViewHandlers {
  /** A board target was picked; the screen point anchors the radial action menu. */
  readonly onPick: (pick: BoardPick, screen: ScreenPoint) => void;
  readonly onFacing: (facing: Direction) => void;
  readonly onHoverCell: (position: GridPosition | null) => void;
}

interface AnimationRecord {
  readonly callback: (ticker: Ticker) => void;
}

interface PositionedVisual extends SortableVisual {
  currentPosition: { x: number; y: number };
}

function clearLayer(layer: Container): void {
  for (const child of layer.removeChildren()) child.destroy({ children: true });
}

function samePosition(left: GridPosition | null, right: GridPosition | null): boolean {
  return left?.x === right?.x && left?.y === right?.y;
}

function lerp(left: number, right: number, progress: number): number {
  return left + (right - left) * progress;
}

export class BattleView {
  private readonly scene = new Container({ label: "BattleScene" });
  private readonly boardFloorLayer = new Container({ label: "boardFloorLayer" });
  private readonly boardOverlayLayer = new Container({ label: "boardOverlayLayer" });
  private readonly propLayer = new Container({ label: "propLayer" });
  private readonly actorLayer = new Container({ label: "actorLayer" });
  private readonly depthRenderLayer = new RenderLayer({
    sortableChildren: true,
    sortFunction: (left, right) => left.zIndex - right.zIndex || left.label.localeCompare(right.label),
  });
  private readonly effectLayer = new Container({ label: "effectLayer" });
  private readonly projection: BoardProjection;
  private readonly terrainRenderer: TerrainRenderer;
  private readonly objectRenderer: ObjectRenderer;
  private readonly actorRenderer: ActorRenderer;
  private readonly tacticalRenderer = new TacticalOverlayRenderer();
  private readonly camera: BattleCamera;
  private readonly animations: AnimationRecord[] = [];
  private readonly pointerTapHandler = (event: FederatedPointerEvent): void => this.handlePointerTap(event);
  private readonly pointerMoveStageHandler = (event: FederatedPointerEvent): void => this.handleHover(event);
  private readonly pointerLeaveHandler = (): void => this.setHover(null);
  private readonly resizeObserver: ResizeObserver;
  private readonly wheelHandler = (event: WheelEvent): void => {
    event.preventDefault();
    const bounds = this.app.canvas.getBoundingClientRect();
    this.camera.zoomBy(
      event.deltaY < 0 ? 1.1 : 0.9,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      this.app.screen.width,
      this.app.screen.height,
    );
    this.layoutScene();
  };
  private readonly pointerDownHandler = (event: PointerEvent): void => {
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      this.panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.app.canvas.setPointerCapture(event.pointerId);
      this.setHover(null);
    }
  };
  private readonly pointerMoveHandler = (event: PointerEvent): void => {
    if (!this.panPointer || this.panPointer.id !== event.pointerId) return;
    this.camera.panBy(event.clientX - this.panPointer.x, event.clientY - this.panPointer.y);
    this.panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.layoutScene();
  };
  private readonly pointerUpHandler = (event: PointerEvent): void => {
    if (this.panPointer?.id === event.pointerId) this.panPointer = null;
  };
  private resizeFrame: number | null = null;
  private panPointer: { readonly id: number; readonly x: number; readonly y: number } | null = null;
  private state: CombatState | null = null;
  private boardKey = "";
  private currentHighlights: BoardHighlights = { tiles: [], actorIds: [], objectIds: [], facingPosition: null };
  private hoverPosition: GridPosition | null = null;
  private boardMesh: PerspectiveMesh | null = null;
  private visuals: PositionedVisual[] = [];
  private actorVisuals = new Map<string, PositionedVisual>();

  public constructor(
    private readonly app: Application,
    catalog: AssetCatalog,
    private readonly handlers: BattleViewHandlers,
    private readonly config: BoardViewConfig = DEFAULT_BOARD_VIEW_CONFIG,
  ) {
    this.projection = new BoardProjection(config);
    this.camera = new BattleCamera(config);
    this.terrainRenderer = new TerrainRenderer(app, catalog, config);
    this.objectRenderer = new ObjectRenderer(catalog, config);
    this.actorRenderer = new ActorRenderer(catalog, config);
    this.scene.addChild(
      this.boardFloorLayer,
      this.boardOverlayLayer,
      this.propLayer,
      this.actorLayer,
      this.depthRenderLayer,
      this.effectLayer,
    );
    this.app.stage.addChild(this.scene);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
    this.app.stage.on("pointertap", this.pointerTapHandler);
    this.app.stage.on("pointermove", this.pointerMoveStageHandler);
    this.app.canvas.addEventListener("pointerleave", this.pointerLeaveHandler);
    this.app.canvas.addEventListener("wheel", this.wheelHandler, { passive: false });
    this.app.canvas.addEventListener("pointerdown", this.pointerDownHandler);
    this.app.canvas.addEventListener("pointermove", this.pointerMoveHandler);
    this.app.canvas.addEventListener("pointerup", this.pointerUpHandler);
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeFrame !== null) window.cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = window.requestAnimationFrame(() => {
        this.resizeFrame = null;
        this.app.resize();
        this.layoutScene();
      });
    });
    const root = this.app.canvas.parentElement;
    if (root) this.resizeObserver.observe(root);
  }

  public render(state: CombatState, highlights: BoardHighlights, events: readonly CombatEvent[] = []): void {
    const previousPositions = new Map(
      Object.values(this.state?.actors ?? {}).map((actor) => [actor.id, { ...actor.position }]),
    );
    this.cancelAnimations();
    this.state = state;
    this.currentHighlights = highlights;
    const nextBoardKey = `${state.scenarioId}:${state.map.width}x${state.map.height}`;
    if (this.boardKey !== nextBoardKey) {
      this.boardKey = nextBoardKey;
      this.camera.reset();
      this.hoverPosition = null;
    }

    this.depthRenderLayer.detachAll();
    for (const layer of [this.boardFloorLayer, this.boardOverlayLayer, this.propLayer, this.actorLayer, this.effectLayer]) clearLayer(layer);
    const boardTexture = this.terrainRenderer.renderBoard(state);
    const corners = this.camera.corners(this.app.screen.width, this.app.screen.height);
    this.projection.update(state.map.width, state.map.height, corners);
    this.boardMesh = new PerspectiveMesh({
      texture: boardTexture,
      verticesX: this.config.meshVerticesX,
      verticesY: this.config.meshVerticesY,
      x0: corners[0].x,
      y0: corners[0].y,
      x1: corners[1].x,
      y1: corners[1].y,
      x2: corners[2].x,
      y2: corners[2].y,
      x3: corners[3].x,
      y3: corners[3].y,
    });
    this.boardMesh.eventMode = "none";
    this.boardFloorLayer.addChild(this.boardMesh);

    const props = [...this.terrainRenderer.renderProps(state), ...this.objectRenderer.render(state)];
    const actors = this.actorRenderer.render(state);
    this.visuals = [];
    this.actorVisuals.clear();
    for (const visual of props) this.registerVisual(visual, this.propLayer);
    for (const visual of actors) {
      const positioned = this.registerVisual(visual, this.actorLayer);
      this.actorVisuals.set(visual.stableId, positioned);
    }
    this.layoutScene();
    this.renderFeedback(events);
    this.animateMovement(events, previousPositions);
    this.app.canvas.dataset.boardSize = `${state.map.width}x${state.map.height}`;
  }

  public focusActor(actorId: string): void {
    const actor = this.state?.actors[actorId];
    if (!actor) return;
    const point = this.projection.gridToScreen(actor.position.x + 0.5, actor.position.y + this.config.actorFootRowOffset);
    this.camera.centerScreenPoint(point, this.app.screen.width, this.app.screen.height);
    this.layoutScene();
  }

  private registerVisual(visual: SortableVisual, parent: Container): PositionedVisual {
    const positioned: PositionedVisual = { ...visual, currentPosition: { ...visual.position } };
    parent.addChild(positioned.display);
    this.depthRenderLayer.attach(positioned.display);
    this.visuals.push(positioned);
    this.placeVisual(positioned);
    return positioned;
  }

  private placeVisual(visual: PositionedVisual): void {
    const row = visual.currentPosition.y + visual.footRowOffset;
    const foot = this.projection.gridToScreen(visual.currentPosition.x + 0.5, row);
    visual.display.position.copyFrom(foot);
    const scale = this.projection.getDepthScale(row) * this.camera.scale;
    visual.display.scale.set(scale);
    visual.display.zIndex = Math.round(foot.y * 100) + visual.layerPriority;
  }

  private layoutScene(): void {
    if (!this.state || this.app.screen.width <= 0 || this.app.screen.height <= 0) return;
    const corners = this.camera.corners(this.app.screen.width, this.app.screen.height);
    this.projection.update(this.state.map.width, this.state.map.height, corners);
    this.boardMesh?.setCorners(
      corners[0].x, corners[0].y,
      corners[1].x, corners[1].y,
      corners[2].x, corners[2].y,
      corners[3].x, corners[3].y,
    );
    for (const visual of this.visuals) this.placeVisual(visual);
    this.depthRenderLayer.sortRenderLayerChildren();
    this.renderOverlay();
    this.publishLayout();
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
  }

  private renderOverlay(): void {
    clearLayer(this.boardOverlayLayer);
    if (!this.state) return;
    this.tacticalRenderer.render(
      this.state,
      this.currentHighlights,
      this.hoverPosition,
      this.projection,
      this.boardOverlayLayer,
    );
  }

  private renderFeedback(events: readonly CombatEvent[]): void {
    if (!this.state) return;
    for (const event of events) {
      if (event.type !== "DAMAGE_DEALT") continue;
      const actor = this.state.actors[event.targetActorId];
      if (!actor) continue;
      const polygon = this.projection.getCellCorners(actor.position.x, actor.position.y);
      const flash = new Graphics()
        .poly(polygon.flatMap((point) => [point.x, point.y]), true)
        .fill({ color: 0xff4d42, alpha: 0.42 })
        .stroke({ width: 4, color: 0xff8f82, alpha: 0.95 });
      this.effectLayer.addChild(flash);
      let elapsed = 0;
      const callback = (ticker: Ticker): void => {
        elapsed += ticker.deltaMS;
        flash.alpha = Math.max(0, 1 - elapsed / 450);
        if (elapsed >= 450) this.app.ticker.remove(callback);
      };
      this.animations.push({ callback });
      this.app.ticker.add(callback);
    }
  }

  private animateMovement(events: readonly CombatEvent[], previousPositions: ReadonlyMap<string, GridPosition>): void {
    for (const event of events) {
      if (event.type !== "ACTOR_MOVED") continue;
      const visual = this.actorVisuals.get(event.actorId);
      const start = previousPositions.get(event.actorId);
      if (!visual || !start || event.path.length === 0) continue;
      const path = [start, ...event.path].filter((position, index, values) => {
        const previous = values[index - 1];
        return !previous || previous.x !== position.x || previous.y !== position.y;
      });
      if (path.length < 2) continue;
      visual.currentPosition = { ...path[0] as GridPosition };
      this.placeVisual(visual);
      let elapsed = 0;
      const segmentDuration = 150;
      const callback = (ticker: Ticker): void => {
        elapsed += ticker.deltaMS;
        const segmentFloat = Math.min(path.length - 1, elapsed / segmentDuration);
        const segment = Math.min(path.length - 2, Math.floor(segmentFloat));
        const progress = Math.min(1, segmentFloat - segment);
        const from = path[segment];
        const to = path[segment + 1];
        if (!from || !to) return;
        visual.currentPosition.x = lerp(from.x, to.x, progress);
        visual.currentPosition.y = lerp(from.y, to.y, progress);
        this.placeVisual(visual);
        this.depthRenderLayer.sortRenderLayerChildren();
        this.publishLayout();
        if (elapsed >= (path.length - 1) * segmentDuration) {
          visual.currentPosition = { ...path[path.length - 1] as GridPosition };
          this.placeVisual(visual);
          this.app.ticker.remove(callback);
        }
      };
      this.animations.push({ callback });
      this.app.ticker.add(callback);
    }
  }

  private handleHover(event: FederatedPointerEvent): void {
    if (this.panPointer) return;
    this.setHover(this.gridAt(event.global.x, event.global.y));
  }

  private setHover(position: GridPosition | null): void {
    if (samePosition(this.hoverPosition, position)) return;
    this.hoverPosition = position;
    this.app.canvas.dataset.hoverCell = position ? `${position.x},${position.y}` : "";
    this.renderOverlay();
    this.handlers.onHoverCell(position);
  }

  private gridAt(screenX: number, screenY: number): GridPosition | null {
    if (!this.state) return null;
    const board = this.projection.screenToGrid(screenX, screenY);
    const position = { x: Math.floor(board.x), y: Math.floor(board.y) };
    if (position.x < 0 || position.y < 0 || position.x >= this.state.map.width || position.y >= this.state.map.height) return null;
    return position;
  }

  private handlePointerTap(event: FederatedPointerEvent): void {
    if (!this.state || this.panPointer) return;
    const point = new Point(event.global.x, event.global.y);
    const facingPosition = this.currentHighlights.facingPosition;
    if (facingPosition) {
      for (const direction of ["north", "east", "south", "west"] as const) {
        if (pointInPolygon(point, facingPolygon(this.projection, facingPosition, direction))) {
          this.handlers.onFacing(direction);
          return;
        }
      }
    }
    const position = this.gridAt(point.x, point.y);
    if (!position) return;
    const screen = { x: point.x, y: point.y };
    const actor = Object.values(this.state.actors).find(
      (candidate) => !candidate.defeated && candidate.position.x === position.x && candidate.position.y === position.y,
    );
    if (actor) {
      this.handlers.onPick({ kind: "actor", actorId: actor.id, position }, screen);
      return;
    }
    const object = Object.values(this.state.map.objects).find(
      (candidate) => !candidate.used && candidate.position.x === position.x && candidate.position.y === position.y,
    );
    if (object) {
      this.handlers.onPick({ kind: "object", objectId: object.id, position }, screen);
      return;
    }
    this.handlers.onPick({ kind: "tile", position }, screen);
  }

  /** Screen position of a cell centre, used to anchor DOM overlays such as the ring menu. */
  public cellAnchor(position: GridPosition): ScreenPoint {
    const point = this.projection.gridToScreen(position.x + 0.5, position.y + 0.5);
    return { x: point.x, y: point.y };
  }

  private cancelAnimations(): void {
    for (const animation of this.animations) this.app.ticker.remove(animation.callback);
    this.animations.length = 0;
  }

  private publishLayout(): void {
    this.app.canvas.dataset.boardCorners = JSON.stringify(
      this.projection.corners.map((point) => ({ x: Number(point.x.toFixed(2)), y: Number(point.y.toFixed(2)) })),
    );
    this.app.canvas.dataset.actorFeet = JSON.stringify(
      [...this.actorVisuals.entries()].map(([id, visual]) => ({
        id,
        x: Number(visual.display.x.toFixed(2)),
        y: Number(visual.display.y.toFixed(2)),
        scale: Number(visual.display.scale.x.toFixed(4)),
        zIndex: visual.display.zIndex,
      })),
    );
    this.app.canvas.dataset.depthOrder = [...this.visuals]
      .sort((left, right) => left.display.zIndex - right.display.zIndex || left.stableId.localeCompare(right.stableId))
      .map((visual) => visual.stableId)
      .join(",");
  }

  public destroy(): void {
    this.resizeObserver.disconnect();
    if (this.resizeFrame !== null) window.cancelAnimationFrame(this.resizeFrame);
    this.cancelAnimations();
    this.depthRenderLayer.detachAll();
    this.app.stage.off("pointertap", this.pointerTapHandler);
    this.app.stage.off("pointermove", this.pointerMoveStageHandler);
    this.app.canvas.removeEventListener("pointerleave", this.pointerLeaveHandler);
    this.app.canvas.removeEventListener("wheel", this.wheelHandler);
    this.app.canvas.removeEventListener("pointerdown", this.pointerDownHandler);
    this.app.canvas.removeEventListener("pointermove", this.pointerMoveHandler);
    this.app.canvas.removeEventListener("pointerup", this.pointerUpHandler);
    this.scene.destroy({ children: true });
    this.terrainRenderer.destroy();
  }
}
