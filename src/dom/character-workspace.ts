import { resolvePartyMemberDefinition } from "../character/member";
import { statisticButton, statisticPresentation } from "./actor-effect-view";
import type { AdventureState } from "../adventure";
import type { CompiledContentPack } from "../content";
import type { ActorState, CombatContent, DeckContributionSource, EquipmentSlotId } from "../game";
import { resolveStrike } from "../game";
import { equipmentTraits } from "../game/rules";
import { clonePartyLoadout, previewLoadoutChange, type LoadoutPartyMember, type LoadoutPreview, type PartyMemberLoadout } from "../loadout";
import type { AssetCatalog } from "../presentation";
import { cardLevelSummary } from "./card-level-view";
import { createCardFace } from "./card-face";
import { bindPressGesture } from "./detail-popover";
import { TraitView } from "./trait-view";

export interface CharacterSheetDestination {
  readonly memberId?: string;
  readonly tab?: "equipment" | "cards";
  readonly cardView?: "prepared" | "deck";
  readonly slot?: EquipmentSlotId;
  readonly rewardIds?: readonly string[];
}
export interface CharacterSheetHandlers {
  readonly onSetLoadout: (memberId: string, loadout: PartyMemberLoadout, settled: (accepted: boolean) => void) => boolean;
}
export interface CharacterSheetEditor extends CharacterSheetHandlers {
  readonly pack: CompiledContentPack;
  readonly state: AdventureState;
  readonly editable: boolean;
  readonly connection: string;
}

export function sheetNode<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
const el = sheetNode;
const signed = (n: number) => n >= 0 ? `+${n}` : String(n);
const slots: readonly EquipmentSlotId[] = ["armor", "weapon", "shield", "feet"];
const labels: Record<EquipmentSlotId, string> = { armor: "몸", weapon: "주손", shield: "보조손", feet: "악세서리" };
type Selection = { kind: "equipment"; id: string | null; slot: EquipmentSlotId } | { kind: "card"; id: string; index?: number };
interface View { tab: "equipment" | "cards"; cardView: "prepared" | "deck"; slot: EquipmentSlotId; choices: boolean }

/** Shared equipment/card workspace. Only an explicit editor adapter can submit a change. */
export class CharacterWorkspace {
  public readonly root = el("section", "", "ui-character-workspace");
  private actor: ActorState | null = null;
  private member: LoadoutPartyMember | undefined;
  private editor: CharacterSheetEditor | undefined;
  private readonly views = new Map<string, View>();
  private selected: Selection | null = null;
  private rewards: ReadonlySet<string> | null = null;
  private pending = false;
  private message = "";
  private destroyed = false;
  private cleanup: Array<() => void> = [];
  private cancelDrag: (() => void) | null = null;
  private inspection: HTMLElement | null = null;
  private readonly overlay = el("div", "", "ui-character-workspace__overlays");
  private readonly traits: TraitView;
  private readonly traitList;
  public constructor(private readonly content: CombatContent, private readonly catalog: AssetCatalog,
    private readonly onBusy: (busy: boolean) => void = () => undefined) {
    this.traits = new TraitView(content.traits, this.overlay); this.traitList = this.traits.createList();
  }
  public get busy(): boolean { return this.pending; }
  private get editable(): boolean { return Boolean(this.editor?.editable && this.member); }
  private get connected(): boolean { return !this.editor || this.editor.connection === "connected"; }
  private view(): View {
    const id = this.actor?.id ?? "";
    let view = this.views.get(id);
    if (!view) { view = { tab: "equipment", cardView: this.editor ? "prepared" : "deck", slot: "weapon", choices: true }; this.views.set(id, view); }
    return view;
  }
  public navigate(destination: CharacterSheetDestination): void {
    this.selected = null; this.message = "";
    const view = this.view();
    view.tab = destination.tab ?? "equipment";
    view.cardView = destination.cardView ?? (this.editor ? "prepared" : "deck");
    this.rewards = destination.rewardIds ? new Set(destination.rewardIds) : null;
    const rewardSlot = destination.rewardIds?.map(id => this.content.equipment[id]?.slot).find(Boolean);
    view.slot = destination.slot ?? rewardSlot ?? "weapon"; view.choices = true;
    this.render();
  }
  public update(actor: ActorState, member?: LoadoutPartyMember, editor?: CharacterSheetEditor): void {
    if (this.actor?.id !== actor.id) { this.selected = null; this.message = ""; }
    if (this.editable && !editor?.editable) { this.selected = null; this.message = "읽기 전용 · 다른 플레이어 또는 현재 단계에서는 변경할 수 없습니다."; }
    this.actor = actor; this.member = member; this.editor = editor;
    this.render();
  }
  public reportError(message: string): void {
    if (this.destroyed) return;
    this.pending = false; this.onBusy(false); this.message = message; this.render();
  }
  public dismissDetails(): void { this.inspection?.remove(); this.inspection = null; this.traits.dismiss(); this.cancelDrag?.(); }
  /** Returns true when Escape consumed a local, uncommitted interaction. */
  public escape(): boolean {
    if (this.pending) return true;
    if (this.inspection) { this.dismissDetails(); return true; }
    if (this.cancelDrag) { this.cancelDrag(); return true; }
    if (this.selected) { this.selected = null; this.message = "비교를 취소했습니다."; this.render(); return true; }
    return false;
  }
  public destroy(): void { this.destroyed = true; this.dispose(); this.traitList.clear(); this.traits.destroy(); this.root.remove(); }
  private dispose(): void { this.dismissDetails(); this.cleanup.forEach(fn => fn()); this.cleanup = []; }
  private button(label: string, key: string, action: () => void, className = ""): HTMLButtonElement {
    const button = el("button", label, `ui-button ${className}`); button.type = "button"; button.dataset.focusKey = key;
    button.addEventListener("click", () => { if (!this.pending) action(); }); button.disabled = this.pending; return button;
  }
  private tabs(label: string, choices: Array<[string, string]>, selected: string, choose: (id: string) => void): HTMLElement {
    const nav = el("nav", "", "ui-character-workspace__tabs"); nav.setAttribute("role", "tablist"); nav.setAttribute("aria-label", label);
    choices.forEach(([id, label], index) => {
      const button = this.button(label, id, () => choose(id)); button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(id === selected)); button.tabIndex = id === selected ? 0 : -1;
      button.addEventListener("keydown", event => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : event.key === "ArrowRight" ? (index + 1) % choices.length : event.key === "ArrowLeft" ? (index + choices.length - 1) % choices.length : -1;
        if (next < 0 || this.pending) return; event.preventDefault(); choose(choices[next]![0]); this.focus(choices[next]![0]);
      }); nav.append(button);
    }); return nav;
  }
  private focus(key: string): void { [...this.root.querySelectorAll<HTMLElement>("[data-focus-key]")].find(node => node.dataset.focusKey === key)?.focus({ preventScroll: true }); }
  private render(): void {
    if (!this.actor || this.destroyed) return;
    const active = this.root.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focused = active?.dataset.focusKey;
    const focusedTrait = active?.dataset.traitId;
    const scrolls = new Map([...this.root.querySelectorAll<HTMLElement>("[data-scroll]")].map(node => [node.dataset.scroll, node.scrollTop]));
    this.dispose(); this.traitList.clear();
    const view = this.view();
    const nav = this.tabs("캐릭터 구성", [["equipment", "장비"], ["cards", "카드"]], view.tab, id => {
      this.selected = null; view.tab = id as View["tab"]; this.render();
    });
    const status = el("p", this.pending ? this.connected ? "적용 중… 서버 확정을 기다립니다." : "재연결 중 · 변경 결과를 확인하고 있습니다." : this.message,
      "ui-status ui-character-workspace__status");
    if (!this.pending && (!this.message || this.message.startsWith("비교"))) status.classList.add("sr-only");
    status.setAttribute("role", "status"); status.hidden = !status.textContent;
    const access = el("span", this.editable ? "편집 가능" : this.editor ? "읽기 전용 · 다른 플레이어 또는 현재 단계" : "읽기 전용", "ui-character-workspace__access");
    nav.append(access);
    this.root.replaceChildren(nav, view.tab === "equipment" ? this.equipment() : this.cards(), status, this.overlay);
    this.root.setAttribute("aria-busy", String(this.pending)); this.root.dataset.editable = String(this.editable);
    this.root.querySelectorAll<HTMLElement>("[data-scroll]").forEach(node => { node.scrollTop = scrolls.get(node.dataset.scroll) ?? 0; });
    if (focused) this.focus(focused);
    else if (focusedTrait) [...this.root.querySelectorAll<HTMLElement>("[data-trait-id]")].find(chip => chip.dataset.traitId === focusedTrait)?.focus({ preventScroll: true });
  }
  private equipped(slot: EquipmentSlotId): string | undefined { return this.actor?.equipmentIds.find(id => this.content.equipment[id]?.slot === slot); }
  private art(id: string | undefined, size: number): HTMLElement {
    const art = el("span", id ? "" : "+", "ui-character-workspace__art"); art.setAttribute("aria-hidden", "true");
    const visual = id ? this.catalog.equipmentVisual(id) : null;
    if (visual) Object.assign(art.style, this.catalog.domAssetStyle(visual, size)); return art;
  }
  private choose(selection: Selection): void { this.selected = selection; this.message = "비교 중 · 확정 전에는 장착 상태가 바뀌지 않습니다."; this.render(); }
  private equipment(): HTMLElement {
    const area = el("div", "", "ui-character-workspace__equipment");
    const row = el("div", "", "ui-character-workspace__slots");
    const view = this.view();
    for (const slot of slots) {
      const id = this.equipped(slot); const name = id ? this.content.equipment[id]!.name : `빈 ${labels[slot]}`;
      const tile = this.button("", `slot-${slot}`, () => { view.slot = slot; view.choices = true; this.selected = null; this.render(); }, "ui-character-workspace__slot");
      tile.setAttribute("aria-label", `${labels[slot]} · ${name}`); tile.setAttribute("aria-pressed", String(view.slot === slot));
      tile.append(el("span", labels[slot]), this.art(id, 58), el("strong", name));
      const wrapper = el("div", "", "ui-character-workspace__slot-wrap"); wrapper.dataset.slot = slot; wrapper.append(tile);
      if (id && this.editable) wrapper.append(this.dragHandle(id, slot, true));
      row.append(wrapper);
    }
    const lower = el("div", "", "ui-character-workspace__lower");
    const selection = this.selected?.kind === "equipment" ? this.selected : null;
    const current = this.equipped(view.slot);
    const detail = this.itemDetail(selection?.id ?? current, view.slot);
    const preview = selection ? this.preview(selection) : undefined;
    if (selection) detail.append(this.comparison(preview));
    lower.append(detail);
    if (this.editable && view.choices) {
      lower.classList.add("ui-character-workspace__lower--split");
      const choices = el("section", "", "ui-panel ui-panel--workspace ui-character-workspace__choices"); choices.setAttribute("aria-label", `${labels[view.slot]} 교체`);
      const title = el("header", "", "ui-character-workspace__choice-header"); title.append(el("h3", `${labels[view.slot]} 교체`), this.button("×", "close-choices", () => { view.choices = false; this.selected = null; this.render(); }));
      title.lastElementChild!.setAttribute("aria-label", "교체 목록 닫기"); choices.append(title);
      const list = el("div", "", "ui-character-workspace__choice-list"); list.dataset.scroll = "equipment-choices";
      const ids = Object.keys(this.editor!.state.collection.equipment).filter(id => this.content.equipment[id]?.slot === view.slot && (!this.rewards || this.rewards.has(id) || id === current));
      if (current && !ids.includes(current)) ids.push(current);
      ids.sort((a, b) => a === current ? -1 : b === current ? 1 : a.localeCompare(b));
      for (const id of ids) {
        const item = this.content.equipment[id]!;
        const candidate: Selection = { kind: "equipment", id, slot: view.slot };
        const legal = id === current || this.preview(candidate)?.legal;
        const button = this.button("", `equipment-${id}`, () => { if (id === current) { this.selected = null; this.render(); } else this.choose(candidate); }, "ui-character-workspace__choice");
        button.setAttribute("aria-label", `${item.name}${id === current ? " · 장착중" : " · 비교"}`);
        button.setAttribute("aria-pressed", String(selection ? selection.id === id : id === current));
        button.dataset.available = String(Boolean(legal));
        const copy = el("span"); copy.append(el("strong", item.name), el("small", id === current ? "장착중" : this.usage(id, "equipment")), el("small", this.equipmentText(id)));
        if (!legal) copy.append(el("small", this.preview(candidate)?.validation.issues[0]?.message ?? "사용 불가", "ui-character-workspace__invalid"));
        button.append(this.art(id, 40), copy);
        const wrapper = el("div", "", "ui-character-workspace__choice-wrap"); wrapper.append(button);
        if (id !== current) wrapper.append(this.dragHandle(id, view.slot, false));
        list.append(wrapper);
      }
      if (!ids.length) list.append(el("p", "이 부위의 보유 장비가 없습니다."));
      if (current) list.append(this.button("장비 해제 비교", "remove-equipment", () => this.choose({ kind: "equipment", id: null, slot: view.slot })));
      choices.append(list);
      const back = el("div", "장비함으로 되돌리기 · 장착 장비를 끌어 놓으면 해제를 비교합니다.", "ui-character-workspace__return"); back.dataset.dropReturn = "true"; choices.append(back);
      this.filterControl(choices); lower.append(choices);
    }
    area.append(row, lower); return area;
  }
  private itemDetail(id: string | undefined | null, slot: EquipmentSlotId): HTMLElement {
    const detail = el("section", "", "ui-character-workspace__detail"); detail.dataset.scroll = "item-detail";
    const item = id ? this.content.equipment[id] : undefined;
    const heading = el("div", "", "ui-character-workspace__item-heading");
    const copy = el("div"); copy.append(el("h3", item?.name ?? `빈 ${labels[slot]}`));
    if (item) {
      this.traitList.render(equipmentTraits(item).map(trait => trait.id), chips => copy.append(chips));
      copy.append(el("p", this.equipmentText(item.id)));
    }
    heading.append(this.art(id ?? undefined, 90), copy); detail.append(heading);
    if (slot === "weapon" && this.actor) {
      const strike = resolveStrike(this.actor, { content: this.content });
      const attack = el("p", "현재 공격 ");
      const attackChange = statisticPresentation(this.actor, actor => { const s = resolveStrike(actor, { content: this.content }); return { value: s.attackModifier, sources: s.sources }; });
      const damageChange = statisticPresentation(this.actor, actor => { const s = resolveStrike(actor, { content: this.content }); return { value: s.damage.flatModifier, sources: s.damage.sources }; });
      const attackValue = statisticButton("Attack", signed(strike.attackModifier), attackChange, (text, anchor) => this.inspect(anchor, text));
      const damageValue = statisticButton("Damage", signed(strike.damage.flatModifier), damageChange, (text, anchor) => this.inspect(anchor, text));
      attackValue.dataset.focusKey = "attack-value"; damageValue.dataset.focusKey = "damage-value";
      attack.append(attackValue, ` · ${strike.damage.count}d${strike.damage.sides}`, damageValue, ` ${strike.damage.damageType} · Reach ${strike.rangeFeet} ft.`);
      detail.append(attack);
    }
    return detail;
  }
  private equipmentText(id: string): string {
    const item = this.content.equipment[id]; if (!item) return "";
    const parts: string[] = [];
    if (item.weaponProfile) { const w = item.weaponProfile; parts.push(`${w.damage.count}d${w.damage.sides} ${w.damage.damageType} · Reach ${w.rangeFeet} ft.`); }
    if (item.armorProfile) parts.push(`AC ${signed(item.armorProfile.acItemBonus)} · DEX 상한 ${item.armorProfile.dexCap ?? "없음"}`);
    if (item.shieldBonus) parts.push(`Raise Shield · AC ${signed(item.shieldBonus)}`);
    for (const modifier of item.statModifiers) parts.push(`${modifier.label} ${signed(modifier.value)}`);
    for (const trait of equipmentTraits(item)) for (const grant of this.content.traits[trait.id]?.cardGrants ?? []) parts.push(`${this.content.cards[grant.cardDefinitionId]?.name ?? grant.cardDefinitionId} ×${grant.count}`);
    return parts.join(" · ");
  }
  private usage(id: string, kind: "equipment" | "cards"): string {
    if (!this.editor) return "";
    const users = Object.values(this.editor.state.party.members).flatMap(member => {
      const count = (kind === "equipment" ? Object.values(member.loadout.equipment) : member.loadout.preparedCards).filter(value => value === id).length;
      return count ? [{ name: resolvePartyMemberDefinition(member, this.editor!.pack)?.name ?? member.id, count }] : [];
    });
    const owned = this.editor.state.collection[kind][id] ?? 0;
    return `보유 ${owned} · 사용 가능 ${owned - users.reduce((sum, user) => sum + user.count, 0)}${users.length ? ` · 사용 중: ${users.map(user => `${user.name} ×${user.count}`).join(", ")}` : ""}`;
  }
  private filterControl(parent: HTMLElement): void {
    if (this.rewards) parent.append(this.button("보상 필터 해제", "reward-filter", () => { this.rewards = null; this.selected = null; this.render(); }));
  }
  private cards(): HTMLElement {
    const area = el("div", "", "ui-character-workspace__cards"); const view = this.view();
    area.append(this.tabs("카드 보기", [["prepared", this.editable ? "준비 편집" : "준비 카드"], ["deck", "전체 덱"]], view.cardView, id => { view.cardView = id as View["cardView"]; this.selected = null; this.render(); }));
    const content = el("div", "", "ui-character-workspace__card-content"); content.dataset.scroll = "cards";
    if (view.cardView === "deck") {
      const grouped = new Map<string, { count: number; sources: string[] }>();
      for (const contribution of this.actor!.deckContributions) {
        const entry = grouped.get(contribution.cardDefinitionId) ?? { count: 0, sources: [] };
        entry.count += contribution.count; entry.sources.push(`${this.sourceLabel(contribution.source)} ×${contribution.count}`); grouped.set(contribution.cardDefinitionId, entry);
      }
      content.append(el("h3", `전체 덱 · ${[...grouped.values()].reduce((sum, entry) => sum + entry.count, 0)}장`));
      const grid = el("div", "", "ui-character-workspace__card-grid");
      for (const [id, entry] of grouped) grid.append(this.cardTile(id, `deck-${id}`, `×${entry.count}`, entry.sources.join(" · ")));
      if (!grouped.size) grid.append(el("p", "구성된 카드가 없습니다.")); content.append(grid);
      if (this.actor!.innateActionIds.length) content.append(el("h3", "고유 행동"), el("p", this.actor!.innateActionIds.map(id => this.content.actions[id]?.name ?? id).join(" · ")));
    } else {
      content.classList.add("ui-character-workspace__card-content--prepared");
      const prepared = this.member?.loadout.preparedCards ?? this.actor!.deckContributions.filter(c => c.source.kind === "prepared").flatMap(c => Array<string>(c.count).fill(c.cardDefinitionId));
      const capacity = this.editor && this.member ? resolvePartyMemberDefinition(this.member, this.editor.pack)?.loadoutProfile.preparedCardCapacity : prepared.length;
      content.append(el("h3", `준비 카드 ${prepared.length}/${capacity ?? prepared.length}`));
      const row = el("div", "", "ui-character-workspace__prepared");
      for (let index = 0; index < (capacity ?? prepared.length); index++) {
        const id = prepared[index];
        if (id) row.append(this.cardTile(id, `prepared-${index}`, "준비됨", this.cardText(id), this.editable ? { kind: "card", id, index } : undefined));
        else row.append(el("div", "+ 빈 슬롯", "ui-character-workspace__empty-card"));
      }
      content.append(row);
      if (this.editable) {
        content.append(el("h3", "보유 카드")); const grid = el("div", "", "ui-character-workspace__card-grid ui-character-workspace__owned"); grid.dataset.scroll = "owned-cards";
        for (const id of Object.keys(this.editor!.state.collection.cards).sort()) {
          if (this.rewards && !this.rewards.has(id)) continue;
          grid.append(this.cardTile(id, `owned-${id}`, this.usage(id, "cards"), this.cardText(id), { kind: "card", id }));
        }
        if (!grid.children.length) grid.append(el("p", "보유 카드가 없습니다.")); content.append(grid); this.filterControl(content);
      }
    }
    area.append(content);
    if (this.selected?.kind === "card") {
      const detail = el("section", "", "ui-character-workspace__card-comparison");
      detail.append(el("h3", this.content.cards[this.selected.id]?.name ?? this.selected.id), el("p", this.cardText(this.selected.id)), this.comparison(this.preview(this.selected)));
      area.append(detail); area.classList.add("ui-character-workspace__cards--comparing");
    }
    return area;
  }
  private cardText(id: string): string {
    const card = this.content.cards[id]; const action = card && this.content.actions[card.actionId];
    return card && action ? `${cardLevelSummary(card, this.content, this.actor ?? undefined)} · ${action.timing.kind === "reaction" ? "반응" : `${action.timing.actions} 액션`} · ${action.description}` : "";
  }
  private cardTile(id: string, key: string, badge: string, description: string, selection?: Selection): HTMLElement {
    const card = this.content.cards[id]; const action = card && this.content.actions[card.actionId];
    const button = el("button", "", "ui-character-workspace__card"); button.type = "button"; button.dataset.focusKey = key; button.disabled = this.pending;
    button.setAttribute("aria-label", `${card?.name ?? id} · ${badge}`);
    button.append(createCardFace({ catalog: this.catalog, cardId: id, name: card?.name ?? id, timing: action?.timing, badges: [badge] }));
    const preview = selection ? this.preview(selection) : undefined;
    if (preview && !preview.legal) button.dataset.available = "false";
    const show = () => this.inspect(button, `${card?.name ?? id} · ${description}${preview && !preview.legal ? ` · ${preview.validation.issues.map(i => i.message).join(" · ")}` : ""}`);
    this.cleanup.push(bindPressGesture(button, { holdMs: 450, onHold: show, onTap: () => { if (this.pending) return; if (selection) this.choose(selection); else show(); }, onCancel: () => this.dismissDetails() }));
    const wrapper = el("div", "", "ui-character-workspace__card-entry"); wrapper.append(button);
    if (key.startsWith("deck-")) wrapper.append(el("small", description));
    return wrapper;
  }
  private inspect(anchor: HTMLElement, text: string): void {
    this.inspection?.remove();
    const note = el("aside", "", "ui-panel ui-panel--popover ui-character-workspace__inspection"); note.setAttribute("role", "tooltip");
    note.append(el("p", text), this.button("상세 닫기", "close-inspection", () => { this.dismissDetails(); anchor.focus(); })); this.root.append(note); this.inspection = note;
  }
  private sourceLabel(source: DeckContributionSource): string {
    if (source.kind === "prepared") return "준비 카드";
    if (source.kind === "base") return `기본 · ${this.content.traits[source.sourceId]?.name ?? this.content.actions[source.sourceId]?.name ?? source.sourceId}`;
    return `장비 · ${this.content.equipment[source.equipmentId]?.name ?? source.equipmentId} / ${this.content.traits[source.traitId]?.name ?? source.traitId}`;
  }
  private candidate(selection: Selection): PartyMemberLoadout | undefined {
    if (!this.member) return;
    const current = clonePartyLoadout(this.member.loadout);
    if (selection.kind === "equipment") {
      const equipment = { ...current.equipment };
      if (selection.id) equipment[selection.slot] = selection.id; else delete equipment[selection.slot];
      return { ...current, equipment };
    }
    if (selection.index !== undefined) {
      if (current.preparedCards[selection.index] !== selection.id) return;
      return { ...current, preparedCards: current.preparedCards.filter((_, index) => index !== selection.index) };
    }
    return { ...current, preparedCards: [...current.preparedCards, selection.id] };
  }
  private preview(selection: Selection): LoadoutPreview | undefined {
    const candidate = this.candidate(selection); if (!candidate || !this.editor || !this.member) return;
    return previewLoadoutChange(this.editor.state.party, this.editor.state.collection, this.editor.pack, this.member.id, candidate);
  }
  private comparison(preview?: LoadoutPreview): HTMLElement {
    const region = el("section", "", "ui-character-workspace__comparison"); region.setAttribute("aria-label", "선택 항목 비교");
    const copy = el("div", "", "ui-character-workspace__comparison-copy");
    if (preview?.after) {
      const { before, after } = preview;
      const damage = (s: typeof before.strike) => `${s.damage.count}d${s.damage.sides}${signed(s.damage.flatModifier)} ${s.damage.damageType}`;
      const values = [["AC", before.statistics.ac, after.statistics.ac], ["최대 HP", before.statistics.maxHp, after.statistics.maxHp], ["Reflex DC", before.statistics.reflex.dc, after.statistics.reflex.dc], ["Class DC", before.statistics.classDc, after.statistics.classDc], ["공격", before.strike.attackModifier, after.strike.attackModifier], ["피해", damage(before.strike), damage(after.strike)], ["Reach", before.strike.rangeFeet, after.strike.rangeFeet], ["전체 덱", before.deck.totalCards, after.deck.totalCards]] as const;
      for (const [label, old, next] of values) {
        const line = el("p", `${label} ${old} → ${next}`); if (typeof old === "number" && typeof next === "number" && next !== old) line.dataset.change = next > old ? "increase" : "decrease"; copy.append(line);
      }
      const changes = [...preview.addedCards.map(c => `+ ${this.content.cards[c.cardDefinitionId]?.name ?? c.cardDefinitionId} ×${c.count}`), ...preview.removedCards.map(c => `− ${this.content.cards[c.cardDefinitionId]?.name ?? c.cardDefinitionId} ×${c.count}`), ...preview.addedContextActionIds.map(id => `+ ${this.content.actions[id]?.name ?? id}`), ...preview.removedContextActionIds.map(id => `− ${this.content.actions[id]?.name ?? id}`)];
      copy.append(el("p", changes.join(" · ")));
    }
    if (!preview?.legal) copy.append(el("p", preview?.validation.issues.map(issue => issue.message).join(" · ") ?? "최신 상태에서 이 항목을 변경할 수 없습니다.", "ui-character-workspace__invalid"));
    const actions = el("div", "", "ui-character-workspace__confirm");
    const selected = this.selected;
    const label = selected?.kind === "card" ? selected.index !== undefined ? "해제" : "준비 추가" : selected?.id === null ? "해제" : selected?.kind === "equipment" && this.equipped(selected.slot) ? "교환" : "장착";
    if (this.editable) { const apply = this.button(label, "apply", () => this.apply(), "ui-button--primary"); apply.disabled = this.pending || !this.connected || !preview?.legal; actions.append(apply); }
    actions.append(this.button("비교 취소", "cancel", () => { this.selected = null; this.message = "비교를 취소했습니다."; this.render(); }));
    region.append(copy, actions); return region;
  }
  private apply(): void {
    if (!this.selected || !this.editor || !this.member || this.pending || !this.editable || !this.connected) return;
    const candidate = this.candidate(this.selected); const preview = this.preview(this.selected);
    if (!candidate || !preview?.legal) { this.message = "최신 비교 내용을 확인하세요."; this.render(); return; }
    this.pending = true; this.onBusy(true);
    if (!this.editor.onSetLoadout(this.member.id, candidate, accepted => {
      if (this.destroyed) return;
      this.pending = false; this.onBusy(false);
      if (accepted) this.selected = null;
      this.message = accepted ? "저장됨" : "변경하지 못했습니다. 최신 비교 내용을 확인하고 다시 시도하세요."; this.render();
    })) { this.pending = false; this.onBusy(false); this.message = "연결 또는 이전 변경을 확인한 뒤 다시 시도하세요."; }
    this.render();
  }
  private dragHandle(id: string, slot: EquipmentSlotId, removing: boolean): HTMLButtonElement {
    const handle = this.button("↕", `drag-${removing ? "slot" : "item"}-${id}`, () => undefined, "ui-character-workspace__drag-handle");
    handle.setAttribute("aria-label", `${this.content.equipment[id]?.name ?? id} 끌어서 이동`);
    handle.disabled = this.pending || !this.connected;
    let pointer = -1; let startX = 0; let startY = 0; let active = false; let ghost: HTMLElement | null = null;
    const cancel = () => { active = false; ghost?.remove(); ghost = null; if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer); this.root.querySelectorAll("[data-drop-active]").forEach(node => node.removeAttribute("data-drop-active")); if (this.cancelDrag === cancel) this.cancelDrag = null; };
    const targetAt = (event: PointerEvent) => document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".ui-character-workspace__slot-wrap, [data-drop-return]");
    handle.addEventListener("pointerdown", event => { if (this.pending || !this.editable || event.button !== 0) return; event.preventDefault(); handle.focus(); active = true; pointer = event.pointerId; startX = event.clientX; startY = event.clientY; this.cancelDrag = cancel; handle.setPointerCapture(pointer); });
    handle.addEventListener("pointermove", event => {
      if (!active || event.pointerId !== pointer) return;
      if (!ghost && Math.hypot(event.clientX - startX, event.clientY - startY) < 8) return;
      if (!ghost) { ghost = el("div", this.content.equipment[id]?.name ?? id, "ui-panel ui-character-workspace__drag-ghost"); this.root.append(ghost); }
      ghost.style.left = `${event.clientX + 12}px`; ghost.style.top = `${event.clientY + 12}px`;
      this.root.querySelectorAll("[data-drop-active]").forEach(node => node.removeAttribute("data-drop-active"));
      const target = targetAt(event); if (target && this.root.contains(target)) target.dataset.dropActive = "true";
    });
    handle.addEventListener("pointerup", event => {
      if (!active || event.pointerId !== pointer) return;
      const moved = Boolean(ghost); const target = targetAt(event);
      const valid = target && this.root.contains(target) && (removing ? Boolean(target.dataset.dropReturn) : target.dataset.slot === slot);
      cancel(); if (!moved) return;
      if (valid) { this.view().slot = slot; this.choose({ kind: "equipment", id: removing ? null : id, slot }); }
      else { this.message = "이 위치에는 놓을 수 없습니다. 맞는 슬롯이나 장비함으로 옮기세요."; this.render(); }
    });
    handle.addEventListener("pointercancel", cancel); handle.addEventListener("lostpointercapture", cancel); this.cleanup.push(cancel); return handle;
  }
}
