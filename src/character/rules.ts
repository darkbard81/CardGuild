import { ATTRIBUTE_IDS, SAVE_IDS, SKILL_IDS } from "../game/statistics";
import type { AttributeId, CharacterWeaponProfile, ProficiencyRank, SkillId, TraitInstance } from "../game/types";
import type {
  AncestryDefinition, CharacterAdvancementChoice, CharacterBuild, CharacterProgressionState,
  CharacterRulesContext, CharacterRulesInput, ClassDefinition, ClassProficiencyProfile, ResolvedCharacterRules,
} from "./types";

export const PROFICIENCY_RANKS = ["untrained", "trained", "expert", "master", "legendary"] as const;
export const ARMOR_CATEGORIES = ["unarmored", "light", "medium", "heavy"] as const;
export const WEAPON_CATEGORIES = ["unarmed", "simple", "martial", "advanced"] as const;
export const SKILL_INCREASE_LEVELS = [3, 5, 7, 9, 11, 13, 15, 17, 19] as const;
export const ATTRIBUTE_BOOST_LEVELS = [5, 10, 15, 20] as const;
const ADVANCEMENT_LEVELS = [...new Set<number>([...SKILL_INCREASE_LEVELS, ...ATTRIBUTE_BOOST_LEVELS])].sort((a, b) => a - b);

function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  requireRule(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
}

function exactKeys(value: object, allowed: readonly string[], label: string): void {
  requireRule(Object.keys(value).every(key => allowed.includes(key)), `${label} contains an unknown field.`);
}

function uniqueSelection(value: unknown, count: number, allowed: readonly string[], label: string): void {
  requireRule(Array.isArray(value) && value.length === count && new Set(value).size === count
    && value.every(entry => typeof entry === "string" && allowed.includes(entry)), `${label} requires ${count} distinct valid choices.`);
}

function positiveInteger(value: unknown, label: string): void {
  requireRule(typeof value === "number" && Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer.`);
}

export function assertCharacterProgression(value: unknown): asserts value is CharacterProgressionState {
  record(value, "Character progression");
  exactKeys(value, ["level", "experience", "advancements"], "Character progression");
  positiveInteger(value.level, "Character progression level");
  requireRule(typeof value.experience === "number" && Number.isInteger(value.experience)
    && value.experience >= 0 && value.experience < 1000, "Character progression experience must be an integer from 0 to 999.");
  requireRule(Array.isArray(value.advancements), "Character advancement history is required.");
  const seen = new Set<number>();
  for (const choice of value.advancements) {
    assertAdvancementChoice(choice);
    requireRule(choice.level <= (value.level as number), "Future advancement choices are not allowed.");
    requireRule(!seen.has(choice.level), "Duplicate advancement level.");
    seen.add(choice.level);
  }
  // A runtime history is a committed prefix, never a later choice jumping over an earlier one.
  const expected = ADVANCEMENT_LEVELS.filter(level => level <= (value.level as number));
  for (const [index, level] of [...seen].sort((a, b) => a - b).entries()) {
    requireRule(expected[index] === level, "An earlier pending advancement must be committed first.");
  }
}

export function assertAdvancementChoice(value: unknown): asserts value is CharacterAdvancementChoice {
  record(value, "Advancement choice");
  exactKeys(value, ["level", "skillIncrease", "attributeBoosts"], "Advancement choice");
  const skill = (SKILL_INCREASE_LEVELS as readonly unknown[]).includes(value.level);
  const attributes = (ATTRIBUTE_BOOST_LEVELS as readonly unknown[]).includes(value.level);
  requireRule(skill || attributes, "Level is not on the universal advancement schedule.");
  requireRule(skill === Object.hasOwn(value, "skillIncrease"), "Skill Increase does not match this level's schedule.");
  requireRule(attributes === Object.hasOwn(value, "attributeBoosts"), "Attribute Boosts do not match this level's schedule.");
  if (skill) requireRule((SKILL_IDS as readonly unknown[]).includes(value.skillIncrease), "Unknown Skill Increase.");
  if (attributes) uniqueSelection(value.attributeBoosts, 4, ATTRIBUTE_IDS, "Attribute Boosts");
}

export function pendingCharacterAdvancements(
  level: number, advancements: readonly CharacterAdvancementChoice[],
): readonly number[] {
  assertCharacterProgression({ level, experience: 0, advancements });
  const committed = new Set(advancements.map(choice => choice.level));
  return ADVANCEMENT_LEVELS.filter(required => required <= level && !committed.has(required));
}

export function resolveCharacterIdentity(traits: readonly TraitInstance[], context: CharacterRulesContext): {
  readonly ancestry: AncestryDefinition; readonly characterClass: ClassDefinition;
} {
  const identity = (category: "ancestry" | "class"): string => {
    const ids = traits.filter(trait => {
      requireRule(Object.hasOwn(context.traits, trait.id), `Unknown Trait "${trait.id}".`);
      return context.traits[trait.id]?.category === category;
    }).map(trait => trait.id);
    requireRule(ids.length === 1, `Character requires exactly one ${category} Trait.`);
    return ids[0]!;
  };
  const ancestryId = identity("ancestry");
  const classId = identity("class");
  const ancestry = context.ancestries[ancestryId];
  const characterClass = context.classes[classId];
  requireRule(ancestry, "Character AncestryDefinition is missing.");
  requireRule(characterClass, "Character ClassDefinition is missing.");
  requireRule(ancestry.id === ancestryId && characterClass.id === classId, "Character identity and registry keys must match.");
  return { ancestry, characterClass };
}

export function assertAncestryDefinition(ancestry: AncestryDefinition, context: Pick<CharacterRulesContext, "traits">): void {
  exactKeys(ancestry, ["id", "hitPoints", "speedFeet", "fixedBoosts"], "AncestryDefinition");
  requireRule(context.traits[ancestry.id]?.category === "ancestry", "AncestryDefinition requires a matching ancestry Trait.");
  positiveInteger(ancestry.hitPoints, "Ancestry hitPoints");
  positiveInteger(ancestry.speedFeet, "Ancestry speedFeet");
  requireRule(ancestry.speedFeet % 5 === 0, "Ancestry speedFeet must be a multiple of 5.");
  uniqueSelection(ancestry.fixedBoosts, 2, ATTRIBUTE_IDS, "Ancestry fixed boosts");
}

function assertRank(rank: unknown): asserts rank is ProficiencyRank {
  requireRule((PROFICIENCY_RANKS as readonly unknown[]).includes(rank), "Unknown proficiency rank.");
}

function rankMap(value: object, keys: readonly string[], complete: boolean): void {
  record(value, "Proficiency ranks");
  exactKeys(value, keys, "Proficiency ranks");
  if (complete) requireRule(keys.every(key => Object.hasOwn(value, key)), "Starting proficiency categories must be complete.");
  Object.values(value).forEach(assertRank);
}

export function resolveClassProficiencies(definition: ClassDefinition, level: number): ClassProficiencyProfile {
  let result = structuredClone(definition.starting);
  for (const milestone of [...definition.milestones].sort((a, b) => a.level - b.level)) {
    if (milestone.level > level) break;
    result = {
      perception: milestone.perception ?? result.perception,
      saves: { ...result.saves, ...milestone.saves },
      armor: { ...result.armor, ...milestone.armor },
      weapons: { ...result.weapons, ...milestone.weapons },
      classDc: milestone.classDc ?? result.classDc,
    };
  }
  return result;
}

export function assertClassDefinition(definition: ClassDefinition, context: Pick<CharacterRulesContext, "traits">): void {
  exactKeys(definition, ["id", "hpPerLevel", "keyAttribute", "starting", "milestones"], "ClassDefinition");
  requireRule(context.traits[definition.id]?.category === "class", "ClassDefinition requires a matching class Trait.");
  positiveInteger(definition.hpPerLevel, "Class hpPerLevel");
  requireRule((ATTRIBUTE_IDS as readonly unknown[]).includes(definition.keyAttribute), "Unknown Class key Attribute.");
  const start = definition.starting;
  record(start, "Class starting profile");
  exactKeys(start, ["perception", "saves", "armor", "weapons", "classDc"], "Class starting profile");
  assertRank(start.perception); assertRank(start.classDc);
  rankMap(start.saves, SAVE_IDS, true); rankMap(start.armor, ARMOR_CATEGORIES, true); rankMap(start.weapons, WEAPON_CATEGORIES, true);
  requireRule(Array.isArray(definition.milestones), "Class milestones must be an array.");
  const seen = new Set<number>();
  for (const milestone of [...definition.milestones].sort((a, b) => a.level - b.level)) {
    exactKeys(milestone, ["level", "perception", "saves", "armor", "weapons", "classDc"], "Class milestone");
    requireRule(Number.isInteger(milestone.level) && milestone.level > 1 && milestone.level <= 20, "Class milestone level must be 2–20.");
    requireRule(!seen.has(milestone.level), "Duplicate Class milestone level.");
    seen.add(milestone.level);
    const before = resolveClassProficiencies(definition, milestone.level - 1);
    let changes = 0;
    const increase = (previous: ProficiencyRank, next: unknown): void => {
      assertRank(next);
      requireRule(PROFICIENCY_RANKS.indexOf(next) > PROFICIENCY_RANKS.indexOf(previous), "Class milestone must increase rank; downgrades and redundant ranks are forbidden.");
      changes++;
    };
    if (milestone.perception !== undefined) increase(before.perception, milestone.perception);
    if (milestone.classDc !== undefined) increase(before.classDc, milestone.classDc);
    for (const [field, keys] of [["saves", SAVE_IDS], ["armor", ARMOR_CATEGORIES], ["weapons", WEAPON_CATEGORIES]] as const) {
      const delta = milestone[field];
      if (Object.hasOwn(milestone, field)) {
        rankMap(delta as object, keys, false);
        for (const [key, rank] of Object.entries(delta!)) increase((before[field] as Record<string, ProficiencyRank>)[key]!, rank);
      }
    }
    requireRule(changes > 0, "Class milestone must contain a proficiency increase.");
  }
}

export function nextSkillRank(rank: ProficiencyRank, level: number): ProficiencyRank | null {
  const next = PROFICIENCY_RANKS[PROFICIENCY_RANKS.indexOf(rank) + 1];
  return !next || (next === "master" && level < 7) || (next === "legendary" && level < 15) ? null : next;
}

function defaultFist(): CharacterWeaponProfile {
  return { name: "Fist", category: "unarmed", attackMode: "melee", rangeFeet: 5,
    damage: { count: 1, sides: 4, damageType: "bludgeoning" }, traits: [{ id: "agile" }, { id: "finesse" }] };
}

/** Shared by authored NPCs, runtime party members, and a future Character Creator. */
export function resolveCharacterRules(input: CharacterRulesInput, context: CharacterRulesContext): ResolvedCharacterRules {
  assertCharacterProgression(input.progression);
  const { ancestry, characterClass } = resolveCharacterIdentity(input.traits, context);
  assertAncestryDefinition(ancestry, context); assertClassDefinition(characterClass, context);
  record(input.build, "CharacterBuild");
  exactKeys(input.build, ["freeBoosts", "trainedSkills"], "CharacterBuild");
  uniqueSelection(input.build.freeBoosts, 4, ATTRIBUTE_IDS, "Free boosts");
  const attributes = Object.fromEntries(ATTRIBUTE_IDS.map(id => [id, 0])) as Record<AttributeId, number>;
  const partial = Object.fromEntries(ATTRIBUTE_IDS.map(id => [id, false])) as Record<AttributeId, boolean>;
  const boost = (id: AttributeId): void => {
    if (attributes[id] < 4) attributes[id]++;
    else if (partial[id]) { attributes[id]++; partial[id] = false; }
    else partial[id] = true;
  };
  ancestry.fixedBoosts.forEach(boost); boost(characterClass.keyAttribute); input.build.freeBoosts.forEach(boost);
  uniqueSelection(input.build.trainedSkills, 2 + attributes.int, SKILL_IDS, "Starting trained skills");
  const skills = Object.fromEntries(SKILL_IDS.map(id => [id, input.build.trainedSkills.includes(id) ? "trained" : "untrained"])) as Record<SkillId, ProficiencyRank>;
  for (const choice of [...input.progression.advancements].sort((a, b) => a.level - b.level)) {
    if (choice.skillIncrease) {
      const next = nextSkillRank(skills[choice.skillIncrease], choice.level);
      requireRule(next, `Skill "${choice.skillIncrease}" cannot increase at Level ${choice.level}.`);
      skills[choice.skillIncrease] = next;
    }
    choice.attributeBoosts?.forEach(boost);
  }
  const proficiency = resolveClassProficiencies(characterClass, input.progression.level);
  return { speedFeet: ancestry.speedFeet, partialAttributeBoosts: partial, statProfile: { kind: "character", stats: {
    level: input.progression.level, attributes, skills, perception: proficiency.perception, saves: proficiency.saves,
    defense: { ancestryHp: ancestry.hitPoints, classHpPerLevel: characterClass.hpPerLevel, armorProficiencies: proficiency.armor },
    offense: { keyAttribute: characterClass.keyAttribute, weaponProficiencies: proficiency.weapons,
      classDcProficiency: proficiency.classDc, unarmedStrike: defaultFist() },
  } } };
}

export function applyCharacterAdvancement(
  progression: CharacterProgressionState, choice: CharacterAdvancementChoice,
  character: { readonly traits: readonly TraitInstance[]; readonly build: CharacterBuild }, context: CharacterRulesContext,
): CharacterProgressionState {
  assertCharacterProgression(progression); assertAdvancementChoice(choice);
  requireRule(pendingCharacterAdvancements(progression.level, progression.advancements)[0] === choice.level,
    "Commit the earliest pending advancement exactly once.");
  const next = { ...progression, advancements: [...progression.advancements, structuredClone(choice)].sort((a, b) => a.level - b.level) };
  resolveCharacterRules({ ...character, progression: next }, context);
  return next;
}
