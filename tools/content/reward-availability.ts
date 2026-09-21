import { applyExperience, createCharacterProgression } from "../../src/adventure/progression";
import type { PartyMemberState } from "../../src/adventure/types";
import type { ActorDefinition, AdventureDefinition, AdventureRewardDefinition, CompiledContentPack } from "../../src/content/content-types";
import { createStartingCollection, previewLoadoutChange } from "../../src/loadout";
import { chooseAdvancement } from "../playtest/advancement-policy";

/** Release audit only: real growth rules and explicit valid choices, never a level-1 proxy. */
export function rewardAvailability(
  pack: CompiledContentPack, adventure: AdventureDefinition, starter: ActorDefinition, reward: AdventureRewardDefinition,
): { readonly immediate: readonly boolean[]; readonly eventual: readonly boolean[] } {
  let member: PartyMemberState = { identity: { origin: "companion", recruitmentSource: "authoring-preview" }, id: "audit.hero", seat: 1, actorDefinitionId: starter.id,
    loadout: starter.starterLoadout, progression: createCharacterProgression(starter) };
  const initial = createStartingCollection({ members: { [member.id]: member } }, pack);
  const immediate = reward.choices.map(() => false);
  const eventual = [...immediate];
  let offered = false;
  for (const encounterId of adventure.encounterIds.slice(0, -1)) {
    const award = adventure.experienceAwards.find(entry => entry.afterEncounterId === encounterId)!;
    member = { ...member, progression: applyExperience(member.progression, award.amount).progression };
    for (let choice = chooseAdvancement(member, pack); choice; choice = chooseAdvancement(member, pack)) {
      member = { ...member, progression: { ...member.progression, advancements: [...member.progression.advancements, choice] } };
    }
    offered ||= encounterId === reward.afterEncounterId;
    if (!offered) continue;
    reward.choices.forEach((choice, index) => {
      if (choice.kind === "companion") { immediate[index] = eventual[index] = Boolean(pack.companions?.[choice.definitionId]); return; }
      const bucket = choice.kind === "card" ? "cards" : "equipment";
      const collection = { ...initial, [bucket]: { ...initial[bucket], [choice.definitionId]: (initial[bucket][choice.definitionId] ?? 0) + 1 } };
      const loadout = choice.kind === "card"
        ? { ...member.loadout, preparedCards: [...member.loadout.preparedCards, choice.definitionId] }
        : { ...member.loadout, equipment: { ...member.loadout.equipment, [pack.combatContent.equipment[choice.definitionId]!.slot]: choice.definitionId } };
      const legal = previewLoadoutChange({ members: { [member.id]: member } }, collection, pack, member.id, loadout).legal;
      if (encounterId === reward.afterEncounterId) immediate[index] = legal;
      eventual[index] ||= legal;
    });
  }
  return { immediate, eventual };
}
