import { CharacterDetailUi } from "./character-detail-ui";
import { createCardFace } from "./card-face";
import type { AdventureState } from "../adventure";
import { resolveEffectiveCharacterStatProfile } from "../adventure/progression";
import type { CompiledContentPack } from "../content";
import type { DeckContributionSource, EquipmentSlotId, ResolvedStrikeProfile } from "../game";
import { equipmentTraits } from "../game/rules";
import {
  EQUIPMENT_SLOT_ORDER,
  deriveLoadoutSnapshot,
  previewLoadoutChange,
  resolveLoadoutStatProfile,
  type LoadoutPreview,
  type PartyMemberLoadout,
} from "../loadout";
import type { AssetCatalog } from "../presentation";
import { HOVER_CLOSE_MS, HOVER_OPEN_MS, bindDismissal, bindPressGesture, placePopover } from "./detail-popover";
import { progressionMeter, progressionText } from "./progression-view";
import { cardLevelSummary } from "./card-level-view";

/** Long enough that a tap to select is never read as a request to inspect. */
const LONG_PRESS_MS = 450;

function required<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Required element was not found: ${selector}`);
  return found;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function damageText(strike: ResolvedStrikeProfile): string {
  return `${strike.damage.count}d${strike.damage.sides}${signed(strike.damage.flatModifier)} ${strike.damage.damageType}`;
}

function cloneLoadout(loadout: PartyMemberLoadout): PartyMemberLoadout {
  return { equipment: { ...loadout.equipment }, preparedCards: [...loadout.preparedCards] };
}

function sourceLabel(source: DeckContributionSource, pack: CompiledContentPack): string {
  if (source.kind === "prepared") return "Prepared Card";
  if (source.kind === "base") return pack.combatContent.traits[source.sourceId]?.name ?? pack.combatContent.actions[source.sourceId]?.name ?? "기본 카드";
  const equipment = pack.combatContent.equipment[source.equipmentId]?.name ?? source.equipmentId;
  const trait = pack.combatContent.traits[source.traitId]?.name ?? source.traitId;
  return `${equipment} / ${trait}`;
}

export interface LoadoutUiHandlers {
  readonly onSetLoadout: (memberId: string, loadout: PartyMemberLoadout, settled: (accepted: boolean) => void) => boolean;
  readonly onDone: () => void;
}

export interface LoadoutDestination { readonly memberId?: string; readonly tab?: "equipment" | "cards" | "deck"; readonly rewardIds?: readonly string[] }

const SLOT_LABELS: Record<EquipmentSlotId, string> = { armor: "몸", weapon: "주손", shield: "보조손", feet: "악세서리" };

type PageTab = "equipment" | "cards" | "deck";
interface ViewState { tab: PageTab; filter: EquipmentSlotId | "all"; pages: Record<PageTab, number> }
interface Tile {
  id: string; label: string; asset: string | null; badge: string; description: string;
  cardId?: string; isCard?: boolean;
  candidate?: PartyMemberLoadout; action?: () => void; className?: string; slot?: string;
}

export class LoadoutUi {
  private readonly screen = required<HTMLElement>("#loadout-screen");
  private state: AdventureState | null = null;
  private selectedMemberId = "";
  private editableMemberIds: ReadonlySet<string> = new Set();
  private readonly views = new Map<string, ViewState>();
  private waiting: { memberId: string; loadout: PartyMemberLoadout; label: string } | null = null;
  private message = "항목을 선택하거나 슬롯에 드래그해 비교한 뒤 확정하세요.";
  private selected: string | null = null;
  private restoringFocus = false;
  private nextTab: PageTab | undefined;
  private readonly tiles = new Map<string, Tile>();
  private rewardIds: ReadonlySet<string> | null = null;
  private readonly detail: CharacterDetailUi;
  private connection = "connected";
  private cancelDrag: (() => void) | null = null;
  private cleanup: Array<() => void> = [];
  private tooltip: HTMLElement | null = null;
  private tooltipAnchor: HTMLElement | null = null;
  private pinned = false;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(private readonly pack: CompiledContentPack, private readonly catalog: AssetCatalog,
    private readonly handlers: LoadoutUiHandlers) { this.detail = new CharacterDetailUi(pack, catalog); }

  public navigate(destination: LoadoutDestination = {}): void {
    this.selected = null;
    if (destination.memberId) this.selectedMemberId = destination.memberId;
    this.rewardIds = destination.rewardIds ? new Set(destination.rewardIds) : null;
    this.nextTab = destination.tab;
    this.view().filter = "all";
    this.view().pages = { equipment: 0, cards: 0, deck: 0 };
  }

  public setConnectionStatus(status: string): void {
    this.connection = status;
    if (!this.screen.hidden && this.waiting) this.refresh();
  }

  public setVisible(visible: boolean): void {
    this.screen.hidden = !visible;
    if (!visible) { this.disposeInteractions(); this.detail.close(); this.selected = null; }
  }

  public destroy(): void { this.disposeInteractions(); this.detail.close(); }

  public reportError(message: string): void {
    if (!this.state || (this.screen.hidden && !this.waiting)) return;
    this.waiting = null;
    this.message = message;
    if (this.state && !this.screen.hidden) this.render(this.state, this.editableMemberIds);
  }

  public render(state: AdventureState, editableMemberIds: ReadonlySet<string> = new Set()): void {
    const focusKey = this.screen.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focusKey : undefined;
    this.disposeInteractions();
    this.state = state;
    const previousAccess = this.editableMemberIds;
    this.editableMemberIds = new Set(editableMemberIds);
    const members = Object.values(state.party.members).sort((a, b) => a.id.localeCompare(b.id));
    const member = members.find((m) => m.id === this.selectedMemberId) ?? members.find((m) => editableMemberIds.has(m.id)) ?? members[0];
    if (!member) return;
    this.selectedMemberId = member.id;
    this.tiles.clear();
    if (previousAccess.has(member.id) && !editableMemberIds.has(member.id) && this.selected) {
      this.selected = null; this.message = "다른 참가자가 조작하는 캐릭터입니다. 상세 정보만 확인할 수 있습니다.";
    }
    const actor = this.pack.actorDefinitions[member.actorDefinitionId];
    if (!actor) return;
    const view = this.view();
    if (this.nextTab) { view.tab = this.nextTab; view.pages[view.tab] = 0; this.nextTab = undefined; }
    this.screen.replaceChildren();
    this.screen.setAttribute("aria-busy", String(Boolean(this.waiting)));
    const header = element("header", "loadout-header");
    header.append(element("h1", undefined, "장비·카드 준비"));
    header.append(this.tabs("Characters", members.map((m) => ({ id: m.id, label: this.pack.actorDefinitions[m.actorDefinitionId]?.name ?? m.id })), member.id, (id) => {
      if (this.waiting) return; this.selected = null; this.selectedMemberId = id; this.refresh();
    }, "loadout-member-tab"));
    const memberTabs = header.querySelectorAll<HTMLElement>(".loadout-member-tab");
    memberTabs.forEach((tab) => { tab.dataset.memberId = tab.dataset.tabId; tab.dataset.owned = String(editableMemberIds.has(tab.dataset.tabId ?? "")); });
    const close = this.button("닫기", "loadout-done", () => { if (!this.waiting) this.handlers.onDone(); }, "primary");
    close.disabled = Boolean(this.waiting); header.append(close);
    const nav = this.tabs("Loadout pages", [{ id: "equipment", label: "장비" }, { id: "cards", label: "준비 카드" }, { id: "deck", label: "덱·능력치" }], view.tab,
      (id) => { if (this.waiting) return; this.selected = null; view.tab = id as PageTab; this.refresh(); });
    const workspace = element("div", "loadout-grid");
    workspace.setAttribute("role", "tabpanel");
    workspace.setAttribute("aria-label", view.tab === "equipment" ? "장비" : view.tab === "cards" ? "준비 카드" : "덱·능력치");
    const sidebar = element("section", "ui-panel ui-panel--workspace loadout-panel equipped-panel");
    sidebar.dataset.editable = String(editableMemberIds.has(member.id));
    sidebar.append(element("h2", undefined, actor.name), element("p", "loadout-panel-label", editableMemberIds.has(member.id) ? "편집 가능" : "읽기 전용 · 다른 플레이어"));
    sidebar.append(element("p", "character-progression", progressionText(member.progression)), progressionMeter(actor.name, member.progression));
    sidebar.append(this.button("캐릭터 상세", "loadout-character-detail", () => this.detail.openPrepared(actor, member)));
    const slots = element("div", view.tab === "cards" ? "prepared-list" : "equipment-slots");
    if (view.tab === "cards") {
      sidebar.append(element("h3", "prepared-heading", `Prepared Cards ${member.loadout.preparedCards.length}/${actor.loadoutProfile.preparedCardCapacity}`));
      for (let index = 0; index < actor.loadoutProfile.preparedCardCapacity; index++) {
        const id = member.loadout.preparedCards[index];
        const cards = [...member.loadout.preparedCards]; cards.splice(index, 1);
        slots.append(this.tile({ id: `prepared-${index}`, cardId: id, isCard: true, label: id ? this.pack.combatContent.cards[id]?.name ?? id : "빈", asset: id ? this.catalog.cardVisual(id) : null,
          badge: id ? "−" : "+", description: id ? this.cardDescription(id) : "보유 카드를 선택해 비교한 뒤 준비 추가를 누르세요.",
          candidate: id ? { ...cloneLoadout(member.loadout), preparedCards: cards } : undefined, className: id ? "prepared-card" : "prepared-empty" }));
      }
    } else {
      const standee = element("div", "loadout-standee"); standee.setAttribute("aria-hidden", "true");
      Object.assign(standee.style, this.catalog.domStandeeStyle(this.catalog.actorVisual(actor.id).front, 170));
      slots.append(standee);
      for (const slot of EQUIPMENT_SLOT_ORDER) {
        const id = member.loadout.equipment[slot];
        const equipment = { ...member.loadout.equipment }; delete equipment[slot];
        slots.append(this.tile({ id: `slot-${slot}`, slot, label: id ? this.pack.combatContent.equipment[id]?.name ?? id : `빈 ${SLOT_LABELS[slot]}`,
          asset: id ? this.catalog.equipmentVisual(id) : null, badge: SLOT_LABELS[slot], description: id ? this.equipmentDescription(id) : "클릭하여 이 부위의 장비를 찾습니다.",
          candidate: id ? { ...cloneLoadout(member.loadout), equipment } : undefined,
          action: id ? undefined : () => { view.tab = "equipment"; view.filter = slot; view.pages.equipment = 0; this.refresh(); }, className: "equipment-slot" }));
      }
    }
    const snapshot = deriveLoadoutSnapshot(actor, member.loadout, this.pack.combatContent, member.id,
      resolveEffectiveCharacterStatProfile(actor, member.progression, this.pack.characterRules));
    sidebar.append(slots, element("p", "loadout-core-stats", `AC ${snapshot.statistics.ac} · HP ${snapshot.statistics.maxHp} · ATK ${signed(snapshot.strike.attackModifier)}`),
      element("p", "loadout-deck-count", `${snapshot.deck.totalCards} Tactical Cards`));
    const panel = element("section", `ui-panel ui-panel--workspace loadout-panel collection-panel${view.tab === "deck" ? " deck-panel" : ""}`);
    const items: Tile[] = [];
    if (view.tab === "equipment") {
      panel.append(this.tabs("Equipment categories", [{ id: "all", label: "전체" }, ...EQUIPMENT_SLOT_ORDER.map((slot) => ({ id: slot, label: SLOT_LABELS[slot] }))], view.filter,
        (id) => { view.filter = id as ViewState["filter"]; view.pages.equipment = 0; this.refresh(); }));
      for (const [id, owned] of Object.entries(state.collection.equipment).sort(([a], [b]) => a.localeCompare(b))) {
        const definition = this.pack.combatContent.equipment[id];
        if ((this.rewardIds && !this.rewardIds.has(id)) || !definition || (view.filter !== "all" && definition.slot !== view.filter)) continue;
        const used = members.reduce((sum, m) => sum + Object.values(m.loadout.equipment).filter((value) => value === id).length, 0);
        const equipped = member.loadout.equipment[definition.slot] === id;
        items.push({ id, label: definition.name, asset: this.catalog.equipmentVisual(id), badge: equipped ? "✓" : `×${owned - used}`,
          description: `${this.equipmentDescription(id)}\n보유 ${owned} · 사용 가능 ${owned - used}${equipped ? " · 현재 장착 중" : ""}\n${this.usersOf(id)}`,
          candidate: equipped ? undefined : { ...cloneLoadout(member.loadout), equipment: { ...member.loadout.equipment, [definition.slot]: id } } });
      }
    } else if (view.tab === "cards") {
      panel.append(element("h2", undefined, "보유 카드"));
      for (const [id, owned] of Object.entries(state.collection.cards).sort(([a], [b]) => a.localeCompare(b))) {
        if (this.rewardIds && !this.rewardIds.has(id)) continue;
        const used = members.reduce((sum, m) => sum + m.loadout.preparedCards.filter((value) => value === id).length, 0);
        items.push({ id, cardId: id, isCard: true, label: this.pack.combatContent.cards[id]?.name ?? id, asset: this.catalog.cardVisual(id), badge: `×${owned - used}`,
          description: `${this.cardDescription(id)}\n보유 ${owned} · 사용 가능 ${owned - used}\n${this.usersOf(id)}`, candidate: { ...cloneLoadout(member.loadout), preparedCards: [...member.loadout.preparedCards, id] } });
      }
    } else {
      panel.append(element("h2", undefined, `${snapshot.deck.totalCards} Tactical Cards`));
      const grouped = new Map<string, { count: number; sources: string[] }>();
      for (const contribution of snapshot.deck.contributions) {
        const entry = grouped.get(contribution.cardDefinitionId) ?? { count: 0, sources: [] };
        entry.count += contribution.count; entry.sources.push(`${sourceLabel(contribution.source, this.pack)} ×${contribution.count}`);
        grouped.set(contribution.cardDefinitionId, entry);
      }
      for (const [id, entry] of grouped) items.push({ id, cardId: id, isCard: true, label: this.pack.combatContent.cards[id]?.name ?? id, asset: this.catalog.cardVisual(id), badge: `×${entry.count}`,
        description: `${this.cardDescription(id)}\n${entry.sources.join("\n")}`, className: "deck-contribution" });
    }
    if (this.rewardIds) panel.append(this.button("보상 필터 해제", "loadout-reward-filter", () => { this.rewardIds = null; this.selected = null; this.refresh(); }));
    if (view.tab === "equipment") {
      const drop = element("div", "loadout-return", "장비함으로 되돌리기 · 장착 장비를 끌어 놓으면 해제를 비교합니다.");
      drop.dataset.dropReturn = "true"; panel.append(drop);
    }
    const pageSize = 4;
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    view.pages[view.tab] = Math.min(view.pages[view.tab], pages - 1);
    const grid = element("div", view.tab === "equipment" ? "loadout-items" : "loadout-items loadout-card-items");
    for (const item of items.slice(view.pages[view.tab] * pageSize, (view.pages[view.tab] + 1) * pageSize)) grid.append(this.tile(item));
    if (!items.length) grid.append(element("p", "loadout-empty", "보유 항목이 없습니다."));
    panel.append(grid);
    if (view.tab === "deck") panel.append(this.stats());
    const pager = element("nav", "loadout-pagination"); pager.setAttribute("aria-label", "Grid pages");
    const previous = this.button("이전", "", () => { view.pages[view.tab]--; this.refresh(); }); previous.disabled = view.pages[view.tab] === 0;
    const next = this.button("다음", "", () => { view.pages[view.tab]++; this.refresh(); }); next.disabled = view.pages[view.tab] === pages - 1;
    pager.append(previous, element("span", undefined, `${view.pages[view.tab] + 1} / ${pages}`), next);
    panel.append(pager); workspace.append(sidebar, panel, this.comparison());
    const status = element("footer", "ui-status loadout-status", this.waiting ? this.connection === "connected" ? "적용 중… 서버 확정을 기다립니다." : "재연결 중 · 변경 결과를 확인하고 있습니다." : this.message); status.setAttribute("role", "status");
    this.tooltip = element("aside", "ui-panel ui-panel--popover loadout-tooltip"); this.tooltip.id = "loadout-detail"; this.tooltip.setAttribute("role", "tooltip"); this.tooltip.hidden = true;
    this.tooltip.addEventListener("pointerenter", () => clearTimeout(this.hideTimer));
    this.tooltip.addEventListener("pointerleave", () => { if (!this.pinned) this.hideTooltip(); });
    this.screen.append(header, nav, workspace, status, this.tooltip);
    this.cleanup.push(bindDismissal({ panel: this.tooltip, anchor: () => this.tooltipAnchor, hide: () => this.hideTooltip() }));
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || this.waiting || document.querySelector("dialog[open]")) return;
      if (this.cancelDrag) { this.cancelDrag(); return; }
      if (!this.selected && this.tooltip && !this.tooltip.hidden) { this.hideTooltip(); return; }
      this.selected = null; this.message = "비교를 취소했습니다. 장착 상태는 바뀌지 않았습니다."; this.refresh();
    };
    this.screen.addEventListener("keydown", escape); this.cleanup.push(() => this.screen.removeEventListener("keydown", escape));
    this.screen.hidden = false;
    this.restoringFocus = true;
    if (focusKey) this.screen.querySelectorAll<HTMLElement>("[data-focus-key]").forEach((node) => { if (node.dataset.focusKey === focusKey) node.focus({ preventScroll: true }); });
    this.restoringFocus = false;
  }

  private view(): ViewState {
    let view = this.views.get(this.selectedMemberId);
    if (!view) { view = { tab: "equipment", filter: "all", pages: { equipment: 0, cards: 0, deck: 0 } }; this.views.set(this.selectedMemberId, view); }
    return view;
  }
  private refresh(): void { if (this.state) this.render(this.state, this.editableMemberIds); }
  private button(label: string, className: string, action: () => void, variant: "primary" | "secondary" = "secondary"): HTMLButtonElement {
    const appearance = `ui-button--${variant}`;
    const button = element("button", `ui-button ${appearance} ${className}`, label); button.type = "button"; button.dataset.focusKey = `${className}:${label}`;
    button.addEventListener("click", action); return button;
  }
  private tabs(label: string, entries: Array<{ id: string; label: string }>, selected: string, select: (id: string) => void, className = "loadout-tab"): HTMLElement {
    const tabs = element("nav", "loadout-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", label);
    entries.forEach((entry, index) => {
      const button = this.button(entry.label, className, () => select(entry.id)); button.dataset.tabId = entry.id;
      button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(entry.id === selected)); button.tabIndex = entry.id === selected ? 0 : -1;
      button.addEventListener("keydown", (event) => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : event.key === "ArrowRight" ? (index + 1) % entries.length : event.key === "ArrowLeft" ? (index + entries.length - 1) % entries.length : -1;
        if (next < 0) return; event.preventDefault();
        const id = entries[next]?.id; if (!id) return; select(id);
        this.screen.querySelectorAll<HTMLElement>(`[role="tablist"][aria-label="${label}"] [role="tab"]`).forEach((node) => { if (node.dataset.tabId === id) node.focus(); });
      }); tabs.append(button);
    }); return tabs;
  }
  private cardDescription(id: string): string {
    const card = this.pack.combatContent.cards[id]; const action = card ? this.pack.combatContent.actions[card.actionId] : undefined;
    const member = this.state?.party.members[this.selectedMemberId];
    const actor = member && this.pack.actorDefinitions[member.actorDefinitionId];
    const ruleActor = actor && member ? { ...actor, statProfile: resolveLoadoutStatProfile(member, this.pack) } : undefined;
    return card && action ? `${cardLevelSummary(card, this.pack.combatContent, ruleActor)} · ${action.timing.kind === "reaction" ? "반응" : `${action.timing.actions} 액션`} · ${action.description}` : "";
  }
  private equipmentDescription(id: string): string {
    const equipment = this.pack.combatContent.equipment[id];
    if (!equipment) return "";
    const parts: string[] = [SLOT_LABELS[equipment.slot]];
    const weapon = equipment.weaponProfile;
    if (weapon) parts.push(`${weapon.category} ${weapon.attackMode} · ${weapon.damage.count}d${weapon.damage.sides} ${weapon.damage.damageType} · ${weapon.rangeFeet}ft`);
    const armor = equipment.armorProfile;
    if (armor) parts.push(`${armor.category} · AC ${signed(armor.acItemBonus)} · DEX cap ${armor.dexCap ?? "none"}`);
    if (equipment.shieldBonus) parts.push(`Raise Shield · AC ${signed(equipment.shieldBonus)}`);
    for (const modifier of equipment.statModifiers) parts.push(`${modifier.label} ${signed(modifier.value)}`);
    for (const trait of equipmentTraits(equipment)) {
      const definition = this.pack.combatContent.traits[trait.id];
      parts.push(definition?.name ?? trait.id);
      for (const grant of definition?.cardGrants ?? []) parts.push(`${this.pack.combatContent.cards[grant.cardDefinitionId]?.name ?? grant.cardDefinitionId} ×${grant.count} · ${this.cardDescription(grant.cardDefinitionId)}`);
    }
    return parts.join(" · ");
  }
  private preview(candidate: PartyMemberLoadout): LoadoutPreview {
    if (!this.state) throw new Error("Loadout state is missing.");
    const member = this.state.party.members[this.selectedMemberId];
    const actor = member && this.pack.actorDefinitions[member.actorDefinitionId];
    if (!member || !actor) throw new Error("Loadout character is missing.");
    return previewLoadoutChange(this.state.party, this.state.collection, this.pack, this.selectedMemberId, candidate);
  }
  private apply(tile: Tile): void {
    if (!tile.candidate || this.waiting) return;
    if (!this.editableMemberIds.has(this.selectedMemberId)) { this.message = "Only this character's owner can edit this loadout."; this.refresh(); return; }
    const preview = this.preview(tile.candidate);
    if (!preview.legal) { this.message = preview.validation.issues.some((issue) => issue.code === "PREPARED_CAPACITY_EXCEEDED") ? "준비 카드를 먼저 해제하세요." : preview.validation.issues[0]?.message ?? "Unavailable"; this.refresh(); return; }
    this.waiting = { memberId: this.selectedMemberId, loadout: tile.candidate, label: tile.label };
    if (!this.handlers.onSetLoadout(this.selectedMemberId, tile.candidate, accepted => {
      this.waiting = null;
      this.message = accepted ? `${tile.label} · 저장됨` : "변경하지 못했습니다. 최신 비교 내용을 확인하고 다시 시도하세요.";
      if (accepted) this.selected = null;
      if (!this.screen.hidden) this.refresh();
    })) { this.waiting = null; this.message = "연결 또는 이전 변경을 확인한 뒤 다시 시도하세요."; }
    this.refresh();
  }
  private tile(tile: Tile): HTMLElement {
    this.tiles.set(tile.id, tile);
    const button = element("button", `loadout-tile ${tile.className ?? "loadout-option"}`); button.type = "button";
    button.dataset.focusKey = tile.id; button.dataset.optionId = tile.id; if (tile.slot) button.dataset.slot = tile.slot;
    const preview = tile.candidate ? this.preview(tile.candidate) : undefined;
    const unavailable = Boolean(tile.candidate && (!preview?.legal || !this.editableMemberIds.has(this.selectedMemberId) || this.waiting));
    button.setAttribute("aria-pressed", String(this.selected === tile.id));
    const verb = "상세·비교";
    button.setAttribute("aria-label", `${tile.label} · ${tile.badge} · ${verb}`);
    if (tile.isCard) {
      button.classList.add("loadout-card-tile");
      const definition = tile.cardId ? this.pack.combatContent.cards[tile.cardId] : undefined;
      const action = definition ? this.pack.combatContent.actions[definition.actionId] : undefined;
      if (action) {
        const costLabel = action.timing.kind === "reaction" ? "Reaction" : `${action.timing.actions} actions`;
        button.setAttribute("aria-label", `${tile.label} · ${costLabel} · ${tile.badge} · ${verb}`);
      }
      button.append(createCardFace({
        catalog: this.catalog, cardId: tile.cardId, name: tile.label, timing: action?.timing,
        badges: [unavailable ? `⊘ ${tile.badge}` : tile.badge],
      }));
    } else {
      const icon = element("span", "loadout-icon"); icon.setAttribute("aria-hidden", "true");
      if (tile.asset) Object.assign(icon.style, this.catalog.domAssetStyle(tile.asset, 52)); else { icon.classList.add("missing"); icon.textContent = "+"; }
      button.append(icon, element("span", "loadout-badge", unavailable ? `⊘ ${tile.badge}` : tile.badge), element("span", "loadout-item-name", tile.label));
    }
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    const clear = (): void => { clearTimeout(hoverTimer); hoverTimer = undefined; };
    const show = (): void => this.showTooltip(button, tile, preview);
    button.addEventListener("pointerenter", (event) => { if (event.pointerType === "mouse" && this.selected !== tile.id) { clear(); hoverTimer = setTimeout(show, HOVER_OPEN_MS); } });
    button.addEventListener("pointerleave", () => { clear(); if (!this.pinned && this.tooltipAnchor === button) this.hideTimer = setTimeout(() => this.hideTooltip(), HOVER_CLOSE_MS); });
    button.addEventListener("focus", () => { if (!this.restoringFocus && button.matches(":focus-visible")) show(); });
    button.addEventListener("blur", () => { if (!this.pinned) this.hideTooltip(); });
    button.addEventListener("pointerdown", clear);
    // A hold inspects; a tap selects a comparison or navigates. The shared gesture keeps a
    // moved, scrolled or cancelled press from being read as either.
    const release = bindPressGesture(button, {
      holdMs: LONG_PRESS_MS,
      onHold: () => { this.pinned = true; show(); },
      onTap: () => { clear(); if (this.waiting) return; if (tile.action) tile.action(); else { this.selected = tile.id; this.message = "비교 중 · 확정 전에는 장착 상태가 바뀌지 않습니다."; this.refresh(); } },
      onCancel: () => this.hideTooltip(),
    });
    this.cleanup.push(() => { clear(); release(); });
    if (!tile.isCard && tile.candidate && this.editableMemberIds.has(this.selectedMemberId)) {
      const wrapper = element("div", "loadout-item");
      if (tile.slot) wrapper.dataset.slot = tile.slot;
      const handle = this.button("↕", "loadout-drag-handle", () => undefined);
      handle.setAttribute("aria-label", tile.label + " 끌어서 이동"); handle.disabled = Boolean(this.waiting);
      this.bindDrag(handle, tile); wrapper.append(button, handle); return wrapper;
    }
    return button;
  }
  private usersOf(id: string): string {
    if (!this.state) return "";
    const users = Object.values(this.state.party.members).flatMap(member => {
      const count = Object.values(member.loadout.equipment).filter(value => value === id).length + member.loadout.preparedCards.filter(value => value === id).length;
      return count ? [`${this.pack.actorDefinitions[member.actorDefinitionId]?.name ?? member.id} ×${count}`] : [];
    });
    return users.length ? "사용 중: " + users.join(" · ") : "";
  }

  private comparison(): HTMLElement {
    const panel = element("section", "ui-panel ui-panel--workspace loadout-panel loadout-comparison");
    panel.setAttribute("aria-label", "선택 항목 비교");
    const tile = this.selected ? this.tiles.get(this.selected) : undefined;
    if (!tile) { panel.append(element("h2", undefined, "상세·비교"), element("p", undefined, "항목을 선택하거나 장비를 슬롯으로 끌어 놓으세요. 확정 버튼을 눌러야 변경됩니다.")); return panel; }
    panel.append(element("h2", undefined, tile.label), element("p", "loadout-description", tile.description));
    const preview = tile.candidate ? this.preview(tile.candidate) : undefined;
    if (preview) {
      const changes = [...preview.addedCards.map(card => `+ ${this.pack.combatContent.cards[card.cardDefinitionId]?.name} ×${card.count}`),
        ...preview.removedCards.map(card => `− ${this.pack.combatContent.cards[card.cardDefinitionId]?.name} ×${card.count}`),
        ...preview.addedContextActionIds.map(id => `+ ${this.pack.combatContent.actions[id]?.name}`),
        ...preview.removedContextActionIds.map(id => `− ${this.pack.combatContent.actions[id]?.name}`)];
      panel.append(element("p", "loadout-card-changes", changes.join(" · ")));
      if (preview.after) panel.append(this.stats(preview));
      if (!preview.legal) panel.append(element("p", "preview-illegal", preview.validation.issues.map(issue => issue.message).join(" · ")));
      const removal = tile.className === "equipment-slot" || tile.className === "prepared-card";
      const slot = this.pack.combatContent.equipment[tile.id]?.slot;
      const equipped = slot && this.state?.party.members[this.selectedMemberId]?.loadout.equipment[slot];
      const apply = this.button(removal ? "해제" : tile.isCard ? "준비 추가" : equipped ? "교환" : "장착", "loadout-apply", () => this.apply(tile), "primary");
      apply.disabled = !preview.legal || Boolean(this.waiting) || !this.editableMemberIds.has(this.selectedMemberId);
      panel.append(apply);
    }
    if (!this.editableMemberIds.has(this.selectedMemberId)) panel.append(element("p", undefined, "다른 참가자가 조작 중인 캐릭터입니다. 읽기만 가능합니다."));
    const cancel = this.button("비교 취소", "loadout-cancel", () => { this.selected = null; this.refresh(); }); cancel.disabled = Boolean(this.waiting);
    panel.append(cancel);
    const copy = element("div", "loadout-comparison-content");
    const actions = element("div", "loadout-comparison-actions");
    for (const child of [...panel.children]) {
      if (child.matches(".loadout-apply, .loadout-cancel")) actions.append(child); else copy.append(child);
    }
    panel.replaceChildren(copy, actions); return panel;
  }

  private bindDrag(handle: HTMLButtonElement, tile: Tile): void {
    let active = false;
    let pointerId = -1;
    let startX = 0; let startY = 0;
    let ghost: HTMLElement | null = null;
    const cancel = (): void => {
      active = false; ghost?.remove(); ghost = null;
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      delete this.screen.dataset.dragging;
      this.screen.querySelectorAll("[data-drop-active]").forEach(node => node.removeAttribute("data-drop-active"));
      if (this.cancelDrag === cancel) this.cancelDrag = null;
    };
    handle.addEventListener("pointerdown", event => {
      if (this.waiting || event.button !== 0) return;
      event.preventDefault(); handle.focus({ preventScroll: true });
      startX = event.clientX; startY = event.clientY; pointerId = event.pointerId;
      active = true; this.cancelDrag = cancel; handle.setPointerCapture(pointerId);
    });
    handle.addEventListener("pointermove", event => {
      if (!active || event.pointerId !== pointerId) return;
      if (!ghost && Math.hypot(event.clientX - startX, event.clientY - startY) < 8) return;
      if (!ghost) { ghost = element("div", "ui-panel loadout-drag-ghost", tile.label); document.body.append(ghost); this.screen.dataset.dragging = "true"; }
      ghost.style.left = `${event.clientX + 12}px`; ghost.style.top = `${event.clientY + 12}px`;
      this.screen.querySelectorAll("[data-drop-active]").forEach(node => node.removeAttribute("data-drop-active"));
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".equipment-slots [data-slot], [data-drop-return]");
      if (target) target.dataset.dropActive = "true";
    });
    handle.addEventListener("pointerup", event => {
      if (!active || event.pointerId !== pointerId) return;
      const moved = Boolean(ghost);
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".equipment-slots [data-slot], [data-drop-return]");
      const valid = tile.className === "equipment-slot" ? Boolean(target?.dataset.dropReturn)
        : target?.dataset.slot === this.pack.combatContent.equipment[tile.id]?.slot;
      cancel();
      if (!moved) return;
      if (valid) { this.selected = tile.id; this.message = "비교 중 · 장착·교환·해제 버튼으로 확정하세요."; }
      else this.message = "이 위치에는 놓을 수 없습니다. 맞는 슬롯이나 장비함으로 옮기세요.";
      this.refresh();
    });
    handle.addEventListener("pointercancel", cancel); handle.addEventListener("lostpointercapture", cancel);
    this.cleanup.push(cancel);
  }

  private showTooltip(anchor: HTMLElement, tile: Tile, preview?: LoadoutPreview): void {
    const tooltip = this.tooltip; if (!tooltip || !anchor.isConnected) return;
    clearTimeout(this.hideTimer);
    this.tooltipAnchor?.removeAttribute("aria-describedby"); this.tooltipAnchor = anchor; anchor.setAttribute("aria-describedby", tooltip.id);
    tooltip.replaceChildren(element("h2", undefined, tile.label), element("p", undefined, tile.description));
    if (preview) {
      const changes = [...preview.addedCards.map((c) => `+ ${this.pack.combatContent.cards[c.cardDefinitionId]?.name} ×${c.count}`),
        ...preview.removedCards.map((c) => `− ${this.pack.combatContent.cards[c.cardDefinitionId]?.name} ×${c.count}`),
        ...preview.addedContextActionIds.map((id) => `+ Context: ${this.pack.combatContent.actions[id]?.name}`),
        ...preview.removedContextActionIds.map((id) => `− Context: ${this.pack.combatContent.actions[id]?.name}`)];
      tooltip.append(element("p", preview.legal ? "preview-legal" : "preview-illegal", preview.legal ? changes.join(" · ") : preview.validation.issues[0]?.message));
      if (preview.after) tooltip.append(this.stats(preview));
    }
    if (!this.editableMemberIds.has(this.selectedMemberId)) tooltip.append(element("p", undefined, "Read-only · Only this character's owner can edit this loadout."));
    placePopover(tooltip, anchor, "right");
  }
  private hideTooltip(): void { clearTimeout(this.hideTimer); if (this.tooltip) this.tooltip.hidden = true; this.tooltipAnchor?.removeAttribute("aria-describedby"); this.tooltipAnchor = null; this.pinned = false; }
  private disposeInteractions(): void { this.cancelDrag?.(); this.cleanup.forEach((cleanup) => cleanup()); this.cleanup = []; this.hideTooltip(); }
  private stats(preview?: LoadoutPreview): HTMLElement {
    const member = this.state?.party.members[this.selectedMemberId];
    if (!member) return element("div");
    const actor = this.pack.actorDefinitions[member.actorDefinitionId];
    if (!actor) return element("div");
    const shown = preview?.after ?? deriveLoadoutSnapshot(actor, member.loadout, this.pack.combatContent, member.id,
      resolveEffectiveCharacterStatProfile(actor, member.progression, this.pack.characterRules));
    const stats = element("div", "loadout-stat-grid");
    const values: Array<[string, string]> = [
      ["AC", preview?.after ? `${preview.before.statistics.ac} → ${preview.after.statistics.ac}` : String(shown.statistics.ac)],
      ["Reflex DC", preview?.after
        ? `${preview.before.statistics.reflex.dc} → ${preview.after.statistics.reflex.dc}`
        : String(shown.statistics.reflex.dc)],
      ["HP", preview?.after
        ? `${preview.before.statistics.maxHp} → ${preview.after.statistics.maxHp}`
        : String(shown.statistics.maxHp)],
      ["Class DC", preview?.after
        ? `${preview.before.statistics.classDc} → ${preview.after.statistics.classDc}`
        : String(shown.statistics.classDc)],
      ["Armor", `${shown.armor.name} · ${shown.armor.category}`],
      ["Armor bonus", `+${shown.armor.acItemBonus} item · DEX cap ${shown.armor.dexCap ?? "none"}`],
      ["Weapon", `${shown.strike.weaponName} · ${shown.strike.weaponCategory ?? "fixed"} ${shown.strike.proficiencyRank ?? ""}`.trim()],
      ["Attack", preview?.after
        ? `${signed(preview.before.strike.attackModifier)} → ${signed(preview.after.strike.attackModifier)}`
        : signed(shown.strike.attackModifier)],
      ["Damage", preview?.after
        ? `${damageText(preview.before.strike)} → ${damageText(preview.after.strike)}`
        : damageText(shown.strike)],
      ["Reach", `${shown.strike.rangeFeet} ft · ${shown.strike.attackMode ?? "fixed"}`],
      ["Weapon traits", shown.strike.traits.length > 0 ? shown.strike.traits.join(", ") : "none"],
      ["Deck", `${shown.deck.totalCards} cards`],
    ];
    for (const [label, value] of values) {
      const block = element("div", "loadout-stat");
      block.append(element("span", undefined, label), element("strong", undefined, value));
      stats.append(block);
    }
    return stats;
  }
}
