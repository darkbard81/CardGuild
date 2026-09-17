import type { CombatState, LegalAction } from "../game";
import type { AssetCatalog } from "../presentation";
import { createCardFace } from "./card-face";
import { requirementText } from "./card-level-view";
import { bindPressGesture, type PressGestureBinding } from "./detail-popover";
import { handLayout } from "./hand-layout";

type Card = CombatState["cardZones"][string]["hand"][number];
interface Entry { action: LegalAction; card?: Card; button: HTMLButtonElement; press: PressGestureBinding; abort: AbortController }
interface HandHandlers {
  onCard(action: LegalAction): void;
  onHover(action: LegalAction | null): void;
  onDetail(button: HTMLElement, action: LegalAction, card?: Card): void;
  onHideDetail(): void;
  detailOpen(): boolean;
}

export class CombatHandUi {
  private readonly dock: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly range: HTMLElement;
  private readonly abort = new AbortController();
  private readonly resize: ResizeObserver;
  private readonly entries = new Map<string, Entry>();
  private order: string[] = [];
  private selected: string | null = null;
  private page = 0;
  private expanded = false;
  private manuallyCollapsed = false;
  private swallowTouch = false;
  private canPlay = true;
  public constructor(private readonly root: HTMLElement, private readonly catalog: AssetCatalog, private readonly handlers: HandHandlers) {
    this.dock = root.closest<HTMLElement>(".hand-dock")!;
    this.toggle = this.dock.querySelector<HTMLButtonElement>("#hand-toggle")!;
    this.previous = this.dock.querySelector<HTMLButtonElement>("#hand-previous")!;
    this.next = this.dock.querySelector<HTMLButtonElement>("#hand-next")!;
    this.range = this.dock.querySelector<HTMLElement>("#hand-page")!;
    const options = { signal: this.abort.signal };
    this.toggle.addEventListener("click", () => { this.manuallyCollapsed = this.expanded; this.setExpanded(!this.expanded); }, options);
    this.previous.addEventListener("click", () => { this.page--; this.layout(); }, options);
    this.next.addEventListener("click", () => { this.page++; this.layout(); }, options);
    root.addEventListener("pointerover", event => { if (event.pointerType === "mouse" && !this.manuallyCollapsed) this.setExpanded(true); }, options);
    this.dock.addEventListener("pointerleave", event => {
      if (event.pointerType !== "mouse") return;
      if (!this.selected && !this.dock.contains(document.activeElement) && !handlers.detailOpen()) this.setExpanded(false);
      if (!this.selected) this.manuallyCollapsed = false;
    }, options);
    root.addEventListener("pointerdown", event => {
      this.swallowTouch = false;
      if (event.pointerType !== "mouse" && !this.expanded) {
        this.swallowTouch = true; this.manuallyCollapsed = false; this.setExpanded(true);
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, { ...options, capture: true });
    root.addEventListener("click", event => {
      if (this.swallowTouch) { this.swallowTouch = false; event.preventDefault(); event.stopImmediatePropagation(); }
    }, { ...options, capture: true });
    root.addEventListener("focusin", () => { if (!this.swallowTouch) { this.manuallyCollapsed = false; this.setExpanded(true); } }, options);
    root.addEventListener("focusout", event => {
      if (!handlers.detailOpen() && !this.selected && !this.dock.contains(event.relatedTarget as Node) && !this.dock.matches(":hover")) this.setExpanded(false);
    }, options);
    root.addEventListener("keydown", event => {
      const index = this.order.findIndex(id => this.entries.get(id)!.button === document.activeElement);
      const next = event.key === "ArrowRight" ? Math.min(index + 1, this.order.length - 1) : event.key === "ArrowLeft" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? this.order.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); event.stopPropagation(); this.page = Math.floor(next / this.capacity()); this.layout(); this.entries.get(this.order[next]!)!.button.focus(); }
    }, options);
    this.resize = new ResizeObserver(() => this.layout()); this.resize.observe(root);
    this.setExpanded(false);
  }
  public collapse(): void { this.manuallyCollapsed = true; this.setExpanded(false); }
  private setExpanded(value: boolean): void {
    this.expanded = value; this.dock.dataset.expanded = String(value);
    this.toggle.setAttribute("aria-expanded", String(value)); this.toggle.textContent = value ? "손패 접기" : "손패 펼치기";
    if (!value) this.handlers.onHideDetail();
  }
  private capacity(): number { return handLayout(this.order.length, this.root.clientWidth).capacity; }
  public update(actions: readonly LegalAction[], selected: LegalAction | null, cards: readonly Card[], canPlay: boolean): void {
    this.canPlay = canPlay;
    const selectedId = selected?.source.kind === "card" ? selected.source.id : null;
    if (this.selected !== selectedId) { this.manuallyCollapsed = false; if (selectedId) this.setExpanded(true); }
    this.selected = selectedId;
    const order = actions.map(action => action.source.id);
    for (const [id, entry] of this.entries) if (!order.includes(id)) {
      if (entry.button === document.activeElement) this.toggle.focus();
      entry.press(); entry.abort.abort(); entry.button.remove(); this.entries.delete(id); this.handlers.onHideDetail();
    }
    for (const action of actions) {
      const card = cards.find(card => card.id === action.source.id);
      let entry = this.entries.get(action.source.id);
      if (!entry) { entry = this.create(action, card); this.entries.set(action.source.id, entry); }
      const faceKey = JSON.stringify([card?.definitionId, action.name, action.timing, action.cardRequirement]);
      if (entry.button.dataset.faceKey !== faceKey) {
        entry.button.replaceChildren(createCardFace({ catalog: this.catalog, cardId: card?.definitionId, name: action.name, timing: action.timing, badges: action.cardRequirement ? [`Lv. ${action.cardRequirement.requiredLevel}`] : [] }));
        entry.button.dataset.faceKey = faceKey;
      }
      entry.action = action; entry.card = card;
      entry.button.setAttribute("aria-disabled", String(!canPlay || !action.enabled));
      entry.button.setAttribute("aria-pressed", String(this.selected === action.source.id));
      entry.button.classList.toggle("selected", this.selected === action.source.id);
      entry.button.title = [action.cardRequirement && requirementText(action.cardRequirement), action.reason ?? action.description].filter(Boolean).join(" · ");
    }
    if (order.join() !== this.order.join()) {
      const focused = document.activeElement;
      order.forEach((id, index) => { const button = this.entries.get(id)!.button; if (this.root.children[index] !== button) this.root.insertBefore(button, this.root.children[index] ?? null); });
      if (focused instanceof HTMLElement && this.root.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
      this.order = order;
    }
    this.root.dataset.empty = String(!order.length);
    this.root.setAttribute("aria-label", order.length ? `손패 ${order.length}장` : "손패가 비었습니다.");
    this.layout();
  }
  private create(action: LegalAction, card?: Card): Entry {
    const button = document.createElement("button"); button.type = "button"; button.className = "tactical-card ui-hand-card";
    Object.assign(button.dataset, { actionId: action.actionId, sourceId: action.source.id, sourceKind: action.source.kind, cardDefinitionId: card?.definitionId ?? "", cardSourceKind: card?.source.kind ?? "" });
    button.append(createCardFace({ catalog: this.catalog, cardId: card?.definitionId, name: action.name, timing: action.timing, badges: action.cardRequirement ? [`Lv. ${action.cardRequirement.requiredLevel}`] : [] }));
    const abort = new AbortController();
    const entry: Entry = { action, card, button, abort, press: bindPressGesture(button, {
      holdMs: 380, onHold: () => this.handlers.onDetail(button, entry.action, entry.card),
      onTap: () => { if (this.canPlay && entry.action.enabled) this.handlers.onCard(entry.action); },
    }) };
    const options = { signal: abort.signal };
    button.addEventListener("pointerenter", event => { if (event.pointerType === "mouse") this.handlers.onHover(entry.action); }, options);
    button.addEventListener("pointerleave", event => { if (event.pointerType === "mouse") this.handlers.onHover(null); }, options);
    button.addEventListener("focus", () => { if (button.matches(":focus-visible")) this.handlers.onDetail(button, entry.action, entry.card); }, options);
    button.addEventListener("blur", () => { entry.press.cancel(); }, options);
    return entry;
  }
  private layout(): void {
    const capacity = this.capacity();
    this.page = Math.max(0, Math.min(this.page, Math.ceil(this.order.length / capacity) - 1));
    const start = this.page * capacity;
    const geometry = handLayout(Math.min(capacity, this.order.length - start), this.root.clientWidth);
    this.order.forEach((id, index) => {
      const button = this.entries.get(id)!.button, card = geometry.cards[index - start];
      button.hidden = !card;
      if (card) {
        button.style.setProperty("--hand-x", `${card.x}px`); button.style.setProperty("--hand-y", `${card.y}px`);
        button.style.setProperty("--hand-angle", `${card.angle}deg`); button.style.setProperty("--hand-order", String(index - start));
      }
    });
    this.previous.disabled = this.page === 0; this.next.disabled = start + capacity >= this.order.length;
    this.previous.hidden = this.next.hidden = this.order.length <= capacity;
    this.range.textContent = this.order.length ? `${start + 1}–${Math.min(start + capacity, this.order.length)} / ${this.order.length}` : "0";
  }
  public cancelPresses(): void { for (const entry of this.entries.values()) entry.press.cancel(); }
  public destroy(): void { this.resize.disconnect(); this.abort.abort(); for (const entry of this.entries.values()) { entry.press(); entry.abort.abort(); entry.button.remove(); } this.entries.clear(); }
}
