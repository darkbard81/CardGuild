import type { ActorDefinition, CompiledContentPack } from "../content/content-types";
import type { CharacterProgressionState, CharacterRulesInput } from "./types";
import { resolveCharacterRules } from "./rules";

export type CharacterGender = "male" | "female";

/** The referenced Character owns Build, traits, starter, grants and capacity once. */
export interface CharacterCreationPreset {
  readonly id: string;
  readonly actorDefinitionId: string;
  /** Only currently implemented starter actions; optional for authored test packs. */
  readonly description?: string;
  readonly appearance: Readonly<Record<CharacterGender, string>>;
}

export type PartyMemberIdentity =
  | { readonly origin: "player-created"; readonly name: string; readonly gender: CharacterGender; readonly creationPresetId: string }
  | { readonly origin: "companion"; readonly recruitmentSource: string };

export interface CreateCharacterInput {
  readonly name: string;
  readonly gender: CharacterGender;
  readonly creationPresetId: string;
}

export interface MemberReference {
  readonly actorDefinitionId: string;
  /** Static authored previews have no persistent identity. Runtime members require it. */
  readonly identity?: PartyMemberIdentity;
  readonly progression?: CharacterProgressionState;
}

export type MemberContent = Pick<CompiledContentPack, "actorDefinitions" | "characterRules" | "creationPresets" | "companions">;
export interface ResolvedPartyMemberDefinition extends ActorDefinition {
  readonly appearanceKey: string;
  readonly rulesInput: CharacterRulesInput | null;
}

/** Creation templates require a persistent identity; never offer them as authored companions. */
export function isAuthoredPlayable(actor: ActorDefinition, content: MemberContent): boolean {
  return actor.traits.some(trait => trait.id === "playable")
    && !Object.values(content.creationPresets ?? {}).some(preset => preset.actorDefinitionId === actor.id);
}

export function assertCharacterName(name: unknown): asserts name is string {
  if (typeof name !== "string" || name !== name.trim() || [...name].length < 1 || [...name].length > 40
    || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) {
    throw new Error("Character name must contain 1–40 characters with no outer whitespace or control characters.");
  }
}

export function assertMemberIdentity(identity: PartyMemberIdentity): void {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw new Error("Member identity is required.");
  if (identity.origin === "player-created") {
    if (Object.keys(identity).sort().join() !== "creationPresetId,gender,name,origin") throw new Error("Invalid player identity fields.");
    assertCharacterName(identity.name);
    if (identity.gender !== "male" && identity.gender !== "female") throw new Error("Unsupported Character gender.");
    if (typeof identity.creationPresetId !== "string" || !identity.creationPresetId) throw new Error("Creation preset is required.");
  } else if (identity.origin === "companion") {
    if (Object.keys(identity).sort().join() !== "origin,recruitmentSource"
      || typeof identity.recruitmentSource !== "string" || !identity.recruitmentSource.trim()) throw new Error("Invalid companion identity.");
  } else throw new Error("Unknown member origin.");
}

export function assertCreationPreset(preset: CharacterCreationPreset, content: MemberContent): ActorDefinition {
  if (!preset || typeof preset.id !== "string" || !preset.id || typeof preset.actorDefinitionId !== "string"
    || Object.keys(preset).filter(key => key !== "description").sort().join() !== "actorDefinitionId,appearance,id"
    || (preset.description !== undefined && (typeof preset.description !== "string" || !preset.description.trim()))
    || !preset.appearance || Object.keys(preset.appearance).sort().join() !== "female,male"
    || [preset.appearance.male, preset.appearance.female].some(key => typeof key !== "string" || !key.trim())) {
    throw new Error("Creation preset requires a template and both appearance keys.");
  }
  const actor = content.actorDefinitions[preset.actorDefinitionId];
  if (!actor?.character || actor.statProfile.kind !== "character" || actor.character.level !== 1
    || actor.character.advancements.length !== 0 || !actor.traits.some(t => t.id === "playable")
    || actor.traits.filter(t => Object.hasOwn(content.characterRules.ancestries, t.id)).map(t => t.id).join() !== "human"
    || actor.traits.filter(t => Object.hasOwn(content.characterRules.classes, t.id)).length !== 1) {
    throw new Error("Creation preset must reference a playable Human Lv1 Character with one Class and no advancements.");
  }
  resolveCharacterRules({ traits: actor.traits, build: actor.character.build,
    progression: { level: 1, experience: 0, advancements: [] } }, content.characterRules);
  if (!Number.isSafeInteger(actor.loadoutProfile.preparedCardCapacity) || actor.loadoutProfile.preparedCardCapacity < 0) {
    throw new Error("Creation preset prepared capacity is invalid.");
  }
  return actor;
}

/** Pure instance projection. Never inserts a user into, or edits, the authored pack. */
export function resolvePartyMemberDefinition(member: MemberReference, content: MemberContent): ResolvedPartyMemberDefinition {
  const actor = content.actorDefinitions[member.actorDefinitionId];
  if (!actor) throw new Error(`Actor definition "${member.actorDefinitionId}" is missing.`);
  let name = actor.name;
  let appearanceKey = actor.id;
  if (member.identity) {
    assertMemberIdentity(member.identity);
    if (member.identity.origin === "player-created") {
      const preset = content.creationPresets?.[member.identity.creationPresetId];
      if (!preset || preset.id !== member.identity.creationPresetId) throw new Error("Unknown creation preset.");
      assertCreationPreset(preset, content);
      if (preset.actorDefinitionId !== actor.id) throw new Error("Member template does not match its creation preset.");
      name = member.identity.name;
      appearanceKey = preset.appearance[member.identity.gender];
    }
  }
  if (member.identity?.origin === "companion") {
    const npc = Object.values(content.companions ?? {}).find(entry => entry.actorDefinitionId === actor.id);
    if (npc) appearanceKey = npc.appearanceKey;
  }
  const progression = member.progression ?? (actor.character ? {
    level: actor.character.level, experience: 0, advancements: actor.character.advancements,
  } : undefined);
  const rulesInput = actor.character && progression ? { traits: actor.traits, build: actor.character.build, progression } : null;
  return { ...actor, name, appearanceKey, rulesInput };
}
