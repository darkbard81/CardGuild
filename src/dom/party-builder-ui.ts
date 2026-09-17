import { CharacterDetailUi } from "./character-detail-ui";
import type { CompiledContentPack } from "../content";
import type { ActorDefinition } from "../content/content-types";
import { deriveLoadoutSnapshot } from "../loadout";
import type { AssetCatalog } from "../presentation";
import type { SessionCoreState } from "../session";

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

export interface PartyBuilderHandlers {
  readonly onSetParty: (actorDefinitionIds: readonly string[]) => void;
  readonly onReleaseCharacter: () => void;
  readonly onSelectCharacter: (memberId: string) => void;
}

function playableActors(pack: CompiledContentPack): readonly ActorDefinition[] {
  return Object.values(pack.actorDefinitions)
    .filter((actor) => actor.traits.some((trait) => trait.id === "playable"))
    .sort((left, right) =>
      archetypeRank(left, actorStatistics(left, pack), pack) -
        archetypeRank(right, actorStatistics(right, pack), pack) ||
      left.name.localeCompare(right.name));
}

/**
 * Whether a Character starts able to put HP back on someone. This reads the same
 * `restore-hp` effect the AI looks for rather than tagging an archetype in content, so a
 * Character becomes support by what its starting cards do.
 */
function startsWithHealing(actor: ActorDefinition, pack: CompiledContentPack): boolean {
  const cardIds = [
    ...actor.baseCardGrants.map((grant) => grant.cardDefinitionId),
    ...actor.starterLoadout.preparedCards,
  ];
  return cardIds.some((cardId) => {
    const action = pack.combatContent.actions[pack.combatContent.cards[cardId]?.actionId ?? ""];
    if (!action) return false;
    const resolution = action.resolution;
    const effects = resolution.kind === "direct"
      ? resolution.effects
      : resolution.kind === "move"
        ? []
        : Object.values(resolution.outcomes).flat();
    return effects.some((effect) => effect.kind === "restore-hp");
  });
}

function actorStatistics(actor: ActorDefinition, pack: CompiledContentPack) {
  return deriveLoadoutSnapshot(actor, actor.starterLoadout, pack.combatContent, actor.id).statistics;
}

type ActorStatistics = ReturnType<typeof actorStatistics>;

function archetypeRank(
  actor: ActorDefinition,
  statistics: ActorStatistics,
  pack: CompiledContentPack,
): number {
  // Healing is checked first: a medic is fast and lightly armoured, so the speed and
  // durability tests below would otherwise label them as something they are not.
  if (startsWithHealing(actor, pack)) return 3;
  // Character creation can change starting HP/AC; Champion identity still describes
  // the guardian role without depending on the previous final-stat thresholds.
  if (actor.traits.some(trait => trait.id === "champion")) return 2;
  if (actor.speedFeet >= 30 || statistics.initiative >= 8) return 1;
  if (statistics.maxHp >= 24 || statistics.ac >= 20) return 2;
  return 0;
}

const ROLE_SUMMARIES = [
  "균형 잡힌 전투와 상황 대응",
  "빠른 이동으로 빈틈을 노리는 전투",
  "튼튼한 방어로 아군을 지키는 전투",
  "회복과 지원으로 파티를 돕는 전투",
] as const;

function roleSummary(actor: ActorDefinition, statistics: ActorStatistics, pack: CompiledContentPack): string {
  return ROLE_SUMMARIES[archetypeRank(actor, statistics, pack)] ?? ROLE_SUMMARIES[0];
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function starterSummary(actor: ActorDefinition, pack: CompiledContentPack): string {
  const equipment = Object.values(actor.starterLoadout.equipment)
    .flatMap((id) => id ? [pack.combatContent.equipment[id]?.name ?? id] : []);
  const cards = actor.baseCardGrants.map((grant) => {
    const name = pack.combatContent.cards[grant.cardDefinitionId]?.name ?? grant.cardDefinitionId;
    return name + " ×" + String(grant.count);
  });
  return [...equipment, ...cards].join(" · ") || "Core actions only";
}

export class PartyBuilderUi {
  private draft: (string | null)[] = [];
  private partyKey: string | null = null;
  private selectedSlot = 0;
  private readonly detail: CharacterDetailUi;

  public constructor(
    private readonly pack: CompiledContentPack,
    private readonly catalog: AssetCatalog,
    private readonly handlers: PartyBuilderHandlers,
  ) { this.detail = new CharacterDetailUi(pack, catalog); }

  public closeDetails(): void { this.detail.close(); }

  public render(state: SessionCoreState, viewerPlayerId: string): HTMLElement {
    const root = element("section", "ui-panel ui-panel--workspace party-builder");
    const isHost = state.hostPlayerId === viewerPlayerId;
    const actors = playableActors(this.pack);
    root.append(
      element("p", "party-builder-label", isHost ? "파티 구성" : "캐릭터 선택"),
      element("h2", undefined, isHost ? "함께할 캐릭터를 고르세요" : "내 캐릭터를 고르세요"),
    );
    if (isHost) this.renderHost(root, state, actors);
    else this.renderGuest(root, state, viewerPlayerId);
    return root;
  }

  private syncDraft(state: SessionCoreState, actors: readonly ActorDefinition[]): void {
    const nextPartyKey = JSON.stringify(state.partySlots.map((slot) => slot.actorDefinitionId));
    if (nextPartyKey === this.partyKey) return;
    this.partyKey = nextPartyKey;
    this.draft = state.partyPrepared
      ? state.partySlots.map((slot) => slot.actorDefinitionId)
      : actors.slice(0, 3).map((actor) => actor.id);
    while (this.draft.length < 3) this.draft.push(null);
  }

  private renderHost(root: HTMLElement, state: SessionCoreState, actors: readonly ActorDefinition[]): void {
    this.syncDraft(state, actors);
    const claimsLocked = Object.keys(state.guestClaims.byMemberId).length > 0;
    const slotEditor = element("div", "party-slot-editor");
    for (const index of [0, 1, 2]) {
      const row = element("div", "party-slot-row");
      row.dataset.partySlot = String(index + 1);
      const slot = element("button", "ui-button ui-button--secondary", `${index === 0 ? "호스트" : "동료 " + String(index)} · ${this.pack.actorDefinitions[this.draft[index] ?? ""]?.name ?? "비어 있음"}`);
      slot.type = "button"; slot.setAttribute("aria-pressed", String(this.selectedSlot === index)); slot.disabled = claimsLocked;
      slot.addEventListener("click", () => { this.selectedSlot = index; this.renderHostReplacement(root, state, actors); });
      row.append(slot);
      if (index > 0 && this.draft[index]) {
        const remove = element("button", "ui-button ui-button--secondary", "비우기"); remove.type = "button"; remove.disabled = claimsLocked;
        remove.setAttribute("aria-label", `동료 ${String(index)} 비우기`);
        remove.addEventListener("click", () => { this.draft.splice(index, 1); this.draft.push(null); this.renderHostReplacement(root, state, actors); }); row.append(remove);
      }
      slotEditor.append(row);
    }
    root.append(slotEditor);
    const cards = element("div", "party-character-cards");
    for (const actor of actors) {
      const card = this.characterCard(actor);
      const select = element("button", "ui-button ui-button--secondary party-character-select", this.draft.includes(actor.id) ? "파티에 선택됨" : "이 슬롯에 선택");
      select.type = "button"; select.dataset.actorDefinitionId = actor.id;
      select.setAttribute("aria-pressed", String(this.draft.includes(actor.id)));
      select.disabled = claimsLocked;
      select.addEventListener("click", () => {
        // Selecting an existing character swaps the two draft slots; identities stay unique.
        const old = this.draft.indexOf(actor.id);
        if (old >= 0) this.draft[old] = this.draft[this.selectedSlot] ?? null;
        this.draft[this.selectedSlot] = actor.id;
        this.renderHostReplacement(root, state, actors);
      });
      card.addEventListener("click", event => { if (!(event.target as Element).closest("button")) select.click(); });
      card.append(select); cards.append(card);
    }
    root.append(cards);

    const actorDefinitionIds = this.draft.flatMap((id) => id ? [id] : []);
    const contiguous = this.draft.findIndex((id) => id === null) < 0 ||
      this.draft.slice(this.draft.findIndex((id) => id === null)).every((id) => id === null);
    const unique = new Set(actorDefinitionIds).size === actorDefinitionIds.length;
    const validSize = actorDefinitionIds.length >= state.seats.length && actorDefinitionIds.length >= 1;
    const unchanged = contiguous && state.partyPrepared &&
      actorDefinitionIds.length === state.partySlots.length &&
      actorDefinitionIds.every((actorDefinitionId, index) =>
        actorDefinitionId === state.partySlots[index]?.actorDefinitionId);
    const apply = element(
      "button",
      "ui-button ui-button--primary session-primary party-apply",
      claimsLocked ? "파티 구성 잠김" : unchanged ? "파티 적용됨" : "파티 적용",
    );
    apply.id = "apply-party";
    apply.type = "button";
    apply.disabled = claimsLocked || unchanged || !contiguous || !unique || !validSize;
    apply.addEventListener("click", () => this.handlers.onSetParty(actorDefinitionIds));
    const gate = element(
      "p",
      apply.disabled && !claimsLocked && !unchanged ? "party-gate invalid" : "party-gate",
      claimsLocked
        ? state.seats.filter(seat => Object.values(state.guestClaims.byMemberId).includes(seat.playerId)).map(seat => {
          const memberId = Object.entries(state.guestClaims.byMemberId).find(([, playerId]) => playerId === seat.playerId)?.[0];
          const slot = state.partySlots.find(candidate => candidate.memberId === memberId);
          return `${seat.displayName}: ${this.pack.actorDefinitions[slot?.actorDefinitionId ?? ""]?.name ?? "캐릭터"}`;
        }).join(" · ") + " 선택 중. 모든 게스트가 선택을 해제하면 파티를 변경할 수 있습니다. 오프라인 참가자는 다시 접속해 해제하세요."
        : unchanged
          ? "현재 파티가 적용되어 있습니다."
          : !validSize
            ? "참가자 수 이상의 캐릭터를 선택하세요."
            : !contiguous || !unique
              ? "앞 슬롯부터 서로 다른 캐릭터를 선택하세요."
              : "첫 슬롯은 호스트 캐릭터입니다. 선택을 마치면 파티를 적용하세요.",
    );
    const cancel = element("button", "ui-button ui-button--secondary", "변경 취소"); cancel.type = "button";
    cancel.disabled = claimsLocked || unchanged;
    cancel.addEventListener("click", () => { this.partyKey = null; this.renderHostReplacement(root, state, actors); });
    root.append(apply, cancel, gate);
  }

  private renderHostReplacement(root: HTMLElement, state: SessionCoreState, actors: readonly ActorDefinition[]): void {
    const replacement = element("section", "ui-panel ui-panel--workspace party-builder");
    replacement.append(
      element("p", "party-builder-label", "HOST PARTY BUILDER"),
      element("h2", undefined, "Prepare the Company"),
    );
    this.renderHost(replacement, state, actors);
    root.replaceWith(replacement);
  }

  private characterCard(actor: ActorDefinition): HTMLElement {
    const card = element("article", "party-character-card");
    card.dataset.actorDefinitionId = actor.id;
    const visual = this.catalog.actorVisual(actor.id);
    const portrait = element("span", "party-character-art");
    portrait.setAttribute("role", "img");
    portrait.setAttribute("aria-label", actor.name + " front standee");
    Object.assign(portrait.style, this.catalog.domStandeeStyle(visual.front, 132));
    const details = element("div", "party-character-copy");
    const statistics = actorStatistics(actor, this.pack);
    details.append(
      element("h3", undefined, actor.name),
      element("p", "party-role", roleSummary(actor, statistics, this.pack)),
      element(
        "p",
        "party-stats",
          "HP " + String(statistics.maxHp) +
          " · AC " + String(statistics.ac) +
          " · Class DC " + String(statistics.classDc) +
          " · REF " + signed(statistics.reflex.modifier) +
          " · INIT " + signed(statistics.initiative) +
          " · " + String(actor.speedFeet) + "ft",
      ),
      element("p", "party-starter", starterSummary(actor, this.pack)),
    );
    const more = element("button", "ui-button ui-button--secondary", "상세"); more.type = "button";
    more.setAttribute("aria-label", actor.name + " 상세"); more.addEventListener("click", () => this.detail.openPrepared(actor));
    card.append(portrait, details, more);
    return card;
  }

  private renderGuest(root: HTMLElement, state: SessionCoreState, viewerPlayerId: string): void {
    if (!state.partyPrepared) {
      root.append(element("p", "party-waiting", "호스트가 파티를 준비하고 있습니다."));
      return;
    }
    const choices = element("div", "party-character-cards");
    for (const partySlot of state.partySlots) {
      const actor = this.pack.actorDefinitions[partySlot.actorDefinitionId];
      if (!actor) continue;
      const claimant = state.guestClaims.byMemberId[partySlot.memberId];
      const mine = claimant === viewerPlayerId;
      const hostCharacter = partySlot.slot === 1;
      const available = !hostCharacter && !claimant;
      const card = this.characterCard(actor);
      const button = element("button", "ui-button ui-button--secondary guest-character-choice",
        hostCharacter ? "호스트 캐릭터" : mine ? "내 캐릭터 · 선택 해제" : claimant ? `${state.seats.find(seat => seat.playerId === claimant)?.displayName ?? "다른 참가자"} 선택함` : "이 캐릭터로 참가");
      button.type = "button"; button.dataset.memberId = partySlot.memberId;
      button.dataset.claimState = hostCharacter ? "host" : mine ? "mine" : claimant ? "taken" : "available";
      button.setAttribute("aria-pressed", String(mine)); button.disabled = !available && !mine;
      button.addEventListener("click", () => { if (mine) this.handlers.onReleaseCharacter(); else if (available) this.handlers.onSelectCharacter(partySlot.memberId); });
      card.addEventListener("click", event => { if (!(event.target as Element).closest("button")) button.click(); });
      card.append(button); choices.append(card);
    }
    root.append(choices);
  }
}
