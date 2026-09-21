import { assertCharacterName, resolvePartyMemberDefinition, type CreateCharacterInput, type ResolvedPartyMemberDefinition } from "../character/member";
import type { CompiledContentPack } from "../content";
import { deriveLoadoutSnapshot } from "../loadout";
import type { AssetCatalog } from "../presentation";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

export interface CreationDraft {
  name: string;
  gender: CreateCharacterInput["gender"];
  creationPresetId: string;
}

/** Draft-only preview. The caller owns the single explicit submission and its durable settlement. */
export class CharacterCreationUi {
  public readonly element = node("div", undefined, "character-creation");
  private readonly nameInput = node("input");
  private readonly preview = node("section", undefined, "creation-preview");
  private readonly title = node("h2");

  public constructor(
    private readonly pack: CompiledContentPack,
    private readonly catalog: AssetCatalog,
    private readonly draft: CreationDraft,
    onDetail: (definition: ResolvedPartyMemberDefinition) => void,
  ) {
    const fields = node("div", undefined, "creation-fields");
    const nameLabel = node("label", "캐릭터 이름");
    nameLabel.htmlFor = "character-name";
    this.nameInput.id = "character-name";
    this.nameInput.name = "character-name";
    this.nameInput.className = "ui-input session-input";
    this.nameInput.required = true;
    this.nameInput.autocomplete = "off";
    this.nameInput.value = draft.name;
    this.nameInput.setAttribute("aria-describedby", "character-name-hint");
    const hint = node("p", "1~40자. 앞뒤 공백과 제어 문자는 사용할 수 없습니다.", "session-description");
    hint.id = "character-name-hint";
    this.nameInput.addEventListener("input", () => {
      draft.name = this.nameInput.value;
      this.nameInput.setCustomValidity("");
      this.nameInput.removeAttribute("aria-invalid");
      this.title.textContent = draft.name || "이름을 지어 주세요";
      for (const [index, label] of ["앞모습", "뒷모습"].entries()) {
        this.preview.querySelectorAll(".creation-standee")[index]?.setAttribute("aria-label", `${draft.name || "미리보기"} ${label}`);
      }
    });
    fields.append(nameLabel, this.nameInput, hint, node("p", "종족: Human (인간) · Lv1 · 경험치 0"));
    const gender = node("fieldset");
    gender.append(node("legend", "성별"));
    for (const [value, label] of [["male", "남성"], ["female", "여성"]] as const) {
      const wrapper = node("label");
      const input = node("input");
      input.type = "radio"; input.name = "character-gender"; input.value = value;
      input.checked = draft.gender === value;
      input.addEventListener("change", () => { if (input.checked) { draft.gender = value; this.renderPreview(); } });
      wrapper.append(input, document.createTextNode(label));
      gender.append(wrapper);
    }
    fields.append(gender);
    const classLabel = node("label", "클래스");
    classLabel.htmlFor = "character-class";
    const choice = node("select");
    choice.id = "character-class"; choice.name = "character-class"; choice.className = "ui-input session-input";
    for (const preset of Object.values(pack.creationPresets ?? {})) {
      const actor = pack.actorDefinitions[preset.actorDefinitionId]!;
      const option = node("option", actor.name); option.value = preset.id; choice.append(option);
    }
    choice.value = draft.creationPresetId;
    choice.addEventListener("change", () => { draft.creationPresetId = choice.value; this.renderPreview(); });
    fields.append(classLabel, choice);
    const detail = node("button", "시작 캐릭터 상세", "ui-button ui-button--secondary");
    detail.type = "button";
    detail.addEventListener("click", () => onDetail(this.definition()));
    fields.append(detail);
    this.element.append(fields, this.preview);
    this.renderPreview();
  }

  public input(): CreateCharacterInput | null {
    try { assertCharacterName(this.draft.name); }
    catch {
      this.nameInput.setCustomValidity("이름은 앞뒤 공백과 제어 문자 없이 1~40자로 입력하세요.");
      this.nameInput.setAttribute("aria-invalid", "true");
      this.nameInput.reportValidity();
      return null;
    }
    return { ...this.draft };
  }

  private definition(): ResolvedPartyMemberDefinition {
    const preset = this.pack.creationPresets![this.draft.creationPresetId]!;
    // A name being edited need not be valid yet. Only the confirmed input is sent to the server.
    const resolved = resolvePartyMemberDefinition({ actorDefinitionId: preset.actorDefinitionId,
      identity: { origin: "player-created", ...this.draft, name: "미리보기" } }, this.pack);
    return { ...resolved, name: this.draft.name || "미리보기" };
  }

  private renderPreview(): void {
    const definition = this.definition();
    const preset = this.pack.creationPresets![this.draft.creationPresetId]!;
    const snapshot = deriveLoadoutSnapshot(definition, definition.starterLoadout, this.pack.combatContent, "preview");
    this.title.textContent = this.draft.name || "이름을 지어 주세요";
    this.preview.replaceChildren(this.title);
    this.preview.setAttribute("aria-label", "시작 캐릭터 미리보기");
    this.preview.dataset.appearanceKey = definition.appearanceKey;
    const figures = node("div", undefined, "creation-figures");
    const visual = this.catalog.actorVisual(definition.appearanceKey);
    for (const [side, label] of [["front", "앞모습"], ["back", "뒷모습"]] as const) {
      const figure = node("div", undefined, "creation-standee");
      figure.setAttribute("role", "img"); figure.setAttribute("aria-label", `${definition.name} ${label}`);
      Object.assign(figure.style, this.catalog.domStandeeStyle(visual[side], 215));
      figures.append(figure);
    }
    const portrait = node("div", undefined, "creation-portrait");
    portrait.setAttribute("role", "img"); portrait.setAttribute("aria-label", "초상화");
    Object.assign(portrait.style, this.catalog.domPortraitStyle(visual.front, 60));
    figures.append(portrait);
    const stats = snapshot.statistics;
    this.preview.append(figures, node("p", preset.description),
      node("p", `HP ${stats.maxHp} · AC ${stats.ac} · 클래스 DC ${stats.classDc} · 이동 ${definition.speedFeet}ft`, "creation-statistics"));
    const equipment = snapshot.equipmentIds.map(id => this.pack.combatContent.equipment[id]!.name);
    this.preview.append(node("p", `시작 장비: ${equipment.join(" · ")}`));
    const deck = node("details");
    deck.append(node("summary", `시작 덱 ${snapshot.deck.contributions.reduce((n, c) => n + c.count, 0)}장 · 준비 ${definition.starterLoadout.preparedCards.length}/${definition.loadoutProfile.preparedCardCapacity}`));
    const list = node("ul");
    for (const contribution of snapshot.deck.contributions) {
      const source = contribution.source.kind === "base" ? "기본" : contribution.source.kind === "prepared" ? "준비" : "장비";
      list.append(node("li", `${this.pack.combatContent.cards[contribution.cardDefinitionId]!.name} ×${contribution.count} (${source})`));
    }
    deck.append(list); this.preview.append(deck);
  }
}
