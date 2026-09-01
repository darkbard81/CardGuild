import type { AdventureState } from "../adventure";
import type { CompiledContentPack } from "../content";
import type { DeckContribution, DeckContributionSource, EquipmentSlotId } from "../game";
import {
  EQUIPMENT_SLOT_ORDER,
  deriveLoadoutSnapshot,
  previewLoadoutChange,
  type LoadoutPreview,
  type PartyMemberLoadout,
} from "../loadout";
import type { AssetCatalog, PresentationAssetId } from "../presentation";

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

function cloneLoadout(loadout: PartyMemberLoadout): PartyMemberLoadout {
  return { equipment: { ...loadout.equipment }, preparedCards: [...loadout.preparedCards] };
}

function sourceLabel(source: DeckContributionSource, pack: CompiledContentPack): string {
  if (source.kind === "prepared") return "Prepared Card";
  if (source.kind === "base") return source.sourceId;
  const equipment = pack.combatContent.equipment[source.equipmentId]?.name ?? source.equipmentId;
  const trait = pack.combatContent.traits[source.traitId]?.name ?? source.traitId;
  return `${equipment} / ${trait}`;
}

export interface LoadoutUiHandlers {
  readonly onSetLoadout: (memberId: string, loadout: PartyMemberLoadout) => void;
  readonly onDone: () => void;
}

type Editor =
  | { readonly kind: "equipment"; readonly slot: EquipmentSlotId }
  | { readonly kind: "cards" };

interface PendingCandidate {
  readonly label: string;
  readonly loadout: PartyMemberLoadout;
  readonly preview: LoadoutPreview;
}

export class LoadoutUi {
  private readonly screen = required<HTMLElement>("#loadout-screen");
  private selectedMemberId: string | null = null;
  private editor: Editor = { kind: "equipment", slot: "weapon" };
  private pending: PendingCandidate | null = null;
  private state: AdventureState | null = null;
  private editableMemberIds: ReadonlySet<string> = new Set();

  public constructor(
    private readonly pack: CompiledContentPack,
    private readonly catalog: AssetCatalog,
    private readonly handlers: LoadoutUiHandlers,
  ) {}

  public setVisible(visible: boolean): void {
    this.screen.hidden = !visible;
  }

  public render(state: AdventureState, editableMemberIds: ReadonlySet<string> = new Set()): void {
    this.state = state;
    this.editableMemberIds = new Set(editableMemberIds);
    const members = Object.values(state.party.members).sort((left, right) => left.id.localeCompare(right.id));
    const member = members.find((candidate) => candidate.id === this.selectedMemberId) ??
      members.find((candidate) => this.editableMemberIds.has(candidate.id)) ??
      members[0];
    if (!member) throw new Error("Loadout Builder requires at least one party member.");
    this.selectedMemberId = member.id;
    const editable = this.editableMemberIds.has(member.id);
    const actor = this.pack.actorDefinitions[member.actorDefinitionId];
    if (!actor) throw new Error(`Actor definition "${member.actorDefinitionId}" is missing.`);

    this.screen.replaceChildren();
    const header = element("header", "loadout-header");
    const title = element("div");
    title.append(
      element("p", "eyebrow", editable ? "Your Character Build" : "Read-only Party Build"),
      element("h1", undefined, actor.name),
      element("p", "loadout-subtitle", "Owned copies stay in Collection while equipped and prepared."),
    );
    const done = element("button", "loadout-done", "Done");
    done.type = "button";
    done.addEventListener("click", this.handlers.onDone);
    header.append(title, done);

    if (members.length > 1) {
      const tabs = element("div", "loadout-member-tabs");
      tabs.setAttribute("role", "tablist");
      for (const candidate of members) {
        const definition = this.pack.actorDefinitions[candidate.actorDefinitionId];
        const tab = element("button", "loadout-member-tab", definition?.name ?? candidate.id);
        tab.type = "button";
        tab.dataset.memberId = candidate.id;
        tab.dataset.owned = String(this.editableMemberIds.has(candidate.id));
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(candidate.id === member.id));
        tab.addEventListener("click", () => {
          this.selectedMemberId = candidate.id;
          this.pending = null;
          this.render(state, this.editableMemberIds);
        });
        tabs.append(tab);
      }
      header.append(tabs);
    }

    const grid = element("div", "loadout-grid");
    grid.append(
      this.renderCollection(state),
      this.renderLoadout(state, member.id, actor.loadoutProfile.preparedCardCapacity),
      this.renderDeck(state, member.id),
    );
    const detail = element("section", "loadout-detail");
    detail.id = "loadout-detail";
    detail.setAttribute("aria-live", "polite");
    this.screen.append(header, grid, detail);
    this.renderCandidateDetail();
    this.setVisible(true);
  }

  private icon(assetId: PresentationAssetId | null, label: string, size = 48): HTMLElement {
    const wrapper = element("span", "loadout-icon");
    wrapper.setAttribute("aria-hidden", "true");
    wrapper.title = label;
    if (!assetId) {
      wrapper.classList.add("missing");
      wrapper.textContent = label.slice(0, 1);
      return wrapper;
    }
    Object.assign(wrapper.style, this.catalog.domAtlasStyle(assetId, size));
    return wrapper;
  }

  private renderCollection(state: AdventureState): HTMLElement {
    const panel = element("section", "loadout-panel collection-panel");
    panel.append(element("p", "loadout-panel-label", "Collection"), element("h2", undefined, "Owned"));
    const list = element("div", "collection-list");
    const equipment = Object.entries(state.collection.equipment).sort(([left], [right]) => left.localeCompare(right));
    const cards = Object.entries(state.collection.cards).sort(([left], [right]) => left.localeCompare(right));
    for (const [id, count] of equipment) {
      const definition = this.pack.combatContent.equipment[id];
      const item = element("div", "collection-item");
      item.append(
        this.icon(this.catalog.equipmentVisual(id), definition?.name ?? id),
        element("span", "collection-name", definition?.name ?? id),
        element("strong", "collection-count", `×${count}`),
      );
      list.append(item);
    }
    for (const [id, count] of cards) {
      const definition = this.pack.combatContent.cards[id];
      const item = element("div", "collection-item");
      item.append(
        this.icon(this.catalog.cardVisual(id), definition?.name ?? id),
        element("span", "collection-name", definition?.name ?? id),
        element("strong", "collection-count", `×${count}`),
      );
      list.append(item);
    }
    if (!list.childElementCount) list.append(element("p", "loadout-empty", "No transferable items."));
    panel.append(list);
    return panel;
  }

  private renderLoadout(state: AdventureState, memberId: string, capacity: number): HTMLElement {
    const member = state.party.members[memberId];
    if (!member) throw new Error(`Party member "${memberId}" is missing.`);
    const panel = element("section", "loadout-panel equipped-panel");
    const editable = this.editableMemberIds.has(memberId);
    panel.dataset.editable = String(editable);
    panel.append(element("p", "loadout-panel-label", "Loadout"), element("h2", undefined, "Equipment"));
    const slots = element("div", "equipment-slots");
    for (const slot of EQUIPMENT_SLOT_ORDER) {
      const id = member.loadout.equipment[slot];
      const definition = id ? this.pack.combatContent.equipment[id] : undefined;
      const button = element("button", "equipment-slot");
      button.type = "button";
      button.disabled = !editable;
      button.dataset.slot = slot;
      button.setAttribute("aria-pressed", String(this.editor.kind === "equipment" && this.editor.slot === slot));
      button.append(
        this.icon(id ? this.catalog.equipmentVisual(id) : null, definition?.name ?? "Empty"),
        element("span", "slot-label", slot),
        element("strong", undefined, definition?.name ?? "Empty"),
      );
      button.addEventListener("click", () => {
        this.editor = { kind: "equipment", slot };
        this.pending = null;
        this.render(state, this.editableMemberIds);
      });
      slots.append(button);
    }
    panel.append(slots, element("h2", "prepared-heading", `Prepared Cards ${member.loadout.preparedCards.length}/${capacity}`));
    const prepared = element("div", "prepared-list");
    member.loadout.preparedCards.forEach((id, index) => {
      const definition = this.pack.combatContent.cards[id];
      const row = element("div", "prepared-card");
      const remove = element("button", "prepared-remove", "Remove");
      remove.type = "button";
      remove.disabled = !editable;
      remove.addEventListener("click", () => {
        const next = cloneLoadout(member.loadout);
        const cards = [...next.preparedCards];
        cards.splice(index, 1);
        this.selectCandidate(state, memberId, `${definition?.name ?? id} removed`, { ...next, preparedCards: cards });
      });
      row.append(
        this.icon(this.catalog.cardVisual(id), definition?.name ?? id, 40),
        element("strong", undefined, definition?.name ?? id),
        remove,
      );
      prepared.append(row);
    });
    const addCard = element("button", "add-card", "+ Add Card");
    addCard.type = "button";
    addCard.disabled = !editable;
    addCard.addEventListener("click", () => {
      this.editor = { kind: "cards" };
      this.pending = null;
      this.render(state, this.editableMemberIds);
    });
    prepared.append(addCard);
    panel.append(prepared, this.renderEditor(state, memberId));
    return panel;
  }

  private renderEditor(state: AdventureState, memberId: string): HTMLElement {
    const member = state.party.members[memberId];
    if (!member) throw new Error(`Party member "${memberId}" is missing.`);
    const editor = element("div", "loadout-editor");
    editor.append(element("p", "loadout-panel-label", this.editor.kind === "cards" ? "Available Cards" : `Available ${this.editor.slot}`));
    if (!this.editableMemberIds.has(memberId)) {
      editor.append(element("p", "loadout-empty", "Only this character's owner can edit this loadout."));
      return editor;
    }

    const options: Array<{ readonly id: string; readonly label: string; readonly candidate: PartyMemberLoadout; readonly assetId: string | null }> = [];
    if (this.editor.kind === "equipment") {
      const slot = this.editor.slot;
      const empty = cloneLoadout(member.loadout);
      const emptyEquipment = { ...empty.equipment };
      delete emptyEquipment[slot];
      options.push({ id: `empty-${slot}`, label: "Empty", candidate: { ...empty, equipment: emptyEquipment }, assetId: null });
      for (const id of Object.keys(state.collection.equipment).sort()) {
        const definition = this.pack.combatContent.equipment[id];
        if (!definition || definition.slot !== slot) continue;
        options.push({
          id,
          label: definition.name,
          candidate: { ...cloneLoadout(member.loadout), equipment: { ...member.loadout.equipment, [slot]: id } },
          assetId: this.catalog.equipmentVisual(id),
        });
      }
    } else {
      for (const id of Object.keys(state.collection.cards).sort()) {
        const definition = this.pack.combatContent.cards[id];
        if (!definition) continue;
        options.push({
          id,
          label: definition.name,
          candidate: { ...cloneLoadout(member.loadout), preparedCards: [...member.loadout.preparedCards, id] },
          assetId: this.catalog.cardVisual(id),
        });
      }
    }

    for (const option of options) {
      const preview = previewLoadoutChange(state.party, state.collection, this.pack, memberId, option.candidate);
      const row = element("div", "loadout-option-row");
      const button = element("button", "loadout-option");
      button.type = "button";
      button.dataset.optionId = option.id;
      button.setAttribute("aria-disabled", String(!preview.legal));
      const reasonId = `loadout-reason-${this.editor.kind}-${option.id.replaceAll(".", "-")}`;
      button.setAttribute("aria-describedby", reasonId);
      button.append(this.icon(option.assetId, option.label, 40), element("strong", undefined, option.label));
      const show = (): void => this.showCandidate({ label: option.label, loadout: option.candidate, preview });
      button.addEventListener("mouseenter", show);
      button.addEventListener("focus", show);
      button.addEventListener("click", show);
      const reason = element("small", preview.legal ? "option-available" : "option-unavailable", preview.legal ? "Available" : preview.validation.issues[0]?.message ?? "Unavailable");
      reason.id = reasonId;
      row.append(button, reason);
      editor.append(row);
    }
    if (!options.length) editor.append(element("p", "loadout-empty", "No owned options are available."));
    return editor;
  }

  private selectCandidate(state: AdventureState, memberId: string, label: string, candidate: PartyMemberLoadout): void {
    this.showCandidate({
      label,
      loadout: candidate,
      preview: previewLoadoutChange(state.party, state.collection, this.pack, memberId, candidate),
    });
  }

  private showCandidate(candidate: PendingCandidate): void {
    this.pending = candidate;
    this.renderCandidateDetail();
  }

  private renderCandidateDetail(): void {
    const detail = document.querySelector<HTMLElement>("#loadout-detail");
    const state = this.state;
    const memberId = this.selectedMemberId;
    if (!detail || !state || !memberId) return;
    const member = state.party.members[memberId];
    if (!member) return;
    const actor = this.pack.actorDefinitions[member.actorDefinitionId];
    if (!actor) return;
    const preview = this.pending?.preview;
    const current = deriveLoadoutSnapshot(actor, member.loadout, this.pack.combatContent, member.id);
    const shown = preview?.after ?? current;
    detail.replaceChildren();
    const stats = element("div", "loadout-stat-grid");
    const values: Array<[string, string]> = [
      ["AC", preview?.after ? `${preview.before.statistics.ac} → ${preview.after.statistics.ac}` : String(shown.statistics.ac)],
      ["Reflex DC", preview?.after
        ? `${preview.before.statistics.reflex.dc} → ${preview.after.statistics.reflex.dc}`
        : String(shown.statistics.reflex.dc)],
      ["HP", preview?.after
        ? `${preview.before.statistics.maxHp} → ${preview.after.statistics.maxHp}`
        : String(shown.statistics.maxHp)],
      ["Armor", `${shown.armor.name} · ${shown.armor.category}`],
      ["Armor bonus", `+${shown.armor.acItemBonus} item · DEX cap ${shown.armor.dexCap ?? "none"}`],
      ["Weapon", shown.weapon.name],
      ["Damage", `${shown.weapon.damage.count}d${shown.weapon.damage.sides}${shown.weapon.damage.modifier >= 0 ? "+" : ""}${shown.weapon.damage.modifier}`],
      ["Reach", `${shown.weapon.rangeFeet} ft`],
      ["Deck", `${shown.deck.totalCards} cards`],
    ];
    for (const [label, value] of values) {
      const block = element("div", "loadout-stat");
      block.append(element("span", undefined, label), element("strong", undefined, value));
      stats.append(block);
    }
    const change = element("div", "loadout-change-summary");
    change.append(element("h2", undefined, this.pending ? `Preview: ${this.pending.label}` : "Current derived build"));
    if (preview) {
      const changes = [
        ...preview.addedCards.map((entry) => `+ ${this.contributionText(entry)}`),
        ...preview.removedCards.map((entry) => `− ${this.contributionText(entry)}`),
        ...preview.addedContextActionIds.map((id) => `+ Context: ${this.pack.combatContent.actions[id]?.name ?? id}`),
        ...preview.removedContextActionIds.map((id) => `− Context: ${this.pack.combatContent.actions[id]?.name ?? id}`),
      ];
      change.append(element("p", preview.legal ? "preview-legal" : "preview-illegal", preview.legal ? changes.join(" · ") || "No derived rule changes." : preview.validation.issues[0]?.message ?? "Unavailable"));
      const apply = element("button", "loadout-apply", "Apply Change");
      apply.type = "button";
      apply.disabled = !preview.legal || !this.editableMemberIds.has(memberId);
      apply.addEventListener("click", () => {
        if (!this.pending || !this.pending.preview.legal) return;
        const loadout = this.pending.loadout;
        this.pending = null;
        this.handlers.onSetLoadout(memberId, loadout);
      });
      change.append(apply);
    } else {
      change.append(element("p", undefined, "Choose an item or card to preview an authoritative loadout change."));
    }
    detail.append(change, stats);
  }

  private contributionText(contribution: DeckContribution): string {
    const card = this.pack.combatContent.cards[contribution.cardDefinitionId]?.name ?? contribution.cardDefinitionId;
    return `${card} ×${contribution.count} (${sourceLabel(contribution.source, this.pack)})`;
  }

  private renderDeck(state: AdventureState, memberId: string): HTMLElement {
    const member = state.party.members[memberId];
    if (!member) throw new Error(`Party member "${memberId}" is missing.`);
    const actor = this.pack.actorDefinitions[member.actorDefinitionId];
    if (!actor) throw new Error(`Actor definition "${member.actorDefinitionId}" is missing.`);
    const deck = deriveLoadoutSnapshot(actor, member.loadout, this.pack.combatContent, memberId).deck;
    const panel = element("section", "loadout-panel deck-panel");
    panel.append(element("p", "loadout-panel-label", "Deck Preview"), element("h2", undefined, `${deck.totalCards} Tactical Cards`));
    const list = element("div", "deck-contributions");
    for (const contribution of deck.contributions) {
      const definition = this.pack.combatContent.cards[contribution.cardDefinitionId];
      const row = element("div", "deck-contribution");
      row.dataset.cardId = contribution.cardDefinitionId;
      row.dataset.sourceKind = contribution.source.kind;
      row.append(
        this.icon(this.catalog.cardVisual(contribution.cardDefinitionId), definition?.name ?? contribution.cardDefinitionId, 44),
        element("strong", undefined, `${definition?.name ?? contribution.cardDefinitionId} ×${contribution.count}`),
        element("span", undefined, sourceLabel(contribution.source, this.pack)),
      );
      list.append(row);
    }
    panel.append(list);
    return panel;
  }
}
