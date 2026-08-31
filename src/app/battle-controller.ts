import {
  chooseAiCommand,
  createCombat,
  dispatchCombatCommand,
  hashCombatState,
  listLegalActions,
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
import { actionCost, BattleUi } from "../dom/battle-ui";
import { RingMenu, type RingMenuOption } from "../dom/ring-menu";
import type { AssetCatalog } from "../presentation";
import { BattleView, type BoardHighlights, type BoardPick, type ScreenPoint } from "../pixi/BattleView";
import type { Application } from "pixi.js";

const AI_DELAY_MS = 260;
const PROMPT_IDLE = "보드에서 적·칸·오브젝트를 클릭해 행동을 고르세요.";
const PROMPT_FACING = "이동 후 바라볼 방향을 선택하세요.";

export interface BattleControllerOptions {
  readonly definition?: CombatDefinition;
  readonly seed?: number;
  readonly onComplete?: (state: CombatState, stateHash: string) => void;
}

/** One radial menu entry: an action already bound to the board target that was picked. */
interface RingEntry {
  readonly id: string;
  readonly action: LegalAction;
  readonly target: LegalTarget;
  /** Interchangeable copies of the same card collapse into one entry. */
  readonly copies: number;
}

function samePosition(left: GridPosition, right: GridPosition): boolean {
  return left.x === right.x && left.y === right.y;
}

function targetKey(target: LegalTarget): string {
  switch (target.kind) {
    case "none":
      return "none";
    case "actor":
      return `actor:${target.actorId}`;
    case "tile":
      return `tile:${target.position.x},${target.position.y}`;
    case "object":
      return `object:${target.objectId}`;
    case "effect":
      return `effect:${target.effectId}`;
  }
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
  private pendingMove: { readonly action: LegalAction; readonly position: GridPosition } | null = null;
  private ringEntries: readonly RingEntry[] = [];
  private hoveredRingOptionId: string | null = null;
  private ringTargetPosition: GridPosition | null = null;
  private hoverCell: GridPosition | null = null;
  private prompt = PROMPT_IDLE;
  private aiTimer: number | null = null;
  private readonly view: BattleView;
  private readonly ui: BattleUi;
  private readonly ring: RingMenu;

  public constructor(app: Application, catalog: AssetCatalog, options: BattleControllerOptions = {}) {
    this.definition = options.definition ?? M0_COMBAT_DEFINITION;
    this.seed = options.seed ?? M0_DEFAULT_SEED;
    this.onComplete = options.onComplete;
    const setup = createCombat(this.definition, this.seed);
    this.state = setup.state;
    this.history = [...setup.events];
    this.view = new BattleView(app, catalog, {
      onPick: (pick, screen) => this.handlePick(pick, screen),
      onFacing: (facing) => this.handleFacing(facing),
      onHoverCell: (position) => this.handleHoverCell(position),
    });
    this.ui = new BattleUi(this.definition.content, this.definition.scenario, {
      onCard: (action) => this.handleCard(action),
      onCardHover: (action) => this.handleActionHover(action),
      onEndTurn: () => this.endTurn(),
      onUseReaction: () => this.resolveReaction(true),
      onPassReaction: () => this.resolveReaction(false),
      onRestart: () => this.restart(),
    });
    this.ring = new RingMenu(this.requireRingRoot(), {
      onSelect: (optionId) => this.handleRingSelect(optionId),
      onHover: (optionId) => this.handleRingHover(optionId),
      onDismiss: () => this.dismissRing(),
    });
    this.render(setup.events);
    this.scheduleAi();
  }

  private requireRingRoot(): HTMLElement {
    const root = document.querySelector<HTMLElement>("#ring-root");
    if (!root) throw new Error("Required element was not found: #ring-root");
    return root;
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
    if (this.pendingMove) {
      // Facing step: only the committed destination stays lit.
      return { tiles: [this.pendingMove.position], actorIds: [], objectIds: [], facingPosition: this.pendingMove.position };
    }
    const hovered = this.hoveredRingEntry();
    const targets = hovered ? [hovered.target] : this.targetsFor(this.selectedAction);
    const ringCell = this.ringEntries.length > 0 ? this.ringTargetPosition : null;
    return {
      tiles: [
        ...targets.flatMap((target) => (target.kind === "tile" ? [target.position] : [])),
        ...(ringCell ? [ringCell] : []),
      ],
      actorIds: targets.flatMap((target) => (target.kind === "actor" ? [target.actorId] : [])),
      objectIds: targets.flatMap((target) => (target.kind === "object" ? [target.objectId] : [])),
      facingPosition: null,
    };
  }

  private hoveredRingEntry(): RingEntry | null {
    if (!this.hoveredRingOptionId) return null;
    return this.ringEntries.find((entry) => entry.id === this.hoveredRingOptionId) ?? null;
  }

  private previewFor(action: LegalAction | null, target: LegalTarget | null): ActionPreview | null {
    const actor = this.state.actors[this.heroId()];
    if (!action || !actor) return null;
    const resolved = target ?? (this.targetsFor(action).length === 1 ? this.targetsFor(action)[0] ?? null : null);
    if (!resolved) return null;
    return previewAction(
      this.state,
      actor.id,
      action.source,
      legalTargetToActionTarget(resolved, actor.facing),
      this.definition.content,
    );
  }

  private render(events: readonly CombatEvent[] = []): void {
    const stateHash = hashCombatState(this.state);
    this.view.render(this.state, this.highlights(), events);
    this.ui.render(this.state, this.history, {
      selectedAction: this.selectedAction,
      prompt: this.prompt,
      stateHash,
    });
    this.renderDetail();
  }

  private renderDetail(): void {
    const hovered = this.hoveredRingEntry();
    if (hovered) {
      this.ui.renderActionDetail(hovered.action, this.previewFor(hovered.action, hovered.target));
      return;
    }
    const action = this.hoveredAction ?? this.selectedAction;
    if (action) {
      this.ui.renderActionDetail(action, this.previewFor(action, null));
      return;
    }
    const hoveredActor = this.hoverCell
      ? Object.values(this.state.actors).find(
          (actor) => this.hoverCell && samePosition(actor.position, this.hoverCell),
        )
      : undefined;
    if (hoveredActor) {
      this.ui.renderActorDetail(hoveredActor);
      return;
    }
    this.ui.renderActionDetail(null, null);
  }

  private clearSelection(): void {
    this.selectedAction = null;
    this.hoveredAction = null;
    this.pendingMove = null;
    this.closeRing();
  }

  private closeRing(): void {
    this.ring.hide();
    this.ringEntries = [];
    this.ringTargetPosition = null;
    this.hoveredRingOptionId = null;
  }

  private dismissRing(): void {
    if (!this.ring.isOpen) return;
    this.closeRing();
    this.hoveredAction = null;
    this.prompt = PROMPT_IDLE;
    this.render();
  }

  /** A board target was picked: resolve it against the selected card, or open the ring menu. */
  private handlePick(pick: BoardPick, screen: ScreenPoint): void {
    if (!this.activeHeroId() || this.state.pendingReaction || this.state.outcome) return;
    if (this.pendingMove) {
      this.clearSelection();
      this.prompt = PROMPT_IDLE;
      this.render();
      return;
    }
    if (this.selectedAction) {
      this.resolveSelectedAction(pick);
      return;
    }
    const entries = this.entriesFor(pick);
    if (entries.length === 0) {
      this.closeRing();
      this.prompt = "이 대상에 사용할 수 있는 행동이 없습니다.";
      this.render();
      return;
    }
    this.ringEntries = entries;
    this.ringTargetPosition = pick.position;
    this.prompt = "링 메뉴에서 행동을 선택하세요. (Esc 취소)";
    this.render();
    this.ring.show(screen, this.pickLabel(pick), entries.map((entry) => this.ringOption(entry)));
  }

  private ringOption(entry: RingEntry): RingMenuOption {
    const duplicated = this.ringEntries.filter((other) => other.action.source.id === entry.action.source.id).length > 1;
    const suffix = duplicated && "label" in entry.target ? ` · ${entry.target.label}` : "";
    const copies = entry.copies > 1 ? ` ×${entry.copies}` : "";
    return {
      id: entry.id,
      actionId: entry.action.actionId,
      label: `${entry.action.name}${suffix}${copies}`,
      cost: actionCost(entry.action),
      hint: entry.action.description,
    };
  }

  private pickLabel(pick: BoardPick): string {
    if (pick.kind === "actor") return this.state.actors[pick.actorId]?.name ?? pick.actorId;
    if (pick.kind === "object") return this.state.map.objects[pick.objectId]?.name ?? pick.objectId;
    return `Tile ${pick.position.x},${pick.position.y}`;
  }

  /** Every legal action whose target list already contains the picked board entity. */
  private entriesFor(pick: BoardPick): readonly RingEntry[] {
    const heroId = this.heroId();
    const grouped = new Map<string, { readonly entry: RingEntry; copies: number }>();
    for (const action of listLegalActions(this.state, heroId, this.definition.content)) {
      if (!action.enabled || action.timing.kind === "reaction") continue;
      for (const target of this.targetsFor(action)) {
        if (!this.targetMatchesPick(target, pick, heroId)) continue;
        const key = `${action.actionId}|${action.sourceLabel ?? ""}|${targetKey(target)}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.copies += 1;
          continue;
        }
        grouped.set(key, {
          entry: { id: `option-${grouped.size}`, action, target, copies: 1 },
          copies: 1,
        });
      }
    }
    return [...grouped.values()].map((group) => ({ ...group.entry, copies: group.copies }));
  }

  private targetMatchesPick(target: LegalTarget, pick: BoardPick, heroId: string): boolean {
    switch (pick.kind) {
      case "tile":
        return target.kind === "tile" && samePosition(target.position, pick.position);
      case "object":
        return target.kind === "object" && target.objectId === pick.objectId;
      case "actor":
        return target.kind === "actor"
          ? target.actorId === pick.actorId
          : pick.actorId === heroId && (target.kind === "none" || target.kind === "effect");
    }
  }

  private handleRingSelect(optionId: string): void {
    const entry = this.ringEntries.find((candidate) => candidate.id === optionId);
    if (!entry) return;
    const { action, target } = entry;
    this.closeRing();
    this.commit(action, target);
  }

  private handleRingHover(optionId: string | null): void {
    this.hoveredRingOptionId = optionId;
    this.view.render(this.state, this.highlights());
    this.renderDetail();
  }

  /** Card-first path: select a card, then pick one of its highlighted board targets. */
  private handleCard(action: LegalAction): void {
    if (!action.enabled || !this.activeHeroId() || this.state.pendingReaction) return;
    this.closeRing();
    if (this.selectedAction?.source.id === action.source.id) {
      this.clearSelection();
      this.prompt = PROMPT_IDLE;
      this.render();
      return;
    }
    this.selectedAction = action;
    this.hoveredAction = null;
    this.pendingMove = null;
    const targets = this.targetsFor(action);
    const single = targets[0];
    if (targets.length === 1 && single && (single.kind === "none" || single.kind === "effect")) {
      this.commit(action, single);
      return;
    }
    this.prompt =
      single?.kind === "tile"
        ? "강조된 칸을 선택한 뒤 바라볼 방향을 정하세요."
        : single?.kind === "actor"
          ? "강조된 적을 선택하세요."
          : single?.kind === "object"
            ? "강조된 오브젝트를 선택하세요."
            : "합법적인 대상을 선택하세요.";
    this.render();
  }

  private resolveSelectedAction(pick: BoardPick): void {
    const action = this.selectedAction;
    if (!action) return;
    const target = this.targetsFor(action).find((candidate) => this.targetMatchesPick(candidate, pick, this.heroId()));
    if (!target) {
      this.clearSelection();
      this.prompt = PROMPT_IDLE;
      this.render();
      return;
    }
    this.commit(action, target);
  }

  /** Tile targets need a facing pick on the board before the command is sent. */
  private commit(action: LegalAction, target: LegalTarget): void {
    if (target.kind === "tile") {
      this.selectedAction = action;
      this.pendingMove = { action, position: { ...target.position } };
      this.prompt = PROMPT_FACING;
      this.render();
      return;
    }
    const hero = this.state.actors[this.heroId()];
    if (!hero) return;
    this.useAction(action, legalTargetToActionTarget(target, hero.facing));
  }

  private handleActionHover(action: LegalAction | null): void {
    this.hoveredAction = action;
    this.view.render(this.state, this.highlights());
    this.renderDetail();
  }

  private handleHoverCell(position: GridPosition | null): void {
    this.hoverCell = position;
    this.renderDetail();
  }

  private handleFacing(facing: Direction): void {
    const pending = this.pendingMove;
    if (!pending) return;
    this.useAction(pending.action, {
      kind: "tile",
      position: pending.position,
      facing,
    });
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
          ? PROMPT_IDLE
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
    this.prompt = PROMPT_IDLE;
    this.render(setup.events);
    this.scheduleAi();
  }

  public destroy(): void {
    if (this.aiTimer !== null) window.clearTimeout(this.aiTimer);
    this.ring.destroy();
    this.ui.destroy();
    this.view.destroy();
  }
}
