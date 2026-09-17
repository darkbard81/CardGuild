import { ATTRIBUTE_BOOST_LEVELS, SKILL_INCREASE_LEVELS, nextSkillRank, pendingCharacterAdvancements, resolveCharacterRules } from "../../src/character";
import type { CharacterAdvancementChoice } from "../../src/character";
import type { PartyMemberState } from "../../src/adventure";
import type { CompiledContentPack } from "../../src/content";
import { SKILL_IDS } from "../../src/game/statistics";

/** Automated players choose explicitly through the same command as the UI. Never used by runtime EXP. */
export function chooseAdvancement(member: PartyMemberState, pack: CompiledContentPack): CharacterAdvancementChoice | null {
  const level = pendingCharacterAdvancements(member.progression.level, member.progression.advancements)[0];
  if (level === undefined) return null;
  const actor = pack.actorDefinitions[member.actorDefinitionId];
  if (!actor?.character) throw new Error("Missing Character Build.");
  const resolved = resolveCharacterRules({ traits: actor.traits, build: actor.character.build, progression: member.progression }, pack.characterRules);
  // Prefer the first starting skill, then the remaining vocabulary, at the shared rank gates.
  const skill = [...new Set([...actor.character.build.trainedSkills, ...SKILL_IDS])]
    .find(id => nextSkillRank(resolved.statProfile.stats.skills[id], level));
  return {
    level,
    ...((SKILL_INCREASE_LEVELS as readonly number[]).includes(level) ? { skillIncrease: skill! } : {}),
    ...((ATTRIBUTE_BOOST_LEVELS as readonly number[]).includes(level) ? { attributeBoosts: actor.character.build.freeBoosts } : {}),
  };
}
