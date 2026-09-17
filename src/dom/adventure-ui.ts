import { CharacterDetailUi } from "./character-detail-ui";
import type { LoadoutDestination } from "./loadout-ui";
import { createCardFace } from "./card-face";
import { cardLevelSummary } from "./card-level-view";
import { equipmentTraits } from "../game/rules";
import { CharacterAdvancementUi } from "./character-advancement-ui";
import { pendingCharacterAdvancements, type CharacterAdvancementChoice } from "../character";
import type { AdventureState } from "../adventure";
import type { CompiledContentPack } from "../content";
import { placementAppliesToPartySize } from "../content";
import type { AdventureDefinition, RewardGrant } from "../content";
import { createStartingCollection, previewLoadoutChange } from "../loadout";
import type { AssetCatalog } from "../presentation";
import { growthSummaryPanel, progressionMeter, progressionText, type GrowthSummary } from "./progression-view";

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
  readonly onAdvanceCharacter: (memberId: string, choice: CharacterAdvancementChoice) => boolean;
  readonly onStart: () => void;
  readonly onContinue: () => void;
  readonly onChooseReward: (rewardId: string, choiceIndex: number, settled: (accepted: boolean) => void) => boolean;
  readonly onOpenLoadout: (destination?: LoadoutDestination) => void;
  readonly onExit: () => void;
}

export interface AdventureUiAccess {
  readonly isHost: boolean;
  readonly editableMemberIds?: ReadonlySet<string>;
  readonly controllerNames?: Readonly<Record<string, string>>;
  /**
   * The last committed victory's growth, or nothing. The UI never derives this from state:
   * Level and EXP are in the snapshot, but "what just changed" only exists in the events
   * the server published with the COMMIT, so the controller owns it and passes it down.
   */
  readonly growth?: GrowthSummary | null;
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
    return `${cardLevelSummary(card!, content)} · ${cost} · ${action.description}`;
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
  for (const trait of equipmentTraits(equipment)) {
    for (const cardGrant of content.traits[trait.id]?.cardGrants ?? []) {
      const name = content.cards[cardGrant.cardDefinitionId]?.name ?? cardGrant.cardDefinitionId;
      const card = content.cards[cardGrant.cardDefinitionId];
      parts.push(`${name} 카드 ×${String(cardGrant.count)}${card ? ` · ${cardLevelSummary(card, content)}` : ""}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : `${equipment.slot} 슬롯 장비입니다.`;
}

export class AdventureUi {
  private readonly screen = required<HTMLElement>("#adventure-screen");
  private readonly progress = required<HTMLOListElement>("#adventure-progress");
  private readonly content = required<HTMLElement>("#adventure-content");
  private readonly collection = required<HTMLElement>("#adventure-collection");
  private readonly party = required<HTMLElement>("#adventure-party");

  private readonly detail: CharacterDetailUi | null;
  private readonly advancementUi: CharacterAdvancementUi;
  private rewardDraft: { rewardId: string; index: number } | null = null;
  private rewardPending = false;
  private rewardMessage = "";
  private lastRender: { state: AdventureState; access: AdventureUiAccess } | null = null;

  public constructor(
    private readonly definition: AdventureDefinition,
    private readonly pack: CompiledContentPack,
    private readonly handlers: AdventureUiHandlers,
    private readonly catalog?: AssetCatalog,
  ) {
    this.advancementUi = new CharacterAdvancementUi(pack, handlers.onAdvanceCharacter);
    this.detail = catalog ? new CharacterDetailUi(pack, catalog) : null;
    const rail = this.progress.parentElement!;
    for (const [target, label] of [[this.progress, "전체 모험 진행"], [this.collection, "보유 보상·Collection"]] as const) {
      const section = element("details", "adventure-secondary"); section.append(element("summary", undefined, label));
      target.before(section); section.append(target);
    }
    this.screen.append(this.content, rail);
  }

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
    Object.assign(wrapper.style, this.catalog.domAssetStyle(assetId, 48));
    return wrapper;
  }

  /** The victory notice, once, wherever the screen after the battle puts it. */
  private growth(access: AdventureUiAccess): HTMLElement | null {
    return access.growth
      ? growthSummaryPanel(access.growth, (memberId) => {
          const member = this.party.querySelector<HTMLElement>(`[data-member-id="${memberId}"] strong`);
          return member?.textContent ?? memberId;
        })
      : null;
  }

  public render(state: AdventureState, access: AdventureUiAccess = { isHost: true }): void {
    const openGrowth = new Set([...this.party.querySelectorAll<HTMLElement>("details[open] [data-advancement-member]")].map(node => node.dataset.advancementMember));
    const previous = this.lastRender?.state;
    this.lastRender = { state, access };
    if (this.rewardDraft && state.pendingReward?.rewardId !== this.rewardDraft.rewardId) {
      this.rewardDraft = null;
      const added = previous && (["cards", "equipment"] as const).some(kind =>
        Object.entries(state.collection[kind]).some(([id, count]) => count > (previous.collection[kind][id] ?? 0)));
      this.rewardMessage = added ? "Collection에 추가되었습니다 · 장비·카드 준비에서 Loadout에 반영하세요." : "";
    }
    const hasPending = Object.values(state.party.members).some(member =>
      pendingCharacterAdvancements(member.progression.level, member.progression.advancements).length > 0);
    this.screen.hidden = state.phase === "combat";
    if (state.phase !== "combat") {
      required<HTMLElement>("#reaction-modal").hidden = true;
      required<HTMLElement>("#result-modal").hidden = true;
    }
    this.renderProgress(state);
    this.renderCollection(state);
    this.party.replaceChildren(...Object.values(state.party.members)
      .sort((left, right) => left.seat - right.seat)
      .map((member) => {
        const row = element("li", "character-progression");
        row.dataset.memberId = member.id;
        const name = this.pack.actorDefinitions[member.actorDefinitionId]?.name ?? member.id;
        row.append(
          element("strong", undefined, name),
          element("span", undefined, progressionText(member.progression)),
          progressionMeter(name, member.progression),
        );
        const advancement = this.advancementUi.render(member, access.editableMemberIds?.has(member.id) ?? false,
          state.phase === "ready" || state.phase === "between-encounters", access.controllerNames?.[member.id]);
        const actor = this.pack.actorDefinitions[member.actorDefinitionId];
        if (this.detail && actor) row.append(this.secondaryActionButton("상세", () => this.detail?.openPrepared(actor, member)));
        if (state.phase === "ready" || state.phase === "between-encounters") {
          row.append(this.secondaryActionButton(`${name} ${access.editableMemberIds?.has(member.id) ? "장비·카드 준비" : "장비·카드 보기"}`, () => this.handlers.onOpenLoadout({ memberId: member.id })));
        }
        if (advancement) {
          const details = element("details", "adventure-growth-editor");
          details.open = openGrowth.has(member.id);
          details.append(element("summary", undefined, "성장 선택"), advancement); row.append(details);
        }
        return row;
      }));
    this.content.replaceChildren();
    this.content.classList.toggle("ui-reward-workspace", state.phase === "reward");
    if (state.phase !== "reward" && (this.rewardMessage || this.rewardPending)) this.content.append(element("p", "ui-status",
      this.rewardPending ? "보상 적용 결과 확인 중…" : this.rewardMessage));
    this.progress.closest(".adventure-map-card")?.append(this.party);

    if (state.phase === "ready") {
      const actions = element("div", "adventure-actions");
      actions.append(
        this.actionButton(access.isHost ? "모험 시작" : "호스트를 기다리는 중", this.handlers.onStart, access.isHost && !hasPending && !this.rewardPending),
        this.secondaryActionButton("장비·카드 준비", () => this.handlers.onOpenLoadout()),
      );
      const partySize = Object.keys(state.party.members).length;
      this.content.append(
        element("p", "eyebrow", `${String(this.definition.encounterIds.length)} Encounters · ${String(partySize)}P`),
        element("h1", undefined, this.definition.name),
        element("p", "adventure-description", this.definition.description),
        this.preparation(state, access), actions, this.party,
      );
      return;
    }
    if (state.phase === "between-encounters") {
      const scenario = state.currentEncounterId ? this.pack.scenarios[state.currentEncounterId] : undefined;
      const actions = element("div", "adventure-actions");
      actions.append(
        this.actionButton(access.isHost ? "전투 시작" : "호스트를 기다리는 중", this.handlers.onContinue, access.isHost && !hasPending && !this.rewardPending),
        this.secondaryActionButton("장비·카드 준비", () => this.handlers.onOpenLoadout()),
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
      const growth = this.growth(access);
      if (growth) this.content.append(growth);
      const threats = state.currentEncounterId ? this.threatPreview(state, state.currentEncounterId) : [];
      if (threats.length > 0) {
        const preview = element("p", "encounter-threats");
        preview.append(
          element("strong", undefined, "예상 적"),
          element("span", undefined, threats.join(" · ")),
        );
        this.content.append(preview);
      }
      const rewards = this.unusedRewards(state);
      const waiting = rewards.reduce((sum, reward) => sum + reward.count, 0);
      if (waiting > 0) {
        const note = element("p", "loadout-nudge");
        note.append(
          element("strong", undefined, `미사용 보상 ${String(waiting)}개`),
          element("span", undefined, "보상은 선택 사항입니다. 사용하지 않아도 전투를 시작할 수 있습니다."),
          this.secondaryActionButton("보상 확인", () => this.handlers.onOpenLoadout({
            tab: rewards.some(reward => reward.kind === "equipment") ? "equipment" : "cards", rewardIds: rewards.map(reward => reward.id),
          })),
        );
        this.content.append(note);
      }
      this.content.append(this.preparation(state, access), actions, this.party);
      return;
    }
    if (state.phase === "reward" && state.pendingReward) {
      this.content.append(
        element("p", "eyebrow", "Encounter Reward"),
        element("h1", undefined, "Choose one reward"),
        element("p", "adventure-description", "획득한 보상은 Collection에 남고 현재 Loadout은 바뀌지 않습니다."),
      );
      const growth = this.growth(access);
      if (growth) this.content.append(growth);
      const choices = element("div", "reward-choices");
      choices.style.setProperty("--reward-choice-count", String(state.pendingReward.choices.length));
      state.pendingReward.choices.forEach((grant, index) => {
        const name = rewardName(grant, this.pack);
        const button = this.actionButton(name, () => {
          this.rewardDraft = { rewardId: state.pendingReward!.rewardId, index };
          this.rewardMessage = "";
          this.render(state, access);
        }, !this.rewardPending);
        button.setAttribute("aria-pressed", String(this.rewardDraft?.index === index));
        button.classList.add("reward-choice");
        const assetId = grant.kind === "card"
          ? this.catalog?.cardVisual(grant.definitionId) ?? null
          : this.catalog?.equipmentVisual(grant.definitionId) ?? null;
        if (grant.kind === "card") {
          const card = this.pack.combatContent.cards[grant.definitionId];
          button.classList.add("reward-card-choice");
          button.replaceChildren(createCardFace({
            catalog: this.catalog, cardId: grant.definitionId, name,
            timing: card ? this.pack.combatContent.actions[card.actionId]?.timing : undefined,
          }));
        } else {
          button.prepend(this.icon(assetId, name));
        }
        button.append(
          element("span", "reward-kind", grant.kind),
          element("span", "reward-detail", rewardDetail(grant, this.pack)),
        );
        choices.append(button);
      });
      this.content.append(choices);
      const draft = this.rewardDraft;
      if (draft) {
        const selected = state.pendingReward.choices[draft.index]!;
        this.content.append(element("p", "ui-status", `선택: ${rewardName(selected, this.pack)} · ${rewardDetail(selected, this.pack)}`));
        const comparison = element("ul", "ui-reward-comparison");
        const key = selected.kind === "card" ? "cards" : "equipment";
        const collection = { ...state.collection, [key]: { ...state.collection[key], [selected.definitionId]: (state.collection[key][selected.definitionId] ?? 0) + 1 } };
        for (const member of Object.values(state.party.members)) {
          const equipment = selected.kind === "equipment" ? this.pack.combatContent.equipment[selected.definitionId] : undefined;
          const candidate = equipment ? { ...member.loadout, equipment: { ...member.loadout.equipment, [equipment.slot]: equipment.id } }
            : { ...member.loadout, preparedCards: [...member.loadout.preparedCards, selected.definitionId] };
          const preview = previewLoadoutChange(state.party, collection, this.pack, member.id, candidate);
          const name = this.pack.actorDefinitions[member.actorDefinitionId]?.name ?? member.id;
          comparison.append(element("li", undefined, preview.after
            ? `${name} · 준비 가능 · HP ${preview.before.statistics.maxHp} → ${preview.after.statistics.maxHp} · AC ${preview.before.statistics.ac} → ${preview.after.statistics.ac} · Strike ${preview.before.strike.attackModifier} → ${preview.after.strike.attackModifier} · 카드 ${preview.before.deck.totalCards} → ${preview.after.deck.totalCards}`
            : `${name} · 현재 준비 불가: ${preview.validation.issues.map(issue => issue.message).join(" · ")}`));
        }
        this.content.append(comparison);
      }
      this.content.append(element("p", "ui-status", this.rewardMessage || (access.isHost
        ? "보상을 눌러 비교한 뒤 획득을 확정하세요. 하나를 획득하면 다른 선택지는 포기합니다."
        : "호스트가 보상을 선택하고 있습니다. 보상 상세는 자유롭게 확인할 수 있습니다.")));
      this.content.append(this.actionButton(this.rewardPending ? "보상 적용 중…" : "이 보상 획득", () => {
        if (!draft || this.rewardPending) return;
        this.rewardPending = true;
        this.render(state, access);
        const started = this.handlers.onChooseReward(draft.rewardId, draft.index, accepted => {
          this.rewardPending = false;
          if (!accepted) this.rewardMessage = "보상을 적용하지 못했습니다. 선택을 확인하고 다시 시도하세요.";
          if (this.lastRender) this.render(this.lastRender.state, this.lastRender.access);
        });
        if (!started) {
          this.rewardPending = false;
          this.rewardMessage = "서버 연결을 확인하고 다시 시도하세요.";
          this.render(state, access);
        }
      }, access.isHost && !!draft && !this.rewardPending));
      return;
    }
    if (state.phase === "complete") {
      this.content.append(
        element("p", "eyebrow", "Adventure Complete"),
        element("h1", undefined, `${this.definition.name} resolved`),
        element("p", "adventure-description", `${String(this.definition.encounterIds.length)}개 Encounter를 모두 통과했습니다. 획득한 보상은 Collection에 남습니다.`),
      );
      const growth = this.growth(access);
      if (growth) this.content.append(growth);
      this.content.append(this.actionButton("시작 화면으로", this.handlers.onExit));
      return;
    }
    if (state.phase === "failed") {
      this.content.append(
        element("p", "eyebrow", "Adventure Failed"),
        element("h1", undefined, "The party was defeated"),
        element("p", "adventure-description", "이번 모험은 종료되었습니다. 시작 화면으로 돌아가 새 모험을 만들거나 다른 저장을 이어갈 수 있습니다."),
        this.actionButton("시작 화면으로", this.handlers.onExit),
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
   * Reward copies nobody is carrying, which is what Manage Loadout is for.
   *
   * The collection is not a reward log — it opens holding every starter's gear — so a plain
   * "owned minus carried" count calls a swapped-out starter weapon an unused reward, and a
   * one-weapon-slot party can never drive that number to zero. Reward provenance is recovered
   * without new state by subtracting the starting collection, which reads the roster's
   * authored starterLoadout and so does not move when a member re-equips.
   *
   * Counted per copy, not per id: a second copy of a card already prepared elsewhere is still
   * an unused reward. The `min` is the attribution rule, and it runs the other way round —
   * carried copies count against the starter baseline first, and only the surplus lands on the
   * reward copies. So a reward that duplicates gear the party already wears keeps the notice up
   * until a second member carries a copy, because until then one copy really is spare. The
   * opposite attribution would read better in that one case and be wrong in the commoner one:
   * two members who each start with a halberd would hide a third, genuinely unused halberd.
   *
   * The shipped M7 rewards never duplicate worn starter gear — production-tutorial.test.ts's "never
   * offers a starter a reward it already has equipped" holds that — so this only decides how
   * the notice behaves if a later pack starts handing out duplicates.
   */
  private unusedRewards(state: AdventureState): readonly { id: string; count: number; kind: "equipment" | "cards" }[] {
    const started = createStartingCollection(state.party, this.pack);
    const carried = new Map<string, number>();
    const use = (id: string): void => {
      carried.set(id, (carried.get(id) ?? 0) + 1);
    };
    for (const member of Object.values(state.party.members)) {
      for (const id of Object.values(member.loadout.equipment)) if (id) use(id);
      for (const id of member.loadout.preparedCards) use(id);
    }
    return (["equipment", "cards"] as const).flatMap(kind => Object.entries(state.collection[kind]).flatMap(([id, copies]) => {
      const count = Math.min(Math.max(0, copies - (started[kind][id] ?? 0)), Math.max(0, copies - (carried.get(id) ?? 0)));
      return count ? [{ id, count, kind }] : [];
    }));
  }

  private preparation(state: AdventureState, access: AdventureUiAccess): HTMLElement {
    const panel = element("section", "adventure-preparation");
    panel.append(element("h2", undefined, "전투 준비"));
    const pending = Object.values(state.party.members).filter(member => pendingCharacterAdvancements(member.progression.level, member.progression.advancements).length);
    if (!pending.length) panel.append(element("p", undefined, "필수 성장 선택이 완료되었습니다. 장비와 카드는 원하는 경우 변경하세요."));
    for (const member of pending) {
      const name = this.pack.actorDefinitions[member.actorDefinitionId]?.name ?? member.id;
      const editable = access.editableMemberIds?.has(member.id) ?? false;
      const owner = access.controllerNames?.[member.id] ?? "담당 참가자";
      const button = this.secondaryActionButton(editable ? `${name} 성장 선택` : `${name} · ${owner}님의 성장 선택을 기다리는 중`, () => {
        const form = this.party.querySelector<HTMLElement>(`[data-advancement-member="${CSS.escape(member.id)}"]`);
        const details = form?.closest("details"); if (details) details.open = true;
        form?.scrollIntoView({ block: "center" }); form?.querySelector<HTMLElement>("select, input, button")?.focus();
      });
      button.disabled = !editable; panel.append(button);
    }
    return panel;
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
      ...Object.entries(state.collection.cards).map(([id, count]) => {
        const card = content.cards[id];
        const face = createCardFace({
          catalog: this.catalog, cardId: id, name: card?.name ?? id,
          timing: card ? content.actions[card.actionId]?.timing : undefined,
          badges: count > 1 ? [`×${count}`] : [],
        });
        face.classList.add("collection-card");
        face.dataset.rewardKind = "card";
        return face;
      }),
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
    const button = element("button", "ui-button ui-button--primary adventure-action", label);
    button.type = "button";
    button.disabled = !enabled;
    button.addEventListener("click", onClick);
    return button;
  }

  private secondaryActionButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = this.actionButton(label, onClick);
    button.classList.replace("ui-button--primary", "ui-button--secondary");
    button.classList.add("adventure-action-secondary");
    return button;
  }

  public reportError(message: string): void {
    this.advancementUi.reportError(message);
    if (this.lastRender && !this.screen.hidden) this.render(this.lastRender.state, this.lastRender.access);
  }

  public clear(): void { this.detail?.close(); this.advancementUi.clear(); this.lastRender = null; this.rewardDraft = null; this.rewardPending = false; this.rewardMessage = ""; }

  public setVisible(visible: boolean): void {
    if (!visible) this.detail?.close();
    this.screen.hidden = !visible;
  }
}
