import {
  chooseAiCommand,
  createCombat,
  dispatchCombatCommand,
  hashCombatState,
  listLegalTargets,
  previewAction,
} from "../game";
import {
  M0_COMBAT_DEFINITION,
  M0_DEFAULT_SEED,
} from "../content/load-m0-content";
import type {
  ActionPreview,
  ActionTarget,
  CombatCommand,
  CombatDefinition,
  CombatEvent,
  CombatState,
  Direction,
  GridPosition,
  LegalAction,
  LegalTarget,
} from "../game";
import { BattleUi } from "../dom/battle-ui";
import type { AssetCatalog } from "../presentation";
import { BattleView, type BoardHighlights } from "../pixi/BattleView";
import type { Application } from "pixi.js";

const AI_DELAY_MS = 260;

export interface BattleControllerOptions {
  readonly definition?: CombatDefinition;
  readonly seed?: number;
  readonly onComplete?: (state: CombatState, stateHash: string) => void;
}

function samePosition(left: GridPosition, right: GridPosition): boolean {
  return left.x === right.x && left.y === right.y;
}

function legalTargetToActionTarget(target: LegalTarget, fallbackFacing: Direction): ActionTarget {
  switch (target.kind) {
    case "none":
      return { kind: "none" };
    case "actor":
      return { kind: "actor", actorId: target.actorId };
    case "tile":
      return { kind: "tile", position: target.position, facing: fallbackFacing };
    case "object":
      return { kind: "object", objectId: target.objectId };
    case "effect":
      return { kind: "effect", effectId: target.effectId };
  }
}

export class BattleController {
  private readonly definition: CombatDefinition;
  private readonly seed: number;
  private readonly onComplete: ((state: CombatState, stateHash: string) => void) | undefined;
  private state: CombatState;
  private history: CombatEvent[];
  private selectedAction: LegalAction | null = null;
  private hoveredAction: LegalAction | null = null;
  private facingPosition: GridPosition | null = null;
  private prompt = "행동을 선택하세요.";
  private aiTimer: number | null = null;
  private readonly view: BattleView;
  private readonly ui: BattleUi;

  public constructor(app: Application, catalog: AssetCatalog, options: BattleControllerOptions = {}) {
    this.definition = options.definition ?? M0_COMBAT_DEFINITION;
    this.seed = options.seed ?? M0_DEFAULT_SEED;
    this.onComplete = options.onComplete;
    const setup = createCombat(this.definition, this.seed);
    this.state = setup.state;
    this.history = [...setup.events];
    this.view = new BattleView(app, catalog, {
      onTile: (position) => this.handleTile(position),
      onActor: (actorId) => this.handleActor(actorId),
      onObject: (objectId) => this.handleObject(objectId),
      onFacing: (facing) => this.handleFacing(facing),
    });
    this.ui = new BattleUi(this.definition.content, this.definition.scenario, {
      onAction: (action) => this.handleAction(action),
      onActionHover: (action) => this.handleActionHover(action),
      onEndTurn: () => this.endTurn(),
      onUseReaction: () => this.resolveReaction(true),
      onPassReaction: () => this.resolveReaction(false),
      onRestart: () => this.restart(),
    });
    this.render(setup.events);
    this.scheduleAi();
  }

  private nextCommandId(label: string): string {
    return `command-${String(this.state.sequence + 1).padStart(4, "0")}-${label}`;
  }

  private activeHeroId(): string | null {
    const actor = this.state.actors[this.state.turn.activeActorId];
    return actor?.team === "heroes" ? actor.id : null;
  }

  private heroId(): string {
    return Object.values(this.state.actors).find((actor) => actor.team === "heroes")?.id ?? "hero";
  }

  private targetsFor(action: LegalAction | null): readonly LegalTarget[] {
    if (!action) return [];
    return listLegalTargets(this.state, this.heroId(), action.source, this.definition.content);
  }

  private highlights(): BoardHighlights {
    const action = this.selectedAction ?? this.hoveredAction;
    const targets = this.targetsFor(action);
    return {
      tiles: targets.flatMap((target) => (target.kind === "tile" ? [target.position] : [])),
      actorIds: targets.flatMap((target) => (target.kind === "actor" ? [target.actorId] : [])),
      objectIds: targets.flatMap((target) => (target.kind === "object" ? [target.objectId] : [])),
      facingPosition: this.facingPosition,
    };
  }

  private detailPreview(action: LegalAction | null): ActionPreview | null {
    if (!action) return null;
    const targets = this.targetsFor(action);
    const actor = this.state.actors[this.heroId()];
    const target = targets.length === 1 && actor ? legalTargetToActionTarget(targets[0] as LegalTarget, actor.facing) : null;
    if (!target) return null;
    return previewAction(this.state, this.heroId(), action.source, target, this.definition.content);
  }

  private render(events: readonly CombatEvent[] = []): void {
    const detailAction = this.hoveredAction ?? this.selectedAction;
    const stateHash = hashCombatState(this.state);
    this.view.render(this.state, this.highlights(), events);
    this.ui.render(this.state, this.history, {
      selectedAction: this.selectedAction,
      detailAction,
      preview: this.detailPreview(detailAction),
      prompt: this.prompt,
      stateHash,
    });
  }

  private clearSelection(): void {
    this.selectedAction = null;
    this.hoveredAction = null;
    this.facingPosition = null;
  }

  private handleAction(action: LegalAction): void {
    if (!action.enabled || !this.activeHeroId() || this.state.pendingReaction) return;
    if (this.selectedAction?.source.id === action.source.id) {
      this.clearSelection();
      this.prompt = "행동을 선택하세요.";
      this.render();
      return;
    }
    this.selectedAction = action;
    this.hoveredAction = null;
    this.facingPosition = null;
    const targets = this.targetsFor(action);
    if (targets.length === 1 && (targets[0]?.kind === "none" || targets[0]?.kind === "effect")) {
      const hero = this.state.actors[this.heroId()];
      if (hero && targets[0]) this.useAction(action, legalTargetToActionTarget(targets[0], hero.facing));
      return;
    }
    this.prompt =
      targets[0]?.kind === "tile"
        ? "파란 타일을 선택한 뒤 바라볼 방향을 정하세요."
        : targets[0]?.kind === "actor"
          ? "강조된 적을 선택하세요."
          : targets[0]?.kind === "object"
            ? "강조된 오브젝트를 선택하세요."
            : "합법적인 대상을 선택하세요.";
    this.render();
  }

  private handleActionHover(action: LegalAction | null): void {
    this.hoveredAction = action;
    const detailAction = action ?? this.selectedAction;
    this.view.render(this.state, this.highlights());
    this.ui.renderActionDetail(detailAction, this.detailPreview(detailAction));
  }

  private handleTile(position: GridPosition): void {
    if (!this.selectedAction) return;
    const target = this.targetsFor(this.selectedAction).find(
      (candidate) => candidate.kind === "tile" && samePosition(candidate.position, position),
    );
    if (target?.kind !== "tile") return;
    this.facingPosition = { ...position };
    this.prompt = "이동 후 바라볼 방향을 선택하세요.";
    this.render();
  }

  private handleFacing(facing: Direction): void {
    if (!this.selectedAction || !this.facingPosition) return;
    this.useAction(this.selectedAction, {
      kind: "tile",
      position: this.facingPosition,
      facing,
    });
  }

  private handleActor(actorId: string): void {
    if (!this.selectedAction) return;
    const target = this.targetsFor(this.selectedAction).find(
      (candidate) => candidate.kind === "actor" && candidate.actorId === actorId,
    );
    if (target?.kind === "actor") this.useAction(this.selectedAction, { kind: "actor", actorId });
  }

  private handleObject(objectId: string): void {
    if (!this.selectedAction) return;
    const target = this.targetsFor(this.selectedAction).find(
      (candidate) => candidate.kind === "object" && candidate.objectId === objectId,
    );
    if (target?.kind === "object") this.useAction(this.selectedAction, { kind: "object", objectId });
  }

  private useAction(action: LegalAction, target: ActionTarget): void {
    const actorId = this.activeHeroId();
    if (!actorId) return;
    this.dispatch({
      type: "use-action",
      id: this.nextCommandId(action.actionId),
      sequence: this.state.sequence + 1,
      actorId,
      action: action.source,
      target,
    });
  }

  private endTurn(): void {
    const actorId = this.activeHeroId();
    if (!actorId) return;
    this.dispatch({
      type: "end-turn",
      id: this.nextCommandId("end-turn"),
      sequence: this.state.sequence + 1,
      actorId,
    });
  }

  private resolveReaction(use: boolean): void {
    const pending = this.state.pendingReaction;
    const candidate = pending?.candidates[0];
    if (!pending || !candidate) return;
    const base = {
      id: this.nextCommandId(use ? "use-reaction" : "pass-reaction"),
      sequence: this.state.sequence + 1,
      actorId: candidate.actorId,
      triggerId: pending.triggerId,
    };
    const command: CombatCommand = use
      ? { type: "use-reaction", ...base, cardInstanceId: candidate.cardInstanceId }
      : { type: "pass-reaction", ...base };
    this.dispatch(command);
  }

  private dispatch(command: CombatCommand): void {
    const result = dispatchCombatCommand(this.state, command, this.definition.content);
    if (!result.accepted) {
      this.prompt = result.error ?? "행동을 실행할 수 없습니다.";
      this.render();
      return;
    }
    this.state = result.state;
    this.history.push(...result.events);
    this.clearSelection();
    this.prompt = this.state.pendingReaction
      ? "Reaction을 사용하거나 Pass하세요."
      : this.state.outcome
        ? "전투가 종료되었습니다."
        : this.activeHeroId()
          ? "행동을 선택하세요."
          : `${this.state.actors[this.state.turn.activeActorId]?.name ?? "Enemy"}의 턴입니다.`;
    this.render(result.events);
    this.scheduleAi();
  }

  private scheduleAi(): void {
    if (this.aiTimer !== null) window.clearTimeout(this.aiTimer);
    this.aiTimer = null;
    if (this.state.outcome || this.state.pendingReaction || this.activeHeroId()) return;
    this.aiTimer = window.setTimeout(() => {
      this.aiTimer = null;
      const command = chooseAiCommand(this.state, this.definition.content);
      if (command) this.dispatch(command);
    }, AI_DELAY_MS);
  }

  private restart(): void {
    if (this.state.outcome && this.onComplete) {
      this.onComplete(this.state, hashCombatState(this.state));
      return;
    }
    if (this.aiTimer !== null) window.clearTimeout(this.aiTimer);
    const setup = createCombat(this.definition, this.seed);
    this.state = setup.state;
    this.history = [...setup.events];
    this.clearSelection();
    this.prompt = "행동을 선택하세요.";
    this.render(setup.events);
    this.scheduleAi();
  }

  public destroy(): void {
    if (this.aiTimer !== null) window.clearTimeout(this.aiTimer);
    this.ui.destroy();
    this.view.destroy();
  }
}
