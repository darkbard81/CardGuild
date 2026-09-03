import type { AdventureState } from "../adventure";
import type { CompiledContentPack } from "../content";
import { placementAppliesToPartySize } from "../content";
import type { AdventureDefinition, RewardGrant } from "../content";
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

export interface AdventureUiHandlers {
  readonly onStart: () => void;
  readonly onContinue: () => void;
  readonly onChooseReward: (rewardId: string, choiceIndex: number) => void;
  readonly onOpenLoadout: () => void;
  readonly onRetry: () => void;
}

export interface AdventureUiAccess {
  readonly isHost: boolean;
}

function rewardName(grant: RewardGrant, pack: CompiledContentPack): string {
  return grant.kind === "equipment"
    ? pack.combatContent.equipment[grant.definitionId]?.name ?? grant.definitionId
    : pack.combatContent.cards[grant.definitionId]?.name ?? grant.definitionId;
}

function signed(value: number): string {
  return value >= 0 ? `+${String(value)}` : String(value);
}

/**
 * What a reward actually does, in the player's terms. A name alone ("Fly", "Shield") tells
 * a first-time player nothing, and this is the only screen where the choice is made.
 */
function rewardDetail(grant: RewardGrant, pack: CompiledContentPack): string {
  const content = pack.combatContent;
  if (grant.kind === "card") {
    const card = content.cards[grant.definitionId];
    const action = card ? content.actions[card.actionId] : undefined;
    if (!action) return "새 전술 카드입니다.";
    const cost = action.timing.kind === "reaction"
      ? "반응"
      : `${String(action.timing.actions)} 액션`;
    return `${cost} · ${action.description}`;
  }
  const equipment = content.equipment[grant.definitionId];
  if (!equipment) return "새 장비입니다.";
  const parts: string[] = [];
  const weapon = equipment.weaponProfile;
  if (weapon) {
    parts.push(`${weapon.category} ${weapon.attackMode} · ${String(weapon.damage.count)}d${String(weapon.damage.sides)} ${weapon.damage.damageType} · ${String(weapon.rangeFeet)}ft`);
  }
  const armor = equipment.armorProfile;
  if (armor) parts.push(`${armor.category} 방어구 · AC ${signed(armor.acItemBonus)} · DEX 상한 ${String(armor.dexCap)}`);
  if (equipment.shieldBonus) parts.push(`Raise Shield로 AC ${signed(equipment.shieldBonus)}`);
  for (const modifier of equipment.statModifiers) parts.push(`${modifier.label} ${signed(modifier.value)}`);
  for (const trait of equipment.traits) {
    for (const cardGrant of content.traits[trait.id]?.cardGrants ?? []) {
      const name = content.cards[cardGrant.cardDefinitionId]?.name ?? cardGrant.cardDefinitionId;
      parts.push(`${name} 카드 ×${String(cardGrant.count)}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : `${equipment.slot} 슬롯 장비입니다.`;
}

export class AdventureUi {
  private readonly screen = required<HTMLElement>("#adventure-screen");
  private readonly progress = required<HTMLOListElement>("#adventure-progress");
  private readonly content = required<HTMLElement>("#adventure-content");
  private readonly collection = required<HTMLElement>("#adventure-collection");

  public constructor(
    private readonly definition: AdventureDefinition,
    private readonly pack: CompiledContentPack,
    private readonly handlers: AdventureUiHandlers,
    private readonly catalog?: AssetCatalog,
  ) {}

  /** The enemies this party will actually face, which party size decides (#16). */
  private threatPreview(state: AdventureState, encounterId: string): readonly string[] {
    const source = this.pack.scenarioSources[encounterId];
    if (!source) return [];
    const partySize = Object.keys(state.party.members).length;
    const counts = new Map<string, number>();
    for (const placement of source.placements) {
      if (!placementAppliesToPartySize(placement, partySize)) continue;
      const name = this.pack.actorDefinitions[placement.actorDefinitionId]?.name ?? placement.actorDefinitionId;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => (count > 1 ? `${name} ×${String(count)}` : name));
  }

  private icon(assetId: string | null, label: string): HTMLElement {
    const wrapper = element("span", "reward-icon");
    wrapper.setAttribute("aria-hidden", "true");
    wrapper.title = label;
    if (!assetId || !this.catalog) {
      wrapper.classList.add("missing");
      wrapper.textContent = label.slice(0, 1);
      return wrapper;
    }
    Object.assign(wrapper.style, this.catalog.domAtlasStyle(assetId, 48));
    return wrapper;
  }

  public render(state: AdventureState, access: AdventureUiAccess = { isHost: true }): void {
    this.screen.hidden = state.phase === "combat";
    if (state.phase !== "combat") {
      required<HTMLElement>("#reaction-modal").hidden = true;
      required<HTMLElement>("#result-modal").hidden = true;
    }
    this.renderProgress(state);
    this.renderCollection(state);
    this.content.replaceChildren();

    if (state.phase === "ready") {
      const actions = element("div", "adventure-actions");
      actions.append(
        this.actionButton(access.isHost ? "Begin Adventure" : "Waiting for Host", this.handlers.onStart, access.isHost),
        this.secondaryActionButton("Manage Loadout", this.handlers.onOpenLoadout),
      );
      const partySize = Object.keys(state.party.members).length;
      this.content.append(
        element("p", "eyebrow", `${String(this.definition.encounterIds.length)} Encounters · ${String(partySize)}P`),
        element("h1", undefined, this.definition.name),
        element("p", "adventure-description", this.definition.description),
        actions,
      );
      return;
    }
    if (state.phase === "between-encounters") {
      const scenario = state.currentEncounterId ? this.pack.scenarios[state.currentEncounterId] : undefined;
      const actions = element("div", "adventure-actions");
      actions.append(
        this.actionButton(access.isHost ? "Enter Encounter" : "Waiting for Host", this.handlers.onContinue, access.isHost),
        this.secondaryActionButton("Manage Loadout", this.handlers.onOpenLoadout),
      );
      const step = state.currentEncounterId
        ? this.definition.encounterIds.indexOf(state.currentEncounterId) + 1
        : 0;
      this.content.append(
        element("p", "eyebrow", step > 0
          ? `Next Encounter · ${String(step)} / ${String(this.definition.encounterIds.length)}`
          : "Next Encounter"),
        element("h1", undefined, scenario?.name ?? "Continue"),
        element("p", "adventure-description", scenario?.objective.description ?? "Prepare for battle."),
      );
      const threats = state.currentEncounterId ? this.threatPreview(state, state.currentEncounterId) : [];
      if (threats.length > 0) {
        const preview = element("p", "encounter-threats");
        preview.append(
          element("strong", undefined, "예상 적"),
          element("span", undefined, threats.join(" · ")),
        );
        this.content.append(preview);
      }
      const waiting = this.unequipped(state);
      if (waiting > 0) {
        const note = element("p", "loadout-nudge");
        note.append(
          element("strong", undefined, `보상 ${String(waiting)}개 대기 중`),
          element("span", undefined, "Manage Loadout에서 장착하거나 준비해야 다음 전투에 반영됩니다."),
        );
        this.content.append(note);
      }
      this.content.append(actions);
      return;
    }
    if (state.phase === "reward" && state.pendingReward) {
      this.content.append(
        element("p", "eyebrow", "Encounter Reward"),
        element("h1", undefined, "Choose one reward"),
        element("p", "adventure-description", "획득한 보상은 Collection에 남고 현재 Loadout은 바뀌지 않습니다."),
      );
      const choices = element("div", "reward-choices");
      choices.style.setProperty("--reward-choice-count", String(state.pendingReward.choices.length));
      state.pendingReward.choices.forEach((grant, index) => {
        const name = rewardName(grant, this.pack);
        const button = this.actionButton(name, () => {
          const offer = state.pendingReward;
          if (offer) this.handlers.onChooseReward(offer.rewardId, index);
        }, access.isHost);
        button.classList.add("reward-choice");
        const assetId = grant.kind === "card"
          ? this.catalog?.cardVisual(grant.definitionId) ?? null
          : this.catalog?.equipmentVisual(grant.definitionId) ?? null;
        button.prepend(this.icon(assetId, name));
        button.append(
          element("span", "reward-kind", grant.kind),
          element("span", "reward-detail", rewardDetail(grant, this.pack)),
        );
        choices.append(button);
      });
      this.content.append(choices);
      return;
    }
    if (state.phase === "complete") {
      this.content.append(
        element("p", "eyebrow", "Adventure Complete"),
        element("h1", undefined, `${this.definition.name} resolved`),
        element("p", "adventure-description", `${String(this.definition.encounterIds.length)}개 Encounter를 모두 통과했습니다. 획득한 보상은 Collection에 남습니다.`),
        this.actionButton(access.isHost ? "Session Complete" : "Session Complete", this.handlers.onRetry, false),
      );
      return;
    }
    if (state.phase === "failed") {
      this.content.append(
        element("p", "eyebrow", "Adventure Failed"),
        element("h1", undefined, "The party was defeated"),
        element("p", "adventure-description", "같은 Adventure seed로 처음부터 다시 도전할 수 있습니다. Loadout을 바꾼 뒤 다시 시도해 보세요."),
        this.actionButton("Session Failed", this.handlers.onRetry, false),
      );
    }
  }

  /**
   * The whole run at a glance. An eight-step rail has to stay readable in the 1024x768
   * minimum, so each row is one line and the rail scrolls rather than pushing the
   * Collection off the card. Both markers are read off position and the reward table, so
   * nothing here knows a content id.
   */
  private renderProgress(state: AdventureState): void {
    const total = this.definition.encounterIds.length;
    const done = state.completedEncounterIds.length;
    this.progress.replaceChildren();
    this.progress.setAttribute("aria-label", `Encounter ${String(Math.min(done + 1, total))} of ${String(total)}`);
    const rewarded = new Set(this.definition.rewards.map((reward) => reward.afterEncounterId));
    for (const [index, encounterId] of this.definition.encounterIds.entries()) {
      const scenario = this.pack.scenarios[encounterId];
      const completed = state.completedEncounterIds.includes(encounterId);
      const current = encounterId === state.currentEncounterId;
      const item = element("li", completed ? "complete" : current ? "current" : "upcoming");
      item.dataset.encounterId = encounterId;
      if (current) item.setAttribute("aria-current", "step");
      if (index === total - 1) item.classList.add("finale");
      item.append(
        element("span", "progress-index", completed ? "✓" : String(index + 1)),
        element("strong", undefined, scenario?.name ?? encounterId),
      );
      if (index === total - 1) item.append(element("span", "progress-tag", "Finale"));
      else if (rewarded.has(encounterId)) {
        const tag = element("span", "progress-tag reward", "◆");
        tag.title = "이 전투를 이기면 보상을 하나 고릅니다.";
        tag.setAttribute("aria-label", "보상 있음");
        item.append(tag);
      }
      this.progress.append(item);
    }
  }

  /**
   * Copies the party owns but is not carrying, which is what Manage Loadout is for. Counted
   * per copy, not per id: a second copy of a card already prepared elsewhere is still an
   * unused reward.
   */
  private unequipped(state: AdventureState): number {
    const members = Object.values(state.party.members);
    const carried = new Map<string, number>();
    const use = (id: string): void => {
      carried.set(id, (carried.get(id) ?? 0) + 1);
    };
    for (const member of members) {
      for (const id of Object.values(member.loadout.equipment)) if (id) use(id);
      for (const id of member.loadout.preparedCards) use(id);
    }
    const spare = ([id, owned]: readonly [string, number]): number => Math.max(0, owned - (carried.get(id) ?? 0));
    return [
      ...Object.entries(state.collection.equipment),
      ...Object.entries(state.collection.cards),
    ].reduce((total, entry) => total + spare(entry), 0);
  }

  private chip(assetId: string | null, name: string, count: number, kind: string): HTMLElement {
    const chip = element("span", "collection-chip");
    chip.dataset.rewardKind = kind;
    chip.append(this.icon(assetId, name), element("span", "chip-name", name));
    if (count > 1) chip.append(element("span", "chip-count", `×${String(count)}`));
    return chip;
  }

  private renderCollection(state: AdventureState): void {
    this.collection.replaceChildren();
    const content = this.pack.combatContent;
    const chips = [
      ...Object.entries(state.collection.equipment).map(([id, count]) =>
        this.chip(this.catalog?.equipmentVisual(id) ?? null, content.equipment[id]?.name ?? id, count, "equipment")),
      ...Object.entries(state.collection.cards).map(([id, count]) =>
        this.chip(this.catalog?.cardVisual(id) ?? null, content.cards[id]?.name ?? id, count, "card")),
    ];
    const heading = element("strong", undefined, "Collection");
    this.collection.append(heading);
    if (chips.length === 0) {
      this.collection.append(element("span", "collection-empty", "아직 획득한 보상이 없습니다."));
      return;
    }
    heading.append(element("span", "collection-count", String(chips.length)));
    const list = element("div", "collection-chips");
    list.append(...chips);
    this.collection.append(list);
  }

  private actionButton(label: string, onClick: () => void, enabled = true): HTMLButtonElement {
    const button = element("button", "adventure-action", label);
    button.type = "button";
    button.disabled = !enabled;
    button.addEventListener("click", onClick);
    return button;
  }

  private secondaryActionButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = this.actionButton(label, onClick);
    button.classList.add("adventure-action-secondary");
    return button;
  }

  public setVisible(visible: boolean): void {
    this.screen.hidden = !visible;
  }
}
