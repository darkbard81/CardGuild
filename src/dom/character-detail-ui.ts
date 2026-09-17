import type { CompiledContentPack, ActorDefinition } from "../content";
import type { ActorState, SkillId } from "../game";
import { resolveArmorClass, resolveClassDC, resolveInitiative, resolveStatisticModifier } from "../game";
import { ATTRIBUTE_IDS, SKILL_IDS } from "../game/statistics";
import { deriveActorSetup, resolveLoadoutStatProfile, type LoadoutPartyMember } from "../loadout";
import type { AssetCatalog } from "../presentation";
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

/** One modal for prepared Characters and live Characters/Creatures; no invented creature stats. */
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
    dialog.className = "ui-panel ui-panel--dialog ui-character-detail";
    dialog.setAttribute("aria-label", actor.name + " 상세");
    this.dialog = dialog;
    const heading = node("h2", actor.name);
    const close = node("button", "닫기", "ui-button ui-button--secondary") as HTMLButtonElement;
    close.type = "button"; close.addEventListener("click", () => dialog.close());
    const tabs = node("nav", "", "ui-character-detail__tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "캐릭터 정보");
    const body = node("section", "", "ui-character-detail__body"); body.id = "character-detail-panel"; body.setAttribute("role", "tabpanel");
    const context = { content: this.pack.combatContent };
    const entries = ["CORE", "SKILLS", ...(actor.traits.length ? ["TRAITS"] : [])];
    const buttons: HTMLButtonElement[] = [];
    const show = (tab: string): void => {
      buttons.forEach(button => { const selected = button.textContent === tab; button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1; });
      body.setAttribute("aria-labelledby", "character-detail-" + tab);
      body.replaceChildren();
      if (tab === "CORE") {
        const hp = node("p", prepared ? `최대 HP ${actor.maxHp}` : `HP ${actor.hp} / ${actor.maxHp}`);
        const meter = document.createElement("progress"); meter.max = actor.maxHp; meter.value = prepared ? actor.maxHp : actor.hp; meter.setAttribute("aria-label", prepared ? "최대 HP" : "HP");
        const top = node("div", "", "ui-character-detail__core");
        const visual = this.catalog.actorVisual(actor.definitionId);
        const portrait = node("div", "", "ui-character-detail__portrait"); portrait.setAttribute("aria-hidden", "true");
        if (visual) Object.assign(portrait.style, this.catalog.domStandeeStyle(visual.front, 210));
        const attributes = node("dl");
        if (actor.statProfile.kind === "character") for (const attribute of ATTRIBUTE_IDS) {
          attributes.append(node("dt", attribute.toUpperCase()), node("dd", signed(actor.statProfile.stats.attributes[attribute])));
        }
        top.append(portrait, attributes); body.append(hp, meter, top);
        const classNames = actor.traits.flatMap(trait => this.pack.combatContent.traits[trait.id]?.category === "class" ? [this.pack.combatContent.traits[trait.id]!.name] : []);
        if (classNames.length) body.append(node("p", classNames.join(" · ")));
        if (member?.progression) body.append(node("p", progressionText(member.progression)), progressionMeter(actor.name, member.progression));
        else if (actor.statProfile.kind === "character") body.append(node("p", `Lv. ${actor.statProfile.stats.level}`));
        const stats = node("dl", "", "ui-character-detail__stats");
        for (const save of ["fortitude", "reflex", "will"] as const) {
          const rank = actor.statProfile.kind === "character" ? ` · ${actor.statProfile.stats.saves[save]}` : "";
          stats.append(node("dt", save.toUpperCase()), node("dd", signed(resolveStatisticModifier(actor, { kind: "save", id: save }, context).value) + rank));
        }
        stats.append(node("dt", "AC"), node("dd", String(resolveArmorClass(actor, context).value)));
        if (actor.statProfile.kind === "character") stats.append(node("dt", "Class DC"), node("dd", String(resolveClassDC(actor, context).value)));
        stats.append(node("dt", "우선권"), node("dd", signed(resolveInitiative(actor, context).value)), node("dt", "이동"), node("dd", `${actor.speedFeet} ft`));
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
        const definition = this.pack.combatContent.traits[trait.id];
        body.append(node("h3", definition?.name ?? trait.id), node("p", definition?.description ?? ""));
      }
    };
    entries.forEach((tab, index) => {
      const button = node("button", tab, "ui-button ui-button--secondary") as HTMLButtonElement;
      button.type = "button"; button.id = "character-detail-" + tab; button.setAttribute("role", "tab"); button.setAttribute("aria-controls", body.id);
      button.addEventListener("click", () => show(tab));
      button.addEventListener("keydown", event => {
        const next = event.key === "ArrowRight" ? (index + 1) % entries.length : event.key === "ArrowLeft" ? (index + entries.length - 1) % entries.length : event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); show(entries[next]!); buttons[next]!.focus(); }
      });
      buttons.push(button); tabs.append(button);
    });
    dialog.append(close, heading, tabs, body); show("CORE");
    dialog.addEventListener("close", () => { dialog.remove(); if (this.dialog === dialog) this.dialog = null; if (opener?.isConnected) opener.focus(); }, { once: true });
    document.body.append(dialog); dialog.showModal(); buttons[0]!.focus();
  }
}
