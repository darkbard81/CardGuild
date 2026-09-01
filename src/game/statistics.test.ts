import { describe, expect, it } from "vitest";

import type {
  ActorState,
  ArmorProfile,
  ArmoredCategory,
  CharacterDefenseProfile,
  CombatContent,
  EquipmentDefinition,
  InitiativeStatisticSelector,
  ProficiencyRank,
  SkillId,
  StatisticContextModifier,
} from "./types";
import {
  ARMOR_CATEGORIES,
  SAVE_ATTRIBUTE,
  SKILL_ATTRIBUTE,
  SKILL_IDS,
  deriveMaxHp,
  formatStatisticSources,
  proficiencyBonus,
  resolveArmorClass,
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

const DEFENSE = {
  ancestryHp: 8,
  classHpPerLevel: 8,
  armorProficiencies: {
    unarmored: "trained",
    light: "trained",
    medium: "trained",
    heavy: "untrained",
  },
} as const satisfies CharacterDefenseProfile;

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
    statProfile: {
      kind: "character",
      stats: {
        level: 1,
        attributes: { str: 1, dex: 2, con: 3, int: 4, wis: 5, cha: 6 },
        perception: "trained",
        saves: { fortitude: "trained", reflex: "trained", will: "trained" },
        skills: { ...SKILLS },
        defense: DEFENSE,
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
          defense: DEFENSE,
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
          defense: DEFENSE,
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
          ac: 16,
          maxHp: 20,
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
          ac: 16,
          maxHp: 20,
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

describe("PF2e Armor Class and Hit Point derivation", () => {
  const ARMORS: Readonly<Record<ArmoredCategory, ArmorProfile>> = {
    light: { category: "light", acItemBonus: 1, dexCap: 4 },
    medium: { category: "medium", acItemBonus: 3, dexCap: 2 },
    heavy: { category: "heavy", acItemBonus: 5, dexCap: 1 },
  };

  function armorEquipment(id: string, profile: ArmorProfile): EquipmentDefinition {
    return { id, name: titleOf(id), slot: "armor", traits: [], statModifiers: [], armorProfile: profile };
  }

  function titleOf(id: string): string {
    return `${id[0]?.toUpperCase() ?? ""}${id.slice(1)}`;
  }

  function armored(
    category: ArmoredCategory | "unarmored",
    overrides: {
      readonly dex?: number;
      readonly ranks?: Partial<Record<ArmoredCategory | "unarmored", "untrained" | "trained" | "expert">>;
      readonly extraEquipment?: Readonly<Record<string, EquipmentDefinition>>;
      readonly actor?: Partial<ActorState>;
    } = {},
  ) {
    const armor = category === "unarmored" ? undefined : ARMORS[category];
    const equipment: Record<string, EquipmentDefinition> = {
      ...(armor ? { [category]: armorEquipment(category, armor) } : {}),
      ...overrides.extraEquipment,
    };
    const base = character();
    const stats = base.statProfile.kind === "character" ? base.statProfile.stats : null;
    if (!stats) throw new Error("The character fixture must use a character profile.");
    const actor = character({
      equipmentIds: Object.keys(equipment),
      statProfile: {
        kind: "character",
        stats: {
          ...stats,
          attributes: { ...stats.attributes, dex: overrides.dex ?? stats.attributes.dex },
          defense: {
            ...DEFENSE,
            armorProficiencies: {
              unarmored: "trained",
              light: "trained",
              medium: "trained",
              heavy: "trained",
              ...overrides.ranks,
            },
          },
        },
      },
      ...overrides.actor,
    });
    return { actor, context: { content: { ...EMPTY_CONTENT, equipment } } };
  }

  it("derives an unarmored AC from the full DEX and the unarmored proficiency", () => {
    const { actor, context } = armored("unarmored", { dex: 4 });
    const resolved = resolveArmorClass(actor, context);

    expect(resolved.value).toBe(17);
    expect(formatStatisticSources(resolved.sources)).toEqual(["Base AC +10", "DEX +4", "Trained unarmored armor proficiency +3"]);
  });

  it("uses the proficiency rank of the worn armor category", () => {
    for (const category of ["light", "medium", "heavy"] as const) {
      const trained = armored(category, { dex: 0 });
      const expert = armored(category, { dex: 0, ranks: { [category]: "expert" } });
      const trainedValue = resolveArmorClass(trained.actor, trained.context).value;

      expect(trainedValue).toBe(10 + 3 + ARMORS[category].acItemBonus);
      expect(resolveArmorClass(expert.actor, expert.context).value - trainedValue).toBe(2);
    }
    expect(ARMOR_CATEGORIES).toEqual(["unarmored", "light", "medium", "heavy"]);
  });

  it("caps DEX at the armor limit and leaves a lower DEX untouched", () => {
    const capped = armored("heavy", { dex: 4 });
    const resolvedCapped = resolveArmorClass(capped.actor, capped.context);
    expect(resolvedCapped.value).toBe(10 + 1 + 3 + 5);
    expect(resolvedCapped.sources.find((source) => source.kind === "attribute")?.label).toBe("DEX (cap 1)");

    const uncapped = armored("heavy", { dex: 0 });
    const resolvedUncapped = resolveArmorClass(uncapped.actor, uncapped.context);
    expect(resolvedUncapped.value).toBe(10 + 0 + 3 + 5);
    expect(resolvedUncapped.sources.find((source) => source.kind === "attribute")?.label).toBe("DEX");
  });

  it("applies armor as an item bonus that loses to a larger item bonus", () => {
    const { actor, context } = armored("light", {
      dex: 0,
      extraEquipment: {
        talisman: {
          id: "talisman",
          name: "Talisman",
          slot: "feet",
          traits: [],
          statModifiers: [{ selector: { kind: "ac" }, type: "item", value: 2, label: "Talisman" }],
        },
      },
    });
    const resolved = resolveArmorClass(actor, context);

    expect(resolved.value).toBe(10 + 0 + 3 + 2);
    expect(resolved.sources.find((source) => source.label === "Light")?.applied).toBe(false);
    expect(resolved.sources.find((source) => source.label === "Talisman")?.applied).toBe(true);
  });

  it("adds a raised shield as a circumstance bonus and drops it when lowered", () => {
    const shield: EquipmentDefinition = {
      id: "shield",
      name: "Shield",
      slot: "shield",
      traits: [],
      statModifiers: [],
      shieldBonus: 2,
    };
    const lowered = armored("light", { dex: 0, extraEquipment: { shield } });
    const raised = armored("light", { dex: 0, extraEquipment: { shield }, actor: { shieldRaised: true } });

    expect(resolveArmorClass(lowered.actor, lowered.context).value).toBe(14);
    const resolved = resolveArmorClass(raised.actor, raised.context);
    expect(resolved.value).toBe(16);
    expect(resolved.sources.find((source) => source.label === "Shield raised")?.modifierType).toBe("circumstance");
  });

  it("orders an item, circumstance, and status breakdown deterministically", () => {
    const shield: EquipmentDefinition = {
      id: "shield", name: "Shield", slot: "shield", traits: [], statModifiers: [], shieldBonus: 2,
    };
    const { actor, context } = armored("medium", { dex: 4, extraEquipment: { shield }, actor: { shieldRaised: true } });
    const frightened = {
      ...context,
      content: {
        ...context.content,
        conditions: {
          frightened: {
            id: "frightened",
            name: "Frightened",
            traits: [],
            statModifiers: [{ selector: { kind: "all" as const }, type: "status" as const, value: -1, label: "Frightened" }],
          },
        },
      },
    };
    const afraid = { ...actor, conditions: [{ id: "frightened", sourceId: "spell" }] };
    const resolved = resolveArmorClass(afraid, frightened);

    expect(resolved.value).toBe(10 + 2 + 3 + 3 + 2 - 1);
    expect(formatStatisticSources(resolved.sources)).toEqual([
      "Base AC +10",
      "DEX (cap 2) +2",
      "Trained medium armor proficiency +3",
      "Medium +3",
      "Shield raised +2",
      "Frightened -1",
    ]);
    expect(resolveArmorClass({ ...afraid, equipmentIds: [...afraid.equipmentIds].reverse() }, frightened)).toEqual(resolved);
  });

  it("keeps creature AC authored while still applying the shared modifier stack", () => {
    const creature = character({
      statProfile: {
        kind: "creature",
        stats: {
          ac: 16,
          maxHp: 20,
          perception: 7,
          saves: { fortitude: 8, reflex: 6, will: 5 },
          skills: { athletics: 9 },
        },
      },
      conditions: [{ id: "frightened", sourceId: "spell" }],
    });
    const context = {
      content: {
        ...EMPTY_CONTENT,
        conditions: {
          frightened: {
            id: "frightened",
            name: "Frightened",
            traits: [],
            statModifiers: [{ selector: { kind: "all" as const }, type: "status" as const, value: -1, label: "Frightened" }],
          },
        },
      },
    };

    expect(resolveArmorClass(creature, context).value).toBe(15);
    expect(resolveArmorClass(creature, context).sources[0]?.label).toBe("Authored AC");
  });

  it("derives max HP from ancestry, class, and CON across levels", () => {
    const profile = {
      level: 1,
      attributes: { str: 0, dex: 0, con: 3, int: 0, wis: 0, cha: 0 },
      perception: "trained" as const,
      saves: { fortitude: "trained" as const, reflex: "trained" as const, will: "trained" as const },
      skills: { ...SKILLS },
      defense: { ...DEFENSE, ancestryHp: 8, classHpPerLevel: 10 },
    };

    expect(deriveMaxHp(profile)).toBe(21);
    expect(deriveMaxHp({ ...profile, level: 4 })).toBe(8 + 4 * 13);
    expect(deriveMaxHp({ ...profile, attributes: { ...profile.attributes, con: 5 } })).toBe(23);
    expect(deriveMaxHp({ ...profile, level: 4, attributes: { ...profile.attributes, con: 5 } })).toBe(8 + 4 * 15);
  });
});
