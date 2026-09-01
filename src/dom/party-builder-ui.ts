import type { CompiledContentPack } from "../content";
import type { ActorDefinition } from "../content/content-types";
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
  readonly onSelectCharacter: (memberId: string) => void;
}

function playableActors(pack: CompiledContentPack): readonly ActorDefinition[] {
  return Object.values(pack.actorDefinitions)
    .filter((actor) => actor.traits.some((trait) => trait.id === "playable"))
    .sort((left, right) => archetypeRank(left) - archetypeRank(right) || left.name.localeCompare(right.name));
}

function archetypeRank(actor: ActorDefinition): number {
  if (actor.speedFeet >= 30 || actor.initiativeModifier >= 8) return 1;
  if (actor.maxHp >= 40 || actor.baseAc >= 20) return 2;
  return 0;
}

function roleSummary(actor: ActorDefinition): string {
  return ["Balanced controller", "Mobile skirmisher", "Durable guardian"][archetypeRank(actor)] ??
    "Balanced controller";
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

  public constructor(
    private readonly pack: CompiledContentPack,
    private readonly catalog: AssetCatalog,
    private readonly handlers: PartyBuilderHandlers,
  ) {}

  public render(state: SessionCoreState, viewerPlayerId: string): HTMLElement {
    const root = element("section", "party-builder");
    root.dataset.partyPrepared = String(state.partyPrepared);
    const isHost = state.hostPlayerId === viewerPlayerId;
    const actors = playableActors(this.pack);
    root.append(
      element("p", "party-builder-label", isHost ? "HOST PARTY BUILDER" : "PARTY"),
      element("h2", undefined, isHost ? "Prepare the Company" : "Choose Your Character"),
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
    const cards = element("div", "party-character-cards");
    for (const actor of actors) cards.append(this.characterCard(actor));
    root.append(cards);

    const claimsLocked = Object.keys(state.guestClaims.byMemberId).length > 0;
    const slotEditor = element("div", "party-slot-editor");
    const selected = new Set(this.draft.flatMap((id) => id ? [id] : []));
    for (const slotIndex of [0, 1, 2] as const) {
      const row = element("label", "party-slot-row");
      row.dataset.partySlot = String(slotIndex + 1);
      row.append(element("span", "party-slot-number", "Slot " + String(slotIndex + 1)));
      const select = element("select", "party-slot-select");
      select.id = "party-slot-" + String(slotIndex + 1);
      select.disabled = claimsLocked;
      if (slotIndex > 0) {
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "Open";
        select.append(empty);
      }
      for (const actor of actors) {
        const option = document.createElement("option");
        option.value = actor.id;
        option.textContent = actor.name;
        option.selected = this.draft[slotIndex] === actor.id;
        option.disabled = selected.has(actor.id) && this.draft[slotIndex] !== actor.id;
        select.append(option);
      }
      select.addEventListener("change", () => {
        this.draft[slotIndex] = select.value || null;
        this.renderHostReplacement(root, state, actors);
      });
      row.append(select, element("small", undefined, slotIndex === 0 ? "Host Character" : "Guest eligible"));
      slotEditor.append(row);
    }

    const actorDefinitionIds = this.draft.flatMap((id) => id ? [id] : []);
    const contiguous = this.draft.findIndex((id) => id === null) < 0 ||
      this.draft.slice(this.draft.findIndex((id) => id === null)).every((id) => id === null);
    const unique = new Set(actorDefinitionIds).size === actorDefinitionIds.length;
    const validSize = actorDefinitionIds.length >= state.seats.length && actorDefinitionIds.length >= 1;
    const unchanged = state.partyPrepared &&
      actorDefinitionIds.length === state.partySlots.length &&
      actorDefinitionIds.every((actorDefinitionId, index) =>
        actorDefinitionId === state.partySlots[index]?.actorDefinitionId);
    const apply = element(
      "button",
      "session-primary party-apply",
      claimsLocked ? "Party Locked" : unchanged ? "Party Applied" : "Apply Party",
    );
    apply.id = "apply-party";
    apply.type = "button";
    apply.disabled = claimsLocked || unchanged || !contiguous || !unique || !validSize;
    apply.addEventListener("click", () => this.handlers.onSetParty(actorDefinitionIds));
    const gate = element(
      "p",
      apply.disabled && !claimsLocked && !unchanged ? "party-gate invalid" : "party-gate",
      claimsLocked
        ? "A guest claim locked party composition."
        : unchanged
          ? "This party composition is already applied."
          : !validSize
            ? "Party size must cover every connected player."
            : !contiguous || !unique
              ? "Choose unique characters in consecutive slots."
              : "Slot order fixes member identity and encounter spawn.",
    );
    root.append(slotEditor, apply, gate);
  }

  private renderHostReplacement(root: HTMLElement, state: SessionCoreState, actors: readonly ActorDefinition[]): void {
    const replacement = element("section", "party-builder");
    replacement.dataset.partyPrepared = String(state.partyPrepared);
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
    Object.assign(portrait.style, this.catalog.domAtlasPortraitStyle(visual.front, 132));
    const details = element("div", "party-character-copy");
    details.append(
      element("h3", undefined, actor.name),
      element("p", "party-role", roleSummary(actor)),
      element(
        "p",
        "party-stats",
        "HP " + String(actor.maxHp) +
          " · AC " + String(actor.baseAc) +
          " · REF +" + String(actor.reflexModifier) +
          " · INIT +" + String(actor.initiativeModifier) +
          " · " + String(actor.speedFeet) + "ft",
      ),
      element("p", "party-starter", starterSummary(actor, this.pack)),
    );
    card.append(portrait, details);
    return card;
  }

  private renderGuest(root: HTMLElement, state: SessionCoreState, viewerPlayerId: string): void {
    if (!state.partyPrepared) {
      root.append(element("p", "party-waiting", "호스트가 파티를 준비하고 있습니다."));
      return;
    }
    const choices = element("div", "guest-character-choices");
    for (const partySlot of state.partySlots) {
      const actor = this.pack.actorDefinitions[partySlot.actorDefinitionId];
      if (!actor) continue;
      const claimant = state.guestClaims.byMemberId[partySlot.memberId];
      const mine = claimant === viewerPlayerId;
      const hostCharacter = partySlot.slot === 1;
      const available = !hostCharacter && !claimant;
      const button = element("button", "guest-character-choice");
      button.type = "button";
      button.dataset.memberId = partySlot.memberId;
      button.dataset.claimState = hostCharacter ? "host" : mine ? "mine" : claimant ? "taken" : "available";
      button.disabled = !available;
      if (mine) button.classList.add("selected");
      const visual = this.catalog.actorVisual(actor.id);
      const portrait = element("span", "guest-character-art");
      Object.assign(portrait.style, this.catalog.domAtlasPortraitStyle(visual.front, 92));
      button.append(
        portrait,
        element("strong", undefined, "Slot " + String(partySlot.slot) + " · " + actor.name),
        element("small", undefined, hostCharacter ? "Host Character" : mine ? "Your Character" : claimant ? "Claimed" : "Available"),
      );
      if (available) button.addEventListener("click", () => this.handlers.onSelectCharacter(partySlot.memberId));
      choices.append(button);
    }
    root.append(choices);
  }
}
