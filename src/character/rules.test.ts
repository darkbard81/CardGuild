import { describe, expect, it } from "vitest";
import {
  applyCharacterAdvancement, assertAncestryDefinition, assertCharacterProgression, assertClassDefinition,
  nextSkillRank, pendingCharacterAdvancements, resolveCharacterRules,
} from "./rules";
import type { CharacterRulesContext, CharacterRulesInput, ClassDefinition } from "./types";
import type { TraitDefinition } from "../game/types";

const trait = (id: string, category: TraitDefinition["category"]): TraitDefinition => ({
  id, category, name: id, source: "cardguild", description: "규칙 테스트", cardGrants: [], actionGrants: [],
});
const fighter: ClassDefinition = {
  id: "fighter", hpPerLevel: 10, keyAttribute: "str",
  starting: {
    perception: "expert", saves: { fortitude: "expert", reflex: "expert", will: "trained" },
    armor: { unarmored: "trained", light: "trained", medium: "trained", heavy: "trained" },
    weapons: { unarmed: "expert", simple: "expert", martial: "expert", advanced: "trained" }, classDc: "trained",
  },
  milestones: [
    { level: 3, saves: { will: "expert" } },
    { level: 5, weapons: { martial: "master" } },
    { level: 7, perception: "master" },
    { level: 9, classDc: "expert", saves: { fortitude: "master" } },
    { level: 11, armor: { heavy: "expert" }, saves: { reflex: "master" } },
  ],
};
const context: CharacterRulesContext = {
  traits: { human: trait("human", "ancestry"), fighter: trait("fighter", "class"), goblin: trait("goblin", "ancestry") },
  ancestries: { human: { id: "human", hitPoints: 8, speedFeet: 25, fixedBoosts: ["str", "int"] } },
  classes: { fighter },
};
const input: CharacterRulesInput = {
  traits: [{ id: "human" }, { id: "fighter" }],
  build: { freeBoosts: ["str", "dex", "con", "wis"], trainedSkills: ["athletics", "medicine", "arcana"] },
  progression: { level: 1, experience: 0, advancements: [] },
};
const resolve = (changes: Partial<CharacterRulesInput> = {}) => resolveCharacterRules({ ...input, ...changes }, context);

describe("shared Character rules without an ActorDefinition", () => {
  it("constructs starting attributes and the INT-based skill pool from seven boosts", () => {
    const result = resolve();
    expect(result.statProfile.stats.attributes).toEqual({ str: 3, dex: 1, con: 1, int: 1, wis: 1, cha: 0 });
    expect(Object.entries(result.statProfile.stats.skills).filter(([, rank]) => rank === "trained").map(([id]) => id))
      .toEqual(["arcana", "athletics", "medicine"]);
    expect(result.statProfile.stats.skills.stealth).toBe("untrained");
    expect(result.speedFeet).toBe(25);
    expect(result.statProfile.stats.defense.ancestryHp).toBe(8);
    expect(result.statProfile.stats.offense.unarmedStrike.name).toBe("Fist");
    expect(input.progression.advancements).toEqual([]);
  });

  it("rejects missing, duplicate, or unresolved identity and invalid starting choices", () => {
    for (const id of ["unknown-trait", "toString", "__proto__"]) {
      expect(() => resolve({ traits: [...input.traits, { id }] })).toThrow("Unknown Trait");
    }
    expect(() => resolve({ traits: [{ id: "human" }] })).toThrow("exactly one class");
    expect(() => resolve({ traits: [{ id: "fighter" }] })).toThrow("exactly one ancestry");
    expect(() => resolve({ traits: [...input.traits, { id: "goblin" }] })).toThrow("exactly one ancestry");
    expect(() => resolve({ traits: [...input.traits, { id: "fighter" }] })).toThrow("exactly one class");
    expect(() => resolve({ traits: [{ id: "goblin" }, { id: "fighter" }] })).toThrow("AncestryDefinition");
    expect(() => resolve({ build: { ...input.build, freeBoosts: ["str", "str", "con", "int"] } })).toThrow("distinct");
    expect(() => resolve({ build: { ...input.build, trainedSkills: ["athletics"] } })).toThrow("Starting trained skills");
    expect(() => resolve({ build: { ...input.build, trainedSkills: ["athletics", "athletics", "arcana"] } })).toThrow("distinct");
  });

  it("replays partial boosts, never treating later INT as another starting skill", () => {
    let progression = { ...input.progression, level: 15 };
    const at = (level: number) => ({ ...input, progression: { ...progression, level } });
    progression = applyCharacterAdvancement(progression, { level: 3, skillIncrease: "athletics" }, input, context);
    progression = applyCharacterAdvancement(progression, { level: 5, skillIncrease: "stealth", attributeBoosts: ["str", "int", "wis", "cha"] }, input, context);
    expect(resolveCharacterRules(at(5), context).statProfile.stats.attributes.str).toBe(4);
    progression = applyCharacterAdvancement(progression, { level: 7, skillIncrease: "athletics" }, input, context);
    progression = applyCharacterAdvancement(progression, { level: 9, skillIncrease: "stealth" }, input, context);
    progression = applyCharacterAdvancement(progression, { level: 10, attributeBoosts: ["str", "int", "wis", "cha"] }, input, context);
    const ten = resolveCharacterRules(at(10), context);
    expect(ten.statProfile.stats.attributes.str).toBe(4);
    expect(ten.partialAttributeBoosts.str).toBe(true);
    progression = applyCharacterAdvancement(progression, { level: 11, skillIncrease: "stealth" }, input, context);
    progression = applyCharacterAdvancement(progression, { level: 13, skillIncrease: "medicine" }, input, context);
    progression = applyCharacterAdvancement(progression, { level: 15, skillIncrease: "athletics", attributeBoosts: ["str", "int", "wis", "cha"] }, input, context);
    const fifteen = resolveCharacterRules(at(15), context);
    expect(fifteen.statProfile.stats.attributes.str).toBe(5);
    expect(fifteen.partialAttributeBoosts.str).toBe(false);
    expect(fifteen.statProfile.stats.skills.athletics).toBe("legendary");
    expect(fifteen.statProfile.stats.skills.crafting).toBe("untrained");
    expect(resolveCharacterRules({ ...input, progression: { ...progression, advancements: [...progression.advancements].reverse() } }, context))
      .toEqual(fifteen);
    progression = applyCharacterAdvancement({ ...progression, level: 20 }, { level: 17, skillIncrease: "medicine" }, input, context);
    progression = applyCharacterAdvancement(progression, { level: 19, skillIncrease: "medicine" }, input, context);
    progression = applyCharacterAdvancement(progression, { level: 20, attributeBoosts: ["str", "int", "wis", "cha"] }, input, context);
    const twenty = resolveCharacterRules({ ...input, progression }, context);
    expect(twenty.statProfile.stats.attributes.str).toBe(5);
    expect(twenty.partialAttributeBoosts.str).toBe(true);
    expect(pendingCharacterAdvancements(20, progression.advancements)).toEqual([]);

  });

  it("derives pending work and permits only the earliest complete record exactly once", () => {
    const progression = { ...input.progression, level: 5 };
    expect(pendingCharacterAdvancements(5, [])).toEqual([3, 5]);
    expect(() => applyCharacterAdvancement(progression, { level: 5, skillIncrease: "athletics", attributeBoosts: ["str", "dex", "con", "wis"] }, input, context))
      .toThrow("earliest");
    const next = applyCharacterAdvancement(progression, { level: 3, skillIncrease: "athletics" }, input, context);
    expect(pendingCharacterAdvancements(5, next.advancements)).toEqual([5]);
    expect(() => applyCharacterAdvancement(next, { level: 3, skillIncrease: "athletics" }, input, context)).toThrow("exactly once");
    expect(() => applyCharacterAdvancement(next, { level: 5, skillIncrease: "medicine" }, input, context)).toThrow("schedule");
    expect(() => applyCharacterAdvancement(next, { level: 5, skillIncrease: "athletics", attributeBoosts: ["str", "dex", "con", "wis"] }, input, context)).toThrow("cannot increase");
    for (const bad of [
      { ...progression, advancements: [{ level: 2, skillIncrease: "athletics" }] },
      { ...progression, advancements: [{ level: 7, skillIncrease: "athletics" }] },
      { ...progression, advancements: [{ level: 3, skillIncrease: "athletics" }, { level: 3, skillIncrease: "medicine" }] },
      { ...progression, advancements: [{ level: 3, skillIncrease: "athletics", rank: "expert" }] },
      { level: 1, experience: 0 },
    ]) expect(() => assertCharacterProgression(bad)).toThrow();
  });

  it("enforces each proficiency gate", () => {
    expect(nextSkillRank("untrained", 3)).toBe("trained");
    expect(nextSkillRank("trained", 3)).toBe("expert");
    expect(nextSkillRank("expert", 5)).toBeNull();
    expect(nextSkillRank("expert", 7)).toBe("master");
    expect(nextSkillRank("master", 13)).toBeNull();
    expect(nextSkillRank("master", 15)).toBe("legendary");
    expect(nextSkillRank("legendary", 19)).toBeNull();
  });

  it("applies automatic milestones at their boundary even while choices remain pending", () => {
    const profile = (level: number) => resolve({ progression: { level, experience: 0, advancements: [] } }).statProfile.stats;
    expect(profile(2).saves.will).toBe("trained");
    expect(profile(3).saves.will).toBe("expert");
    expect(profile(4).offense.weaponProficiencies.martial).toBe("expert");
    expect(profile(5).offense.weaponProficiencies.martial).toBe("master");
    expect(profile(7).perception).toBe("master");
    expect(profile(8).saves.fortitude).toBe("expert");
    expect(profile(9).saves.fortitude).toBe("master");
    expect(profile(10).saves.reflex).toBe("expert");
    expect(profile(11).saves.reflex).toBe("master");
    expect(profile(9).offense.classDcProficiency).toBe("expert");
    expect(profile(11).defense.armorProficiencies.heavy).toBe("expert");
    expect(fighter.starting.weapons.martial).toBe("expert");
    const separate = { ...context, classes: { fighter: { ...fighter, milestones: [] } } };
    expect(resolveCharacterRules({ ...input, progression: { level: 11, experience: 0, advancements: [] } }, separate)
      .statProfile.stats.perception).toBe("expert");
  });

  it("rejects malformed and ambiguous rules tables rather than silently normalizing them", () => {
    expect(() => assertAncestryDefinition({ ...context.ancestries.human!, fixedBoosts: ["str", "str"] }, context)).toThrow("distinct");
    for (const milestones of [
      [{ level: 2, perception: "trained" as const }], [{ level: 2, perception: "expert" as const }],
      [{ level: 2 }], [{ level: 1, perception: "master" as const }],
      [{ level: 2, perception: "master" as const }, { level: 2, perception: "legendary" as const }],
    ]) expect(() => assertClassDefinition({ ...fighter, milestones }, context)).toThrow();
    expect(() => assertClassDefinition({ ...fighter, starting: { ...fighter.starting, armor: { unarmored: "trained" } } } as ClassDefinition, context)).toThrow("complete");
    expect(() => assertClassDefinition({ ...fighter, milestones: [{ level: 3, skillIncrease: "arcana" }] } as unknown as ClassDefinition, context)).toThrow("unknown field");
  });
});
