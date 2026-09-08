import {
  hashCombatState,
  facingContext,
  listLegalActions,
  listLegalTargets,
  previewAction,
} from "../game";
import type {
  ActionPreview,
  ActionTarget,
  CombatDefinition,
  CombatEvent,
  CombatState,
  Direction,
  GridPosition,
  LegalAction,
  LegalTarget,
} from "../game";
import type { SessionIntent } from "../session";
import {
  hoveredRingEntry,
  IDLE_INTERACTION,
  interactionAction,
  type Interaction,
  type RingEntry,
} from "./battle-interaction";
import { actionCost, BattleUi } from "../dom/battle-ui";
import { measureHudSafeArea } from "../dom/hud-safe-area";
import { RingMenu, type RingMenuOption } from "../dom/ring-menu";
import type { AssetCatalog } from "../presentation";
import { BattleView, type BoardHighlights, type BoardPick, type MoveBandTile, type ScreenPoint } from "../pixi/BattleView";
import { MOVE_BAND_ORDER, moveBandOf, moveBandsFor, moveBandTilesFor } from "./move-bands";
import type { Application } from "pixi.js";

const PROMPT_IDLE = "보드에서 적·칸·오브젝트를 클릭해 행동을 고르세요.";
const PROMPT_FACING = "제자리 Step으로 바라볼 방향을 선택하세요. (1 Action · Esc 취소)";
const PROMPT_END_TURN = "턴을 마칠 최종 방향을 선택하세요. (무료 · Esc 취소)";
const PROMPT_SPENT_TURN = "Action을 모두 사용했습니다. 최종 방향을 선택한 뒤 확정하세요. (무료 · Esc 취소)";

export interface BattleControllerOptions {
  readonly definition: CombatDefinition;
  readonly state: CombatState;
  readonly history: readonly CombatEvent[];
  readonly controlledActorIds: ReadonlySet<string>;
  readonly onIntent: (intent: SessionIntent) => boolean;
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

function legalTargetToActionTarget(target: LegalTarget): ActionTarget {
  switch (target.kind) {
    case "none":
      return { kind: "none" };
    case "actor":
      return { kind: "actor", actorId: target.actorId };
    case "tile":
      return { kind: "tile", position: target.position };
    case "object":
      return { kind: "object", objectId: target.objectId };
    case "effect":
      return { kind: "effect", effectId: target.effectId };
  }
}

export class BattleController {
  private readonly definition: CombatDefinition;
  private controlledActorIds: ReadonlySet<string>;
  private presentedActorId: string;
  private readonly onIntent: (intent: SessionIntent) => boolean;
  private state: CombatState;
  private history: CombatEvent[];
  private interaction: Interaction = IDLE_INTERACTION;
  /** Pure preview state: it changes what the inspector shows, never what a click does. */
  private hoveredCardAction: LegalAction | null = null;
  private hoverCell: GridPosition | null = null;
  private prompt = PROMPT_IDLE;
  private readonly view: BattleView;
  private readonly ui: BattleUi;
  private readonly ring: RingMenu;
  private directionReturn: { interaction: Interaction; prompt: string } | null = null;
  private pendingFacing: { interaction: Extract<Interaction, { kind: "direction" }>; facing: Direction; previous: { interaction: Interaction; prompt: string } | null } | null = null;
  private inspectionCache: { state: CombatState; interaction: Interaction; card: LegalAction | null; hover: GridPosition | null;
    value: { action: LegalAction | null; preview: ActionPreview | null } } | null = null;
  private selectedFacing: Direction | null = null;
  private ringAnchor: ScreenPoint = { x: 0, y: 0 };
  private ringTitle = "";
  private readonly keyHandler = (event: KeyboardEvent): void => {
    if (this.interaction.kind === "direction") {
      const direction = ({ ArrowUp: "north", ArrowRight: "east", ArrowDown: "south", ArrowLeft: "west" } as const)[event.key as "ArrowUp"];
      if (direction) { event.preventDefault(); this.handleFacing(direction); return; }
      if (event.key === "Enter") { event.preventDefault(); this.confirmFacing(); return; }
    }
    if (event.key === "Escape" && this.interaction.kind === "direction") {
      event.preventDefault();
      this.cancelDirection();
    }
  };

  public constructor(app: Application, catalog: AssetCatalog, options: BattleControllerOptions) {
    this.definition = options.definition;
    this.controlledActorIds = new Set(options.controlledActorIds);
    this.presentedActorId = [...this.controlledActorIds][0] ?? options.state.turn.activeActorId;
    this.onIntent = options.onIntent;
    this.state = options.state;
    this.history = [...options.history];
    this.syncPresentedActor();
    const stage = this.requireElement<HTMLElement>(".combat-stage");
    this.view = new BattleView(app, catalog, {
      onPick: (pick, screen) => this.handlePick(pick, screen),
      onFacing: (facing) => this.handleFacing(facing),
      onCancelDirection: () => this.cancelDirection(),
      onHoverCell: (position) => this.handleHoverCell(position),
      safeArea: () => measureHudSafeArea(stage),
    });
    this.ui = new BattleUi(this.definition.content, this.definition.scenario, catalog, {
      onCard: (action) => this.handleCard(action),
      onCardHover: (action) => this.handleActionHover(action),
      onEndTurn: () => this.endTurn(),
      onUseReaction: () => this.resolveReaction(true),
      onPassReaction: () => this.resolveReaction(false),
      onRestart: () => this.restart(),
    });
    this.ring = new RingMenu(this.requireElement<HTMLElement>("#ring-root"), {
      onSelect: (optionId) => this.handleRingSelect(optionId),
      onHover: (optionId) => this.handleRingHover(optionId),
      onDismiss: () => this.dismissRing(),
    });
    this.refreshMoveBands();
    window.addEventListener("keydown", this.keyHandler);
    this.render(options.history);
  }

  private moveBands: readonly MoveBandTile[] = [];
  /** The turn whose spent-action widget already opened, so a cancel is not undone. */
  private spentTurnOffered: number | null = null;

  private requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Required element was not found: ${selector}`);
    return element;
  }

  private activeHeroId(): string | null {
    const actor = this.state.actors[this.state.turn.activeActorId];
    return actor?.team === "heroes" && this.controlledActorIds.has(actor.id) ? actor.id : null;
  }

  private heroId(): string {
    return this.presentedActorId;
  }

  private syncPresentedActor(): void {
    const reactionActorId = this.state.pendingReaction?.candidates[0]?.actorId;
    if (reactionActorId && this.controlledActorIds.has(reactionActorId)) {
      this.presentedActorId = reactionActorId;
      return;
    }
    const activeActorId = this.state.turn.activeActorId;
    if (this.controlledActorIds.has(activeActorId)) {
      this.presentedActorId = activeActorId;
      return;
    }
    if (!this.controlledActorIds.has(this.presentedActorId)) {
      this.presentedActorId = [...this.controlledActorIds][0] ?? activeActorId;
    }
  }

  private targetsFor(action: LegalAction | null): readonly LegalTarget[] {
    if (!action) return [];
    return listLegalTargets(this.state, this.heroId(), action.source, this.definition.content);
  }

  /**
   * Recomputed once per snapshot rather than per render: the reach only changes when the
   * board does, but a hover re-renders.
   */
  private refreshMoveBands(): void {
    const heroId = this.activeHeroId();
    this.moveBands = heroId && !this.state.pendingReaction && !this.state.outcome
      ? moveBandsFor(this.state, heroId, this.definition.content)
      : [];
  }

  /** Idle shows every movement; choosing one narrows the board to that movement's reach. */
  private visibleMoveBands(): readonly MoveBandTile[] {
    const interaction = this.interaction;
    const heroId = this.activeHeroId();
    if (!heroId || this.moveBands.length === 0) return [];
    switch (interaction.kind) {
      case "idle":
        return this.moveBands;
      case "direction":
        return [];
      case "card":
      case "ring": {
        const chosen = interaction.kind === "card" ? interaction.action : hoveredRingEntry(interaction)?.action;
        if (!chosen || !moveBandOf(chosen, this.definition.content)) return [];
        return moveBandTilesFor(this.state, heroId, this.definition.content, chosen);
      }
    }
  }

  private highlights(): BoardHighlights {
    const interaction = this.interaction;
    if (interaction.kind === "direction") {
      return {
        tiles: [interaction.position],
        actorIds: [],
        objectIds: [],
        facingPosition: interaction.position,
        moveBands: [],
        actorFacing: this.state.actors[this.heroId()] ? facingContext(this.state.actors[this.heroId()]!, this.selectedFacing ?? undefined) : undefined,
        previewFacing: this.selectedFacing ? { actorId: this.heroId(), direction: this.selectedFacing } : undefined,
      };
    }
    const hovered = hoveredRingEntry(interaction);
    const targets = hovered
      ? [hovered.target]
      : this.targetsFor(interaction.kind === "card" ? interaction.action : null);
    const inspection = this.inspection();
    const inspectedTarget = inspection.preview?.tactical?.targetId;
    const targetActor = inspectedTarget ? this.state.actors[inspectedTarget] : undefined;
    const actor = this.state.actors[this.heroId()];
    const ringCell = interaction.kind === "ring" ? [interaction.position] : [];
    return {
      tiles: [
        ...targets.flatMap((target) => (target.kind === "tile" ? [target.position] : [])),
        ...ringCell,
      ],
      actorIds: targets.flatMap((target) => (target.kind === "actor" ? [target.actorId] : [])),
      objectIds: targets.flatMap((target) => (target.kind === "object" ? [target.objectId] : [])),
      facingPosition: null,
      moveBands: this.visibleMoveBands(),
      tactical: inspection.preview?.tactical,
      targetFacing: targetActor ? facingContext(targetActor) : undefined,
      actorFacing: inspection.action && actor ? facingContext(actor) : undefined,
    };
  }

  private previewFor(action: LegalAction | null, target: LegalTarget | null): ActionPreview | null {
    const actor = this.state.actors[this.heroId()];
    if (!action || !actor) return null;
    const hoveredActor = this.hoverCell ? Object.values(this.state.actors).find((candidate) => samePosition(candidate.position, this.hoverCell!)) : undefined;
    const hoverTarget: LegalTarget | null = hoveredActor && hoveredActor.team !== actor.team
      ? { kind: "actor", actorId: hoveredActor.id, label: hoveredActor.name } : null;
    const resolved = target ?? hoverTarget ?? (this.targetsFor(action).length === 1 ? this.targetsFor(action)[0] ?? null : null);
    if (!resolved) return null;
    return previewAction(
      this.state,
      actor.id,
      action.source,
      resolved.kind === "tile" && samePosition(resolved.position, actor.position)
        ? { kind: "tile", position: resolved.position, facing: actor.facing }
        : legalTargetToActionTarget(resolved),
      this.definition.content,
    );
  }

  private render(events: readonly CombatEvent[] = []): void {
    const stateHash = hashCombatState(this.state);
    const canControl = Boolean(this.activeHeroId()) && !this.state.pendingReaction && !this.state.outcome;
    const app = this.requireElement<HTMLElement>("#app");
    app.dataset.viewerMemberId = this.presentedActorId;
    app.dataset.controlledActorIds = [...this.controlledActorIds].sort().join(",");
    const highlights = this.highlights();
    this.view.render(this.state, highlights, events);
    this.ui.render(this.state, this.history, {
      selectedAction: interactionAction(this.interaction),
      // Legend order follows the bands themselves: cheapest movement first.
      moveBands: MOVE_BAND_ORDER.filter((band) => highlights.moveBands.some((tile) => tile.band === band)),
      prompt: this.prompt,
      stateHash,
      controlledActorId: this.presentedActorId,
      canControl,
    });
    this.renderDetail();
  }

  private inspection(): { action: LegalAction | null; preview: ActionPreview | null } {
    const cached = this.inspectionCache;
    if (cached && cached.state === this.state && cached.interaction === this.interaction
      && cached.card === this.hoveredCardAction && cached.hover === this.hoverCell) return cached.value;
    const hovered = hoveredRingEntry(this.interaction);
    const action = hovered?.action ?? this.hoveredCardAction ?? interactionAction(this.interaction);
    const value = { action, preview: this.previewFor(action, hovered?.target ?? null) };
    this.inspectionCache = { state: this.state, interaction: this.interaction, card: this.hoveredCardAction, hover: this.hoverCell, value };
    return value;
  }

  private renderDetail(): void {
    if (this.interaction.kind === "direction") {
      this.ui.renderDirection(this.selectedFacing ?? this.state.actors[this.heroId()]!.facing,
        this.interaction.purpose === "step-turn" ? "1 Action" : "무료",
        () => this.confirmFacing(), () => this.cancelDirection());
      return;
    }
    const { action, preview } = this.inspection();
    this.ring.setContext(preview?.tactical?.causes.includes("flanking") ? "Flanking" : null);
    if (action) {
      this.ui.renderActionDetail(action, preview, this.state);
      return;
    }
    // A ring that is open but has nothing chosen yet should describe what it opened on.
    // Pointing at the board is a hover on a mouse and nothing at all on a touch screen,
    // so this is the only reading a finger gets.
    const interaction = this.interaction;
    if (interaction.kind === "ring") {
      const target = Object.values(this.state.actors)
        .find((actor) => samePosition(actor.position, interaction.position));
      if (target) {
        this.ui.renderActorDetail(target);
        return;
      }
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

  /** Every phase change goes through here so the ring can never outlive its state. */
  private enter(interaction: Interaction): void {
    this.interaction = interaction;
    if (interaction.kind === "direction") this.selectedFacing = this.state.actors[this.heroId()]?.facing ?? null;
    else this.selectedFacing = null;
    if (interaction.kind !== "ring") this.ring.hide();
  }

  private goIdle(): void {
    this.directionReturn = null;
    this.enter(IDLE_INTERACTION);
    this.hoveredCardAction = null;
  }

  private dismissRing(): void {
    if (this.interaction.kind !== "ring") return;
    this.goIdle();
    this.prompt = PROMPT_IDLE;
    this.render();
  }

  /** A board target was picked: resolve it against the selected card, or open the ring menu. */
  private handlePick(pick: BoardPick, screen: ScreenPoint): void {
    if (!this.activeHeroId() || this.state.pendingReaction || this.state.outcome) return;
    const interaction = this.interaction;
    if (interaction.kind === "direction") {
      this.cancelDirection();
      return;
    }
    if (interaction.kind === "card") {
      this.resolveCardTarget(interaction.action, pick);
      return;
    }
    const entries = this.entriesFor(pick);
    if (entries.length === 0) {
      this.goIdle();
      this.prompt = "이 대상에 사용할 수 있는 행동이 없습니다.";
      this.render();
      return;
    }
    this.enter({ kind: "ring", position: pick.position, entries, hoveredOptionId: null });
    this.prompt = "링 메뉴에서 행동을 선택하세요. (Esc 취소)";
    this.render();
    this.ringAnchor = screen;
    this.ringTitle = this.pickLabel(pick);
    this.ring.show(screen, this.ringTitle, entries.map((entry) => this.ringOption(entry, entries)));
  }

  private ringOption(entry: RingEntry, entries: readonly RingEntry[]): RingMenuOption {
    const duplicated = entries.filter((other) => other.action.source.id === entry.action.source.id).length > 1;
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
          : target.kind === "tile"
            ? samePosition(target.position, pick.position)
            : pick.actorId === heroId && (target.kind === "none" || target.kind === "effect");
    }
  }

  private handleRingSelect(optionId: string): void {
    const interaction = this.interaction;
    if (interaction.kind !== "ring") return;
    const entry = interaction.entries.find((candidate) => candidate.id === optionId);
    if (!entry) return;
    this.commit(entry.action, entry.target);
  }

  private handleRingHover(optionId: string | null): void {
    const interaction = this.interaction;
    if (interaction.kind !== "ring") return;
    this.interaction = { ...interaction, hoveredOptionId: optionId };
    this.view.updateHighlights(this.highlights());
    this.renderDetail();
  }

  /** Card-first path: select a card, then pick one of its highlighted board targets. */
  private handleCard(action: LegalAction): void {
    if (!action.enabled || !this.activeHeroId() || this.state.pendingReaction) return;
    const current = this.interaction;
    if (current.kind === "card" && current.action.source.id === action.source.id) {
      this.goIdle();
      this.prompt = PROMPT_IDLE;
      this.render();
      return;
    }
    this.enter({ kind: "card", action });
    this.hoveredCardAction = null;
    const targets = this.targetsFor(action);
    const single = targets[0];
    if (targets.length === 1 && single && (single.kind === "none" || single.kind === "effect")) {
      this.commit(action, single);
      return;
    }
    this.prompt =
      single?.kind === "tile"
        ? "강조된 칸을 선택하세요. 제자리 Step은 방향을 선택합니다."
        : single?.kind === "actor"
          ? "강조된 적을 선택하세요."
          : single?.kind === "object"
            ? "강조된 오브젝트를 선택하세요."
            : "합법적인 대상을 선택하세요.";
    this.render();
  }

  private resolveCardTarget(action: LegalAction, pick: BoardPick): void {
    const target = this.targetsFor(action).find((candidate) => this.targetMatchesPick(candidate, pick, this.heroId()));
    if (!target) {
      this.goIdle();
      this.prompt = PROMPT_IDLE;
      this.render();
      return;
    }
    this.commit(action, target);
  }

  /** Only an in-place Step needs explicit direction input. */
  private commit(action: LegalAction, target: LegalTarget): void {
    const hero = this.state.actors[this.heroId()];
    if (!hero) return;
    const resolution = this.definition.content.actions[action.actionId]?.resolution;
    if (resolution?.kind === "move" && resolution.step && target.kind === "tile" && samePosition(target.position, hero.position)) {
      this.directionReturn = { interaction: this.interaction, prompt: this.prompt };
      this.enter({ kind: "direction", purpose: "step-turn", action, position: { ...target.position } });
      this.prompt = PROMPT_FACING;
      this.render();
      return;
    }
    this.useAction(action, legalTargetToActionTarget(target));
  }

  private handleActionHover(action: LegalAction | null): void {
    this.hoveredCardAction = action;
    this.view.updateHighlights(this.highlights());
    this.renderDetail();
  }

  private handleHoverCell(position: GridPosition | null): void {
    this.hoverCell = position;
    this.view.updateHighlights(this.highlights());
    this.renderDetail();
  }

  private handleFacing(facing: Direction): void {
    if (this.interaction.kind !== "direction") return;
    this.selectedFacing = facing;
    this.render();
  }

  private confirmFacing(): void {
    const facing = this.selectedFacing;
    if (!facing) return;
    const interaction = this.interaction;
    if (interaction.kind !== "direction") return;
    this.pendingFacing = { interaction, facing, previous: this.directionReturn };
    const sent = this.sendIntent(interaction.purpose === "end-turn"
      ? { type: "end-turn", facing }
      : { type: "use-action", action: interaction.action.source, target: { kind: "tile", position: interaction.position, facing } });
    if (!sent) this.pendingFacing = null;
  }

  public reportError(message: string): void {
    const pending = this.pendingFacing;
    if (!pending) return;
    this.pendingFacing = null;
    this.enter(pending.interaction);
    this.directionReturn = pending.previous;
    this.selectedFacing = pending.facing;
    this.prompt = message;
    this.render();
  }

  private useAction(action: LegalAction, target: ActionTarget): void {
    if (!this.activeHeroId()) return;
    this.sendIntent({
      type: "use-action",
      action: action.source,
      target,
    });
  }

  /** Opens the final-facing widget without drawing it, so a caller can batch the render. */
  private beginEndTurnDirection(prompt: string): boolean {
    const actorId = this.activeHeroId();
    if (!actorId || this.state.pendingReaction || this.state.outcome || this.interaction.kind === "direction") return false;
    const actor = this.state.actors[actorId];
    if (!actor) return false;
    this.directionReturn = { interaction: this.interaction, prompt: this.prompt };
    this.enter({ kind: "direction", purpose: "end-turn", position: actor.position });
    this.prompt = prompt;
    return true;
  }

  private endTurn(): void {
    if (this.beginEndTurnDirection(PROMPT_END_TURN)) this.render();
  }

  /**
   * A turn with no actions left has nothing but End Turn in it: every action in the pack
   * costs at least one, and Reactions are resolved by their own window rather than from
   * the turn. So the final-facing widget opens itself; selecting a direction previews it
   * and confirming ends the turn. The turn is still not
   * ended for them: `Esc` puts the board back and leaves End Turn to be pressed, and the
   * remembered turn number keeps the next snapshot from reopening what they dismissed.
   */
  private offerSpentTurnDirection(): void {
    if (this.state.turn.actionsRemaining > 0 || this.spentTurnOffered === this.state.turn.turnNumber) return;
    if (this.beginEndTurnDirection(PROMPT_SPENT_TURN)) this.spentTurnOffered = this.state.turn.turnNumber;
  }

  private cancelDirection(): void {
    const previous = this.directionReturn;
    this.directionReturn = null;
    this.enter(previous?.interaction ?? IDLE_INTERACTION);
    this.prompt = previous?.prompt ?? PROMPT_IDLE;
    this.render();
    if (this.interaction.kind === "ring") {
      const entries = this.interaction.entries;
      this.ring.show(this.ringAnchor, this.ringTitle, entries.map((entry) => this.ringOption(entry, entries)));
    }
  }

  private resolveReaction(use: boolean): void {
    const pending = this.state.pendingReaction;
    const candidate = pending?.candidates[0];
    if (!pending || !candidate || !this.controlledActorIds.has(candidate.actorId)) return;
    this.sendIntent(use
      ? { type: "use-reaction", triggerId: pending.triggerId, cardInstanceId: candidate.cardInstanceId }
      : { type: "pass-reaction", triggerId: pending.triggerId });
  }

  /** Reports whether the intent was taken, so a caller can retry on the next snapshot. */
  private sendIntent(intent: SessionIntent): boolean {
    if (!this.onIntent(intent)) {
      this.prompt = "서버 응답을 기다리는 중입니다.";
      this.render();
      return false;
    }
    this.goIdle();
    this.prompt = "서버가 행동을 판정하는 중입니다.";
    this.render();
    return true;
  }

  private restart(): void {
    this.prompt = "전투 결과는 서버가 Adventure로 반영합니다.";
    this.render();
  }

  public update(
    state: CombatState,
    events: readonly CombatEvent[],
    replaceHistory = false,
    controlledActorIds: ReadonlySet<string> = this.controlledActorIds,
  ): void {
    this.pendingFacing = null;
    this.hoverCell = null;
    this.state = state;
    this.controlledActorIds = new Set(controlledActorIds);
    this.syncPresentedActor();
    this.history = replaceHistory ? [...events] : [...this.history, ...events];
    this.refreshMoveBands();
    this.goIdle();
    const pendingOwner = state.pendingReaction?.candidates[0]?.actorId;
    this.prompt = state.pendingReaction
      ? pendingOwner !== undefined && this.controlledActorIds.has(pendingOwner)
        ? "Reaction을 사용하거나 Pass하세요."
        : `${state.actors[pendingOwner ?? ""]?.name ?? "다른 플레이어"}의 Reaction을 기다리는 중입니다.`
      : state.outcome
        ? "전투가 종료되었습니다."
        : this.activeHeroId()
          ? PROMPT_IDLE
          : `${state.actors[state.turn.activeActorId]?.name ?? "다른 플레이어"}의 턴입니다.`;
    // Chosen before the render so the action that spent the last pip is animated and
    // logged in the same pass that puts the widget on the board.
    this.offerSpentTurnDirection();
    this.render(events);
  }

  public destroy(): void {
    window.removeEventListener("keydown", this.keyHandler);
    this.ring.destroy();
    this.ui.destroy();
    this.view.destroy();
  }
}
