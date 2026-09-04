import {
  SAVE_IDS,
  equippedArmor,
  listLegalActions,
  resolveArmorClass,
  resolveClassDC,
  resolveInitiative,
  resolveStatisticDC,
  resolveStatisticModifier,
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
  SaveId,
  ScenarioDefinition,
} from "../game";
import { buildCombatLog, type CombatLogEntry } from "./combat-log";
import type { AssetCatalog } from "../presentation";
import type { MoveBand } from "../pixi/BattleView";

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
  /** Which move bands the board is showing, so the legend can name their colours. */
  readonly moveBands: readonly MoveBand[];
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

/** Rule terms, so they match the action names in the ring menu and the hand. */
const MOVE_BAND_LABELS: Readonly<Record<MoveBand, string>> = {
  step: "Step",
  stride: "Stride",
  fly: "Fly",
};

/**
 * Portrait window sizes in pixels. The crop itself comes from the measured ink box in the
 * asset manifest, so it lands on the drawing whatever shape the creature is.
 */
const HERO_PORTRAIT_SIZE = 50;

/** Past this a name needs the smaller type to stay on one line beside its cost. */
const LONG_CARD_NAME = 12;

/** Long enough not to fire on a tap that means "pick this card". */
const LONG_PRESS_MS = 380;
const INITIATIVE_PORTRAIT_SIZE = 34;

/** The grid has room for three columns, the sheet has room for the whole word. */
const SAVE_LABELS: Readonly<Record<SaveId, string>> = {
  fortitude: "Fort",
  reflex: "Ref",
  will: "Will",
};

const SAVE_SHEET_LABELS: Readonly<Record<SaveId, string>> = {
  fortitude: "Fortitude DC",
  reflex: "Reflex DC",
  will: "Will DC",
};

function hpBlock(actor: ActorState): readonly HTMLElement[] {
  const hpRow = element("div", "hp-row");
  hpRow.append(element("span", undefined, "HP"), element("strong", undefined, `${actor.hp}/${actor.maxHp}`));
  const bar = element("div", "hp-bar");
  const fill = element("span", "hp-fill");
  fill.style.width = `${Math.max(0, Math.min(100, (actor.hp / actor.maxHp) * 100))}%`;
  bar.append(fill);
  return [hpRow, bar];
}

/** Two or three labelled numbers on one line, for the values read at a glance. */
function statPair(entries: readonly (readonly [string, string])[]): HTMLElement {
  const row = element("div", "stat-pair");
  for (const [label, value] of entries) {
    const cell = element("div", "stat-cell");
    cell.append(element("span", "stat-label", label), element("strong", undefined, value));
    row.append(cell);
  }
  return row;
}

function conditionLine(actor: ActorState): HTMLElement {
  const conditions = actor.conditions.map((condition) => condition.id);
  return element(
    "p",
    conditions.length ? "condition-line" : "condition-line empty",
    conditions.length ? conditions.join(" · ") : "상태 이상 없음",
  );
}

function percentage(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function actorName(state: CombatState, actorId: string): string {
  return state.actors[actorId]?.name ?? actorId;
}

export class BattleUi {
  private readonly abortController = new AbortController();
  private readonly app = required<HTMLElement>("#app");
  private readonly objective = required<HTMLElement>("#objective-text");
  private readonly round = required<HTMLElement>("#round-value");
  private readonly initiative = required<HTMLOListElement>("#initiative-list");
  private readonly heroHeading = required<HTMLElement>("#hero-heading");
  private readonly heroStats = required<HTMLElement>("#hero-stats");
  private readonly heroPortrait = required<HTMLElement>("#hero-portrait");
  private readonly heroDetails = required<HTMLElement>("#hero-details");
  private readonly heroDetailsToggle = required<HTMLButtonElement>("#hero-details-toggle");
  private readonly actionPips = required<HTMLElement>("#action-pips");
  private readonly endTurn = required<HTMLButtonElement>("#end-turn");
  private readonly selectedDetail = required<HTMLElement>("#selected-detail");
  private readonly combatLog = required<HTMLOListElement>("#combat-log");
  private readonly handCount = required<HTMLElement>("#hand-count");
  private readonly deckCount = required<HTMLElement>("#deck-count");
  private readonly discardCount = required<HTMLElement>("#discard-count");
  private readonly handCards = required<HTMLElement>("#hand-cards");
  private readonly boardPrompt = required<HTMLElement>("#board-prompt");
  private readonly moveLegend = required<HTMLElement>("#move-legend");
  private readonly cardDetail = required<HTMLElement>("#card-detail");
  /** The last history array rendered, so an unrelated re-render leaves the log alone. */
  private lastHistory: readonly CombatEvent[] | null = null;
  private longPressTimer: number | null = null;
  private longPressFired = false;
  private readonly reactionModal = required<HTMLElement>("#reaction-modal");
  private readonly reactionDescription = required<HTMLElement>("#reaction-description");
  private readonly reactionUse = required<HTMLButtonElement>("#reaction-use");
  private readonly reactionPass = required<HTMLButtonElement>("#reaction-pass");
  private readonly resultModal = required<HTMLElement>("#result-modal");
  private readonly resultTitle = required<HTMLElement>("#result-title");
  private readonly resultDescription = required<HTMLElement>("#result-description");
  private readonly resultAction = required<HTMLButtonElement>("#restart-battle");

  /** The character sheet stays where the player left it across snapshots. */
  private heroDetailsOpen = false;
  private portraitDefinitionId: string | null = null;

  public constructor(
    private readonly content: CombatContent,
    private readonly scenario: ScenarioDefinition,
    private readonly catalog: AssetCatalog,
    private readonly handlers: BattleUiHandlers,
  ) {
    this.resultAction.textContent = "Return to Adventure";
    const listenerOptions = { signal: this.abortController.signal };
    // Anything that is not the card being pressed puts its detail away again.
    document.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Node) || !this.handCards.contains(event.target)) this.hideCardDetail();
    }, listenerOptions);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.hideCardDetail();
    }, listenerOptions);
    this.heroDetailsToggle.addEventListener("click", () => {
      this.heroDetailsOpen = !this.heroDetailsOpen;
      this.applyHeroDetailsState();
    }, listenerOptions);
    this.endTurn.addEventListener("click", handlers.onEndTurn, listenerOptions);
    this.reactionUse.addEventListener("click", handlers.onUseReaction, listenerOptions);
    this.reactionPass.addEventListener("click", handlers.onPassReaction, listenerOptions);
    required<HTMLButtonElement>("#restart-battle").addEventListener("click", handlers.onRestart, listenerOptions);
  }

  public destroy(): void {
    this.hideCardDetail();
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
    this.renderMoveLegend(presentation.moveBands);

    this.renderInitiative(state);
    this.renderHeroCard(hero);
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

  /**
   * Faces, not names: the order is read at a glance mid-turn, and the same standee is
   * what the player is looking at on the board. The name rides along for screen readers
   * and as the tooltip, so nothing that needs the text loses it.
   */
  private renderInitiative(state: CombatState): void {
    this.initiative.replaceChildren();
    for (const actorId of state.turn.initiativeOrder) {
      const actor = state.actors[actorId];
      if (!actor) continue;
      const item = element("li", "initiative-chip");
      if (actor.id === state.turn.activeActorId) item.classList.add("active");
      if (actor.defeated) item.classList.add("defeated");
      item.dataset.actorId = actor.id;
      item.dataset.team = actor.team;
      item.title = actor.name;
      const portrait = element("span", "initiative-portrait");
      portrait.setAttribute("aria-hidden", "true");
      this.paintPortrait(portrait, actor, INITIATIVE_PORTRAIT_SIZE);
      item.append(portrait, element("span", "sr-only", actor.name));
      this.initiative.append(item);
    }
  }

  /**
   * The card answers "can I act, and am I in trouble" at a glance: portrait, HP,
   * the two numbers every attack is read against, and the three saves. Everything
   * a player only consults deliberately lives behind the toggle instead.
   */
  private renderHeroCard(hero: ActorState): void {
    this.renderPortrait(hero);
    const context = { content: this.content };
    const savesRow = element("div", "save-grid");
    for (const id of SAVE_IDS) {
      const cell = element("div", "save-cell");
      cell.dataset.saveId = id;
      cell.append(
        element("span", "stat-label", SAVE_LABELS[id]),
        element("strong", undefined, signed(resolveStatisticModifier(hero, { kind: "save", id }, context).value)),
      );
      savesRow.append(cell);
    }
    this.heroStats.replaceChildren(
      ...hpBlock(hero),
      statPair([
        ["AC", String(resolveArmorClass(hero, context).value)],
        ["Speed", `${hero.speedFeet}ft`],
      ]),
      savesRow,
      conditionLine(hero),
    );
    this.renderHeroDetails(hero);
    this.applyHeroDetailsState();
  }

  /** A bust crop of the same standee the board draws, so a panel can name a face. */
  private paintPortrait(window: HTMLElement, actor: ActorState, size: number): void {
    window.replaceChildren();
    const visual = this.catalog.manifest.actorVisuals[actor.definitionId];
    if (!visual) {
      window.classList.add("missing");
      window.textContent = actor.name.slice(0, 1);
      return;
    }
    window.classList.remove("missing");
    Object.assign(window.style, this.catalog.domPortraitStyle(visual.front, size));
  }

  private renderPortrait(hero: ActorState): void {
    if (this.portraitDefinitionId === hero.definitionId) return;
    this.portraitDefinitionId = hero.definitionId;
    this.paintPortrait(this.heroPortrait, hero, HERO_PORTRAIT_SIZE);
  }

  private renderHeroDetails(hero: ActorState): void {
    const context = { content: this.content };
    const strike = resolveStrike(hero, context);
    const armor = equippedArmor(hero, context);
    const sheet = element("dl", "stats-grid");
    const rows: readonly (readonly [string, string])[] = [
      ["Perception", signed(resolveStatisticModifier(hero, { kind: "perception" }, context).value)],
      ["Initiative", signed(resolveInitiative(hero, context).value)],
      ["Class DC", String(resolveClassDC(hero, context).value)],
      ...SAVE_IDS.map((id) => [
        SAVE_SHEET_LABELS[id],
        String(resolveStatisticDC(hero, { kind: "save", id }, context).value),
      ] as const),
      ["Facing", hero.facing],
      ["Strike", strikeLabel(strike)],
      ["Damage", `${strike.damage.damageType}`],
      ["Reach", `${strike.rangeFeet}ft`],
      ["Traits", strike.traits.length ? strike.traits.join(" · ") : "—"],
      ["Armor", armor?.name ?? "Unarmored"],
    ];
    for (const [label, value] of rows) {
      sheet.append(element("dt", undefined, label), element("dd", undefined, value));
    }
    this.heroDetails.replaceChildren(sheet);
  }

  private applyHeroDetailsState(): void {
    this.heroDetails.hidden = !this.heroDetailsOpen;
    this.heroDetailsToggle.setAttribute("aria-expanded", String(this.heroDetailsOpen));
    this.heroDetailsToggle.textContent = this.heroDetailsOpen ? "닫기" : "상세";
  }

  private statBlock(
    actor: ActorState,
    rows: readonly (readonly [string, string | number])[],
  ): readonly HTMLElement[] {
    const stats = element("dl", "stats-grid");
    for (const [label, value] of rows) {
      stats.append(element("dt", undefined, label), element("dd", undefined, String(value)));
    }
    return [...hpBlock(actor), stats, conditionLine(actor)];
  }

  /** Colour alone does not say what a band means, so it is named while it is on screen. */
  private renderMoveLegend(bands: readonly MoveBand[]): void {
    this.moveLegend.hidden = bands.length === 0;
    this.moveLegend.replaceChildren(...bands.map((band) => {
      const item = element("span", "move-legend-item");
      const dot = element("span", "move-legend-dot");
      dot.dataset.band = band;
      item.append(dot, element("span", undefined, MOVE_BAND_LABELS[band]));
      return item;
    }));
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
    this.hideCardDetail();
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

    const title = element("span", action.name.length > LONG_CARD_NAME ? "card-title long" : "card-title");
    title.append(element("strong", undefined, action.name), element("span", "cost-badge", actionCost(action)));
    const visual = card ? this.catalog.cardVisual(card.definitionId) : null;
    const art = element("span", visual ? "card-art" : "card-art missing");
    art.setAttribute("aria-hidden", "true");
    if (visual) {
      const image = element("span", "card-art-image");
      // Percentage-placed, so the picture takes whatever room the frame has.
      Object.assign(image.style, this.catalog.domAtlasFillStyle(visual));
      art.append(image);
    } else {
      art.textContent = action.name.slice(0, 1);
    }
    button.append(title, art);
    button.addEventListener("click", () => {
      // The press that opened the detail is not the press that plays the card.
      if (this.longPressFired) {
        this.longPressFired = false;
        return;
      }
      this.handlers.onCard(action);
    });
    button.addEventListener("pointerdown", () => this.startLongPress(button, action, card));
    for (const type of ["pointerup", "pointerleave", "pointercancel"] as const) {
      button.addEventListener(type, () => this.cancelLongPress());
    }
    button.addEventListener("mouseenter", () => this.handlers.onCardHover(action));
    button.addEventListener("mouseleave", () => this.handlers.onCardHover(null));
    return button;
  }

  /**
   * The card face carries a name, a cost and a picture — enough to pick from. The words
   * behind it are a press away, which is what a finger has instead of a hover.
   */
  private startLongPress(
    button: HTMLElement,
    action: LegalAction,
    card: CombatState["cardZones"][string]["hand"][number] | undefined,
  ): void {
    this.cancelLongPress();
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      this.longPressFired = true;
      this.showCardDetail(button, action, card);
    }, LONG_PRESS_MS);
  }

  private cancelLongPress(): void {
    if (this.longPressTimer === null) return;
    window.clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private showCardDetail(
    button: HTMLElement,
    action: LegalAction,
    card: CombatState["cardZones"][string]["hand"][number] | undefined,
  ): void {
    const heading = element("div", "detail-heading");
    heading.append(element("strong", undefined, action.name), element("span", "cost-badge", actionCost(action)));
    this.cardDetail.replaceChildren(
      heading,
      element("p", undefined, action.description),
      element("p", "detail-traits", action.traits.join(" · ")),
      element("p", "detail-source", `Source: ${action.sourceLabel ?? card?.source.kind ?? "Character"}`),
    );
    if (action.reason) this.cardDetail.append(element("p", "detail-warning", action.reason));
    this.cardDetail.hidden = false;
    const stage = button.closest(".combat-stage")?.getBoundingClientRect();
    const anchor = button.getBoundingClientRect();
    if (!stage) return;
    // Above the card it belongs to, kept inside the stage on both sides.
    const half = this.cardDetail.offsetWidth / 2;
    const centre = anchor.left + anchor.width / 2 - stage.left;
    this.cardDetail.style.left = `${Math.min(Math.max(centre, half + 8), stage.width - half - 8)}px`;
    this.cardDetail.style.bottom = `${stage.bottom - anchor.top + 10}px`;
  }

  public hideCardDetail(): void {
    this.cancelLongPress();
    this.cardDetail.hidden = true;
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

  /**
   * One line per action — what was used and what it did — with the arithmetic folded
   * away. A turn used to cost the player ten flat lines to read.
   */
  private renderLog(state: CombatState, history: readonly CombatEvent[]): void {
    // The controller hands over the same array until new events arrive, so an unrelated
    // re-render (a card picked, a ring dismissed) must not rebuild and re-announce it.
    if (history === this.lastHistory) return;
    this.lastHistory = history;
    this.combatLog.replaceChildren();
    const entries = buildCombatLog(history, (actorId) => actorName(state, actorId), this.content);
    for (const entry of entries.slice(-40).reverse()) this.combatLog.append(this.logEntry(entry));
  }

  private logEntry(entry: CombatLogEntry): HTMLElement {
    const item = element("li", "log-entry");
    if (entry.details.length === 0) {
      item.append(element("p", "log-line", entry.summary));
      return item;
    }
    const line = element("button", "log-line log-line-expandable", entry.summary);
    line.type = "button";
    line.setAttribute("aria-expanded", "false");
    const detail = element("ul", "log-detail");
    for (const message of entry.details) detail.append(element("li", undefined, message));
    // Hover opens it on a mouse (CSS); a tap is the only way in on a tablet.
    line.addEventListener("click", () => {
      const open = item.classList.toggle("open");
      line.setAttribute("aria-expanded", String(open));
    });
    item.append(line, detail);
    return item;
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
