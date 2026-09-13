import {
  applyCharacterAdvancement, ATTRIBUTE_BOOST_LEVELS, nextSkillRank, pendingCharacterAdvancements,
  resolveCharacterRules, SKILL_INCREASE_LEVELS,
} from "../character";
import type { CharacterAdvancementChoice } from "../character";
import type { PartyMemberState } from "../adventure";
import type { CompiledContentPack } from "../content";
import { ATTRIBUTE_IDS, SKILL_IDS } from "../game/statistics";
import type { AttributeId, SkillId } from "../game/types";

interface Draft {
  level: number;
  skill?: SkillId;
  attributes: Set<AttributeId>;
  pending: boolean;
  error: string;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Only drafts live here. A selected boost becomes gameplay only in a committed snapshot. */
export class CharacterAdvancementUi {
  private readonly drafts = new Map<string, Draft>();

  public constructor(private readonly pack: CompiledContentPack,
    private readonly onCommit: (memberId: string, choice: CharacterAdvancementChoice) => boolean) {}

  public reportError(message: string): void {
    for (const draft of this.drafts.values()) {
      if (draft.pending) { draft.pending = false; draft.error = message; }
    }
  }

  public clear(): void { this.drafts.clear(); }

  public render(member: PartyMemberState, editable: boolean, phaseAllows: boolean): HTMLElement | null {
    const pending = pendingCharacterAdvancements(member.progression.level, member.progression.advancements);
    const level = pending[0];
    if (level === undefined) { this.drafts.delete(member.id); return null; }
    const panel = element("section"); panel.className = "character-advancement";
    panel.dataset.advancementMember = member.id; panel.dataset.advancementLevel = String(level);
    panel.setAttribute("aria-label", `${this.pack.actorDefinitions[member.actorDefinitionId]?.name ?? member.id} Level-Up`);
    panel.append(element("h3", `Lv. ${level} · Level-Up`));
    if (!phaseAllows) {
      panel.append(element("p", "보상을 선택한 뒤 성장 선택을 완료하세요.")); return panel;
    }
    if (!editable) {
      this.drafts.delete(member.id);
      panel.append(element("p", "이 캐릭터를 조종하는 플레이어의 성장 선택을 기다립니다.")); return panel;
    }
    const actor = this.pack.actorDefinitions[member.actorDefinitionId];
    if (!actor?.character) throw new Error("Character Build is missing.");
    const character = { traits: actor.traits, build: actor.character.build };
    const before = resolveCharacterRules({ ...character, progression: member.progression }, this.pack.characterRules);
    let draft = this.drafts.get(member.id);
    if (!draft || draft.level !== level) {
      draft = { level, attributes: new Set(), pending: false, error: "" };
      this.drafts.set(member.id, draft);
    }
    const current = draft;
    const form = element("form");
    const controls = element("fieldset");
    controls.append(element("legend", "성장 선택"));
    const needsSkill = (SKILL_INCREASE_LEVELS as readonly number[]).includes(level);
    const needsAttributes = (ATTRIBUTE_BOOST_LEVELS as readonly number[]).includes(level);
    if (needsSkill) {
      const label = element("label", "Skill Increase ");
      const select = element("select"); select.name = "skillIncrease";
      select.append(new Option("Skill을 선택하세요", ""));
      for (const skill of SKILL_IDS) {
        const rank = before.statProfile.stats.skills[skill];
        const next = nextSkillRank(rank, level);
        const option = new Option(`${skill} · ${rank}${next ? ` → ${next}` : " (현재 성장 불가)"}`, skill);
        option.disabled = next === null; select.append(option);
      }
      select.value = current.skill ?? "";
      select.addEventListener("change", () => { current.skill = select.value ? select.value as SkillId : undefined; current.error = ""; update(); });
      label.append(select); controls.append(label);
    }
    const boxes: HTMLInputElement[] = [];
    if (needsAttributes) {
      const attributes = element("fieldset"); attributes.className = "advancement-attributes";
      attributes.append(element("legend", "Attribute Boost · 서로 다른 4개"));
      for (const attribute of ATTRIBUTE_IDS) {
        const label = element("label"); const box = element("input"); box.type = "checkbox";
        box.name = "attributeBoosts"; box.value = attribute; box.checked = current.attributes.has(attribute);
        label.append(box, document.createTextNode(`${attribute.toUpperCase()} ${before.statProfile.stats.attributes[attribute] >= 0 ? "+" : ""}${before.statProfile.stats.attributes[attribute]}${before.partialAttributeBoosts[attribute] ? " (partial)" : ""}`));
        box.addEventListener("change", () => { if (box.checked) current.attributes.add(attribute); else current.attributes.delete(attribute); current.error = ""; update(); });
        boxes.push(box); attributes.append(label);
      }
      controls.append(attributes);
    }
    const preview = element("p"); preview.className = "advancement-preview"; preview.setAttribute("role", "status");
    const submit = element("button", "성장 확정"); submit.type = "submit"; submit.className = "advancement-commit";
    form.append(controls, preview, submit); panel.append(form);
    let choice: CharacterAdvancementChoice | null = null;
    const update = (): void => {
      controls.disabled = current.pending;
      for (const box of boxes) box.disabled = !box.checked && current.attributes.size >= 4;
      choice = null;
      submit.disabled = true; submit.textContent = current.pending ? "저장 중…" : "성장 확정";
      if ((needsSkill && !current.skill) || (needsAttributes && current.attributes.size !== 4)) {
        preview.textContent = current.error || "필요한 성장 항목을 모두 선택하세요."; return;
      }
      const candidate: CharacterAdvancementChoice = {
        level, ...(needsSkill ? { skillIncrease: current.skill! } : {}),
        ...(needsAttributes ? { attributeBoosts: ATTRIBUTE_IDS.filter(id => current.attributes.has(id)) as unknown as NonNullable<CharacterAdvancementChoice["attributeBoosts"]> } : {}),
      };
      try {
        const progression = applyCharacterAdvancement(member.progression, candidate, character, this.pack.characterRules);
        const after = resolveCharacterRules({ ...character, progression }, this.pack.characterRules);
        const changes: string[] = [];
        if (candidate.skillIncrease) changes.push(`${candidate.skillIncrease}: ${before.statProfile.stats.skills[candidate.skillIncrease]} → ${after.statProfile.stats.skills[candidate.skillIncrease]}`);
        for (const attribute of candidate.attributeBoosts ?? []) {
          changes.push(`${attribute.toUpperCase()}: ${before.statProfile.stats.attributes[attribute]} → ${after.statProfile.stats.attributes[attribute]}${after.partialAttributeBoosts[attribute] ? " (partial · 다음 boost로 +1)" : ""}`);
        }
        preview.textContent = current.error || changes.join(" · "); choice = candidate; submit.disabled = current.pending;
      } catch (error) { preview.textContent = error instanceof Error ? error.message : String(error); }
    };
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (current.pending || !choice) return;
      const selected = choice; current.pending = true; current.error = ""; update();
      if (!this.onCommit(member.id, selected)) {
        current.pending = false; current.error = "연결 또는 이전 변경을 확인한 뒤 다시 시도하세요."; update();
      }
    });
    update(); return panel;
  }
}
