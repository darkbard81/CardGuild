import { CombatActorSummary } from "./combat-actor-summary";
import { canInspectActor } from "../game/knowledge";
import { formatActionCost } from "./card-face";
import { requirementText } from "./card-level-view";
import { listLegalActions, listLegalTargets, resolveStrike } from "../game";
import { CharacterDetailPanel } from "./character-detail-ui";
import { CombatHandUi } from "./combat-hand-ui";
import type { LoadoutPartyMember } from "../loadout";
import type {
  ActionPreview,
  ActorState,
  CombatContent,
  CombatEvent,
  CombatState,
  LegalAction,
  ScenarioDefinition,
} from "../game";
import { buildCombatLog, type CombatLogEntry } from "./combat-log";
import { TraitView, type TraitChipList } from "./trait-view";
import type { AssetCatalog } from "../presentation";
import type { MoveBand } from "../pixi/BattleView";

export interface BattleUiHandlers {
  readonly onCard: (action: LegalAction) => void;
  readonly onCardHover: (action: LegalAction | null) => void;
  readonly onEndTurn: () => void;
  readonly onUseReaction: () => void;
  readonly onPassReaction: () => void;
  readonly onEscape?: () => boolean;
}

export interface BattleUiPresentation {
  readonly selectedAction: LegalAction | null;
  /** Which move bands the board is showing, so the legend can name their colours. */
  readonly moveBands: readonly MoveBand[];
  readonly prompt: string;
  readonly controlledActorId: string;
  readonly canControl: boolean;
  readonly interactionActive?: boolean;
  readonly status?: string;
  readonly members?: readonly LoadoutPartyMember[];
  readonly inputBlocked?: boolean;
  readonly ownsReaction?: boolean;
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
  return formatActionCost(action.timing);
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

const INITIATIVE_PORTRAIT_SIZE = 34;

function percentage(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function actorName(state: CombatState, actorId: string): string {
  return state.actors[actorId]?.name ?? actorId;
}

export class BattleUi {
  private endConfirmation: HTMLDialogElement | null = null;
  private readonly abortController = new AbortController();
  private readonly objective = required<HTMLElement>("#objective-text");
  private readonly round = required<HTMLElement>("#round-value");
  private readonly initiative = required<HTMLOListElement>("#initiative-list");
  private readonly heroHeading = required<HTMLElement>("#hero-heading");
  private readonly status = required<HTMLElement>("#combat-status");
  private readonly inspectSelect = element("select") as HTMLSelectElement;
  private detailDialog: HTMLDialogElement | null = null;
  private readonly inspectActive = required<HTMLButtonElement>("#inspect-active");
  private readonly sheet: CharacterDetailPanel;
  private readonly actorSummary: CombatActorSummary;
  private readonly hand: CombatHandUi;
  private state: CombatState | null = null;
  private members: readonly LoadoutPartyMember[] = [];
  private inspectedActorId: string | null = null;
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
  private readonly reactionModal = required<HTMLElement>("#reaction-modal");
  private readonly reactionDescription = required<HTMLElement>("#reaction-description");
  private readonly reactionUse = required<HTMLButtonElement>("#reaction-use");
  private readonly reactionPass = required<HTMLButtonElement>("#reaction-pass");
  private readonly resultModal = required<HTMLElement>("#result-modal");
  private readonly resultTitle = required<HTMLElement>("#result-title");
  private readonly resultDescription = required<HTMLElement>("#result-description");

  /** The character sheet stays where the player left it across snapshots. */
  /** One registry view for every Trait the battle shows, and one chip list per surface. */
  private readonly traits: TraitView;
  private readonly actionTraits: TraitChipList;
  private readonly cardTraits: TraitChipList;

  public constructor(
    private readonly content: CombatContent,
    private readonly scenario: ScenarioDefinition,
    private readonly catalog: AssetCatalog,
    handlers: BattleUiHandlers,
  ) {
    required<HTMLElement>(".log-panel").removeAttribute("open");
    this.traits = new TraitView(content.traits);
    this.actionTraits = this.traits.createList();
    this.cardTraits = this.traits.createList();
    this.sheet = new CharacterDetailPanel(content, catalog, "combat", "dialog");
    this.actorSummary = new CombatActorSummary(content);
    this.inspectActive.before(this.actorSummary.root);
    this.inspectSelect.setAttribute("aria-label", "상세 대상");
    this.hand = new CombatHandUi(this.handCards, catalog, {
      onCard: handlers.onCard, onHover: handlers.onCardHover,
      onDetail: (button, action, card) => this.showCardDetail(button, action, card),
      onHideDetail: () => this.hideCardDetail(false), detailOpen: () => !this.cardDetail.hidden,
    });
    this.inspectSelect.addEventListener("change", () => { this.inspectedActorId = this.inspectSelect.value; this.renderInspector(); }, { signal: this.abortController.signal });
    this.inspectActive.addEventListener("click", () => { this.openActorDetail(this.state?.turn.activeActorId); }, { signal: this.abortController.signal });
    const listenerOptions = { signal: this.abortController.signal };
    // Anything that is not the card being pressed, or the detail it opened, puts the
    // detail away again; a Trait chip inside the detail is part of it.
    document.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (!(target instanceof Node) || (!this.handCards.contains(target) && !this.cardDetail.contains(target))) this.hideCardDetail();
    }, listenerOptions);
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape" || event.defaultPrevented || this.endConfirmation?.open || this.detailDialog?.open) return;
      if (!this.cardDetail.hidden) { this.hideCardDetail(); event.preventDefault(); event.stopPropagation(); return; }
      if (handlers.onEscape?.()) { event.preventDefault(); event.stopPropagation(); return; }
      this.hand.collapse();
    }, listenerOptions);
    this.endTurn.addEventListener("click", handlers.onEndTurn, listenerOptions);
    this.reactionUse.addEventListener("click", handlers.onUseReaction, listenerOptions);
    this.reactionPass.addEventListener("click", handlers.onPassReaction, listenerOptions);
  }

  public confirmEndTurn(actions: number, proceed: () => void): void {
    this.endConfirmation?.remove();
    const dialog = element("dialog", "ui-panel ui-panel--dialog ui-end-turn-confirm");
    dialog.setAttribute("aria-label", "남은 행동 포기 확인");
    dialog.append(element("h2", undefined, `아직 ${actions} Actions가 남아 있습니다.`), element("p", undefined, "지금 턴을 종료할까요?"));
    const cancel = element("button", "ui-button ui-button--secondary", "계속 행동");
    const confirm = element("button", "ui-button ui-button--primary", "턴 종료");
    cancel.type = confirm.type = "button";
    cancel.addEventListener("click", () => dialog.close());
    confirm.addEventListener("click", () => { dialog.close(); proceed(); });
    dialog.addEventListener("close", () => { dialog.remove(); if (this.endConfirmation === dialog) this.endConfirmation = null; });
    dialog.append(cancel, confirm); document.body.append(dialog); this.endConfirmation = dialog;
    dialog.showModal(); cancel.focus();
  }

  public destroy(): void {
    this.endConfirmation?.remove();
    this.hand.destroy();
    this.closeActorDetail();
    this.sheet.destroy();
    this.actorSummary.destroy();
    this.hideCardDetail();
    this.traits.destroy();
    this.abortController.abort();
    this.reactionModal.hidden = true;
    this.resultModal.hidden = true;
  }

  public render(
    state: CombatState,
    history: readonly CombatEvent[],
    presentation: BattleUiPresentation,
  ): void {
    if (this.endConfirmation && (this.state !== state || !presentation.canControl || state.pendingReaction || state.outcome)) this.endConfirmation.close();
    const hero = state.actors[presentation.controlledActorId];
    if (!hero) return;
    const actions = listLegalActions(state, hero.id, this.content);
    const zones = state.cardZones[hero.id];
    const activeActor = state.actors[state.turn.activeActorId];

    this.objective.textContent = this.scenario.objective.description;
    this.round.textContent = String(state.round);
    this.state = state;
    this.members = presentation.members ?? [];
    this.heroHeading.textContent = activeActor?.name ?? hero.name;
    this.actorSummary.update(activeActor && canInspectActor(state, activeActor.id) ? activeActor : null);
    this.status.textContent = presentation.status ?? (presentation.canControl ? "내 턴" : "다른 행동자 대기 중");
    if (state.outcome || (state.pendingReaction && presentation.ownsReaction)) this.closeActorDetail();
    this.renderInspector();
    this.boardPrompt.textContent = presentation.prompt;
    this.renderMoveLegend(presentation.moveBands);

    this.renderInitiative(state);
    this.renderPips(state.turn.actionsRemaining);
    this.hand.update(
      actions.filter((action) => action.source.kind === "card"),
      presentation.selectedAction,
      zones?.hand ?? [],
      presentation.canControl,
      new Set(actions.filter(action => {
        const targets = listLegalTargets(state, hero.id, action.source, this.content);
        return targets.length === 1 && (targets[0]?.kind === "none" || targets[0]?.kind === "effect");
      }).map(action => action.source.id)),
    );
    const historyChanged = history !== this.lastHistory;
    this.renderLog(state, history);
    const knowledgeResult = history.at(-1);
    if (historyChanged && knowledgeResult?.type === "KNOWLEDGE_RECALLED") this.status.textContent = knowledgeResult.success ? "Recall Knowledge 성공 · 적 상세 해금" : "Recall Knowledge 실패 · 같은 대상 재시도 불가";

    required<HTMLElement>("#hand-owner").textContent = `${hero.name}의 손패`;
    this.handCount.textContent = String(zones?.hand.length ?? 0);
    this.deckCount.textContent = String(zones?.drawPile.length ?? 0);
    this.discardCount.textContent = String(zones?.discardPile.length ?? 0);
    this.endTurn.disabled = !presentation.canControl ||
      activeActor?.id !== hero.id || Boolean(state.pendingReaction) || Boolean(state.outcome);

    this.renderReaction(state, presentation.ownsReaction ?? false, presentation.inputBlocked ?? false, presentation.status);
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
      const button = element("button", "ui-button ui-button--initiative"); button.type = "button";
      button.setAttribute("aria-label", `${actor.name} 상세`);
      if (!canInspectActor(state, actor.id)) button.setAttribute("aria-label", `${actor.name} 상세 잠김 · Recall Knowledge 필요`);
      button.append(portrait, element("span", "sr-only", actor.name));
      button.addEventListener("click", () => { this.openActorDetail(actor.id); });
      item.append(button);
      this.initiative.append(item);
    }
  }

  public closeActorDetail(): void { this.sheet.dismissDetails(); this.detailDialog?.close(); }

  public openActorDetail(actorId?: string): void {
    if (!actorId || !this.state?.actors[actorId]) return;
    if (!canInspectActor(this.state, actorId)) {
      this.boardPrompt.textContent = "적 상세는 Recall Knowledge 성공 후 열람할 수 있습니다.";
      return;
    }
    this.inspectedActorId = actorId;
    if (this.detailDialog?.open) { this.renderInspector(); return; }
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = element("dialog", "ui-panel ui-panel--dialog ui-character-detail-dialog ui-character-detail-dialog--fullscreen");
    dialog.setAttribute("aria-label", "캐릭터 상세");
    const close = element("button", "ui-button ui-button--secondary", "닫기"); close.type = "button";
    close.addEventListener("click", () => dialog.close());
    const header = element("header", "ui-character-detail-dialog__header"); header.append(this.inspectSelect, close);
    dialog.append(header, this.sheet.root);
    dialog.addEventListener("close", () => {
      this.sheet.dismissDetails();
      if (this.detailDialog === dialog) this.detailDialog = null;
      dialog.remove(); (opener?.isConnected ? opener : this.inspectActive).focus();
    }, { once: true });
    this.detailDialog = dialog; this.renderInspector(); document.body.append(dialog); dialog.showModal(); close.focus();
  }

  private renderInspector(): void {
    if (!this.state || !this.detailDialog) return;
    if (this.inspectedActorId && !this.state.actors[this.inspectedActorId]) { this.closeActorDetail(); return; }
    const actor = this.state.actors[this.inspectedActorId ?? this.state.turn.activeActorId];
    if (!actor || !canInspectActor(this.state, actor.id)) { this.closeActorDetail(); return; }
    const actors = Object.values(this.state.actors).filter(actor => canInspectActor(this.state!, actor.id));
    const signature = actors.map(actor => actor.id + actor.name).join();
    if (this.inspectSelect.dataset.actors !== signature) {
      this.inspectSelect.replaceChildren(...actors.map(actor => { const option = element("option", undefined, actor.name); option.value = actor.id; return option; }));
      this.inspectSelect.dataset.actors = signature;
    }
    this.inspectSelect.value = actor.id;
    this.sheet.update(actor, this.members.find(member => member.id === actor.id));
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

  private showCardDetail(
    button: HTMLElement,
    action: LegalAction,
    card: CombatState["cardZones"][string]["hand"][number] | undefined,
  ): void {
    const heading = element("div", "detail-heading");
    heading.append(element("strong", undefined, action.name), element("span", "cost-badge", actionCost(action)));
    this.cardTraits.render(action.traits, (chips) => this.cardDetail.replaceChildren(
      heading,
      element("p", undefined, action.description),
      ...(action.cardRequirement ? [element("p", "card-level-detail", requirementText(action.cardRequirement))] : []),
      chips,
      element("p", "detail-source", `Source: ${action.sourceLabel ?? card?.source.kind ?? "Character"}`),
    ));
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

  public hideCardDetail(cancelPresses = true): void {
    if (cancelPresses) this.hand.cancelPresses();
    this.cardTraits.clear();
    this.cardDetail.hidden = true;
  }

  /** Replaces the inspector with one line, for a phase that has nothing to inspect. */
  public renderHint(text: string): void {
    this.actionTraits.clear();
    required<HTMLElement>("#action-preview-summary").textContent = "행동 상세";
    this.selectedDetail.replaceChildren(element("p", "detail-hint", text));
  }

  public renderActionDetail(action: LegalAction | null, preview: ActionPreview | null, state?: CombatState): void {
    required<HTMLElement>("#action-preview-summary").textContent = action ? `${action.name} · ${actionCost(action)} · 행동 상세` : "행동 상세";
    if (!action) {
      this.actionTraits.clear();
      this.selectedDetail.replaceChildren(element("p", "detail-hint", DETAIL_HINT));
      return;
    }
    const heading = element("div", "detail-heading");
    heading.append(element("strong", undefined, action.name), element("span", "cost-badge", actionCost(action)));
    this.actionTraits.render(action.traits, (chips) => this.selectedDetail.replaceChildren(
      heading,
      element("p", undefined, action.description),
      chips,
    ));
    if (this.content.actions[action.actionId]?.resolution.kind === "recall-knowledge" && preview) this.selectedDetail.append(element("p", undefined, preview.notes[0] ?? ""));
    if (action.sourceLabel) this.selectedDetail.append(element("p", "detail-source", `Source: ${action.sourceLabel}`));
    if (action.reason) this.selectedDetail.append(element("p", "detail-warning", action.reason));
    if (!preview) return;
    if (!preview.legal) {
      this.selectedDetail.append(element("p", "detail-warning", preview.reason ?? "Target is not legal."));
      return;
    }
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
    const tactical = preview.tactical;
    if (tactical) {
      previewGrid.append(element("dt", undefined, "Target AC"), element("dd", "target-ac",
        tactical.acBeforeOffGuard === tactical.ac ? String(tactical.ac) : `${tactical.acBeforeOffGuard} → ${tactical.ac}`));
    } else if (preview.check) {
      previewGrid.append(element("dt", undefined, "Check / DC"), element("dd", undefined, `${preview.check.modifier >= 0 ? "+" : ""}${preview.check.modifier} / ${preview.check.dc}`));
    }
    this.selectedDetail.append(previewGrid);
    if (tactical?.causes.length) {
      const effect = element("div", "off-guard-summary");
      effect.append(element("strong", "off-guard-effect", `Off-Guard ${tactical.penalty}`),
        element("span", "off-guard-causes", tactical.causes.map((cause) => cause === "rear" ? "Rear" : "Flanking").join(" · ")));
      if (tactical.acBeforeOffGuard === tactical.ac) effect.append(element("span", undefined, "기존 페널티 적용 · 추가 AC 감소 없음"));
      if (tactical.partnerIds.length) effect.append(element("span", "flanking-partners", `협공 아군: ${tactical.partnerIds.map((id) => state?.actors[id]?.name ?? "아군").join(", ")}`));
      this.selectedDetail.append(effect);
    }
    if (import.meta.env.DEV) {
      const diagnostics = element("details", "preview-diagnostics");
      diagnostics.append(element("summary", undefined, "Debug"));
      for (const note of preview.notes) diagnostics.append(element("p", "preview-note", note));
      if (tactical) diagnostics.append(element("pre", undefined, JSON.stringify(tactical, null, 2)));
      this.selectedDetail.append(diagnostics);
    }
  }

  /** Board hover remains a preview; it never changes the explicitly pinned sheet. */
  public renderActorDetail(actor: ActorState): void {
    this.renderHint(`${actor.name} · ${actor.team === "heroes" ? "Ally" : "Enemy"} · HP ${actor.hp}/${actor.maxHp}`);
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

  private renderReaction(state: CombatState, ownsReaction: boolean, blocked: boolean, status?: string): void {
    const pending = state.pendingReaction;
    this.reactionModal.hidden = !pending || !ownsReaction;
    if (!pending || !ownsReaction) return;
    const mover = state.actors[pending.sourceActorId];
    const candidate = pending.candidates[0];
    const owner = candidate ? state.actors[candidate.actorId] : undefined;
    const card = candidate && state.cardZones[candidate.actorId]?.hand.find(card => card.id === candidate.cardInstanceId);
    const name = card ? this.content.cards[card.definitionId]?.name ?? "Reaction" : "Reaction";
    required<HTMLElement>("#reaction-title").textContent = `${name}?`;
    this.reactionUse.disabled = this.reactionPass.disabled = blocked;
    const strike = owner ? resolveStrike(owner, { content: this.content }) : null;
    const signed = (value: number) => value >= 0 ? `+${value}` : String(value);
    const profile = strike ? `기본 Strike: ${strike.weaponName} · 명중 ${signed(strike.attackModifier)} · ${strike.damage.count}d${strike.damage.sides}${signed(strike.damage.flatModifier)} ${strike.damage.damageType}. ` : "";
    this.reactionDescription.textContent =
      `${owner?.name ?? "캐릭터"}의 ${name} · ${mover?.name ?? "Enemy"}가 전방/측면 사거리에서 이동을 시작했습니다. ` +
      "사용하면 반응 1회와 해당 카드를 소비해 이동 전에 공격합니다. Pass는 반응을 쓰지 않고 이동을 계속합니다. " +
      profile + (blocked ? status ?? "서버 응답을 기다리고 있습니다." : "");
  }

  private renderResult(state: CombatState): void {
    this.resultModal.hidden = !state.outcome;
    if (!state.outcome) return;
    this.resultTitle.textContent = state.outcome === "victory" ? "Victory" : "Defeat";
    this.resultDescription.textContent =
      state.outcome === "victory"
        ? "전투에서 승리했습니다. 보상과 다음 준비 화면으로 이동하고 있습니다."
        : "파티가 패배했습니다. 모험 결과 화면으로 이동하고 있습니다.";
  }
}
