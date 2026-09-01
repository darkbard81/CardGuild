import {
  listLegalActions,
  resolveArmorClass,
  resolveStatisticDC,
  resolveStrike,
} from "../game";
import type {
  ActionPreview,
  ActorState,
  CombatContent,
  CombatEvent,
  CombatState,
  LegalAction,
  ResolvedStrikeProfile,
  ScenarioDefinition,
} from "../game";
import type { AssetCatalog } from "../presentation";

export interface BattleUiHandlers {
  readonly onCard: (action: LegalAction) => void;
  readonly onCardHover: (action: LegalAction | null) => void;
  readonly onEndTurn: () => void;
  readonly onUseReaction: () => void;
  readonly onPassReaction: () => void;
  readonly onRestart: () => void;
}

export interface BattleUiPresentation {
  readonly selectedAction: LegalAction | null;
  readonly prompt: string;
  readonly stateHash: string;
  readonly controlledActorId: string;
  readonly canControl: boolean;
}

const DETAIL_HINT = "보드에서 대상을 클릭하면 사용할 수 있는 행동이 링 메뉴로 열립니다.";

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

export function actionCost(action: LegalAction): string {
  return action.timing.kind === "reaction" ? "↻" : "●".repeat(action.timing.actions);
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

/** Reads the resolved Strike rather than raw weapon data, so the panel cannot drift from combat. */
function strikeLabel(strike: ResolvedStrikeProfile): string {
  const { count, sides, flatModifier } = strike.damage;
  return `${strike.weaponName} ${signed(strike.attackModifier)} · ${count}d${sides}${signed(flatModifier)}`;
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
  private readonly abortController = new AbortController();
  private readonly app = required<HTMLElement>("#app");
  private readonly objective = required<HTMLElement>("#objective-text");
  private readonly round = required<HTMLElement>("#round-value");
  private readonly initiative = required<HTMLOListElement>("#initiative-list");
  private readonly heroHeading = required<HTMLElement>("#hero-heading");
  private readonly heroStats = required<HTMLElement>("#hero-stats");
  private readonly actionPips = required<HTMLElement>("#action-pips");
  private readonly endTurn = required<HTMLButtonElement>("#end-turn");
  private readonly selectedDetail = required<HTMLElement>("#selected-detail");
  private readonly combatLog = required<HTMLOListElement>("#combat-log");
  private readonly handCount = required<HTMLElement>("#hand-count");
  private readonly deckCount = required<HTMLElement>("#deck-count");
  private readonly discardCount = required<HTMLElement>("#discard-count");
  private readonly handCards = required<HTMLElement>("#hand-cards");
  private readonly boardPrompt = required<HTMLElement>("#board-prompt");
  private readonly reactionModal = required<HTMLElement>("#reaction-modal");
  private readonly reactionDescription = required<HTMLElement>("#reaction-description");
  private readonly reactionUse = required<HTMLButtonElement>("#reaction-use");
  private readonly reactionPass = required<HTMLButtonElement>("#reaction-pass");
  private readonly resultModal = required<HTMLElement>("#result-modal");
  private readonly resultTitle = required<HTMLElement>("#result-title");
  private readonly resultDescription = required<HTMLElement>("#result-description");
  private readonly resultAction = required<HTMLButtonElement>("#restart-battle");

  public constructor(
    private readonly content: CombatContent,
    private readonly scenario: ScenarioDefinition,
    private readonly catalog: AssetCatalog,
    private readonly handlers: BattleUiHandlers,
  ) {
    this.resultAction.textContent = "Return to Adventure";
    const listenerOptions = { signal: this.abortController.signal };
    this.endTurn.addEventListener("click", handlers.onEndTurn, listenerOptions);
    this.reactionUse.addEventListener("click", handlers.onUseReaction, listenerOptions);
    this.reactionPass.addEventListener("click", handlers.onPassReaction, listenerOptions);
    required<HTMLButtonElement>("#restart-battle").addEventListener("click", handlers.onRestart, listenerOptions);
  }

  public destroy(): void {
    this.abortController.abort();
    this.reactionModal.hidden = true;
    this.resultModal.hidden = true;
  }

  public render(
    state: CombatState,
    history: readonly CombatEvent[],
    presentation: BattleUiPresentation,
  ): void {
    const hero = state.actors[presentation.controlledActorId];
    if (!hero) return;
    const actions = listLegalActions(state, hero.id, this.content);
    const zones = state.cardZones[hero.id];
    const activeActor = state.actors[state.turn.activeActorId];

    this.app.dataset.ready = "true";
    this.app.dataset.outcome = state.outcome ?? "ongoing";
    this.app.dataset.stateHash = presentation.stateHash;
    this.app.dataset.controlledActorId = presentation.controlledActorId;
    this.objective.textContent = this.scenario.objective.description;
    this.round.textContent = String(state.round);
    this.heroHeading.textContent = hero.name;
    this.boardPrompt.textContent = presentation.prompt;

    this.renderInitiative(state);
    this.renderStats(hero);
    this.renderPips(presentation.canControl ? state.turn.actionsRemaining : 0);
    this.renderCards(
      actions.filter((action) => action.source.kind === "card"),
      presentation.selectedAction,
      state,
      hero.id,
    );
    this.renderLog(state, history);

    this.handCount.textContent = String(zones?.hand.length ?? 0);
    this.deckCount.textContent = String(zones?.drawPile.length ?? 0);
    this.discardCount.textContent = String(zones?.discardPile.length ?? 0);
    this.endTurn.disabled = !presentation.canControl ||
      activeActor?.id !== hero.id || Boolean(state.pendingReaction) || Boolean(state.outcome);

    this.renderReaction(state, presentation.controlledActorId);
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

  private renderStats(hero: ActorState): void {
    this.heroStats.replaceChildren();
    this.heroStats.append(...this.statBlock(hero, [
      ["AC", resolveArmorClass(hero, { content: this.content }).value],
      ["Reflex DC", resolveStatisticDC(hero, { kind: "save", id: "reflex" }, { content: this.content }).value],
      ["Speed", `${hero.speedFeet}ft`],
      ["Facing", hero.facing],
      ["Strike", strikeLabel(resolveStrike(hero, { content: this.content }))],
    ]));
  }

  private statBlock(
    actor: ActorState,
    rows: readonly (readonly [string, string | number])[],
  ): readonly HTMLElement[] {
    const hpRow = element("div", "hp-row");
    hpRow.append(element("span", undefined, "HP"), element("strong", undefined, `${actor.hp}/${actor.maxHp}`));
    const bar = element("div", "hp-bar");
    const fill = element("span", "hp-fill");
    fill.style.width = `${Math.max(0, Math.min(100, (actor.hp / actor.maxHp) * 100))}%`;
    bar.append(fill);
    const stats = element("dl", "stats-grid");
    for (const [label, value] of rows) {
      stats.append(element("dt", undefined, label), element("dd", undefined, String(value)));
    }
    const conditions = actor.conditions.map((condition) => condition.id);
    const status = element(
      "p",
      conditions.length ? "condition-line" : "condition-line empty",
      conditions.length ? conditions.join(" · ") : "No conditions",
    );
    return [hpRow, bar, stats, status];
  }

  private renderPips(remaining: number): void {
    this.actionPips.replaceChildren();
    for (let index = 0; index < 3; index += 1) {
      const pip = element("span", index < remaining ? "action-pip available" : "action-pip spent");
      pip.setAttribute("aria-label", index < remaining ? "Action available" : "Action spent");
      this.actionPips.append(pip);
    }
  }

  private renderCards(
    actions: readonly LegalAction[],
    selected: LegalAction | null,
    state: CombatState,
    actorId: string,
  ): void {
    this.handCards.replaceChildren();
    if (actions.length === 0) {
      this.handCards.append(element("p", "empty-message", "손패가 비었습니다."));
      return;
    }
    for (const action of actions) {
      const card = action.source.kind === "card"
        ? state.cardZones[actorId]?.hand.find((candidate) => candidate.id === action.source.id)
        : undefined;
      this.handCards.append(this.cardButton(action, selected, card));
    }
  }

  private cardButton(
    action: LegalAction,
    selected: LegalAction | null,
    card: CombatState["cardZones"][string]["hand"][number] | undefined,
  ): HTMLButtonElement {
    const button = element("button", "tactical-card");
    button.type = "button";
    button.disabled = !action.enabled;
    button.dataset.actionId = action.actionId;
    button.dataset.sourceId = action.source.id;
    button.dataset.sourceKind = action.source.kind;
    if (card) {
      button.dataset.cardDefinitionId = card.definitionId;
      button.dataset.cardSourceKind = card.source.kind;
    }
    button.setAttribute("aria-pressed", String(selected?.source.id === action.source.id));
    if (selected?.source.id === action.source.id) button.classList.add("selected");
    button.title = action.reason ?? action.description;

    const top = element("span", "card-top");
    top.append(element("strong", undefined, action.name), element("span", "cost-badge", actionCost(action)));
    const visual = card ? this.catalog.cardVisual(card.definitionId) : null;
    const icon = element("span", visual ? "tactical-card-icon" : "tactical-card-icon missing");
    icon.setAttribute("aria-hidden", "true");
    if (visual) Object.assign(icon.style, this.catalog.domAtlasStyle(visual, 32));
    button.append(
      top,
      icon,
      element("span", "card-description", action.description),
      element("span", "card-source", action.sourceLabel ?? "Character"),
    );
    button.addEventListener("click", () => this.handlers.onCard(action));
    button.addEventListener("mouseenter", () => this.handlers.onCardHover(action));
    button.addEventListener("mouseleave", () => this.handlers.onCardHover(null));
    return button;
  }

  public renderActionDetail(action: LegalAction | null, preview: ActionPreview | null): void {
    this.selectedDetail.replaceChildren();
    if (!action) {
      this.selectedDetail.append(element("p", "detail-hint", DETAIL_HINT));
      return;
    }
    const heading = element("div", "detail-heading");
    heading.append(element("strong", undefined, action.name), element("span", "cost-badge", actionCost(action)));
    this.selectedDetail.append(
      heading,
      element("p", undefined, action.description),
      element("p", "detail-traits", action.traits.join(" · ")),
    );
    if (action.sourceLabel) this.selectedDetail.append(element("p", "detail-source", `Source: ${action.sourceLabel}`));
    if (action.reason) this.selectedDetail.append(element("p", "detail-warning", action.reason));
    if (!preview) return;
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

  /** Inspector view for an actor the pointer is hovering on the board. */
  public renderActorDetail(actor: ActorState): void {
    this.selectedDetail.replaceChildren();
    const heading = element("div", "detail-heading");
    heading.append(
      element("strong", undefined, actor.name),
      element("span", "cost-badge", actor.team === "heroes" ? "Ally" : "Enemy"),
    );
    this.selectedDetail.append(heading, ...this.statBlock(actor, [
      ["AC", resolveArmorClass(actor, { content: this.content }).value],
      ["Speed", `${actor.speedFeet}ft`],
      ["Facing", actor.facing],
    ]));
    if (actor.defeated) this.selectedDetail.append(element("p", "detail-warning", "Defeated"));
  }

  private renderLog(state: CombatState, history: readonly CombatEvent[]): void {
    this.combatLog.replaceChildren();
    const messages = history.flatMap((event) => {
      const message = formatEvent(state, event);
      return message ? [message] : [];
    });
    for (const message of messages.slice(-40).reverse()) this.combatLog.append(element("li", undefined, message));
  }

  private renderReaction(state: CombatState, controlledActorId: string): void {
    const pending = state.pendingReaction;
    this.reactionModal.hidden = !pending;
    if (!pending) return;
    const mover = state.actors[pending.sourceActorId];
    const owner = pending.candidates[0]?.actorId;
    const actionable = owner === controlledActorId;
    this.reactionUse.disabled = !actionable;
    this.reactionPass.disabled = !actionable;
    this.reactionDescription.textContent = actionable
      ? `${mover?.name ?? "Enemy"} is starting a Move action inside your front/side reach. Resolve Reactive Strike before movement continues.`
      : `Waiting for ${actorName(state, owner ?? "another player")} to resolve the head Reaction candidate.`;
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
