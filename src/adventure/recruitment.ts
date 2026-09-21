import { pendingCharacterAdvancements, resolveCharacterRules } from "../character";
import { isAuthoredPlayable, type MemberContent } from "../character/member";
import type { CompanionDefinition } from "../content/content-types";
import { clonePartyLoadout, createStartingCollection, deriveLoadoutSnapshot, validatePartyLoadout, type LoadoutContent } from "../loadout";
import { assertCharacterProgression } from "./progression";
import type { AdventureRuntimeContext, AdventureState, CollectionState, PartyMemberState } from "./types";

/** The same complete authored starter is used by compilation, reward preview and recruitment. */
export function createCompanionMember(
  npc: CompanionDefinition, source: string, seat: 1 | 2 | 3, content: MemberContent & LoadoutContent,
): PartyMemberState {
  const actor = content.actorDefinitions[npc.actorDefinitionId];
  if (!actor?.character || actor.statProfile.kind !== "character" || !isAuthoredPlayable(actor, content)
    || !npc.description.trim() || !npc.appearanceKey.trim()) throw new Error("Companion requires an authored playable Character and appearance.");
  const progression = { level: actor.character.level, experience: npc.startingExperience,
    advancements: structuredClone(actor.character.advancements) };
  assertCharacterProgression(progression);
  if (pendingCharacterAdvancements(progression.level, progression.advancements).length) throw new Error("Companion starter must have complete advancement history.");
  resolveCharacterRules({ traits: actor.traits, build: actor.character.build, progression }, content.characterRules);
  const snapshot = deriveLoadoutSnapshot(actor, actor.starterLoadout, content.combatContent, "companion-starter");
  if (snapshot.strike.proficiencyRank === "untrained"
    || actor.statProfile.stats.defense.armorProficiencies[snapshot.armor.category] === "untrained") throw new Error("Companion starter equipment must be proficient.");
  const member: PartyMemberState = { id: `party.hero-${seat}`, seat, actorDefinitionId: actor.id,
    identity: { origin: "companion", recruitmentSource: source }, progression, loadout: clonePartyLoadout(actor.starterLoadout) };
  const party = { members: { [member.id]: member } };
  const validation = validatePartyLoadout(party, createStartingCollection(party, content), content);
  if (!validation.valid) throw new Error(`Invalid companion starter: ${validation.issues[0]?.message}`);
  return member;
}

/** Only this member's owned prepared cards/equipment. Base and equipment grants are not ownership. */
export function addMemberStartingCollection(
  collection: CollectionState, member: PartyMemberState, content: LoadoutContent,
): CollectionState {
  const starter = createStartingCollection({ members: { [member.id]: member } }, content);
  const add = (kind: "equipment" | "cards"): Readonly<Record<string, number>> => {
    const result = { ...collection[kind] };
    for (const [id, amount] of Object.entries(starter[kind])) {
      const count = (result[id] ?? 0) + amount;
      if (!Number.isSafeInteger(count)) throw new Error("Collection count overflow.");
      result[id] = count;
    }
    return result;
  };
  return { equipment: add("equipment"), cards: add("cards") };
}

export function recruitCompanion(state: AdventureState, definitionId: string, source: string, context: AdventureRuntimeContext) {
  if (state.partyOrigin !== "player-created") throw new Error("Recruitment requires a created protagonist.");
  const npc = context.companions?.[definitionId];
  if (!npc || npc.id !== definitionId) throw new Error("Unknown companion definition.");
  const members = Object.values(state.party.members).sort((a, b) => a.seat - b.seat);
  if (members.some(member => member.identity.origin === "companion" && member.actorDefinitionId === npc.actorDefinitionId)) {
    throw new Error("Companion has already joined.");
  }
  const seat = members.length + 1;
  if (seat > Math.min(3, context.definition.partySize.max)) throw new Error("Party is full.");
  if (members.some((member, index) => member.seat !== index + 1)) throw new Error("Party slots must be contiguous.");
  const member = createCompanionMember(npc, source, seat as 1 | 2 | 3, context);
  if (state.party.members[member.id]) throw new Error("Recruitment member ID is already occupied.");
  const party = { members: { ...state.party.members, [member.id]: member } };
  const collection = addMemberStartingCollection(state.collection, member, context);
  const validation = validatePartyLoadout(party, collection, context);
  if (!validation.valid) throw new Error(validation.issues[0]?.message ?? "Invalid recruited party.");
  return { party, collection, member };
}
