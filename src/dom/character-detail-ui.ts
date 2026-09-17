import type { CompiledContentPack, ActorDefinition } from "../content";
import type { ActorState, SkillId, CombatContent } from "../game";
import { equippedArmor, resolveStrike, resolveArmorClass, resolveClassDC, resolveInitiative, resolveStatisticDC, resolveStatisticModifier } from "../game";
import { ATTRIBUTE_IDS, SKILL_IDS } from "../game/statistics";
import { deriveActorSetup, resolveLoadoutStatProfile, type LoadoutPartyMember } from "../loadout";
import type { AssetCatalog } from "../presentation";
import { TraitView } from "./trait-view";
import { progressionMeter, progressionText } from "./progression-view";

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

let detailInstance = 0;
export type CharacterDetailTab = "CORE" | "SKILLS" | "TRAITS" | "ACTION";

/** Shared sheet. The combat adapter supplies live actors; preparation supplies resolved loadouts. */
export class CharacterDetailPanel {
  public readonly root = node("div", "", "ui-character-detail");
  public readonly body = node("section", "", "ui-character-detail__body");
  private readonly heading = node("h2");
  private readonly buttons = new Map<CharacterDetailTab, HTMLButtonElement>();
  private readonly traits: TraitView;
  private readonly strikeTraits;
  private actor: ActorState | null = null;
  private member?: LoadoutPartyMember;
  private fingerprint = "";
  private externalSummary = false;
  public tab: CharacterDetailTab = "CORE";
  public onTabChange?: (tab: CharacterDetailTab) => void;
  public constructor(private readonly content: CombatContent, private readonly catalog: AssetCatalog,
    private readonly contextKind: "preparation" | "combat", layout: "dialog" | "panel",
    private readonly actionBody?: HTMLElement, private readonly sharedTraits?: TraitView) {
    this.root.dataset.layout = layout;
    this.root.dataset.context = contextKind;
    this.traits = sharedTraits ?? new TraitView(content.traits);
    this.strikeTraits = this.traits.createList();
    const id = `character-detail-${++detailInstance}`;
    const tabs = node("nav", "", "ui-character-detail__tabs");
    tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "캐릭터 정보");
    this.body.id = id + "-panel"; this.body.setAttribute("role", "tabpanel");
    const entries: CharacterDetailTab[] = ["CORE", "SKILLS", "TRAITS", ...(actionBody ? ["ACTION" as const] : [])];
    entries.forEach((tab, index) => {
      const button = node("button", tab, "ui-button ui-button--secondary") as HTMLButtonElement;
      button.type = "button"; button.id = id + "-" + tab; button.setAttribute("role", "tab"); button.setAttribute("aria-controls", this.body.id);
      button.addEventListener("click", () => { this.show(tab); this.onTabChange?.(tab); });
      button.addEventListener("keydown", event => {
        const next = event.key === "ArrowRight" ? (index + 1) % entries.length : event.key === "ArrowLeft" ? (index + entries.length - 1) % entries.length : event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); event.stopPropagation(); const value = entries[next]!; this.show(value); this.onTabChange?.(value); this.buttons.get(value)!.focus(); }
      });
      this.buttons.set(tab, button); tabs.append(button);
    });
    this.root.append(this.heading, tabs, this.body);
    if (actionBody) { actionBody.hidden = true; this.root.append(actionBody); }
  }
  public update(actor: ActorState, member?: LoadoutPartyMember, externalSummary = false): void {
    const fingerprint = JSON.stringify([actor, member, externalSummary]);
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint; this.actor = actor; this.member = member; this.externalSummary = externalSummary;
    this.heading.hidden = externalSummary;
    this.heading.textContent = actor.name;
    this.root.dataset.actorId = actor.id;
    this.show(this.tab);
  }
  public show(tab: CharacterDetailTab): void {
    this.tab = tab;
    for (const [value, button] of this.buttons) { button.setAttribute("aria-selected", String(value === tab)); button.tabIndex = value === tab ? 0 : -1; }
    this.body.setAttribute("aria-labelledby", this.buttons.get(tab)!.id);
    const destination = this.body;
    const scroll = destination.scrollTop;
    const body = node("div");
    // ACTION is persistent: preview updates must not recreate its controls on snapshots.
    if (this.actionBody) { this.actionBody.hidden = tab !== "ACTION"; if (tab !== "ACTION") this.root.append(this.actionBody); }
    if (tab === "ACTION") { if (this.actionBody && destination.firstChild !== this.actionBody) destination.replaceChildren(this.actionBody); return; }
    const actor = this.actor; if (!actor) return;
    const member = this.member, contextKind = this.contextKind, context = { content: this.content };

      if (tab === "CORE") {
        const hp = node("p", contextKind === "preparation" ? `최대 HP ${actor.maxHp}` : `HP ${actor.hp} / ${actor.maxHp}`);
        const meter = document.createElement("progress"); meter.max = actor.maxHp; meter.value = contextKind === "preparation" ? actor.maxHp : actor.hp; meter.setAttribute("aria-label", contextKind === "preparation" ? "최대 HP" : "HP");
        const top = node("div", "", "ui-character-detail__core");
        const visual = this.catalog.actorVisual(actor.definitionId);
        const portrait = node("div", "", "ui-character-detail__portrait"); portrait.setAttribute("aria-hidden", "true");
        if (visual) Object.assign(portrait.style, this.catalog.domStandeeStyle(visual.front, 210));
        const attributes = node("dl");
        if (actor.statProfile.kind === "character") for (const attribute of ATTRIBUTE_IDS) {
          attributes.append(node("dt", attribute.toUpperCase()), node("dd", signed(actor.statProfile.stats.attributes[attribute])));
        }
        top.append(portrait, attributes);
        if (!this.externalSummary) body.append(hp, meter);
        body.append(top);
        const classNames = actor.traits.flatMap(trait => this.content.traits[trait.id]?.category === "class" ? [this.content.traits[trait.id]!.name] : []);
        if (classNames.length) body.append(node("p", classNames.join(" · ")));
        if (member?.progression) body.append(node("p", progressionText(member.progression)), progressionMeter(actor.name, member.progression));
        else if (actor.statProfile.kind === "character") body.append(node("p", `Lv. ${actor.statProfile.stats.level}`));
        const stats = node("dl", "", "ui-character-detail__stats");
        for (const save of ["fortitude", "reflex", "will"] as const) {
          const rank = actor.statProfile.kind === "character" ? ` · ${actor.statProfile.stats.saves[save]}` : "";
          stats.append(node("dt", save.toUpperCase()), node("dd", signed(resolveStatisticModifier(actor, { kind: "save", id: save }, context).value) + rank));
        }
        for (const save of ["fortitude", "reflex", "will"] as const) stats.append(node("dt", `${save[0]!.toUpperCase()}${save.slice(1)} DC`), node("dd", String(resolveStatisticDC(actor, { kind: "save", id: save }, context).value)));
        stats.append(node("dt", "AC"), node("dd", String(resolveArmorClass(actor, context).value)));
        if (actor.statProfile.kind === "character") stats.append(node("dt", "Class DC"), node("dd", String(resolveClassDC(actor, context).value)));
        stats.append(node("dt", "우선권"), node("dd", signed(resolveInitiative(actor, context).value)), node("dt", "이동"), node("dd", `${actor.speedFeet} ft`));
        const strike = resolveStrike(actor, context);
        stats.append(node("dt", "Perception"), node("dd", signed(resolveStatisticModifier(actor, { kind: "perception" }, context).value)),
          node("dt", "Strike"), node("dd", `${strike.weaponName} ${signed(strike.attackModifier)} · ${strike.damage.count}d${strike.damage.sides}${signed(strike.damage.flatModifier)}`),
          node("dt", "Damage"), node("dd", strike.damage.damageType), node("dt", "Reach"), node("dd", `${strike.rangeFeet}ft`),
          node("dt", "Armor"), node("dd", equippedArmor(actor, context)?.name ?? "Unarmored"));
        if (contextKind === "combat") stats.append(node("dt", "Facing"), node("dd", actor.facing),
          node("dt", "Reaction"), node("dd", actor.reactionAvailable ? "Available" : "Spent"),
          node("dt", "Shield"), node("dd", actor.shieldRaised ? "Raised" : "Lowered"));
        if (contextKind === "combat" && !this.externalSummary) stats.append(node("dt", "Conditions"), node("dd", actor.conditions.map(condition => condition.id).join(" · ") || "—"));
        body.append(stats);

      } else if (tab === "SKILLS") {
        const list = node("dl");
        const skills: readonly SkillId[] = actor.statProfile.kind === "character" ? SKILL_IDS : Object.keys(actor.statProfile.stats.skills) as SkillId[];
        for (const skill of skills) {
          const rank = actor.statProfile.kind === "character" ? ` · ${actor.statProfile.stats.skills[skill]}` : "";
          list.append(node("dt", skill), node("dd", signed(resolveStatisticModifier(actor, { kind: "skill", id: skill }, context).value) + rank));
        }
        body.append(skills.length ? list : node("p", "등록된 기술 정보가 없습니다."));
      } else for (const trait of actor.traits) {
        const definition = this.content.traits[trait.id];
        body.append(node("h3", definition?.name ?? trait.id), node("p", definition?.description ?? ""));
      }

    if (tab === "CORE") this.strikeTraits.render(resolveStrike(actor, context).traits, chips => { body.append(chips); destination.replaceChildren(...body.childNodes); });
    else { this.strikeTraits.clear(); destination.replaceChildren(...body.childNodes); }
    destination.scrollTop = scroll;
  }
  public destroy(): void { this.strikeTraits.clear(); if (!this.sharedTraits) this.traits.destroy(); this.root.remove(); }
}

/** Modal wrapper used by lobby and preparation; combat embeds the same panel. */
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
    dialog.className = "ui-panel ui-panel--dialog ui-character-detail-dialog";
    dialog.setAttribute("aria-label", actor.name + " 상세"); this.dialog = dialog;
    const close = node("button", "닫기", "ui-button ui-button--secondary") as HTMLButtonElement;
    close.type = "button"; close.addEventListener("click", () => dialog.close());
    const panel = new CharacterDetailPanel(this.pack.combatContent, this.catalog, prepared ? "preparation" : "combat", "dialog");
    panel.update(actor, member); dialog.append(close, panel.root);
    dialog.addEventListener("close", () => { panel.destroy(); dialog.remove(); if (this.dialog === dialog) this.dialog = null; if (opener?.isConnected) opener.focus(); }, { once: true });
    document.body.append(dialog); dialog.showModal(); panel.root.querySelector<HTMLButtonElement>("[role=tab]")!.focus();
  }
}
