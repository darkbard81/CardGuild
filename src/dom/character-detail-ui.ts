import { resolvePartyMemberDefinition } from "../character/member";
import { updateCharacterPicker } from "./character-picker";
import type { AdventureState } from "../adventure";
import { CharacterWorkspace, sheetNode, type CharacterSheetDestination, type CharacterSheetEditor, type CharacterSheetHandlers } from "./character-workspace";
import { conditionPresentation, statisticButton, statisticPresentation } from "./actor-effect-view";
import type { CompiledContentPack, ActorDefinition } from "../content";
import type { ActorState, SkillId, CombatContent, ProficiencyRank, ResolvedStatistic } from "../game";
import { resolveArmorClass, resolveClassDC, resolveInitiative, resolveStatisticDC, resolveStatisticModifier } from "../game";
import { ATTRIBUTE_IDS, SKILL_IDS } from "../game/statistics";
import { deriveActorSetup, resolveLoadoutStatProfile, type LoadoutPartyMember } from "../loadout";
import type { AssetCatalog } from "../presentation";
import { TraitView } from "./trait-view";
import { progressionMeter } from "./progression-view";

function node(tag: string, text = "", className = ""): HTMLElement {
  const result = document.createElement(tag); result.textContent = text; result.className = className; return result;
}
const signed = (value: number): string => value >= 0 ? `+${value}` : String(value);

/** Preparation adapters use the same equipment/progression pipeline as encounter creation. */
export function preparationDetailActor(definition: ActorDefinition, pack: CompiledContentPack, member?: LoadoutPartyMember): ActorState {
  if (member) definition = resolvePartyMemberDefinition(member, pack);
  const setup = deriveActorSetup(definition, { instanceId: member?.id ?? definition.id, actorDefinitionId: definition.id,
    team: "heroes", position: { x: 0, y: 0 }, facing: "north" }, member?.loadout ?? definition.starterLoadout,
  pack.combatContent, member?.id ?? definition.id, member ? resolveLoadoutStatProfile(member, pack) : definition.statProfile);
  return { ...setup, defeated: false, reactionAvailable: false, shieldRaised: false };
}

/** Shared sheet; all numbers come from the authoritative stat resolvers. */
export class CharacterDetailPanel {
  public readonly root = node("div", "", "ui-character-detail ui-character-detail--sheet");
  public readonly body = node("section", "", "ui-character-detail__workspace");
  private readonly overview = node("section", "", "ui-character-detail__overview");
  private readonly effects = node("section", "", "ui-character-detail__effects");
  private readonly skills = node("aside", "", "ui-character-detail__skills");
  private readonly traits: TraitView;
  private readonly traitList;
  public readonly workspace: CharacterWorkspace;
  private fingerprint = "";
  private readonly changeNote = node("aside", "", "ui-character-detail__change-note");
  public constructor(private readonly content: CombatContent, catalog: AssetCatalog,
    private readonly contextKind: "preparation" | "combat", layout: "dialog" | "panel", onBusy?: (busy: boolean) => void) {
    this.root.dataset.layout = layout;
    this.root.dataset.context = contextKind;
    this.overview.setAttribute("aria-label", "기본 정보와 방어");
    this.skills.setAttribute("aria-label", "스킬과 지각");
    this.body.setAttribute("aria-label", "장비와 카드");
    this.changeNote.hidden = true;
    this.changeNote.setAttribute("role", "status");
    this.root.append(this.overview, this.effects, this.skills, this.body, this.changeNote);
    this.traits = new TraitView(content.traits, this.root);
    this.traitList = this.traits.createList();
    this.workspace = new CharacterWorkspace(content, catalog, onBusy);
    this.body.append(this.workspace.root);
  }
  public update(actor: ActorState, member?: LoadoutPartyMember, editor?: CharacterSheetEditor): void {
    this.workspace.update(actor, member, editor);
    const fingerprint = JSON.stringify([actor, member]);
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    this.root.dataset.actorId = actor.id;
    const scroll = this.body.scrollTop;
    const skillsScroll = this.skills.scrollTop;
    const untrainedOpen = this.skills.querySelector("details")?.open ?? false;
    const focused = document.activeElement;
    const focusedStat = focused instanceof HTMLElement ? focused.dataset.statKey : undefined;
    const focusedNote = focused instanceof HTMLElement && this.changeNote.contains(focused);
    const focusedTrait = focused instanceof HTMLElement && this.root.contains(focused) ? focused.dataset.traitId : undefined;
    const context = { content: this.content };
    const profile = actor.statProfile;
    this.changeNote.hidden = true;
    const annotate = (element: HTMLElement, resolve: (actor: ActorState) => ResolvedStatistic): HTMLElement => {
      const result = statisticPresentation(actor, resolve);
      if (this.contextKind !== "combat" || result.delta === 0) return element;
      const value = element.querySelector("strong");
      if (!value) return element;
      const button = statisticButton(element.dataset.statKey ?? element.textContent ?? "", value.textContent ?? "", result, (explanation, button) => {
        const close = node("button", "닫기", "ui-button ui-button--secondary") as HTMLButtonElement;
        close.type = "button";
        close.addEventListener("click", () => { this.changeNote.hidden = true; button.focus(); });
        this.changeNote.replaceChildren(node("p", explanation), close); this.changeNote.hidden = false;
      });
      button.dataset.statKey = element.dataset.statKey ?? element.className;
      value.replaceChildren(button);
      return element;
    };
    const statRow = (label: string, resolve: (actor: ActorState) => ResolvedStatistic, rank?: ProficiencyRank, unsigned = false) =>
      annotate(row(label, unsigned ? String(resolve(actor).value) : signed(resolve(actor).value), rank), resolve);
    const field = (label: string, value: string, className = "") => {
      const field = node("div", "", `ui-character-detail__field ${className}`);
      field.dataset.statKey = label;
      field.append(node("span", label), node("strong", value));
      return field;
    };
    const row = (label: string, value: string, rank?: ProficiencyRank) => {
      const row = node("div", "", "ui-character-detail__stat-row");
      row.dataset.statKey = label;
      const badge = node("span", rank ? rank[0]!.toUpperCase() : "—", "ui-character-detail__rank");
      badge.dataset.rank = rank ?? "fixed";
      badge.title = rank ?? "Fixed";
      badge.setAttribute("aria-label", rank ?? "고정 수치");
      row.append(badge, node("strong", value), node("span", label));
      return row;
    };
    const identity = node("div", "", "ui-character-detail__identity");
    identity.append(field("Level", String(profile.stats.level ?? 1)), field("XP", member?.progression ? String(member.progression.experience) : "—"));
    const name = node("div", "", "ui-character-detail__name");
    name.append(node("span", "Character Name"), node("h2", actor.name));
    identity.append(name);
    const attributes = node("div", "", "ui-character-detail__attributes");
    attributes.append(field("SPEED", `${actor.speedFeet} ft.`));
    if (profile.kind === "character") for (const id of ATTRIBUTE_IDS) attributes.append(field(id.toUpperCase(), signed(profile.stats.attributes[id])));
    const defense = node("div", "", "ui-character-detail__defense");
    const ac = annotate(field("AC", String(resolveArmorClass(actor, context).value), "ui-character-detail__ac"), actor => resolveArmorClass(actor, context));
    const vitality = node("div", "", "ui-character-detail__vitality");
    const hp = node("div", this.contextKind === "combat" ? `HP ${actor.hp} / ${actor.maxHp}` : `최대 HP ${actor.maxHp}`, "ui-character-detail__hp");
    hp.style.setProperty("--hp-fill", `${Math.max(0, Math.min(100, actor.hp / actor.maxHp * 100))}%`);
    const shield = actor.equipmentIds.map(id => this.content.equipment[id]).find(item => item?.slot === "shield");
    vitality.append(hp, node("div", shield ? `${shield.name}${this.contextKind === "combat" ? actor.shieldRaised ? " · Raised" : " · Lowered" : ""}` : "No Shield", "ui-character-detail__shield"));
    if (member?.progression) vitality.append(progressionMeter(actor.name, member.progression));
    const saves = node("div", "", "ui-character-detail__saves");
    for (const id of ["fortitude", "reflex", "will"] as const) {
      const save = statRow(id[0]!.toUpperCase() + id.slice(1), actor => resolveStatisticModifier(actor, { kind: "save", id }, context), profile.kind === "character" ? profile.stats.saves[id] : undefined);
      save.title = `DC ${resolveStatisticDC(actor, { kind: "save", id }, context).value}`;
      saves.append(save);
    }
    defense.append(ac, vitality, saves);
    this.overview.replaceChildren(identity, attributes, defense);

    const traitsHeading = node("h3", "Traits");
    const conditionHeading = node("h3", "Condition");
    const conditions = node("div", "", "ui-character-detail__conditions");
    if (this.contextKind === "combat") {
      for (const condition of actor.conditions) {
        const group = node("div", "", "ui-character-detail__condition ui-condition-chip");
        const { label, effects, tone } = conditionPresentation(condition, this.content);
        group.dataset.tone = tone;
        group.append(node("span", label));
        if (effects.length) {
          const list = node("ul", "", "ui-character-detail__derived-effects");
          for (const effect of effects) list.append(node("li", effect.label));
          group.append(list);
        }
        conditions.append(group);
      }
      if (!actor.conditions.length) conditions.append(node("span", "상태 이상 없음", "ui-character-detail__muted"));
      conditions.append(node("p", `Facing ${actor.facing} · Reaction ${actor.reactionAvailable ? "Available" : "Spent"}`, "ui-character-detail__combat-state"));
    } else conditions.append(node("span", "전투 중 표시", "ui-character-detail__muted"));
    const traitsGroup = node("section", "", "ui-character-detail__effect-group");
    traitsGroup.setAttribute("aria-label", "Traits");
    const conditionGroup = node("section", "", "ui-character-detail__effect-group");
    conditionGroup.setAttribute("aria-label", "Condition");
    conditionGroup.append(conditionHeading, conditions);
    this.traitList.render(actor.traits.map(trait => trait.id), chips => {
      traitsGroup.replaceChildren(traitsHeading, chips);
      this.effects.replaceChildren(traitsGroup, conditionGroup);
    });

    const skillRows: HTMLElement[] = [];
    if (profile.kind === "character") skillRows.push(statRow("Class DC", actor => resolveClassDC(actor, context), profile.stats.offense.classDcProficiency, true));
    skillRows.push(statRow("Perception", actor => resolveStatisticModifier(actor, { kind: "perception" }, context), profile.kind === "character" ? profile.stats.perception : undefined),
      statRow("Initiative", actor => resolveInitiative(actor, context)), node("h3", profile.kind === "character" ? "Skills (Trained or higher)" : "Skills"));
    const skills: readonly SkillId[] = profile.kind === "character" ? SKILL_IDS : Object.keys(profile.stats.skills) as SkillId[];
    const untrained = document.createElement("details");
    untrained.className = "ui-character-detail__untrained"; untrained.open = untrainedOpen;
    const untrainedRows: HTMLElement[] = [];
    for (const id of skills) {
      const rank = profile.kind === "character" ? profile.stats.skills[id] : undefined;
      const item = statRow(id[0]!.toUpperCase() + id.slice(1), actor => resolveStatisticModifier(actor, { kind: "skill", id }, context), rank);
      if (rank === "untrained") untrainedRows.push(item); else skillRows.push(item);
    }
    if (untrainedRows.length) { untrained.append(node("summary", `Untrained (${untrainedRows.length})`), ...untrainedRows); skillRows.push(untrained); }
    if (!skills.length) skillRows.push(node("p", "등록된 기술 정보가 없습니다."));
    this.skills.replaceChildren(...skillRows);

    this.body.scrollTop = scroll;
    this.skills.scrollTop = skillsScroll;
    if (focusedStat || focusedNote) {
      const replacement = [...this.root.querySelectorAll<HTMLElement>("[data-stat-key]")].find(item => item instanceof HTMLButtonElement && item.dataset.statKey === focusedStat);
      const fallback = this.root.closest("dialog")?.querySelector<HTMLButtonElement>("button");
      (replacement ?? fallback)?.focus({ preventScroll: true });
    }
    if (focusedTrait) [...this.root.querySelectorAll<HTMLElement>("[data-trait-id]")].find(chip => chip.dataset.traitId === focusedTrait)?.focus({ preventScroll: true });
  }
  public dismissDetails(): void { this.changeNote.hidden = true; this.traits.dismiss(); this.workspace.dismissDetails(); }
  public destroy(): void { this.workspace.destroy(); this.traitList.clear(); this.traits.destroy(); this.root.remove(); }
}

/** Preparation/lobby adapter for the same full-screen sheet used by combat. */
export class CharacterDetailUi {
  private dialog: HTMLDialogElement | null = null;
  private panel: CharacterDetailPanel | null = null;
  private select: HTMLElement | null = null;
  private adventure: AdventureState | null = null;
  private editableMemberIds: ReadonlySet<string> = new Set();
  private selectedMemberId = "";
  private connection = "connected";
  public constructor(private readonly pack: CompiledContentPack, private readonly catalog: AssetCatalog,
    private readonly handlers?: CharacterSheetHandlers) {}
  public close(): void {
    const dialog = this.dialog;
    if (!dialog) return;
    // Forced lifecycle transitions may close a pending editor. The SessionClient still owns
    // the request; destroying its view does not cancel or resubmit that request.
    dialog.close(); this.panel?.destroy(); this.panel = null; this.dialog = null;
    this.select = null; this.adventure = null; dialog.remove();
  }
  public destroy(): void { this.close(); }
  public setConnectionStatus(status: string): void { this.connection = status; this.renderAdventure(); }
  public reportError(message: string): void { this.panel?.workspace.reportError(message); }
  private create(prepared: boolean): CharacterDetailPanel {
    this.close();
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const openerLabel = opener?.getAttribute("aria-label") ?? opener?.textContent;
    const dialog = sheetNode("dialog", "", "ui-panel ui-panel--dialog ui-character-detail-dialog ui-character-detail-dialog--fullscreen");
    dialog.setAttribute("aria-label", "캐릭터 상세"); this.dialog = dialog;
    const select = sheetNode("div"); this.select = select;
    const close = sheetNode("button", "닫기", "ui-button ui-button--secondary"); close.type = "button";
    close.addEventListener("click", () => { if (!this.panel?.workspace.busy) this.close(); });
    const header = sheetNode("header", "", "ui-character-detail-dialog__header"); header.append(select, close);
    const panel = new CharacterDetailPanel(this.pack.combatContent, this.catalog, prepared ? "preparation" : "combat", "dialog", busy => {
      close.disabled = busy; select.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = busy; });
    });
    this.panel = panel; dialog.append(header, panel.root);
    dialog.addEventListener("cancel", event => { if (panel.workspace.escape()) event.preventDefault(); });
    dialog.addEventListener("close", () => {
      if (this.dialog === dialog) this.close();
      if (document.querySelector("dialog[open]")) return;
      const replacement = [...document.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")].find(button =>
        button.getClientRects().length > 0 && (button.getAttribute("aria-label") ?? button.textContent) === openerLabel);
      if (opener?.isConnected) opener.focus();
      else (replacement ?? document.querySelector<HTMLButtonElement>("#adventure-screen button:not(:disabled)"))?.focus();
    }, { once: true });
    document.body.append(dialog); dialog.showModal(); close.focus(); return panel;
  }
  public openPrepared(definition: ActorDefinition, member?: LoadoutPartyMember): void { this.open(preparationDetailActor(definition, this.pack, member), member, true); }
  public open(actor: ActorState, member?: LoadoutPartyMember, prepared = false): void {
    const panel = this.create(prepared);
    updateCharacterPicker(this.select!, [actor], actor.id, this.catalog, () => {});
    panel.update(actor, member);
  }
  public openAdventure(state: AdventureState, editableMemberIds: ReadonlySet<string>, destination: CharacterSheetDestination = {}): void {
    const panel = this.create(true);
    this.adventure = state; this.editableMemberIds = editableMemberIds;
    const members = Object.values(state.party.members);
    this.selectedMemberId = destination.memberId ?? members.find(member => editableMemberIds.has(member.id))?.id ?? members[0]?.id ?? "";
    this.renderAdventure(); panel.workspace.navigate(destination);
  }
  public updateAdventure(state: AdventureState, editableMemberIds: ReadonlySet<string>): void {
    if (!this.adventure) return;
    const wasPreparing = this.adventure.phase === "ready" || this.adventure.phase === "between-encounters";
    const preparing = state.phase === "ready" || state.phase === "between-encounters";
    if (wasPreparing && !preparing) { this.close(); return; }
    this.adventure = state; this.editableMemberIds = editableMemberIds; this.renderAdventure();
  }
  private renderAdventure(): void {
    const state = this.adventure; if (!state || !this.panel || !this.select) return;
    const members = Object.values(state.party.members);
    const member = members.find(m => m.id === this.selectedMemberId);
    if (!member) { this.close(); return; }
    const definition = resolvePartyMemberDefinition(member, this.pack); if (!definition) { this.close(); return; }
    updateCharacterPicker(this.select, members.map(m => ({ id: m.id, definitionId: m.actorDefinitionId, appearanceKey: resolvePartyMemberDefinition(m, this.pack).appearanceKey, name: resolvePartyMemberDefinition(m, this.pack)?.name ?? m.id })), member.id, this.catalog, id => {
      this.selectedMemberId = id; this.renderAdventure();
    }, this.panel.workspace.busy);
    const editable = (state.phase === "ready" || state.phase === "between-encounters") && this.editableMemberIds.has(member.id);
    this.panel.update(preparationDetailActor(definition, this.pack, member), member, this.handlers ? {
      pack: this.pack, state, editable, connection: this.connection, onSetLoadout: this.handlers.onSetLoadout,
    } : undefined);
  }
}
