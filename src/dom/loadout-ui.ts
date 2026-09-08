import type { AdventureState } from "../adventure";
import type { CompiledContentPack } from "../content";
import type { DeckContributionSource, EquipmentSlotId, ResolvedStrikeProfile } from "../game";
import {
  EQUIPMENT_SLOT_ORDER,
  deriveLoadoutSnapshot,
  previewLoadoutChange,
  type LoadoutPreview,
  type PartyMemberLoadout,
} from "../loadout";
import type { AssetCatalog } from "../presentation";

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
  readonly onSetLoadout: (memberId: string, loadout: PartyMemberLoadout) => boolean;
  readonly onDone: () => void;
}

type PageTab = "equipment" | "cards" | "deck";
interface ViewState { tab: PageTab; filter: EquipmentSlotId | "all"; pages: Record<PageTab, number> }
interface Tile {
  id: string; label: string; asset: string | null; badge: string; description: string;
  candidate?: PartyMemberLoadout; action?: () => void; className?: string; slot?: string;
}

export class LoadoutUi {
  private readonly screen = required<HTMLElement>("#loadout-screen");
  private state: AdventureState | null = null;
  private selectedMemberId = "";
  private editableMemberIds: ReadonlySet<string> = new Set();
  private readonly views = new Map<string, ViewState>();
  private waiting: { memberId: string; loadout: PartyMemberLoadout; label: string } | null = null;
  private message = "클릭으로 장착·해제 · Hover 또는 길게 눌러 상세 보기";
  private cleanup: Array<() => void> = [];
  private tooltip: HTMLElement | null = null;
  private tooltipAnchor: HTMLElement | null = null;
  private pinned = false;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(private readonly pack: CompiledContentPack, private readonly catalog: AssetCatalog,
    private readonly handlers: LoadoutUiHandlers) {}

  public setVisible(visible: boolean): void {
    this.screen.hidden = !visible;
    if (!visible) this.disposeInteractions();
  }

  public destroy(): void { this.disposeInteractions(); }

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
    this.editableMemberIds = new Set(editableMemberIds);
    const members = Object.values(state.party.members).sort((a, b) => a.id.localeCompare(b.id));
    const member = members.find((m) => m.id === this.selectedMemberId) ?? members.find((m) => editableMemberIds.has(m.id)) ?? members[0];
    if (!member) return;
    this.selectedMemberId = member.id;
    if (this.waiting) {
      const actual = state.party.members[this.waiting.memberId]?.loadout;
      if (actual && EQUIPMENT_SLOT_ORDER.every((slot) => actual.equipment[slot] === this.waiting?.loadout.equipment[slot]) &&
        [...actual.preparedCards].sort().join("|") === [...this.waiting.loadout.preparedCards].sort().join("|")) {
        this.message = `${this.waiting.label} · 반영 완료`;
        this.waiting = null;
      } else if (!editableMemberIds.has(this.waiting.memberId)) {
        this.waiting = null;
        this.message = "캐릭터 편집 권한이 변경되었습니다.";
      }
    }
    const actor = this.pack.actorDefinitions[member.actorDefinitionId];
    if (!actor) return;
    const view = this.view();
    this.screen.replaceChildren();
    this.screen.setAttribute("aria-busy", String(Boolean(this.waiting)));
    const header = element("header", "loadout-header");
    header.append(element("h1", undefined, "Manage Loadout"));
    header.append(this.tabs("Characters", members.map((m) => ({ id: m.id, label: this.pack.actorDefinitions[m.actorDefinitionId]?.name ?? m.id })), member.id, (id) => {
      this.selectedMemberId = id; this.refresh();
    }, "loadout-member-tab"));
    const memberTabs = header.querySelectorAll<HTMLElement>(".loadout-member-tab");
    memberTabs.forEach((tab) => { tab.dataset.memberId = tab.dataset.tabId; tab.dataset.owned = String(editableMemberIds.has(tab.dataset.tabId ?? "")); });
    header.append(this.button("Done", "loadout-done", this.handlers.onDone));
    const nav = this.tabs("Loadout pages", [{ id: "equipment", label: "장비" }, { id: "cards", label: "준비 카드" }, { id: "deck", label: "덱·능력치" }], view.tab,
      (id) => { view.tab = id as PageTab; this.refresh(); });
    const workspace = element("div", "loadout-grid");
    workspace.setAttribute("role", "tabpanel");
    workspace.setAttribute("aria-label", view.tab === "equipment" ? "장비" : view.tab === "cards" ? "준비 카드" : "덱·능력치");
    const sidebar = element("section", "loadout-panel equipped-panel");
    sidebar.dataset.editable = String(editableMemberIds.has(member.id));
    sidebar.append(element("h2", undefined, actor.name), element("p", "loadout-panel-label", editableMemberIds.has(member.id) ? "Your build" : "Read-only · 다른 플레이어"));
    const slots = element("div", view.tab === "cards" ? "prepared-list" : "equipment-slots");
    if (view.tab === "cards") {
      sidebar.append(element("h3", "prepared-heading", `Prepared Cards ${member.loadout.preparedCards.length}/${actor.loadoutProfile.preparedCardCapacity}`));
      for (let index = 0; index < actor.loadoutProfile.preparedCardCapacity; index++) {
        const id = member.loadout.preparedCards[index];
        const cards = [...member.loadout.preparedCards]; cards.splice(index, 1);
        slots.append(this.tile({ id: `prepared-${index}`, label: id ? this.pack.combatContent.cards[id]?.name ?? id : "Empty", asset: id ? this.catalog.cardVisual(id) : null,
          badge: id ? "−" : "+", description: id ? this.cardDescription(id) : "보유 카드를 클릭하여 준비합니다.",
          candidate: id ? { ...cloneLoadout(member.loadout), preparedCards: cards } : undefined, className: id ? "prepared-card" : "prepared-empty" }));
      }
    } else {
      for (const slot of EQUIPMENT_SLOT_ORDER) {
        const id = member.loadout.equipment[slot];
        const equipment = { ...member.loadout.equipment }; delete equipment[slot];
        slots.append(this.tile({ id: `slot-${slot}`, slot, label: id ? this.pack.combatContent.equipment[id]?.name ?? id : `Empty ${slot}`,
          asset: id ? this.catalog.equipmentVisual(id) : null, badge: slot, description: id ? this.equipmentDescription(id) : "클릭하여 이 부위의 장비를 찾습니다.",
          candidate: id ? { ...cloneLoadout(member.loadout), equipment } : undefined,
          action: id ? undefined : () => { view.tab = "equipment"; view.filter = slot; view.pages.equipment = 0; this.refresh(); }, className: "equipment-slot" }));
      }
    }
    const snapshot = deriveLoadoutSnapshot(actor, member.loadout, this.pack.combatContent, member.id);
    sidebar.append(slots, element("p", "loadout-core-stats", `AC ${snapshot.statistics.ac} · HP ${snapshot.statistics.maxHp} · ATK ${signed(snapshot.strike.attackModifier)}`),
      element("p", "loadout-deck-count", `${snapshot.deck.totalCards} Tactical Cards`));
    const panel = element("section", `loadout-panel collection-panel${view.tab === "deck" ? " deck-panel" : ""}`);
    const items: Tile[] = [];
    if (view.tab === "equipment") {
      panel.append(this.tabs("Equipment categories", [{ id: "all", label: "전체" }, ...EQUIPMENT_SLOT_ORDER.map((slot) => ({ id: slot, label: ({ weapon: "무기", armor: "방어구", shield: "방패", feet: "신발" })[slot] }))], view.filter,
        (id) => { view.filter = id as ViewState["filter"]; view.pages.equipment = 0; this.refresh(); }));
      for (const [id, owned] of Object.entries(state.collection.equipment).sort(([a], [b]) => a.localeCompare(b))) {
        const definition = this.pack.combatContent.equipment[id];
        if (!definition || (view.filter !== "all" && definition.slot !== view.filter)) continue;
        const used = members.reduce((sum, m) => sum + Object.values(m.loadout.equipment).filter((value) => value === id).length, 0);
        const equipped = member.loadout.equipment[definition.slot] === id;
        items.push({ id, label: definition.name, asset: this.catalog.equipmentVisual(id), badge: equipped ? "✓" : `×${owned - used}`,
          description: `${this.equipmentDescription(id)}\n보유 ${owned} · 사용 가능 ${owned - used}${equipped ? " · 현재 장착 중" : ""}`,
          candidate: equipped ? undefined : { ...cloneLoadout(member.loadout), equipment: { ...member.loadout.equipment, [definition.slot]: id } } });
      }
    } else if (view.tab === "cards") {
      panel.append(element("h2", undefined, "보유 카드"));
      for (const [id, owned] of Object.entries(state.collection.cards).sort(([a], [b]) => a.localeCompare(b))) {
        const used = members.reduce((sum, m) => sum + m.loadout.preparedCards.filter((value) => value === id).length, 0);
        items.push({ id, label: this.pack.combatContent.cards[id]?.name ?? id, asset: this.catalog.cardVisual(id), badge: `×${owned - used}`,
          description: `${this.cardDescription(id)}\n보유 ${owned} · 사용 가능 ${owned - used}`, candidate: { ...cloneLoadout(member.loadout), preparedCards: [...member.loadout.preparedCards, id] } });
      }
    } else {
      panel.append(element("h2", undefined, `${snapshot.deck.totalCards} Tactical Cards`));
      const grouped = new Map<string, { count: number; sources: string[] }>();
      for (const contribution of snapshot.deck.contributions) {
        const entry = grouped.get(contribution.cardDefinitionId) ?? { count: 0, sources: [] };
        entry.count += contribution.count; entry.sources.push(`${sourceLabel(contribution.source, this.pack)} ×${contribution.count}`);
        grouped.set(contribution.cardDefinitionId, entry);
      }
      for (const [id, entry] of grouped) items.push({ id, label: this.pack.combatContent.cards[id]?.name ?? id, asset: this.catalog.cardVisual(id), badge: `×${entry.count}`,
        description: `${this.cardDescription(id)}\n${entry.sources.join("\n")}`, className: "deck-contribution" });
    }
    const pageSize = view.tab === "deck" ? 12 : 24;
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    view.pages[view.tab] = Math.min(view.pages[view.tab], pages - 1);
    const grid = element("div", "loadout-items");
    for (const item of items.slice(view.pages[view.tab] * pageSize, (view.pages[view.tab] + 1) * pageSize)) grid.append(this.tile(item));
    if (!items.length) grid.append(element("p", "loadout-empty", "보유 항목이 없습니다."));
    panel.append(grid);
    if (view.tab === "deck") panel.append(this.stats());
    const pager = element("nav", "loadout-pagination"); pager.setAttribute("aria-label", "Grid pages");
    const previous = this.button("이전", "", () => { view.pages[view.tab]--; this.refresh(); }); previous.disabled = view.pages[view.tab] === 0;
    const next = this.button("다음", "", () => { view.pages[view.tab]++; this.refresh(); }); next.disabled = view.pages[view.tab] === pages - 1;
    pager.append(previous, element("span", undefined, `${view.pages[view.tab] + 1} / ${pages}`), next);
    panel.append(pager); workspace.append(sidebar, panel);
    const status = element("footer", "loadout-status", this.waiting ? "변경을 반영하는 중…" : this.message); status.setAttribute("role", "status");
    this.tooltip = element("aside", "loadout-tooltip"); this.tooltip.id = "loadout-detail"; this.tooltip.setAttribute("role", "tooltip"); this.tooltip.hidden = true;
    this.tooltip.addEventListener("pointerenter", () => clearTimeout(this.hideTimer));
    this.tooltip.addEventListener("pointerleave", () => { if (!this.pinned) this.hideTooltip(); });
    this.screen.append(header, nav, workspace, status, this.tooltip);
    const dismiss = (event: Event): void => {
      if (event.type === "scroll" && this.tooltip?.contains(event.target as Node)) return;
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event.type === "pointerdown" && (this.tooltip?.contains(event.target as Node) || this.tooltipAnchor?.contains(event.target as Node))) return;
      this.hideTooltip();
    };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", dismiss);
    window.addEventListener("resize", dismiss); window.addEventListener("scroll", dismiss, true);
    this.cleanup.push(() => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", dismiss); window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss, true); });
    this.screen.hidden = false;
    if (focusKey) this.screen.querySelectorAll<HTMLElement>("[data-focus-key]").forEach((node) => { if (node.dataset.focusKey === focusKey) node.focus({ preventScroll: true }); });
  }

  private view(): ViewState {
    let view = this.views.get(this.selectedMemberId);
    if (!view) { view = { tab: "equipment", filter: "all", pages: { equipment: 0, cards: 0, deck: 0 } }; this.views.set(this.selectedMemberId, view); }
    return view;
  }
  private refresh(): void { if (this.state) this.render(this.state, this.editableMemberIds); }
  private button(label: string, className: string, action: () => void): HTMLButtonElement {
    const button = element("button", className, label); button.type = "button"; button.dataset.focusKey = `${className}:${label}`;
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
    return action ? `${action.timing.kind === "reaction" ? "반응" : `${action.timing.actions} 액션`} · ${action.description}` : "";
  }
  private equipmentDescription(id: string): string {
    const equipment = this.pack.combatContent.equipment[id];
    if (!equipment) return "";
    const parts: string[] = [equipment.slot];
    const weapon = equipment.weaponProfile;
    if (weapon) parts.push(`${weapon.category} ${weapon.attackMode} · ${weapon.damage.count}d${weapon.damage.sides} ${weapon.damage.damageType} · ${weapon.rangeFeet}ft`);
    const armor = equipment.armorProfile;
    if (armor) parts.push(`${armor.category} · AC ${signed(armor.acItemBonus)} · DEX cap ${armor.dexCap ?? "none"}`);
    if (equipment.shieldBonus) parts.push(`Raise Shield · AC ${signed(equipment.shieldBonus)}`);
    for (const modifier of equipment.statModifiers) parts.push(`${modifier.label} ${signed(modifier.value)}`);
    for (const trait of equipment.traits) {
      const definition = this.pack.combatContent.traits[trait.id];
      parts.push(definition?.name ?? trait.id);
      for (const grant of definition?.cardGrants ?? []) parts.push(`${this.pack.combatContent.cards[grant.cardDefinitionId]?.name ?? grant.cardDefinitionId} ×${grant.count}`);
    }
    return parts.join(" · ");
  }
  private preview(candidate: PartyMemberLoadout): LoadoutPreview {
    if (!this.state) throw new Error("Loadout state is missing.");
    return previewLoadoutChange(this.state.party, this.state.collection, this.pack, this.selectedMemberId, candidate);
  }
  private apply(tile: Tile): void {
    if (!tile.candidate || this.waiting) return;
    if (!this.editableMemberIds.has(this.selectedMemberId)) { this.message = "Only this character's owner can edit this loadout."; this.refresh(); return; }
    const preview = this.preview(tile.candidate);
    if (!preview.legal) { this.message = preview.validation.issues.some((issue) => issue.code === "PREPARED_CAPACITY_EXCEEDED") ? "준비 카드를 먼저 해제하세요." : preview.validation.issues[0]?.message ?? "Unavailable"; this.refresh(); return; }
    this.waiting = { memberId: this.selectedMemberId, loadout: tile.candidate, label: tile.label };
    if (!this.handlers.onSetLoadout(this.selectedMemberId, tile.candidate)) { this.waiting = null; this.message = "연결 또는 이전 변경을 확인한 뒤 다시 시도하세요."; }
    this.refresh();
  }
  private tile(tile: Tile): HTMLElement {
    const button = element("button", `loadout-tile ${tile.className ?? "loadout-option"}`); button.type = "button";
    button.dataset.focusKey = tile.id; button.dataset.optionId = tile.id; if (tile.slot) button.dataset.slot = tile.slot;
    const preview = tile.candidate ? this.preview(tile.candidate) : undefined;
    const unavailable = Boolean(tile.candidate && (!preview?.legal || !this.editableMemberIds.has(this.selectedMemberId) || this.waiting));
    button.setAttribute("aria-disabled", String(unavailable));
    const verb = tile.candidate ? (tile.className === "equipment-slot" || tile.className === "prepared-card" ? "해제" : "장착") : "상세 보기";
    button.setAttribute("aria-label", `${tile.label} · ${tile.badge} · ${verb}`);
    const icon = element("span", "loadout-icon"); icon.setAttribute("aria-hidden", "true");
    if (tile.asset) Object.assign(icon.style, this.catalog.domAssetStyle(tile.asset, 52)); else { icon.classList.add("missing"); icon.textContent = "+"; }
    button.append(icon, element("span", "loadout-badge", unavailable ? `⊘ ${tile.badge}` : tile.badge), element("span", "sr-only", tile.label));
    let timer: ReturnType<typeof setTimeout> | undefined; let held = false; let cancelled = false; let origin: { x: number; y: number } | null = null;
    const clear = (): void => { clearTimeout(timer); timer = undefined; };
    const show = (): void => this.showTooltip(button, tile, preview);
    button.addEventListener("pointerenter", (event) => { if (event.pointerType === "mouse") { clear(); timer = setTimeout(show, 200); } });
    button.addEventListener("pointerleave", () => { clear(); if (!this.pinned && this.tooltipAnchor === button) this.hideTimer = setTimeout(() => this.hideTooltip(), 150); });
    button.addEventListener("focus", () => { if (button.matches(":focus-visible")) show(); });
    button.addEventListener("blur", () => { if (!this.pinned) this.hideTooltip(); });
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return; clear(); held = false; cancelled = false; origin = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => { held = true; this.pinned = true; show(); }, 450);
    });
    button.addEventListener("pointermove", (event) => { if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) { clear(); cancelled = true; } });
    button.addEventListener("pointerup", () => { clear(); origin = null; });
    button.addEventListener("pointercancel", () => { clear(); origin = null; cancelled = true; this.hideTooltip(); });
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      if ((held || cancelled) && event.detail !== 0) { event.preventDefault(); return; }
      clear(); if (tile.action) tile.action(); else if (tile.candidate) this.apply(tile); else { this.pinned = true; show(); }
    });
    const cancel = (): void => { clear(); if (origin) cancelled = true; };
    window.addEventListener("scroll", cancel, true); this.cleanup.push(() => { clear(); window.removeEventListener("scroll", cancel, true); });
    return button;
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
    tooltip.hidden = false; tooltip.style.left = "8px"; tooltip.style.top = "8px";
    const rect = anchor.getBoundingClientRect(); const bounds = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rect.right + 10, window.innerWidth - bounds.width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - bounds.height - 8))}px`;
  }
  private hideTooltip(): void { clearTimeout(this.hideTimer); if (this.tooltip) this.tooltip.hidden = true; this.tooltipAnchor?.removeAttribute("aria-describedby"); this.tooltipAnchor = null; this.pinned = false; }
  private disposeInteractions(): void { this.cleanup.forEach((cleanup) => cleanup()); this.cleanup = []; this.hideTooltip(); }
  private stats(preview?: LoadoutPreview): HTMLElement {
    const member = this.state?.party.members[this.selectedMemberId];
    if (!member) return element("div");
    const actor = this.pack.actorDefinitions[member.actorDefinitionId];
    if (!actor) return element("div");
    const shown = preview?.after ?? deriveLoadoutSnapshot(actor, member.loadout, this.pack.combatContent, member.id);
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
