import {
  getStatistic,
  getWeaponProfile,
  listLegalActions,
} from "../game";
import type {
  ActionPreview,
  CombatContent,
  CombatEvent,
  CombatState,
  LegalAction,
  ScenarioDefinition,
} from "../game";

export interface BattleUiHandlers {
  readonly onAction: (action: LegalAction) => void;
  readonly onActionHover: (action: LegalAction | null) => void;
  readonly onEndTurn: () => void;
  readonly onUseReaction: () => void;
  readonly onPassReaction: () => void;
  readonly onRestart: () => void;
}

export interface BattleUiPresentation {
  readonly selectedAction: LegalAction | null;
  readonly detailAction: LegalAction | null;
  readonly preview: ActionPreview | null;
  readonly prompt: string;
  readonly stateHash: string;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element was not found: ${selector}`);
  return element;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function actionCost(action: LegalAction): string {
  return action.timing.kind === "reaction" ? "↻" : "●".repeat(action.timing.actions);
}

function percentage(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function actorName(state: CombatState, actorId: string): string {
  return state.actors[actorId]?.name ?? actorId;
}

function formatEvent(state: CombatState, event: CombatEvent): string | null {
  switch (event.type) {
    case "COMBAT_STARTED":
      return `Encounter started · seed ${event.seed}`;
    case "INITIATIVE_ROLLED":
      return `${actorName(state, event.actorId)} initiative ${event.roll} + ${event.modifier} = ${event.total}`;
    case "TURN_STARTED":
      return `Round ${event.round} · ${actorName(state, event.actorId)} turn`;
    case "TURN_ENDED":
      return `${actorName(state, event.actorId)} ended the turn.`;
    case "ACTION_SPENT":
      return `${actorName(state, event.actorId)} used ${event.actionId} (${event.remaining} actions left).`;
    case "CARD_PLAYED":
      return `${actorName(state, event.actorId)} played a tactical card.`;
    case "ACTOR_MOVED":
      return `${actorName(state, event.actorId)} moved ${event.path.length} squares by ${event.movementMode}.`;
    case "FACING_CHANGED":
      return `${actorName(state, event.actorId)} now faces ${event.facing}.`;
    case "CHECK_ROLLED":
      return `${event.label}: d20 ${event.roll} + ${event.modifier} vs DC ${event.dc} → ${event.degree}.`;
    case "DAMAGE_DEALT":
      return `${actorName(state, event.targetActorId)} took ${event.amount} ${event.damageType} damage (${event.remainingHp} HP).`;
    case "CONDITION_APPLIED":
      return `${actorName(state, event.actorId)} gained ${event.condition}.`;
    case "CONDITION_REMOVED":
      return `${actorName(state, event.actorId)} removed ${event.condition}.`;
    case "ACTION_LOCKED":
      return `${actorName(state, event.actorId)} cannot use ${event.actionId} again this turn.`;
    case "SHIELD_RAISED":
      return `${actorName(state, event.actorId)} raised a shield (AC +${event.bonus}).`;
    case "EFFECT_CREATED":
      return `${actorName(state, event.actorId)} created ${event.name}.`;
    case "EFFECT_SUSTAINED":
      return `${actorName(state, event.actorId)} sustained an effect.`;
    case "EFFECT_EXPIRED":
      return `${actorName(state, event.actorId)} let an effect expire.`;
    case "OBJECT_INTERACTED":
      return `${actorName(state, event.actorId)} operated ${event.objectId}.`;
    case "TERRAIN_CHANGED":
      return `${event.tileId} changed to ${event.traits.join(", ")}.`;
    case "CARD_DRAWN":
      return null;
    case "DISCARD_RESHUFFLED":
      return `${actorName(state, event.actorId)} reshuffled the discard pile.`;
    case "REACTION_OPENED":
      return `Reaction window opened against ${actorName(state, event.sourceActorId)}.`;
    case "REACTION_USED":
      return `${actorName(state, event.actorId)} used ${event.actionId}.`;
    case "REACTION_PASSED":
      return `${actorName(state, event.actorId)} passed the reaction.`;
    case "ACTOR_DEFEATED":
      return `${actorName(state, event.actorId)} was defeated.`;
    case "COMBAT_ENDED":
      return `Combat ended: ${event.outcome}.`;
  }
}

export class BattleUi {
  private escapeMenuOpen = false;
  private readonly app = required<HTMLElement>("#app");
  private readonly objective = required<HTMLElement>("#objective-text");
  private readonly round = required<HTMLElement>("#round-value");
  private readonly initiative = required<HTMLOListElement>("#initiative-list");
  private readonly heroHeading = required<HTMLElement>("#hero-heading");
  private readonly heroStats = required<HTMLElement>("#hero-stats");
  private readonly actionPips = required<HTMLElement>("#action-pips");
  private readonly basicActions = required<HTMLElement>("#basic-actions");
  private readonly contextActions = required<HTMLElement>("#context-actions");
  private readonly endTurn = required<HTMLButtonElement>("#end-turn");
  private readonly enemyList = required<HTMLElement>("#enemy-list");
  private readonly selectedDetail = required<HTMLElement>("#selected-detail");
  private readonly combatLog = required<HTMLOListElement>("#combat-log");
  private readonly handCount = required<HTMLElement>("#hand-count");
  private readonly deckCount = required<HTMLElement>("#deck-count");
  private readonly discardCount = required<HTMLElement>("#discard-count");
  private readonly handCards = required<HTMLElement>("#hand-cards");
  private readonly boardPrompt = required<HTMLElement>("#board-prompt");
  private readonly hashShort = required<HTMLElement>("#state-hash-short");
  private readonly reactionModal = required<HTMLElement>("#reaction-modal");
  private readonly reactionDescription = required<HTMLElement>("#reaction-description");
  private readonly resultModal = required<HTMLElement>("#result-modal");
  private readonly resultTitle = required<HTMLElement>("#result-title");
  private readonly resultDescription = required<HTMLElement>("#result-description");

  public constructor(
    private readonly content: CombatContent,
    private readonly scenario: ScenarioDefinition,
    private readonly handlers: BattleUiHandlers,
  ) {
    this.endTurn.addEventListener("click", handlers.onEndTurn);
    required<HTMLButtonElement>("#reaction-use").addEventListener("click", handlers.onUseReaction);
    required<HTMLButtonElement>("#reaction-pass").addEventListener("click", handlers.onPassReaction);
    required<HTMLButtonElement>("#restart-battle").addEventListener("click", handlers.onRestart);
  }

  public render(
    state: CombatState,
    history: readonly CombatEvent[],
    presentation: BattleUiPresentation,
  ): void {
    const hero = Object.values(state.actors).find((actor) => actor.team === "heroes");
    if (!hero) return;
    const actions = listLegalActions(state, hero.id, this.content);
    const zones = state.cardZones[hero.id];
    const activeActor = state.actors[state.turn.activeActorId];
    const ac = getStatistic(hero, this.content, "ac").value;
    const reflex = getStatistic(hero, this.content, "reflex").value;
    const weapon = getWeaponProfile(hero, this.content);

    this.app.dataset.ready = "true";
    this.app.dataset.outcome = state.outcome ?? "ongoing";
    this.app.dataset.stateHash = presentation.stateHash;
    this.objective.textContent = this.scenario.objective;
    this.round.textContent = String(state.round);
    this.heroHeading.textContent = hero.name;
    this.boardPrompt.textContent = presentation.prompt;
    this.hashShort.textContent = presentation.stateHash.slice(0, 8);
    this.hashShort.title = presentation.stateHash;

    this.renderInitiative(state);
    this.renderStats(hero.name, hero.hp, hero.maxHp, ac, reflex, hero.speedFeet, weapon.name, hero.facing, hero.conditions.map((condition) => condition.id));
    this.renderPips(state.turn.activeActorId === hero.id ? state.turn.actionsRemaining : 0);
    this.renderActionGroup(
      this.basicActions,
      actions.filter((action) => action.source.kind === "basic"),
      presentation.selectedAction,
    );
    this.renderContextActions(
      actions.filter((action) => action.source.kind === "context"),
      presentation.selectedAction,
    );
    this.renderCards(
      actions.filter((action) => action.source.kind === "card"),
      presentation.selectedAction,
    );
    this.renderEnemies(state);
    this.renderActionDetail(presentation.detailAction, presentation.preview);
    this.renderLog(state, history);

    this.handCount.textContent = String(zones?.hand.length ?? 0);
    this.deckCount.textContent = String(zones?.drawPile.length ?? 0);
    this.discardCount.textContent = String(zones?.discardPile.length ?? 0);
    this.endTurn.disabled =
      activeActor?.id !== hero.id || Boolean(state.pendingReaction) || Boolean(state.outcome);

    this.renderReaction(state);
    this.renderResult(state);
  }

  private renderInitiative(state: CombatState): void {
    this.initiative.replaceChildren();
    for (const actorId of state.turn.initiativeOrder) {
      const actor = state.actors[actorId];
      if (!actor) continue;
      const item = element("li", actor.id === state.turn.activeActorId ? "active" : undefined);
      item.dataset.actorId = actor.id;
      item.textContent = actor.name;
      if (actor.defeated) item.classList.add("defeated");
      this.initiative.append(item);
    }
  }

  private renderStats(
    name: string,
    hp: number,
    maxHp: number,
    ac: number,
    reflex: number,
    speed: number,
    weapon: string,
    facing: string,
    conditions: readonly string[],
  ): void {
    this.heroStats.replaceChildren();
    const hpRow = element("div", "hp-row");
    hpRow.append(element("span", undefined, "HP"), element("strong", undefined, `${hp}/${maxHp}`));
    const bar = element("div", "hp-bar");
    const fill = element("span", "hp-fill");
    fill.style.width = `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%`;
    bar.append(fill);
    const stats = element("dl", "stats-grid");
    for (const [label, value] of [
      ["AC", ac],
      ["Reflex DC", reflex],
      ["Speed", `${speed}ft`],
      ["Facing", facing],
    ] as const) {
      stats.append(element("dt", undefined, label), element("dd", undefined, String(value)));
    }
    const equipment = element("p", "equipment-line", `${weapon} · Shield · Boots of Fly`);
    const status = element(
      "p",
      conditions.length ? "condition-line" : "condition-line empty",
      conditions.length ? conditions.join(" · ") : `${name} has no conditions`,
    );
    this.heroStats.append(hpRow, bar, stats, equipment, status);
  }

  private renderPips(remaining: number): void {
    this.actionPips.replaceChildren();
    for (let index = 0; index < 3; index += 1) {
      const pip = element("span", index < remaining ? "action-pip available" : "action-pip spent");
      pip.setAttribute("aria-label", index < remaining ? "Action available" : "Action spent");
      this.actionPips.append(pip);
    }
  }

  private renderActionGroup(
    root: HTMLElement,
    actions: readonly LegalAction[],
    selected: LegalAction | null,
  ): void {
    root.replaceChildren();
    if (actions.length === 0) {
      root.append(element("p", "empty-message", "No action available"));
      return;
    }
    for (const action of actions) root.append(this.actionButton(action, selected, false));
  }

  private renderContextActions(
    actions: readonly LegalAction[],
    selected: LegalAction | null,
  ): void {
    this.contextActions.replaceChildren();
    const recoveryActions = actions.filter((action) => action.contextGroup === "escape");
    const directActions = actions.filter((action) => action.contextGroup !== "escape");
    if (recoveryActions.length === 0) this.escapeMenuOpen = false;

    if (recoveryActions.length > 0) {
      const wrapper = element("div", "escape-context");
      const toggle = element("button", "action-button escape-toggle") as HTMLButtonElement;
      toggle.type = "button";
      toggle.dataset.contextGroup = "escape";
      toggle.setAttribute("aria-expanded", String(this.escapeMenuOpen));
      toggle.append(
        element("strong", undefined, "Escape"),
        element("span", "action-cost", `${recoveryActions.length} option${recoveryActions.length === 1 ? "" : "s"}`),
      );
      const menu = element("div", "escape-options");
      menu.hidden = !this.escapeMenuOpen;
      for (const action of recoveryActions) menu.append(this.actionButton(action, selected, false));
      toggle.addEventListener("click", () => {
        this.escapeMenuOpen = !this.escapeMenuOpen;
        toggle.setAttribute("aria-expanded", String(this.escapeMenuOpen));
        menu.hidden = !this.escapeMenuOpen;
      });
      wrapper.append(toggle, menu);
      this.contextActions.append(wrapper);
    }

    for (const action of directActions) {
      this.contextActions.append(this.actionButton(action, selected, false));
    }
    if (actions.length === 0) {
      this.contextActions.append(element("p", "empty-message", "No action available"));
    }
  }

  private actionButton(action: LegalAction, selected: LegalAction | null, card: boolean): HTMLButtonElement {
    const button = element("button", card ? "tactical-card" : "action-button") as HTMLButtonElement;
    button.type = "button";
    button.disabled = !action.enabled;
    button.dataset.actionId = action.actionId;
    button.dataset.sourceId = action.source.id;
    button.dataset.sourceKind = action.source.kind;
    button.setAttribute("aria-pressed", String(selected?.source.id === action.source.id));
    if (selected?.source.id === action.source.id) button.classList.add("selected");
    button.title = action.reason ?? action.description;

    if (card) {
      const top = element("span", "card-top");
      top.append(element("strong", undefined, action.name), element("span", "cost-badge", actionCost(action)));
      button.append(
        top,
        element("span", "card-description", action.description),
        element("span", "card-traits", action.traits.join(" · ")),
        element("span", "card-source", `Source: ${action.sourceLabel ?? "Character"}`),
      );
    } else {
      button.append(
        element("strong", undefined, action.name),
        element("span", "action-cost", actionCost(action)),
      );
    }
    button.addEventListener("click", () => this.handlers.onAction(action));
    button.addEventListener("mouseenter", () => this.handlers.onActionHover(action));
    button.addEventListener("mouseleave", () => this.handlers.onActionHover(null));
    return button;
  }

  private renderCards(actions: readonly LegalAction[], selected: LegalAction | null): void {
    this.handCards.replaceChildren();
    for (const action of actions) this.handCards.append(this.actionButton(action, selected, true));
  }

  private renderEnemies(state: CombatState): void {
    this.enemyList.replaceChildren();
    for (const enemy of Object.values(state.actors)
      .filter((actor) => actor.team === "enemies")
      .sort((left, right) => left.id.localeCompare(right.id))) {
      const ac = getStatistic(enemy, this.content, "ac").value;
      const card = element("article", `enemy-card${enemy.defeated ? " defeated" : ""}`);
      card.dataset.actorId = enemy.id;
      const heading = element("div", "enemy-heading");
      heading.append(element("strong", undefined, enemy.name), element("span", undefined, `${enemy.hp}/${enemy.maxHp} HP`));
      card.append(
        heading,
        element("p", undefined, `AC ${ac} · Facing ${enemy.facing}`),
        element(
          "p",
          enemy.conditions.length ? "condition-line" : "condition-line empty",
          enemy.conditions.length ? enemy.conditions.map((condition) => condition.id).join(" · ") : "No conditions",
        ),
      );
      this.enemyList.append(card);
    }
  }

  public renderActionDetail(action: LegalAction | null, preview: ActionPreview | null): void {
    this.selectedDetail.replaceChildren();
    if (!action) {
      this.selectedDetail.textContent = "카드나 행동을 선택하면 규칙 근거가 표시됩니다.";
      return;
    }
    const heading = element("div", "detail-heading");
    heading.append(element("strong", undefined, action.name), element("span", "cost-badge", actionCost(action)));
    const traits = element("p", "detail-traits", action.traits.join(" · "));
    const description = element("p", undefined, action.description);
    this.selectedDetail.append(heading, description, traits);
    if (action.sourceLabel) this.selectedDetail.append(element("p", "detail-source", `Source: ${action.sourceLabel}`));
    if (action.reason) this.selectedDetail.append(element("p", "detail-warning", action.reason));
    if (preview) {
      const previewGrid = element("dl", "preview-grid");
      if (preview.hitChance !== undefined) {
        previewGrid.append(element("dt", undefined, "Hit"), element("dd", undefined, percentage(preview.hitChance)));
      }
      if (preview.criticalChance !== undefined) {
        previewGrid.append(element("dt", undefined, "Critical"), element("dd", undefined, percentage(preview.criticalChance)));
      }
      if (preview.damageRange) {
        previewGrid.append(
          element("dt", undefined, "Damage"),
          element("dd", undefined, `${preview.damageRange[0]}–${preview.damageRange[1]}`),
        );
      }
      if (preview.pathCostFeet !== undefined) {
        previewGrid.append(element("dt", undefined, "Move cost"), element("dd", undefined, `${preview.pathCostFeet}ft`));
      }
      this.selectedDetail.append(previewGrid);
      for (const note of preview.notes) this.selectedDetail.append(element("p", "preview-note", note));
    }
  }

  private renderLog(state: CombatState, history: readonly CombatEvent[]): void {
    this.combatLog.replaceChildren();
    const messages = history.flatMap((event) => {
      const message = formatEvent(state, event);
      return message ? [message] : [];
    });
    for (const message of messages.slice(-40).reverse()) this.combatLog.append(element("li", undefined, message));
  }

  private renderReaction(state: CombatState): void {
    const pending = state.pendingReaction;
    this.reactionModal.hidden = !pending;
    if (!pending) return;
    const mover = state.actors[pending.sourceActorId];
    this.reactionDescription.textContent = `${mover?.name ?? "Enemy"} is starting a Move action inside your front/side reach. Resolve Reactive Strike before movement continues.`;
  }

  private renderResult(state: CombatState): void {
    this.resultModal.hidden = !state.outcome;
    if (!state.outcome) return;
    this.resultTitle.textContent = state.outcome === "victory" ? "Victory" : "Defeat";
    this.resultDescription.textContent =
      state.outcome === "victory"
        ? "The gatehouse is secure. The same seed and command log reproduce this result."
        : "Aerin fell in the gatehouse. Replay the same seed and try a different action sequence.";
  }
}
