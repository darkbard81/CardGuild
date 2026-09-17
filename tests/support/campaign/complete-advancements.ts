import { dispatchAdventureCommand, type AdventureState } from "../../../src/adventure";
import type { CompiledContentPack } from "../../../src/content";
import { chooseAdvancement } from "../../../tools/playtest/advancement-policy";

/** Domain test driver: explicit legal choices, never fabricated final ranks. */
export function completeAdvancements(initial: AdventureState, pack: CompiledContentPack): AdventureState {
  let state = initial;
  const context = { definition: pack.adventures[state.adventureId]!, actorDefinitions: pack.actorDefinitions,
    characterRules: pack.characterRules, combatContent: pack.combatContent };
  for (const id of Object.keys(state.party.members).sort()) {
    let choice;
    while ((choice = chooseAdvancement(state.party.members[id]!, pack))) {
      const result = dispatchAdventureCommand(state, { type: "advance-character", memberId: id, choice }, context);
      if (!result.accepted) throw new Error(result.error);
      state = result.state;
    }
  }
  return state;
}
