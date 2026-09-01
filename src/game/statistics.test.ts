import { describe, expect, it } from "vitest";

import type {
  ActorState,
  CombatContent,
  InitiativeStatisticSelector,
  ProficiencyRank,
  SkillId,
  StatisticContextModifier,
} from "./types";
import {
  SAVE_ATTRIBUTE,
  SKILL_ATTRIBUTE,
  SKILL_IDS,
  proficiencyBonus,
  resolveInitiative,
  resolveStatisticDC,
  resolveStatisticModifier,
} from "./statistics";

const SKILLS: Readonly<Record<SkillId, ProficiencyRank>> = {
  acrobatics: "untrained",
  arcana: "untrained",
  athletics: "untrained",
  crafting: "untrained",
  deception: "untrained",
  diplomacy: "untrained",
  intimidation: "untrained",
  medicine: "untrained",
  nature: "untrained",
  occultism: "untrained",
  performance: "untrained",
  religion: "untrained",
  society: "untrained",
  stealth: "untrained",
  survival: "untrained",
  thievery: "untrained",
};

const EMPTY_CONTENT: CombatContent = {
  actions: {},
  cards: {},
  conditions: {},
  equipment: {},
  traits: {},
};

function character(overrides: Partial<ActorState> = {}): ActorState {
  return {
    id: "character",
    definitionId: "character.test",
    name: "Character",
    team: "heroes",
    position: { x: 0, y: 0 },
    facing: "north",
    hp: 10,
    maxHp: 10,
    baseAc: 10,
    statProfile: {
      kind: "character",
      stats: {
        level: 1,
        attributes: { str: 1, dex: 2, con: 3, int: 4, wis: 5, cha: 6 },
        perception: "trained",
        saves: { fortitude: "trained", reflex: "trained", will: "trained" },
        skills: { ...SKILLS },
      },
    },
    speedFeet: 25,
    fallbackWeapon: {
      name: "Unarmed",
      attackModifier: 0,
      rangeFeet: 5,
      damage: { count: 1, sides: 4, modifier: 0, damageType: "bludgeoning" },
    },
    conditions: [],
    traits: [],
    equipmentIds: [],
    innateActionIds: [],
    deckContributions: [],
    reactionAvailable: false,
    shieldRaised: false,
    defeated: false,
    ...overrides,
  };
}

function contextModifiers(modifiers: readonly StatisticContextModifier[]) {
  return { content: EMPTY_CONTENT, modifiers };
}

describe("PF2e character statistic foundation", () => {
  it("uses proficiency with level for all five ranks", () => {
    expect([
      proficiencyBonus(5, "untrained"),
      proficiencyBonus(5, "trained"),
      proficiencyBonus(5, "expert"),
      proficiencyBonus(5, "master"),
      proficiencyBonus(5, "legendary"),
    ]).toEqual([0, 7, 9, 11, 13]);
  });

  it("defines all three save and all sixteen general-skill attribute mappings", () => {
    expect(SAVE_ATTRIBUTE).toEqual({ fortitude: "con", reflex: "dex", will: "wis" });
    expect(SKILL_IDS).toHaveLength(16);
    expect(new Set(SKILL_IDS)).toEqual(new Set(Object.keys(SKILL_ATTRIBUTE)));
    expect(SKILL_ATTRIBUTE).toEqual({
      acrobatics: "dex",
      arcana: "int",
      athletics: "str",
      crafting: "int",
      deception: "cha",
      diplomacy: "cha",
      intimidation: "cha",
      medicine: "wis",
      nature: "wis",
      occultism: "int",
      performance: "cha",
      religion: "wis",
      society: "int",
      stealth: "dex",
      survival: "wis",
      thievery: "dex",
    });
  });

  it("derives Fortitude, Reflex, Will and their DCs through one resolver", () => {
    const actor = character();
    const context = { content: EMPTY_CONTENT };
    expect(resolveStatisticModifier(actor, { kind: "save", id: "fortitude" }, context).value).toBe(6);
    expect(resolveStatisticModifier(actor, { kind: "save", id: "reflex" }, context).value).toBe(5);
    expect(resolveStatisticModifier(actor, { kind: "save", id: "will" }, context).value).toBe(8);
    expect(resolveStatisticDC(actor, { kind: "save", id: "fortitude" }, context).value).toBe(16);
    expect(resolveStatisticDC(actor, { kind: "save", id: "reflex" }, context).value).toBe(15);
    expect(resolveStatisticDC(actor, { kind: "save", id: "will" }, context).value).toBe(18);
  });

  it("derives every skill from its mapped attribute and keeps overrides immutable", () => {
    const actor = character({
      statProfile: {
        kind: "character",
        stats: {
          level: 2,
          attributes: { str: 1, dex: 2, con: 0, int: 3, wis: 4, cha: 5 },
          perception: "trained",
          saves: { fortitude: "trained", reflex: "trained", will: "trained" },
          skills: Object.fromEntries(SKILL_IDS.map((id) => [id, "trained"])) as Record<SkillId, ProficiencyRank>,
        },
      },
    });
    const context = { content: EMPTY_CONTENT };
    for (const id of SKILL_IDS) {
      expect(resolveStatisticModifier(actor, { kind: "skill", id }, context).value).toBe(
        actor.statProfile.kind === "character"
          ? actor.statProfile.stats.attributes[SKILL_ATTRIBUTE[id]] + 4
          : Number.NaN,
      );
    }
    expect(resolveStatisticModifier(actor, { kind: "skill", id: "athletics" }, context).value).toBe(5);
    expect(resolveStatisticModifier(actor, { kind: "skill", id: "acrobatics" }, context).value).toBe(6);
    expect(resolveStatisticModifier(actor, { kind: "skill", id: "arcana" }, context).value).toBe(7);
    expect(resolveStatisticModifier(actor, { kind: "skill", id: "medicine" }, context).value).toBe(8);
    expect(resolveStatisticModifier(actor, { kind: "skill", id: "intimidation" }, context).value).toBe(9);
    expect(resolveStatisticDC(actor, { kind: "skill", id: "athletics" }, context).value).toBe(15);

    const before = structuredClone(actor.statProfile);
    expect(resolveStatisticModifier(
      actor,
      { kind: "skill", id: "athletics", attributeOverride: "cha" },
      context,
    ).value).toBe(9);
    expect(actor.statProfile).toEqual(before);
  });

  it("derives default and skill-based initiative from the same statistic resolver", () => {
    const actor = character({
      statProfile: {
        kind: "character",
        stats: {
          level: 3,
          attributes: { str: 0, dex: 4, con: 0, int: 0, wis: 2, cha: 0 },
          perception: "expert",
          saves: { fortitude: "trained", reflex: "trained", will: "trained" },
          skills: { ...SKILLS, stealth: "trained" },
        },
      },
    });
    const context = { content: EMPTY_CONTENT };
    expect(resolveStatisticModifier(actor, { kind: "perception" }, context).value).toBe(9);
    expect(resolveInitiative(actor, context).value).toBe(9);
    expect(resolveInitiative(actor, context, { kind: "skill", id: "stealth" })).toEqual(
      resolveStatisticModifier(actor, { kind: "skill", id: "stealth" }, context),
    );
    expect(resolveInitiative(actor, context, { kind: "skill", id: "stealth" }).value).toBe(9);
  });

  it("restricts the Initiative source to Perception or Skill selectors", () => {
    const skillSource: InitiativeStatisticSelector = { kind: "skill", id: "stealth" };
    // @ts-expect-error Initiative is never derived from a Save statistic.
    const saveSource: InitiativeStatisticSelector = { kind: "save", id: "reflex" };
    expect(skillSource.kind).toBe("skill");
    expect(saveSource.kind).toBe("save");
  });

  it("stacks typed bonuses and penalties and accumulates untyped penalties deterministically", () => {
    const actor = character();
    const modifiers: readonly StatisticContextModifier[] = [
      { selector: { kind: "all" }, type: "item", value: 1, label: "Lesser item", sourceId: "item-a" },
      { selector: { kind: "all" }, type: "item", value: 3, label: "Greater item", sourceId: "item-b" },
      { selector: { kind: "all" }, type: "status", value: 1, label: "Lesser status", sourceId: "status-a" },
      { selector: { kind: "all" }, type: "status", value: 2, label: "Greater status", sourceId: "status-b" },
      { selector: { kind: "all" }, type: "circumstance", value: 2, label: "Lesser circumstance", sourceId: "circumstance-a" },
      { selector: { kind: "all" }, type: "circumstance", value: 4, label: "Greater circumstance", sourceId: "circumstance-b" },
      { selector: { kind: "all" }, type: "item", value: -1, label: "Lesser item penalty", sourceId: "item-c" },
      { selector: { kind: "all" }, type: "item", value: -3, label: "Greater item penalty", sourceId: "item-d" },
      { selector: { kind: "all" }, type: "untyped", value: -1, label: "Untyped one", sourceId: "untyped-a" },
      { selector: { kind: "all" }, type: "untyped", value: -2, label: "Untyped two", sourceId: "untyped-b" },
    ];
    const forward = resolveStatisticModifier(actor, { kind: "skill", id: "athletics" }, contextModifiers(modifiers));
    const reversed = resolveStatisticModifier(actor, { kind: "skill", id: "athletics" }, contextModifiers([...modifiers].reverse()));

    expect(forward.value).toBe(4);
    expect(forward).toEqual(reversed);
    expect(forward.sources.filter((source) => source.kind === "context" && source.applied).map((source) => source.label)).toEqual([
      "Greater circumstance",
      "Greater item",
      "Greater item penalty",
      "Greater status",
      "Untyped one",
      "Untyped two",
    ]);
    expect(forward.sources.find((source) => source.label === "Lesser item")?.applied).toBe(false);
  });

  it("collects equipment, condition, trait, and context modifiers through one selector pipeline", () => {
    const actor = character({
      equipmentIds: ["boots"],
      conditions: [{ id: "frightened", sourceId: "spell" }],
      traits: [{ id: "nimble" }],
    });
    const content: CombatContent = {
      ...EMPTY_CONTENT,
      equipment: {
        boots: {
          id: "boots",
          name: "Boots",
          slot: "feet",
          traits: [],
          statModifiers: [{
            selector: { kind: "save", id: "reflex" },
            type: "item",
            value: 2,
            label: "Boots",
          }],
        },
      },
      conditions: {
        frightened: {
          id: "frightened",
          name: "Frightened",
          traits: [],
          statModifiers: [{ selector: { kind: "all" }, type: "status", value: -1, label: "Frightened" }],
        },
      },
      traits: {
        nimble: {
          id: "nimble",
          name: "Nimble",
          cardGrants: [],
          actionGrants: [],
          statModifiers: [{ selector: { kind: "save" }, type: "circumstance", value: 1, label: "Nimble" }],
        },
      },
    };
    const resolved = resolveStatisticModifier(actor, { kind: "save", id: "reflex" }, {
      content,
      modifiers: [{
        selector: { kind: "save", id: "reflex" },
        type: "untyped",
        value: -2,
        label: "Context penalty",
        sourceId: "context",
      }],
    });

    expect(resolved.value).toBe(5);
    expect(resolved.sources.filter((source) => source.applied).map((source) => source.kind)).toEqual([
      "attribute",
      "proficiency",
      "equipment",
      "condition",
      "trait",
      "context",
    ]);
  });

  it("keeps fixed creature authoring compatible with the common modifier and DC APIs", () => {
    const actor = character({
      statProfile: {
        kind: "creature",
        stats: {
          perception: 7,
          saves: { fortitude: 8, reflex: 6, will: 5 },
          skills: { athletics: 9 },
        },
      },
    });
    const context = { content: EMPTY_CONTENT };
    expect(resolveStatisticModifier(actor, { kind: "save", id: "reflex" }, context).value).toBe(6);
    expect(resolveStatisticDC(actor, { kind: "save", id: "reflex" }, context).value).toBe(16);
    expect(resolveStatisticModifier(actor, { kind: "skill", id: "athletics" }, context).value).toBe(9);
    expect(resolveInitiative(actor, context).value).toBe(7);
  });

  it("labels an unlisted creature Skill separately from an authored zero", () => {
    const actor = character({
      statProfile: {
        kind: "creature",
        stats: {
          perception: 7,
          saves: { fortitude: 8, reflex: 6, will: 5 },
          skills: { athletics: 0 },
        },
      },
    });
    const context = { content: EMPTY_CONTENT };
    const authored = resolveStatisticModifier(actor, { kind: "skill", id: "athletics" }, context);
    const unlisted = resolveStatisticModifier(actor, { kind: "skill", id: "arcana" }, context);

    expect(authored.value).toBe(0);
    expect(unlisted.value).toBe(0);
    expect(authored.sources[0]?.label).toBe("Authored Athletics");
    expect(unlisted.sources[0]?.label).toBe("Unlisted Arcana");
    expect(authored.sources[0]?.sourceId).not.toBe(unlisted.sources[0]?.sourceId);
  });

  it("rejects positive untyped modifiers from authored content and runtime context alike", () => {
    const actor = character({ equipmentIds: ["charm"] });
    const context: CombatContent = {
      ...EMPTY_CONTENT,
      equipment: {
        charm: {
          id: "charm",
          name: "Charm",
          slot: "feet",
          traits: [],
          statModifiers: [{ selector: { kind: "all" }, type: "untyped", value: 2, label: "Untyped charm" }],
        },
      },
    };

    expect(() => resolveStatisticModifier(actor, { kind: "save", id: "reflex" }, { content: context }))
      .toThrow(/Untyped modifier "Untyped charm" from equipment "charm" must be a penalty/);
    expect(() => resolveStatisticModifier(character(), { kind: "skill", id: "athletics" }, contextModifiers([{
      selector: { kind: "all" },
      type: "untyped",
      value: 0,
      label: "Untyped zero",
      sourceId: "context",
    }]))).toThrow(/must be a penalty \(value < 0\) but is 0\./);
    expect(() => resolveStatisticModifier(character(), { kind: "skill", id: "athletics" }, contextModifiers([{
      selector: { kind: "all" },
      type: "untyped",
      value: -2,
      label: "Untyped penalty",
      sourceId: "context",
    }]))).not.toThrow();
  });
});
