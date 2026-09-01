import { describe, expect, it } from "vitest";

import { resolveMapPenalty, resolveStrike, resolveStrikeSource } from "./offense";
import { formatStatisticSources, resolveClassDC } from "./statistics";
import type {
  ActorState,
  CharacterOffenseProfile,
  CharacterWeaponProfile,
  CombatContent,
  ConditionDefinition,
  EquipmentDefinition,
  FixedStrikeProfile,
  ProficiencyRank,
  SkillId,
  TraitId,
  WeaponCategory,
} from "./types";

const SKILLS: Readonly<Record<SkillId, ProficiencyRank>> = Object.fromEntries(
  [
    "acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy",
    "intimidation", "medicine", "nature", "occultism", "performance", "religion",
    "society", "stealth", "survival", "thievery",
  ].map((id) => [id, "trained"]),
) as Readonly<Record<SkillId, ProficiencyRank>>;

const DEFENSE = {
  ancestryHp: 8,
  classHpPerLevel: 8,
  armorProficiencies: {
    unarmored: "trained", light: "trained", medium: "trained", heavy: "untrained",
  },
} as const;

const FIST: CharacterWeaponProfile = {
  name: "Fist",
  category: "unarmed",
  attackMode: "melee",
  rangeFeet: 5,
  damage: { count: 1, sides: 4, damageType: "bludgeoning" },
  traits: [{ id: "agile" }],
};

function offense(overrides: Partial<CharacterOffenseProfile> = {}): CharacterOffenseProfile {
  return {
    keyAttribute: "str",
    weaponProficiencies: {
      unarmed: "trained", simple: "trained", martial: "expert", advanced: "untrained",
    },
    classDcProficiency: "trained",
    unarmedStrike: FIST,
    ...overrides,
  };
}

function weapon(overrides: Partial<CharacterWeaponProfile> = {}): CharacterWeaponProfile {
  return {
    name: "Longsword",
    category: "martial",
    attackMode: "melee",
    rangeFeet: 5,
    damage: { count: 1, sides: 8, damageType: "slashing" },
    traits: [],
    ...overrides,
  };
}

function weaponEquipment(id: string, profile: CharacterWeaponProfile): EquipmentDefinition {
  return { id, name: profile.name, slot: "weapon", traits: [], statModifiers: [], weaponProfile: profile };
}

const FRIGHTENED: ConditionDefinition = {
  id: "frightened",
  name: "Frightened",
  traits: [],
  statModifiers: [{ selector: { kind: "all" }, type: "status", value: -1, label: "Frightened" }],
};

function content(equipment: readonly EquipmentDefinition[] = []): CombatContent {
  return {
    actions: {},
    cards: {},
    conditions: { frightened: FRIGHTENED },
    equipment: Object.fromEntries(equipment.map((entry) => [entry.id, entry])),
    traits: {},
  };
}

function character(overrides: Partial<ActorState> = {}, offenseOverrides: Partial<CharacterOffenseProfile> = {}): ActorState {
  return {
    id: "hero",
    definitionId: "hero.test",
    name: "Hero",
    team: "heroes",
    position: { x: 0, y: 0 },
    facing: "north",
    hp: 20,
    maxHp: 20,
    statProfile: {
      kind: "character",
      stats: {
        level: 1,
        attributes: { str: 4, dex: 2, con: 2, int: 0, wis: 1, cha: 0 },
        perception: "trained",
        saves: { fortitude: "trained", reflex: "trained", will: "trained" },
        skills: { ...SKILLS },
        defense: DEFENSE,
        offense: offense(offenseOverrides),
      },
    },
    speedFeet: 25,
    conditions: [],
    traits: [],
    equipmentIds: [],
    innateActionIds: [],
    deckContributions: [],
    reactionAvailable: true,
    shieldRaised: false,
    defeated: false,
    ...overrides,
  };
}

const GOBLIN_STRIKE: FixedStrikeProfile = {
  name: "Goblin Blade",
  attackModifier: 9,
  rangeFeet: 5,
  damage: { count: 1, sides: 6, modifier: 4, damageType: "slashing" },
  traits: [{ id: "agile" }],
};

function creature(overrides: Partial<ActorState> = {}): ActorState {
  return {
    ...character(),
    id: "goblin",
    definitionId: "enemy.goblin",
    name: "Goblin",
    team: "enemies",
    statProfile: {
      kind: "creature",
      stats: {
        ac: 16,
        maxHp: 18,
        strike: GOBLIN_STRIKE,
        perception: 5,
        saves: { fortitude: 3, reflex: 5, will: 2 },
        skills: { athletics: 4 },
      },
    },
    ...overrides,
  };
}

describe("weapon proficiency and Strike attack", () => {
  it("maps every weapon category to its own proficiency rank", () => {
    const ranks: Readonly<Record<WeaponCategory, ProficiencyRank>> = {
      unarmed: "untrained", simple: "trained", martial: "expert", advanced: "legendary",
    };
    const attacks = (["unarmed", "simple", "martial", "advanced"] as const).map((category) => {
      const equipment = weaponEquipment("probe", weapon({ category }));
      const actor = character({ equipmentIds: ["probe"] }, { weaponProficiencies: ranks });
      return resolveStrike(actor, { content: content([equipment]) }).attackModifier;
    });
    // STR 4 + level-1 proficiency: untrained 0, trained 3, expert 5, master/legendary 9.
    expect(attacks).toEqual([4, 7, 9, 13]);
  });

  it("uses STR for melee and DEX for ranged", () => {
    const melee = weaponEquipment("sword", weapon());
    const bow = weaponEquipment("bow", weapon({ name: "Shortbow", attackMode: "ranged", rangeFeet: 60 }));
    const meleeStrike = resolveStrike(character({ equipmentIds: ["sword"] }), { content: content([melee]) });
    const rangedStrike = resolveStrike(character({ equipmentIds: ["bow"] }), { content: content([bow]) });
    expect([meleeStrike.attackAttribute, meleeStrike.attackModifier]).toEqual(["str", 9]);
    expect([rangedStrike.attackAttribute, rangedStrike.attackModifier]).toEqual(["dex", 7]);
  });

  it("picks the higher legal Attribute for a finesse weapon without prompting", () => {
    const finesse = weaponEquipment("rapier", weapon({ name: "Rapier", traits: [{ id: "finesse" }] }));
    const context = { content: content([finesse]) };
    const strong = resolveStrike(character({ equipmentIds: ["rapier"] }), context);
    const nimble = resolveStrike(
      character({
        equipmentIds: ["rapier"],
        statProfile: {
          kind: "character",
          stats: {
            level: 1,
            attributes: { str: 1, dex: 4, con: 2, int: 0, wis: 1, cha: 0 },
            perception: "trained",
            saves: { fortitude: "trained", reflex: "trained", will: "trained" },
            skills: { ...SKILLS },
            defense: DEFENSE,
            offense: offense(),
          },
        },
      }),
      context,
    );
    expect([strong.attackAttribute, strong.attackModifier]).toEqual(["str", 9]);
    expect([nimble.attackAttribute, nimble.attackModifier]).toEqual(["dex", 9]);
    // The breakdown records which Attribute actually won, not just the total.
    expect(nimble.sources.map((source) => source.label)).toContain("DEX");
  });

  it("uses DEX to attack with a thrown weapon", () => {
    const javelin = weaponEquipment("javelin", weapon({
      name: "Javelin", attackMode: "ranged", rangeFeet: 30, traits: [{ id: "thrown" }],
    }));
    const strike = resolveStrike(character({ equipmentIds: ["javelin"] }), { content: content([javelin]) });
    expect([strike.attackAttribute, strike.attackModifier]).toEqual(["dex", 7]);
  });

  it("routes typed attack modifiers through the shared stacking rules", () => {
    const sword = weaponEquipment("sword", weapon());
    const actor = character({ equipmentIds: ["sword"], conditions: [{ id: "frightened", sourceId: "spell" }] });
    const strike = resolveStrike(actor, {
      content: content([sword]),
      modifiers: [
        { selector: { kind: "attack" }, type: "status", value: -2, label: "Sickened", sourceId: "sickened" },
        { selector: { kind: "attack" }, type: "item", value: 1, label: "Weapon potency", sourceId: "rune" },
        { selector: { kind: "damage" }, type: "item", value: 2, label: "Damage rune", sourceId: "rune" },
      ],
    });
    // Two status penalties: only the worst applies. The item bonus is a separate type.
    expect(strike.attackModifier).toBe(4 + 5 - 2 + 1);
    expect(formatStatisticSources(strike.sources)).not.toContain("Frightened -1");
    // A check penalty never reaches damage; the damage item bonus does.
    expect(strike.damage.flatModifier).toBe(4 + 2);
  });

  it("falls back to the authored unarmed Strike when the weapon slot is empty", () => {
    const source = resolveStrikeSource(character(), { content: content() });
    const strike = resolveStrike(character(), { content: content() });
    expect(source.kind).toBe("unarmed");
    expect([strike.weaponName, strike.weaponCategory, strike.attackModifier]).toEqual(["Fist", "unarmed", 7]);
  });
});

describe("multiple attack penalty", () => {
  it("walks the standard ladder and the eased agile ladder", () => {
    expect([0, 1, 2, 3].map((n) => resolveMapPenalty(n))).toEqual([0, -5, -10, -10]);
    expect([0, 1, 2, 3].map((n) => resolveMapPenalty(n, ["agile"]))).toEqual([0, -4, -8, -8]);
  });

  it("eases MAP only for a Strike made with the agile weapon itself", () => {
    const agile = weaponEquipment("dagger", weapon({ name: "Dagger", traits: [{ id: "agile" }] }));
    const heavy = weaponEquipment("sword", weapon());
    const agileStrike = resolveStrike(character({ equipmentIds: ["dagger"] }), { content: content([agile]) }, { attacksThisTurn: 1 });
    const heavyStrike = resolveStrike(character({ equipmentIds: ["sword"] }), { content: content([heavy]) }, { attacksThisTurn: 1 });
    expect([agileStrike.mapPenalty, heavyStrike.mapPenalty]).toEqual([-4, -5]);
    // An Attack-trait Skill Action such as Trip never reads the weapon's agile trait.
    expect(resolveMapPenalty(1)).toBe(-5);
    expect(agileStrike.sources.map((source) => source.label)).toContain("Multiple attack penalty (agile)");
  });
});

describe("Strike damage", () => {
  it("adds STR in melee, nothing on a plain ranged Strike, and STR again when thrown", () => {
    const sword = weaponEquipment("sword", weapon());
    const bow = weaponEquipment("bow", weapon({ name: "Shortbow", attackMode: "ranged", rangeFeet: 60 }));
    const javelin = weaponEquipment("javelin", weapon({
      name: "Javelin", attackMode: "ranged", rangeFeet: 30, traits: [{ id: "thrown" }],
    }));
    const flat = (id: string, equipment: EquipmentDefinition) =>
      resolveStrike(character({ equipmentIds: [id] }), { content: content([equipment]) }).damage.flatModifier;
    expect([flat("sword", sword), flat("bow", bow), flat("javelin", javelin)]).toEqual([4, 0, 4]);
  });

  it("halves a positive STR for propulsive and keeps a negative one whole", () => {
    const sling = weaponEquipment("sling", weapon({
      name: "Sling", attackMode: "ranged", rangeFeet: 50, traits: [{ id: "propulsive" }],
    }));
    const context = { content: content([sling]) };
    const strong = resolveStrike(character({ equipmentIds: ["sling"] }), context);
    const weak = character({ equipmentIds: ["sling"] });
    const feeble = resolveStrike({
      ...weak,
      statProfile: weak.statProfile.kind === "character"
        ? {
            kind: "character",
            stats: { ...weak.statProfile.stats, attributes: { ...weak.statProfile.stats.attributes, str: -2 } },
          }
        : weak.statProfile,
    }, context);
    expect(strong.damage.flatModifier).toBe(2);
    expect(feeble.damage.flatModifier).toBe(-2);
  });
});

describe("Class DC", () => {
  it("derives from key Attribute, proficiency, the modifier stack, and a base of 10", () => {
    const actor = character();
    expect(resolveClassDC(actor, { content: content() }).value).toBe(10 + 4 + 3);
    expect(formatStatisticSources(resolveClassDC(actor, { content: content() }).sources)).toEqual([
      "DC base +10",
      "STR (key) +4",
      "Trained class DC proficiency +3",
    ]);
  });

  it("moves with the Class DC proficiency rank and with the key Attribute", () => {
    const expert = character({}, { classDcProficiency: "expert" });
    const casterKey = character({}, { keyAttribute: "dex" });
    expect(resolveClassDC(expert, { content: content() }).value).toBe(10 + 4 + 5);
    expect(resolveClassDC(casterKey, { content: content() }).value).toBe(10 + 2 + 3);
  });

  it("stays distinct from Save and Skill DCs and rejects creature profiles", () => {
    const actor = character({ conditions: [{ id: "frightened", sourceId: "spell" }] });
    const context = { content: content() };
    // Frightened reaches every check and DC through `all`, Class DC included.
    expect(resolveClassDC(actor, context).value).toBe(10 + 4 + 3 - 1);
    expect(() => resolveClassDC(creature(), context)).toThrow(/Class DC is a Character statistic/);
  });
});

describe("creature fixed Strike", () => {
  it("keeps authored attack and damage instead of a Character derivation", () => {
    const strike = resolveStrike(creature(), { content: content() });
    expect([strike.weaponName, strike.attackModifier, strike.damage.flatModifier]).toEqual(["Goblin Blade", 9, 4]);
    expect([strike.weaponCategory, strike.proficiencyRank, strike.attackAttribute]).toEqual([null, null, null]);
    expect(strike.sources[0]?.label).toBe("Authored Goblin Blade");
  });

  it("ignores any weapon equipment it happens to carry", () => {
    const sword = weaponEquipment("sword", weapon());
    const armed = creature({ equipmentIds: ["sword"] });
    expect(resolveStrike(armed, { content: content([sword]) }).weaponName).toBe("Goblin Blade");
  });

  it("still takes the shared modifier stack and its own agile MAP", () => {
    const afraid = creature({ conditions: [{ id: "frightened", sourceId: "spell" }] });
    const strike = resolveStrike(afraid, { content: content() }, { attacksThisTurn: 1 });
    expect(strike.attackModifier).toBe(9 - 1 - 4);
    expect(strike.damage.flatModifier).toBe(4);
    expect(strike.traits as readonly TraitId[]).toEqual(["agile"]);
  });
});
