import { conditionPresentation, statisticButton, statisticPresentation } from "./actor-effect-view";
import type { CompiledContentPack, ActorDefinition } from "../content";
import type { ActorState, SkillId, CombatContent, ProficiencyRank, ResolvedStatistic } from "../game";
import { resolveStrike, resolveArmorClass, resolveClassDC, resolveInitiative, resolveStatisticDC, resolveStatisticModifier } from "../game";
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
  const setup = deriveActorSetup(definition, { instanceId: member?.id ?? definition.id, actorDefinitionId: definition.id,
    team: "heroes", position: { x: 0, y: 0 }, facing: "north" }, member?.loadout ?? definition.starterLoadout,
  pack.combatContent, member?.id ?? definition.id, member ? resolveLoadoutStatProfile(member, pack) : definition.statProfile);
  return { ...setup, defeated: false, reactionAvailable: false, shieldRaised: false };
}

/** Shared read-only sheet; all numbers come from the authoritative stat resolvers. */
export class CharacterDetailPanel {
  public readonly root = node("div", "", "ui-character-detail ui-character-detail--sheet");
  public readonly body = node("section", "", "ui-character-detail__workspace");
  private readonly overview = node("section", "", "ui-character-detail__overview");
  private readonly effects = node("section", "", "ui-character-detail__effects");
  private readonly skills = node("aside", "", "ui-character-detail__skills");
  private readonly traits: TraitView;
  private readonly traitList;
  private readonly strikeTraits;
  private fingerprint = "";
  private readonly changeNote = node("aside", "", "ui-character-detail__change-note");
  public constructor(private readonly content: CombatContent, private readonly catalog: AssetCatalog,
    private readonly contextKind: "preparation" | "combat", layout: "dialog" | "panel") {
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
    this.strikeTraits = this.traits.createList();
  }
  public update(actor: ActorState, member?: LoadoutPartyMember): void {
    const fingerprint = JSON.stringify([actor, member]);
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    this.root.dataset.actorId = actor.id;
    const scroll = this.body.scrollTop;
    const skillsScroll = this.skills.scrollTop;
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
    this.traitList.render(actor.traits.map(trait => trait.id), chips => this.effects.replaceChildren(traitsHeading, chips, conditionHeading, conditions));

    const skillRows: HTMLElement[] = [];
    if (profile.kind === "character") skillRows.push(statRow("Class DC", actor => resolveClassDC(actor, context), profile.stats.offense.classDcProficiency, true));
    skillRows.push(statRow("Perception", actor => resolveStatisticModifier(actor, { kind: "perception" }, context), profile.kind === "character" ? profile.stats.perception : undefined),
      statRow("Initiative", actor => resolveInitiative(actor, context)), node("h3", "Skills"));
    const skills: readonly SkillId[] = profile.kind === "character" ? SKILL_IDS : Object.keys(profile.stats.skills) as SkillId[];
    for (const id of skills) skillRows.push(statRow(id[0]!.toUpperCase() + id.slice(1), actor => resolveStatisticModifier(actor, { kind: "skill", id }, context), profile.kind === "character" ? profile.stats.skills[id] : undefined));
    if (!skills.length) skillRows.push(node("p", "등록된 기술 정보가 없습니다."));
    this.skills.replaceChildren(...skillRows);

    const equipment = node("div", "", "ui-character-detail__equipment");
    const slots = { armor: "몸", weapon: "주손", shield: "보조손", feet: "악세서리" } as const;
    for (const slot of ["armor", "weapon", "shield", "feet"] as const) {
      const item = actor.equipmentIds.map(id => this.content.equipment[id]).find(item => item?.slot === slot);
      const tile = node("article", "", "ui-character-detail__equipment-slot");
      tile.append(node("span", slots[slot], "ui-character-detail__muted"));
      if (item) {
        const visual = this.catalog.equipmentVisual(item.id);
        if (visual) { const art = node("div", "", "ui-character-detail__equipment-art"); art.setAttribute("aria-hidden", "true"); Object.assign(art.style, this.catalog.domAssetStyle(visual, 48)); tile.append(art); }
      }
      tile.append(node("strong", item?.name ?? "비어 있음")); equipment.append(tile);
    }
    const strike = resolveStrike(actor, context);
    const attack = node("p", `${strike.weaponName} `, "ui-character-detail__strike");
    attack.append(node("strong", signed(strike.attackModifier)));
    annotate(attack, actor => { const resolved = resolveStrike(actor, context); return { value: resolved.attackModifier, sources: resolved.sources }; });
    const damage = node("span");
    damage.dataset.statKey = "Damage";
    damage.append(node("strong", `${strike.damage.count}d${strike.damage.sides}${signed(strike.damage.flatModifier)}`));
    annotate(damage, actor => { const resolved = resolveStrike(actor, context).damage; return { value: resolved.flatModifier, sources: resolved.sources }; });
    attack.append(node("span", " · "), damage, node("span", ` ${strike.damage.damageType} · Reach ${strike.rangeFeet} ft.`));
    const weaponTraits = node("div", "", "ui-character-detail__weapon-traits");
    this.strikeTraits.render(strike.traits, chips => weaponTraits.replaceChildren(chips));
    const cards = node("div", "", "ui-character-detail__cards");
    const counts = new Map<string, number>();
    for (const grant of actor.deckContributions) counts.set(grant.cardDefinitionId, (counts.get(grant.cardDefinitionId) ?? 0) + grant.count);
    for (const [id, count] of counts) {
      const card = this.content.cards[id];
      const tile = node("article", "", "ui-character-detail__card");
      const visual = this.catalog.cardVisual(id);
      if (visual) Object.assign(tile.style, this.catalog.domFillStyle(visual));
      tile.append(node("strong", card?.name ?? id), node("span", `×${count}`));
      cards.append(tile);
    }
    if (!counts.size) cards.append(node("p", "구성된 카드가 없습니다."));
    const innate = actor.innateActionIds.map(id => this.content.actions[id]?.name ?? id);
    this.body.replaceChildren(node("h3", "장비"), equipment, attack, weaponTraits, node("h3", "카드"), cards);
    if (innate.length) this.body.append(node("h3", "고유 행동"), node("p", innate.join(" · ")));
    this.body.scrollTop = scroll;
    this.skills.scrollTop = skillsScroll;
    if (focusedStat || focusedNote) {
      const replacement = [...this.root.querySelectorAll<HTMLElement>("[data-stat-key]")].find(item => item instanceof HTMLButtonElement && item.dataset.statKey === focusedStat);
      const fallback = this.root.closest("dialog")?.querySelector<HTMLButtonElement>("button");
      (replacement ?? fallback)?.focus({ preventScroll: true });
    }
    if (focusedTrait) [...this.root.querySelectorAll<HTMLElement>("[data-trait-id]")].find(chip => chip.dataset.traitId === focusedTrait)?.focus({ preventScroll: true });
  }
  public dismissDetails(): void { this.changeNote.hidden = true; this.traits.dismiss(); }
  public destroy(): void { this.strikeTraits.clear(); this.traitList.clear(); this.traits.destroy(); this.root.remove(); }
}

/** Lobby and preparation wrapper; combat supplies its own live snapshot adapter. */
export class CharacterDetailUi {
  private dialog: HTMLDialogElement | null = null;
  public constructor(private readonly pack: CompiledContentPack, private readonly catalog: AssetCatalog) {}
  public close(): void { this.dialog?.close(); }
  public openPrepared(definition: ActorDefinition, member?: LoadoutPartyMember): void {
    this.open(preparationDetailActor(definition, this.pack, member), member, true);
  }
  public open(actor: ActorState, member?: LoadoutPartyMember, prepared = false): void {
    this.close();
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.createElement("dialog");
    dialog.className = "ui-panel ui-panel--dialog ui-character-detail-dialog ui-character-detail-dialog--fullscreen";
    dialog.setAttribute("aria-label", actor.name + " 상세"); this.dialog = dialog;
    const close = node("button", "닫기", "ui-button ui-button--secondary") as HTMLButtonElement;
    close.type = "button"; close.addEventListener("click", () => dialog.close());
    const panel = new CharacterDetailPanel(this.pack.combatContent, this.catalog, prepared ? "preparation" : "combat", "dialog");
    panel.update(actor, member); dialog.append(close, panel.root);
    dialog.addEventListener("close", () => { panel.destroy(); dialog.remove(); if (this.dialog === dialog) this.dialog = null; if (opener?.isConnected) opener.focus(); }, { once: true });
    document.body.append(dialog); dialog.showModal(); close.focus();
  }
}
